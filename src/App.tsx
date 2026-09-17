import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { useEffect, useMemo, useRef, useState } from "react";
import appPackage from "../package.json";
import {
  clearRememberedLogin,
  formatErrorMessage,
  getAuthSettings,
  getRememberedLogin,
  getSession,
  login,
  logout,
  refreshSession,
  register,
  requestPasswordResetCode,
  requestRegistrationCode,
  resetPassword,
  saveRememberedLogin,
} from "./auth";
import type { AuthSession } from "./auth";

type Mode = "login" | "register" | "forgot";
type RepeatMode = "count" | "infinite";
type ClickButton = "left" | "right" | "middle";
interface ClickProfile {
  x: number;
  y: number;
  width: number;
  height: number;
  intervalMs: number;
  pressDurationMs: number;
  repeatMode: RepeatMode;
  repeatCount: number;
  button: ClickButton;
  targets: ClickTarget[];
}
interface ClickTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface SavedProfile {
  name: string;
  profile: ClickProfile;
}
interface RunLog {
  id: string;
  startedAt: string;
  endedAt: string;
  clicks: number;
  result: "completed" | "stopped" | "error";
  error?: string;
}

const SAVED_PROFILES_KEY = "gotap.savedProfiles.v1";
const RUN_LOGS_KEY = "gotap.runLogs.v1";
interface ClickerStatus {
  state: "idle" | "running" | "stopped" | "completed" | "error";
  completed: number;
  targetCount: number | null;
  error: string | null;
}

interface SelectionPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_PROFILE: ClickProfile = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  intervalMs: 1000,
  pressDurationMs: 100,
  repeatMode: "count",
  repeatCount: 10,
  button: "left",
  targets: [],
};

function CursorLogo() {
  return (
    <svg
      className="cursor-logo"
      viewBox="0 0 100 100"
      role="img"
      aria-label="GoTap 鼠标箭头标志"
    >
      <path
        d="M25 15 70 53 52 56 64 82 54 87 42 61 31 75Z"
        fill="currentColor"
        stroke="#123b5b"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle
        cx="72"
        cy="27"
        r="6"
        fill="#65c7ff"
        stroke="#123b5b"
        strokeWidth="2.5"
      />
    </svg>
  );
}

function SelectionOverlay() {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const close = () => void getCurrentWindow().close();
  const finish = async (point: { x: number; y: number }) => {
    if (!start) return;
    const left = Math.min(start.x, point.x);
    const top = Math.min(start.y, point.y);
    const width = Math.abs(point.x - start.x);
    const height = Math.abs(point.y - start.y);
    if (width < 2 || height < 2) {
      close();
      return;
    }
    await emit("selection:completed", {
      x: Math.round(left + width / 2),
      y: Math.round(top + height / 2),
      width: Math.round(width),
      height: Math.round(height),
    } satisfies SelectionPayload);
    close();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  const rectangle =
    start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : undefined;
  return (
    <main
      className="selection-overlay"
      onMouseDown={(event) => {
        if (event.button === 0) {
          setStart({ x: event.clientX, y: event.clientY });
          setCurrent({ x: event.clientX, y: event.clientY });
        }
      }}
      onMouseMove={(event) => {
        if (start) setCurrent({ x: event.clientX, y: event.clientY });
      }}
      onMouseUp={(event) => {
        if (event.button === 0)
          void finish({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="selection-instructions">
        拖拽框选点击区域 · 松开鼠标确认 · Esc 取消
      </div>
      {rectangle && <div className="selection-rectangle" style={rectangle} />}
    </main>
  );
}

function AuthPage({
  onAuthenticated,
}: {
  onAuthenticated: (session: AuthSession) => void;
}) {
  const remembered = useMemo(() => getRememberedLogin(), []);
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(remembered?.email ?? "");
  const [password, setPassword] = useState(remembered?.password ?? "");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(Boolean(remembered));
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void getAuthSettings()
      .then((value) => setRegistrationEnabled(value.registration_enabled))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setInterval(
      () => setCountdown((value) => Math.max(value - 1, 0)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [countdown]);

  const sendCode = async () => {
    if (!email.includes("@")) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "forgot") await requestPasswordResetCode(email);
      else await requestRegistrationCode(email);
      setCountdown(60);
      setMessage("验证码已发送，请检查邮箱");
    } catch (submissionError) {
      setError(formatErrorMessage(submissionError));
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let session: AuthSession | undefined;
      if (mode === "login") session = await login(email, password);
      else if (mode === "register")
        session = await register(name, email, code, password);
      else {
        await resetPassword(email, code, password);
        setMode("login");
        setMessage("密码已重置，请使用新密码登录");
        return;
      }
      if (remember) saveRememberedLogin(email, password);
      else clearRememberedLogin();
      onAuthenticated(session);
    } catch (submissionError) {
      setError(formatErrorMessage(submissionError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-shell">
      <section className="card auth-card">
        <div className="brand">
          <div className="brand-mark">
            <CursorLogo />
          </div>
          <div>
            <strong>GoTap</strong>
            <small>轻量、可靠的桌面自动点击器</small>
          </div>
        </div>
        <p className="eyebrow">
          {mode === "login"
            ? "欢迎回来"
            : mode === "register"
              ? "创建账号"
              : "找回密码"}
        </p>
        <h1>
          {mode === "login"
            ? "用户登录"
            : mode === "register"
              ? "注册账号"
              : "重置密码"}
        </h1>
        <form onSubmit={(event) => void submit(event)} className="form">
          {mode === "register" && (
            <label>
              姓名
              <input
                value={name}
                maxLength={10}
                onChange={(event) => setName(event.target.value)}
                placeholder="可选"
              />
            </label>
          )}
          <label>
            邮箱
            <input
              required
              type="email"
              value={email}
              readOnly={mode === "forgot"}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {(mode === "register" || mode === "forgot") && (
            <label>
              验证码
              <div className="code-row">
                <input
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="6 位验证码"
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || countdown > 0}
                  onClick={() => void sendCode()}
                >
                  {countdown ? `${countdown}s 后重发` : "发送验证码"}
                </button>
              </div>
            </label>
          )}
          <label>
            密码
            <input
              required
              minLength={8}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
            />
          </label>
          {mode === "login" && (
            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              记住登录信息
            </label>
          )}
          {error && <p className="error">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button className="primary" disabled={busy}>
            {busy
              ? "处理中…"
              : mode === "login"
                ? "登录"
                : mode === "register"
                  ? "注册并登录"
                  : "重置密码"}
          </button>
        </form>
        <div className="auth-links">
          {mode === "login" && (
            <>
              <button onClick={() => setMode("forgot")}>忘记密码</button>
              {registrationEnabled && (
                <button onClick={() => setMode("register")}>注册账号</button>
              )}
            </>
          )}
          {mode !== "login" && (
            <button onClick={() => setMode("login")}>返回登录</button>
          )}
        </div>
      </section>
    </main>
  );
}

function ClickerPage({
  session,
  onLogout,
}: {
  session: AuthSession;
  onLogout: () => void;
}) {
  const [profile, setProfile] = useState<ClickProfile>(DEFAULT_PROFILE);
  const [status, setStatus] = useState<ClickerStatus>({
    state: "idle",
    completed: 0,
    targetCount: null,
    error: null,
  });
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [message, setMessage] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [hasAvailableUpdate, setHasAvailableUpdate] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateState, setUpdateState] = useState<
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "installing"
    | "latest"
    | "error"
  >("idle");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const updateCheckInFlight = useRef(false);
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>(() => {
    try {
      const value = localStorage.getItem(SAVED_PROFILES_KEY);
      return value ? (JSON.parse(value) as SavedProfile[]) : [];
    } catch {
      return [];
    }
  });
  const [profileName, setProfileName] = useState("");
  const [runLogs, setRunLogs] = useState<RunLog[]>(() => {
    try {
      const value = localStorage.getItem(RUN_LOGS_KEY);
      return value ? (JSON.parse(value) as RunLog[]).slice(0, 20) : [];
    } catch {
      return [];
    }
  });
  const runStartedAt = useRef<number | null>(null);
  const previousState = useRef<ClickerStatus["state"]>("idle");

  const persistProfiles = (profiles: SavedProfile[]) => {
    setSavedProfiles(profiles);
    localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify(profiles));
  };
  const persistRunLogs = (logs: RunLog[]) => {
    setRunLogs(logs);
    localStorage.setItem(RUN_LOGS_KEY, JSON.stringify(logs));
  };
  const checkForUpdates = async (openDialog = true) => {
    if (
      updateCheckInFlight.current ||
      updateState === "downloading" ||
      updateState === "installing"
    )
      return;
    updateCheckInFlight.current = true;
    if (openDialog) {
      setUpdateDialogOpen(true);
      setUpdateState("checking");
      setUpdateError(null);
    }
    try {
      const update = await check({ timeout: 15_000 });
      if (!update) {
        setHasAvailableUpdate(false);
        if (openDialog) setUpdateState("latest");
        return;
      }
      setAvailableUpdate(update);
      setHasAvailableUpdate(true);
      if (openDialog) setUpdateState("available");
    } catch (error) {
      if (openDialog) {
        setUpdateState("error");
        setUpdateError(formatErrorMessage(error));
      }
    } finally {
      updateCheckInFlight.current = false;
    }
  };
  const closeUpdateDialog = async () => {
    if (updateState === "downloading" || updateState === "installing") return;
    await availableUpdate?.close().catch(() => undefined);
    setAvailableUpdate(null);
    setUpdateDialogOpen(false);
    setUpdateState("idle");
    setUpdateError(null);
  };
  const installUpdate = async () => {
    if (!availableUpdate) return;
    setUpdateState("downloading");
    setUpdateProgress(0);
    setUpdateError(null);
    try {
      let downloaded = 0;
      let total = 0;
      await availableUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0)
            setUpdateProgress(Math.min(100, (downloaded / total) * 100));
        } else if (event.event === "Finished") setUpdateProgress(100);
      });
      setUpdateState("installing");
      await relaunch();
    } catch (error) {
      setUpdateState("error");
      setUpdateError(formatErrorMessage(error));
    }
  };

  useEffect(() => {
    void invoke<ClickProfile | null>("load_settings")
      .then((value) => {
        if (value)
          setProfile({
            ...DEFAULT_PROFILE,
            ...value,
            targets: value.targets ?? [],
          });
      })
      .catch(() => undefined);
    void invoke<boolean>("get_auto_launch_status")
      .then(setAutoLaunch)
      .catch(() => undefined);
    void invoke<ClickerStatus>("get_clicker_status")
      .then(setStatus)
      .catch(() => undefined);
    let dispose: (() => void) | undefined;
    void listen<ClickerStatus>("clicker:status", (event) =>
      setStatus(event.payload),
    ).then((unlisten) => {
      dispose = unlisten;
    });
    let disposeSelection: (() => void) | undefined;
    void listen<SelectionPayload>("selection:completed", (event) => {
      setProfile((current) => ({ ...current, ...event.payload }));
      setMessage(
        `已选择区域中心 (${event.payload.x}, ${event.payload.y})，大小 ${event.payload.width} × ${event.payload.height}`,
      );
    }).then((unlisten) => {
      disposeSelection = unlisten;
    });
    return () => {
      dispose?.();
      disposeSelection?.();
    };
  }, []);

  useEffect(() => {
    void checkForUpdates(false);
    const interval = window.setInterval(
      () => void checkForUpdates(false),
      5 * 60_000,
    );
    const onFocus = () => void checkForUpdates(false);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const previous = previousState.current;
    if (status.state === "running" && previous !== "running") {
      runStartedAt.current = Date.now();
    } else if (
      previous === "running" &&
      status.state !== "running" &&
      ["completed", "stopped", "error"].includes(status.state)
    ) {
      const started = runStartedAt.current ?? Date.now();
      const result = status.state as RunLog["result"];
      const log: RunLog = {
        id: `${started}-${status.completed}`,
        startedAt: new Date(started).toISOString(),
        endedAt: new Date().toISOString(),
        clicks: status.completed,
        result,
        ...(status.error ? { error: status.error } : {}),
      };
      persistRunLogs([log, ...runLogs].slice(0, 20));
      runStartedAt.current = null;
    }
    previousState.current = status.state;
  }, [status.state, status.completed, status.error]);

  const update = <K extends keyof ClickProfile>(
    key: K,
    value: ClickProfile[K],
  ) => setProfile((current) => ({ ...current, [key]: value }));
  const captureCursor = async () => {
    try {
      const [x, y] = await invoke<[number, number]>("get_cursor_position");
      setProfile((current) => ({ ...current, x, y, width: 0, height: 0 }));
      setMessage(`已选择坐标 (${x}, ${y})`);
    } catch (error) {
      setMessage(formatErrorMessage(error));
    }
  };
  const selectArea = async () => {
    setMessage("请在目标窗口上拖拽框选区域，按 Esc 可取消");
    try {
      await invoke("open_selection_window");
    } catch (error) {
      setMessage(formatErrorMessage(error));
    }
  };
  const addCurrentTarget = () => {
    setProfile((current) => ({
      ...current,
      targets: [
        ...current.targets,
        {
          x: current.x,
          y: current.y,
          width: current.width,
          height: current.height,
        },
      ],
    }));
    setMessage(`已添加第 ${profile.targets.length + 1} 个点击步骤`);
  };
  const removeTarget = (index: number) => {
    setProfile((current) => ({
      ...current,
      targets: current.targets.filter(
        (_, targetIndex) => targetIndex !== index,
      ),
    }));
  };
  const saveNamedProfile = () => {
    const name = profileName.trim();
    if (!name) {
      setMessage("请输入方案名称");
      return;
    }
    const snapshot = JSON.parse(JSON.stringify(profile)) as ClickProfile;
    const next = savedProfiles.filter((item) => item.name !== name);
    next.push({ name, profile: snapshot });
    persistProfiles(next);
    setProfileName(name);
    setMessage(`方案“${name}”已保存`);
  };
  const loadNamedProfile = (name: string) => {
    const item = savedProfiles.find((value) => value.name === name);
    if (!item) return;
    setProfile({
      ...DEFAULT_PROFILE,
      ...item.profile,
      targets: item.profile.targets ?? [],
    });
    setProfileName(name);
    setMessage(`已切换到方案“${name}”`);
  };
  const deleteNamedProfile = () => {
    const name = profileName.trim();
    if (!name) return;
    persistProfiles(savedProfiles.filter((item) => item.name !== name));
    setProfileName("");
    setMessage(`方案“${name}”已删除`);
  };
  const clearRunLogs = () => {
    persistRunLogs([]);
    setMessage("运行日志已清空");
  };
  const formatRunTime = (value: string) =>
    new Date(value).toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const totalClicks = runLogs.reduce((sum, log) => sum + log.clicks, 0);
  const start = async () => {
    setMessage("");
    try {
      await invoke("save_settings", { profile });
      await invoke("start_clicking", { profile });
    } catch (error) {
      setMessage(formatErrorMessage(error));
    }
  };
  const stop = () => {
    void invoke("stop_clicking_command").catch((error) =>
      setMessage(formatErrorMessage(error)),
    );
  };
  const running = status.state === "running";
  useEffect(() => {
    let disposeToggle: (() => void) | undefined;
    let disposeStop: (() => void) | undefined;
    void listen("hotkey:toggle", () => {
      if (running) stop();
      else void start();
    }).then((unlisten) => {
      disposeToggle = unlisten;
    });
    void listen("hotkey:stop", () => {
      if (running) stop();
    }).then((unlisten) => {
      disposeStop = unlisten;
    });
    return () => {
      disposeToggle?.();
      disposeStop?.();
    };
  }, [running, profile]);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void listen("tray:toggle-clicker", () => {
      if (running) stop();
      else void start();
    }).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [running, profile]);
  const toggleAutoLaunch = async (enabled: boolean) => {
    try {
      setAutoLaunch(await invoke<boolean>("set_auto_launch", { enabled }));
    } catch (error) {
      setMessage(formatErrorMessage(error));
    }
  };
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <CursorLogo />
          </div>
          <div>
            <strong>GoTap</strong>
            <small className="brand-subtitle">
              桌面自动点击器
              <button
                className="brand-version-button"
                onClick={() => void checkForUpdates(true)}
                title="检查更新"
                type="button"
              >
                v{appPackage.version}
                {hasAvailableUpdate && (
                  <span
                    className="update-available-dot"
                    aria-label="有新版本可更新"
                  />
                )}
              </button>
            </small>
          </div>
        </div>
        <div className="account">
          <span>{session.user.name || session.user.email}</span>
          <button onClick={() => void logout().finally(onLogout)}>退出</button>
        </div>
      </header>
      <section className="content">
        <div className="card target-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">目标位置</p>
              <h2>选择要点击的按钮</h2>
            </div>
            <span className={`state state-${status.state}`}>
              {running
                ? "运行中"
                : status.state === "completed"
                  ? "已完成"
                  : status.state === "error"
                    ? "错误"
                    : "已停止"}
            </span>
          </div>
          <div className="coordinates">
            <div>
              <span>X</span>
              <strong>{profile.x}</strong>
            </div>
            <div>
              <span>Y</span>
              <strong>{profile.y}</strong>
            </div>
          </div>
          <button
            className="secondary wide"
            onClick={() => void captureCursor()}
            disabled={running}
          >
            将鼠标移到目标后读取当前位置
          </button>
          <button
            className="secondary wide"
            onClick={() => void selectArea()}
            disabled={running}
          >
            拖拽框选目标区域
          </button>
          {profile.width > 0 && profile.height > 0 && (
            <p className="selection-summary">
              已选择区域：{profile.width} × {profile.height}（点击中心）
            </p>
          )}
          <div className="target-actions">
            <button
              className="secondary"
              onClick={addCurrentTarget}
              disabled={running}
            >
              添加当前坐标为步骤
            </button>
            {profile.targets.length > 0 && (
              <button
                className="secondary"
                onClick={() =>
                  setProfile((current) => ({ ...current, targets: [] }))
                }
                disabled={running}
              >
                清空步骤
              </button>
            )}
          </div>
          {profile.targets.length > 0 && (
            <div className="target-list">
              {profile.targets.map((target, index) => (
                <div
                  className="target-item"
                  key={`${target.x}-${target.y}-${index}`}
                >
                  <span>步骤 {index + 1}</span>
                  <code>
                    ({target.x}, {target.y})
                    {target.width > 0 &&
                      ` · ${target.width} × ${target.height}`}
                  </code>
                  <button
                    className="remove-target"
                    onClick={() => removeTarget(index)}
                    disabled={running}
                    aria-label={`删除步骤 ${index + 1}`}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="hint">
            添加步骤后将按列表顺序循环点击；未添加步骤时使用当前坐标。跨显示器坐标以当前主屏为基准。
          </p>
        </div>
        <div className="card">
          <p className="eyebrow">点击参数</p>
          <div className="grid">
            <label>
              点击间隔（毫秒）
              <input
                type="number"
                min={10}
                value={profile.intervalMs}
                onChange={(event) =>
                  update("intervalMs", Number(event.target.value))
                }
              />
            </label>
            <label>
              按下时长（毫秒）
              <input
                type="number"
                min={1}
                value={profile.pressDurationMs}
                onChange={(event) =>
                  update("pressDurationMs", Number(event.target.value))
                }
              />
            </label>
            <label>
              鼠标按键
              <select
                value={profile.button}
                onChange={(event) =>
                  update("button", event.target.value as ClickButton)
                }
              >
                <option value="left">左键</option>
                <option value="right">右键</option>
                <option value="middle">中键</option>
              </select>
            </label>
            <label>
              执行次数
              <select
                value={profile.repeatMode}
                onChange={(event) =>
                  update("repeatMode", event.target.value as RepeatMode)
                }
              >
                <option value="count">指定次数</option>
                <option value="infinite">无限循环</option>
              </select>
            </label>
            {profile.repeatMode === "count" && (
              <label>
                点击次数
                <input
                  type="number"
                  min={1}
                  max={10000000}
                  value={profile.repeatCount}
                  onChange={(event) =>
                    update("repeatCount", Number(event.target.value))
                  }
                />
              </label>
            )}
          </div>
          <p className="hint">
            点击间隔指两次按下开始之间的时间，按下时长必须小于点击间隔。
          </p>
        </div>
        <div className="card profile-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">任务方案</p>
              <h2>保存常用点击配置</h2>
            </div>
            <span className="profile-count">{savedProfiles.length} 个方案</span>
          </div>
          <div className="profile-row">
            <input
              value={profileName}
              maxLength={30}
              placeholder="例如：每日签到"
              onChange={(event) => setProfileName(event.target.value)}
              disabled={running}
            />
            <button
              className="primary"
              onClick={saveNamedProfile}
              disabled={running}
            >
              保存方案
            </button>
            <button
              className="secondary"
              onClick={deleteNamedProfile}
              disabled={running || !profileName.trim()}
            >
              删除
            </button>
          </div>
          {savedProfiles.length > 0 && (
            <div className="profile-list">
              {savedProfiles.map((item) => (
                <button
                  className={`profile-item${item.name === profileName ? " active" : ""}`}
                  key={item.name}
                  onClick={() => loadNamedProfile(item.name)}
                  disabled={running}
                >
                  <span>{item.name}</span>
                  <small>
                    {item.profile.targets?.length || 0} 步骤 ·{" "}
                    {item.profile.intervalMs} ms
                  </small>
                </button>
              ))}
            </div>
          )}
          <p className="hint">
            方案仅保存在本机浏览器存储中，不会上传到服务器。
          </p>
        </div>
        <div className="card controls">
          <div>
            <p className="eyebrow">运行控制</p>
            <div className="progress">
              已完成 <strong>{status.completed}</strong>
              {status.targetCount ? ` / ${status.targetCount}` : " 次"}
            </div>
          </div>
          <div className="actions">
            <button
              className="primary"
              disabled={running}
              onClick={() => void start()}
            >
              开始点击
            </button>
            <button className="danger" disabled={!running} onClick={stop}>
              停止
            </button>
          </div>
          {status.error && <p className="error">{status.error}</p>}
          {message && <p className="hint">{message}</p>}
        </div>
        <div className="card logs-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">运行记录</p>
              <h2>最近执行</h2>
            </div>
            <div className="log-summary">
              {runLogs.length} 次运行 · {totalClicks} 次点击
            </div>
          </div>
          {runLogs.length > 0 ? (
            <div className="log-list">
              {runLogs.slice(0, 8).map((log) => (
                <div className="log-item" key={log.id}>
                  <span className={`log-result log-${log.result}`}>
                    {log.result === "completed"
                      ? "完成"
                      : log.result === "error"
                        ? "错误"
                        : "停止"}
                  </span>
                  <span className="log-time">
                    {formatRunTime(log.startedAt)}
                  </span>
                  <strong>{log.clicks} 次</strong>
                  {log.error && <small title={log.error}>{log.error}</small>}
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">完成一次点击任务后，这里会显示运行结果。</p>
          )}
          {runLogs.length > 0 && (
            <button
              className="clear-logs"
              onClick={clearRunLogs}
              disabled={running}
            >
              清空运行记录
            </button>
          )}
        </div>
        <div className="settings-row">
          <label className="check">
            <input
              type="checkbox"
              checked={autoLaunch}
              onChange={(event) => void toggleAutoLaunch(event.target.checked)}
            />
            登录系统后自动启动
          </label>
          <span className="privacy">所有坐标和参数仅保存在本机</span>
        </div>
        <div className="shortcut-card">
          <div>
            <p className="eyebrow">快捷键与权限</p>
            <p className="hint">
              全局快捷键：⌘/Ctrl+Shift+Space 开始/停止，⌘/Ctrl+Shift+X
              紧急停止。 macOS 需要授予辅助功能权限。
            </p>
          </div>
          <button
            className="secondary"
            onClick={() =>
              void invoke("open_accessibility_settings").catch((error) =>
                setMessage(formatErrorMessage(error)),
              )
            }
          >
            打开辅助功能设置
          </button>
        </div>
      </section>
      {updateDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="update-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
          >
            <h2 id="update-title">
              {updateState === "latest"
                ? "当前已是最新版本"
                : updateState === "error"
                  ? "检查更新失败"
                  : availableUpdate
                    ? `发现 GoTap ${availableUpdate.version}`
                    : "检查 GoTap 更新"}
            </h2>
            {updateState === "checking" && <p>正在连接更新服务，请稍候…</p>}
            {updateState === "latest" && (
              <p>当前版本 v{appPackage.version} 暂无新版本。</p>
            )}
            {updateState === "error" && (
              <p>{updateError ?? "暂时无法获取更新信息，请稍后重试。"}</p>
            )}
            {availableUpdate &&
              updateState !== "error" &&
              updateState !== "checking" && (
                <>
                  <p className="update-notes">
                    {availableUpdate.body || "本次更新包含稳定性和体验改进。"}
                  </p>
                  {(updateState === "downloading" ||
                    updateState === "installing") && (
                    <div
                      className="update-progress"
                      aria-label={`已下载 ${Math.round(updateProgress)}%`}
                    >
                      <span style={{ width: `${updateProgress}%` }} />
                    </div>
                  )}
                  {updateState === "downloading" && (
                    <small>正在下载更新… {Math.round(updateProgress)}%</small>
                  )}
                  {updateState === "installing" && (
                    <small>正在安装并重启 GoTap…</small>
                  )}
                </>
              )}
            <div className="confirm-actions">
              {updateState !== "downloading" &&
                updateState !== "installing" && (
                  <button
                    className="cancel-button"
                    onClick={() => void closeUpdateDialog()}
                    type="button"
                  >
                    关闭
                  </button>
                )}
              {updateState === "available" && (
                <button
                  className="confirm-button action-button"
                  onClick={() => void installUpdate()}
                  type="button"
                >
                  更新并重启
                </button>
              )}
              {updateState === "error" && (
                <button
                  className="confirm-button action-button"
                  onClick={() => void checkForUpdates(true)}
                  type="button"
                >
                  重试
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      <footer>
        GoTap v{appPackage.version} · 当前用户 {session.user.email}
      </footer>
    </main>
  );
}

function AuthenticatedApp() {
  const [session, setSession] = useState<AuthSession | null>(() =>
    getSession(),
  );
  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setInterval(
      () => {
        void refreshSession(session)
          .then(setSession)
          .catch(() => undefined);
      },
      10 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [session]);
  return session ? (
    <ClickerPage session={session} onLogout={() => setSession(null)} />
  ) : (
    <AuthPage onAuthenticated={setSession} />
  );
}

export default function App() {
  return new URLSearchParams(window.location.search).has("selection") ? (
    <SelectionOverlay />
  ) : (
    <AuthenticatedApp />
  );
}
