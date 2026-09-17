import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
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
}
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
};

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
          <div className="brand-mark">GT</div>
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

  useEffect(() => {
    void invoke<ClickProfile | null>("load_settings")
      .then((value) => {
        if (value) setProfile(value);
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
          <div className="brand-mark">GT</div>
          <div>
            <strong>GoTap</strong>
            <small>桌面自动点击器</small>
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
          <p className="hint">
            区域框选后将点击区域中心；跨显示器坐标以当前主屏为基准。
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
      </section>
      <footer>GoTap 0.1.0 · 当前用户 {session.user.email}</footer>
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
