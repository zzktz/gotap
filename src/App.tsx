import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectItem,
  Tooltip,
} from "@heroui/react";
import appPackage from "../package.json";
import {
  clearRememberedLogin,
  formatErrorMessage,
  getAuthSettings,
  getRememberedLogin,
  getSession,
  login,
  register,
  requestPasswordResetCode,
  requestRegistrationCode,
  refreshSession,
  resetPassword,
  saveRememberedLogin,
  submitFeedback,
} from "./auth";
import type { AuthSession } from "./auth";

type Mode = "login" | "register" | "forgot";
type InfoPanel = "help" | "logs" | null;
type FeedbackFile = { file: File; previewName: string };
type RepeatMode = "count" | "infinite";
type ClickButton = "left" | "right" | "middle";
type ClickPosition = "center" | "random";
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
  clickPosition: ClickPosition;
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
const SETTINGS_MIGRATION_KEY = "gotap.settings.v2";
const MIN_INTERVAL_MS = 100;
const MAX_REPEAT_COUNT = 999_999;
const FIXED_PRESS_DURATION_MS = 5;
const START_DELAY_SECONDS = 3;
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
  intervalMs: MIN_INTERVAL_MS,
  pressDurationMs: FIXED_PRESS_DURATION_MS,
  repeatMode: "count",
  repeatCount: 3000,
  button: "left",
  clickPosition: "center",
  targets: [],
};

function normalizeProfile(value: Partial<ClickProfile>): ClickProfile {
  const profile = { ...DEFAULT_PROFILE, ...value };
  const repeatMode =
    profile.repeatMode === "infinite" || profile.repeatCount === 0
      ? "infinite"
      : "count";
  return {
    ...profile,
    intervalMs: Number.isFinite(profile.intervalMs)
      ? Math.max(MIN_INTERVAL_MS, profile.intervalMs)
      : DEFAULT_PROFILE.intervalMs,
    pressDurationMs: FIXED_PRESS_DURATION_MS,
    button: profile.button === "right" ? "right" : "left",
    clickPosition: profile.clickPosition === "random" ? "random" : "center",
    repeatMode,
    repeatCount:
      repeatMode === "infinite"
        ? 0
        : Math.min(MAX_REPEAT_COUNT, Math.max(0, profile.repeatCount)),
    targets: profile.targets ?? [],
  };
}

function CursorLogo() {
  return (
    <svg
      aria-label="GoTap 鼠标箭头标志"
      className="cursor-logo"
      role="img"
      viewBox="0 0 1024 1024"
    >
      <rect width="1024" height="1024" fill="#1768a7" />
      <path
        d="M842 562 422 422l140 420 117-117 94 94 46-47-93-93 116-117Z"
        fill="#fff"
      />
      <path
        d="M248 743V248h495v213l66 22V182H182v627h301l-22-66H248Z"
        fill="#fff"
      />
    </svg>
  );
}

function FieldLabel({
  children,
  description,
}: {
  children: string;
  description: string;
}) {
  return (
    <span className="field-label">
      {children}
      <Tooltip
        classNames={{
          content: "field-help-tooltip",
          arrow: "field-help-tooltip-arrow",
        }}
        content={description}
        placement="top"
      >
        <span
          aria-label={`${children}说明`}
          className="field-help"
          role="img"
          tabIndex={0}
        >
          ?
        </span>
      </Tooltip>
    </span>
  );
}

function SelectionOverlay() {
  const [draftStart, setDraftStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [dragging, setDragging] = useState<"draw" | "move" | null>(null);
  const [moveOrigin, setMoveOrigin] = useState<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const confirming = useRef(false);
  const lastSelectionClick = useRef<{
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const params = new URLSearchParams(window.location.search);
  const offsetX = Number(params.get("offsetX") ?? 0);
  const offsetY = Number(params.get("offsetY") ?? 0);
  const coordinateScale = Number(params.get("coordinateScale") ?? 1);
  const close = async () => {
    await invoke("close_selection_windows").catch(() => undefined);
    await getCurrentWindow()
      .destroy()
      .catch(() => undefined);
  };
  useEffect(() => {
    document.documentElement.classList.add("selection-mode");
    return () => document.documentElement.classList.remove("selection-mode");
  }, []);
  const finish = async () => {
    if (!selection || confirming.current) return;
    confirming.current = true;
    try {
      await emit("selection:completed", {
        x: Math.round(
          (offsetX + selection.left + selection.width / 2) * coordinateScale,
        ),
        y: Math.round(
          (offsetY + selection.top + selection.height / 2) * coordinateScale,
        ),
        width: Math.round(selection.width * coordinateScale),
        height: Math.round(selection.height * coordinateScale),
      } satisfies SelectionPayload);
      await close();
    } catch {
      confirming.current = false;
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  const rectangle =
    dragging === "draw" && draftStart && current
      ? {
          left: Math.min(draftStart.x, current.x),
          top: Math.min(draftStart.y, current.y),
          width: Math.abs(current.x - draftStart.x),
          height: Math.abs(current.y - draftStart.y),
        }
      : selection;
  const isInsideSelection = (x: number, y: number) =>
    selection !== null &&
    x >= selection.left &&
    x <= selection.left + selection.width &&
    y >= selection.top &&
    y <= selection.top + selection.height;
  return (
    <main
      className={`selection-overlay${selection ? " has-selection" : ""}`}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (isInsideSelection(event.clientX, event.clientY) && selection) {
          const now = Date.now();
          const previous = lastSelectionClick.current;
          if (
            previous &&
            now - previous.time <= 500 &&
            Math.hypot(
              previous.x - event.clientX,
              previous.y - event.clientY,
            ) <= 8
          ) {
            lastSelectionClick.current = null;
            void finish();
            return;
          }
          lastSelectionClick.current = {
            time: now,
            x: event.clientX,
            y: event.clientY,
          };
          setDragging("move");
          setMoveOrigin({
            x: event.clientX,
            y: event.clientY,
            left: selection.left,
            top: selection.top,
          });
        } else {
          lastSelectionClick.current = null;
          setSelection(null);
          setDragging("draw");
          setDraftStart({ x: event.clientX, y: event.clientY });
          setCurrent({ x: event.clientX, y: event.clientY });
        }
      }}
      onMouseMove={(event) => {
        if (dragging === "draw" && draftStart) {
          setCurrent({ x: event.clientX, y: event.clientY });
        } else if (dragging === "move" && moveOrigin && selection) {
          const left = Math.max(
            0,
            Math.min(
              window.innerWidth - selection.width,
              moveOrigin.left + event.clientX - moveOrigin.x,
            ),
          );
          const top = Math.max(
            0,
            Math.min(
              window.innerHeight - selection.height,
              moveOrigin.top + event.clientY - moveOrigin.y,
            ),
          );
          setSelection((currentSelection) =>
            currentSelection ? { ...currentSelection, left, top } : null,
          );
        }
      }}
      onMouseUp={(event) => {
        if (event.button !== 0) return;
        if (dragging === "draw" && draftStart) {
          const left = Math.min(draftStart.x, event.clientX);
          const top = Math.min(draftStart.y, event.clientY);
          const width = Math.abs(event.clientX - draftStart.x);
          const height = Math.abs(event.clientY - draftStart.y);
          if (width >= 2 && height >= 2)
            setSelection({ left, top, width, height });
          setDraftStart(null);
          setCurrent(null);
        }
        setDragging(null);
        setMoveOrigin(null);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        if (isInsideSelection(event.clientX, event.clientY)) void finish();
      }}
    >
      <div className="selection-instructions">
        按住左键拖拽框选 · 松开后可移动区域 · 双击确认 · Esc 取消
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
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark auth-brand-mark">
            <CursorLogo />
          </div>
          <div>
            <h1>GoTap</h1>
            <p>轻量、可靠的桌面自动点击器</p>
          </div>
        </div>
        <section className="card auth-card">
          <p className="eyebrow">
            {mode === "login"
              ? "欢迎回来"
              : mode === "register"
                ? "创建账号"
                : "找回密码"}
          </p>
          <h2>
            {mode === "login"
              ? "用户登录"
              : mode === "register"
                ? "注册账号"
                : "重置密码"}
          </h2>
          <form onSubmit={(event) => void submit(event)} className="form">
            {mode === "register" && (
              <Input
                className="hero-input"
                label="姓名"
                labelPlacement="outside"
                maxLength={10}
                onValueChange={setName}
                placeholder="可选"
                size="sm"
                value={name}
                variant="bordered"
              />
            )}
            <Input
              className="hero-input"
              isReadOnly={mode === "forgot"}
              isRequired
              label="邮箱"
              labelPlacement="outside"
              onValueChange={setEmail}
              placeholder="you@example.com"
              size="sm"
              type="email"
              value={email}
              variant="bordered"
            />
            {(mode === "register" || mode === "forgot") && (
              <div className="form-field">
                <div className="code-row">
                  <Input
                    className="hero-input"
                    classNames={{ inputWrapper: "code-input-wrapper" }}
                    isRequired
                    inputMode="numeric"
                    label="验证码"
                    labelPlacement="outside"
                    maxLength={6}
                    onValueChange={(value) => setCode(value.replace(/\D/g, ""))}
                    placeholder="6 位验证码"
                    size="sm"
                    value={code}
                    variant="bordered"
                  />
                  <Button
                    className="hero-button code-button"
                    isDisabled={busy || countdown > 0}
                    onPress={() => void sendCode()}
                    type="button"
                    variant="bordered"
                  >
                    {countdown ? `${countdown}s 后重发` : "发送验证码"}
                  </Button>
                </div>
              </div>
            )}
            <Input
              className="hero-input"
              isRequired
              label="密码"
              labelPlacement="outside"
              minLength={8}
              onValueChange={setPassword}
              placeholder="至少 8 位"
              size="sm"
              type="password"
              value={password}
              variant="bordered"
            />
            {mode === "login" && (
              <Checkbox
                className="remember-checkbox"
                isSelected={remember}
                onValueChange={setRemember}
                size="sm"
              >
                记住登录信息
              </Checkbox>
            )}
            {error && <p className="error">{error}</p>}
            {message && <p className="success">{message}</p>}
            <Button
              className="hero-button auth-submit"
              color="primary"
              isDisabled={busy}
              type="submit"
            >
              {busy
                ? "处理中…"
                : mode === "login"
                  ? "登录"
                  : mode === "register"
                    ? "注册并登录"
                    : "重置密码"}
            </Button>
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
        <p className="auth-copyright">GoTap · 桌面自动点击器</p>
      </section>
    </main>
  );
}

function ClickerPage() {
  const [profile, setProfile] = useState<ClickProfile>(DEFAULT_PROFILE);
  const [status, setStatus] = useState<ClickerStatus>({
    state: "idle",
    completed: 0,
    targetCount: null,
    error: null,
  });
  const [message, setMessage] = useState("");
  const [startCountdown, setStartCountdown] = useState(0);
  const startPending = useRef(false);
  const startToken = useRef(0);
  const pendingStartProfile = useRef<ClickProfile | null>(null);
  const [infoPanel, setInfoPanel] = useState<InfoPanel>(null);
  const [aboutMenuOpen, setAboutMenuOpen] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackFiles, setFeedbackFiles] = useState<FeedbackFile[]>([]);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackSuccess, setFeedbackSuccess] = useState("");
  const aboutMenuRef = useRef<HTMLDivElement>(null);
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
        if (!value) return;

        const loaded = normalizeProfile(value);
        // 999999 was briefly used as the default before the current default
        // was settled at 3000. Migrate that old untouched value once, while
        // preserving a user's intentional choice of 999999 afterwards.
        let next = loaded;
        if (
          value.repeatMode === "count" &&
          value.repeatCount === MAX_REPEAT_COUNT &&
          !localStorage.getItem(SETTINGS_MIGRATION_KEY)
        ) {
          next = {
            ...loaded,
            repeatCount: DEFAULT_PROFILE.repeatCount,
            repeatMode: "count",
          };
          void invoke("save_settings", { profile: next }).catch(
            () => undefined,
          );
        }
        localStorage.setItem(SETTINGS_MIGRATION_KEY, "1");
        setProfile(next);
      })
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
    let disposeProgress: (() => void) | undefined;
    void listen<number>("clicker:progress", (event) =>
      setStatus((current) => ({ ...current, completed: event.payload })),
    ).then((unlisten) => {
      disposeProgress = unlisten;
    });
    let disposeSelection: (() => void) | undefined;
    void listen<SelectionPayload>("selection:completed", (event) => {
      // Keep already configured steps while selecting the next area. This
      // allows the user to select an area, add it as a step, then repeat.
      setProfile((current) => ({ ...current, ...event.payload }));
    }).then((unlisten) => {
      disposeSelection = unlisten;
    });
    return () => {
      dispose?.();
      disposeProgress?.();
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
  const updateRepeatCount = (repeatCount: number) => {
    const normalized = Math.min(MAX_REPEAT_COUNT, Math.max(0, repeatCount));
    setProfile((current) => ({
      ...current,
      repeatCount: normalized,
      repeatMode: normalized === 0 ? "infinite" : "count",
    }));
  };
  const selectArea = async () => {
    setMessage("拖拽生成区域后可移动，双击区域确认选择");
    try {
      await invoke("open_selection_window");
    } catch (error) {
      setMessage(formatErrorMessage(error));
    }
  };
  const addCurrentTarget = () => {
    if (profile.width <= 0 || profile.height <= 0) {
      setMessage("请先选择一个有效区域");
      return;
    }
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
    setMessage("当前区域已添加为步骤");
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
    const snapshot = normalizeProfile(
      JSON.parse(JSON.stringify(profile)) as ClickProfile,
    );
    const next = savedProfiles.filter((item) => item.name !== name);
    next.push({ name, profile: snapshot });
    persistProfiles(next);
    setProfileName(name);
    setMessage(`方案“${name}”已保存`);
  };
  const loadNamedProfile = (name: string) => {
    const item = savedProfiles.find((value) => value.name === name);
    if (!item) return;
    setProfile(normalizeProfile(item.profile));
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
  const openFeedbackDialog = () => {
    setAboutMenuOpen(false);
    setFeedbackDialogOpen(true);
    setFeedbackMessage("");
    setFeedbackFiles([]);
    setFeedbackError("");
    setFeedbackSuccess("");
  };
  const closeFeedbackDialog = () => {
    if (feedbackBusy) return;
    setFeedbackDialogOpen(false);
    setFeedbackError("");
    setFeedbackSuccess("");
  };
  const selectFeedbackFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const next: FeedbackFile[] = [];
    for (const file of selected) {
      if (next.length >= 3) break;
      if (
        !(
          file.type === "image/png" ||
          file.type === "image/jpeg" ||
          file.type === "image/webp"
        )
      ) {
        setFeedbackError("截图仅支持 PNG、JPEG 或 WebP 格式");
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        setFeedbackError("单张截图不能超过 5 MiB");
        continue;
      }
      next.push({ file, previewName: file.name });
    }
    setFeedbackFiles(next);
    event.target.value = "";
  };
  const encodeFeedbackFile = async (file: File): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(index, index + chunkSize),
      );
    }
    return btoa(binary);
  };
  const sendFeedback = async () => {
    const message = feedbackMessage.trim();
    if (!message) {
      setFeedbackError("请填写反馈内容");
      return;
    }
    setFeedbackBusy(true);
    setFeedbackError("");
    setFeedbackSuccess("");
    try {
      const screenshots = await Promise.all(
        feedbackFiles.map(async ({ file, previewName }) => ({
          filename: previewName,
          data: await encodeFeedbackFile(file),
        })),
      );
      await submitFeedback(message, screenshots);
      setFeedbackMessage("");
      setFeedbackFiles([]);
      setFeedbackSuccess("反馈已提交，感谢你的反馈！");
    } catch (error) {
      setFeedbackError(formatErrorMessage(error));
    } finally {
      setFeedbackBusy(false);
    }
  };
  const formatRunTime = (value: string) =>
    new Date(value).toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const totalClicks = runLogs.reduce((sum, log) => sum + log.clicks, 0);
  useEffect(() => {
    if (startCountdown > 0) {
      const timer = window.setTimeout(
        () => setStartCountdown((value) => Math.max(value - 1, 0)),
        1000,
      );
      return () => window.clearTimeout(timer);
    }

    const profileToStart = pendingStartProfile.current;
    if (!profileToStart || !startPending.current) return undefined;
    pendingStartProfile.current = null;
    const token = startToken.current;
    void invoke("start_clicking", { profile: profileToStart }).catch(
      (error) => {
        if (token !== startToken.current) return;
        startPending.current = false;
        setMessage(formatErrorMessage(error));
      },
    );
    return undefined;
  }, [startCountdown]);
  const start = async () => {
    if (startPending.current || runningRef.current || startCountdown > 0) return;
    startPending.current = true;
    const token = ++startToken.current;
    setMessage("");
    const effectiveProfile = normalizeProfile(profile);
    setProfile(effectiveProfile);
    try {
      await invoke("save_settings", { profile: effectiveProfile });
      if (!startPending.current || token !== startToken.current) return;
      pendingStartProfile.current = effectiveProfile;
      setStartCountdown(START_DELAY_SECONDS);
    } catch (error) {
      if (token !== startToken.current) return;
      startPending.current = false;
      setStartCountdown(0);
      setMessage(formatErrorMessage(error));
    }
  };
  const stop = () => {
    startToken.current += 1;
    pendingStartProfile.current = null;
    startPending.current = false;
    setStartCountdown(0);
    void invoke("stop_clicking_command").catch((error) =>
      setMessage(formatErrorMessage(error)),
    );
  };
  const running = status.state === "running";
  const runningRef = useRef(running);
  runningRef.current = running;
  const startRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);
  startRef.current = () => void start();
  stopRef.current = stop;
  useEffect(() => {
    // A delayed initial status response (or a late event from a previous
    // run) must not cancel the three-second hand-release countdown that is
    // already in progress.  The start/stop handlers own that pending state.
    if (startPending.current && status.state !== "running") return;
    if (status.state !== "running") {
      setStartCountdown(0);
      if (["idle", "stopped", "completed", "error"].includes(status.state))
        startPending.current = false;
    } else {
      startPending.current = false;
    }
  }, [status.state]);
  useEffect(() => {
    let active = true;
    let disposeToggle: (() => void) | undefined;
    let disposeStop: (() => void) | undefined;
    void listen("hotkey:toggle", () => {
      if (runningRef.current) stopRef.current();
      else startRef.current();
    }).then((unlisten) => {
      if (active) disposeToggle = unlisten;
      else unlisten();
    });
    void listen("hotkey:stop", () => {
      if (runningRef.current || startPending.current) stopRef.current();
    }).then((unlisten) => {
      if (active) disposeStop = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      disposeToggle?.();
      disposeStop?.();
    };
  }, []);
  useEffect(() => {
    if (!aboutMenuOpen) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!aboutMenuRef.current?.contains(event.target as Node))
        setAboutMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAboutMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [aboutMenuOpen]);
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void listen("tray:toggle-clicker", () => {
      if (runningRef.current) stopRef.current();
      else startRef.current();
    }).then((unlisten) => {
      if (active) dispose = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, []);
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <CursorLogo />
          </div>
          <div>
            <div className="brand-title">
              <strong>GoTap</strong>
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
            </div>
            <small className="brand-subtitle">桌面自动点击器</small>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="about-menu-wrap" ref={aboutMenuRef}>
            <Button
              aria-label="打开帮助与反馈菜单"
              aria-expanded={aboutMenuOpen}
              aria-haspopup="menu"
              className="topbar-action"
              onPress={() => setAboutMenuOpen((open) => !open)}
              size="sm"
              title="帮助与反馈"
              variant="light"
            >
              <span className="help-icon" aria-hidden="true">?</span>
            </Button>
            {aboutMenuOpen && (
              <div className="about-menu" role="menu">
                <button
                  onClick={() => {
                    setAboutMenuOpen(false);
                    setInfoPanel("help");
                  }}
                  role="menuitem"
                  type="button"
                >
                  帮助
                </button>
                <button
                  onClick={openFeedbackDialog}
                  role="menuitem"
                  type="button"
                >
                  反馈
                </button>
                <button
                  onClick={() => {
                    setAboutMenuOpen(false);
                    void exit(0);
                  }}
                  role="menuitem"
                  type="button"
                >
                  退出
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <section className="content">
        <div className="card target-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">目标位置</p>
            </div>
            <div className="target-heading-actions">
              <Button
                className="hero-button primary-action-button target-select-button"
                color="primary"
                isDisabled={running}
                onPress={() => void selectArea()}
              >
                选择区域
              </Button>
            </div>
          </div>
          <div className="coordinates">
            <span>坐标</span>
            <strong>
              ({profile.x}, {profile.y})
            </strong>
            {profile.width > 0 && profile.height > 0 && (
              <span className="coordinate-size">
                区域 {profile.width} × {profile.height}
              </span>
            )}
          </div>
          <div className="target-actions">
            <Button
              className="hero-button target-step-button"
              variant="bordered"
              onPress={addCurrentTarget}
              isDisabled={running}
              size="sm"
            >
              添加步骤
            </Button>
            {profile.targets.length > 0 && (
              <Button
                className="hero-button target-step-button"
                variant="bordered"
                onPress={() =>
                  setProfile((current) => ({ ...current, targets: [] }))
                }
                isDisabled={running}
                size="sm"
              >
                清空
              </Button>
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
          {profile.targets.length > 0 && (
            <p className="hint">
              已添加 {profile.targets.length} 个步骤，将按顺序循环点击。
            </p>
          )}
          <div className="merged-controls">
            <div>
              <div className="progress">
                已完成 <strong>{status.completed}</strong>
                {status.targetCount ? ` / ${status.targetCount}` : " 次"}
              </div>
            </div>
            <div className="actions">
              <Button
                className="hero-button primary-action-button"
                color="primary"
                isDisabled={running || startCountdown > 0}
                onClick={() => void start()}
              >
                开始点击
              </Button>
              <Button
                className="hero-button danger-action-button"
                color="danger"
                isDisabled={!running}
                onPress={stop}
              >
                停止
              </Button>
            </div>
            <div className="run-info" role="status" aria-live="polite">
              {status.error ? (
                <p className="error">{status.error}</p>
              ) : message ? (
                <p className="hint">{message}</p>
              ) : running ? (
                <span className="run-info-state run-info-running">正在运行</span>
              ) : status.state === "completed" ? (
                <span className="run-info-state run-info-completed">已完成</span>
              ) : (
                <span className="run-info-placeholder">
                  运行状态和操作提示显示在这里
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="card click-params-card">
          <div className="grid parameter-grid">
            <Input
              className="hero-input"
              label={
                <FieldLabel description="两次点击之间的时间间隔，最小为 100 毫秒">
                  间隔时间
                </FieldLabel>
              }
              labelPlacement="outside"
              min={MIN_INTERVAL_MS}
              onValueChange={(value) => update("intervalMs", Number(value))}
              size="sm"
              type="number"
              value={String(profile.intervalMs)}
              variant="bordered"
            />
            <Input
              className="hero-input"
              label={
                <FieldLabel description="执行次数，设置为 0 表示无限循环">
                  点击次数
                </FieldLabel>
              }
              labelPlacement="outside"
              max={MAX_REPEAT_COUNT}
              min={0}
              onValueChange={(value) => updateRepeatCount(Number(value))}
              size="sm"
              type="number"
              value={String(profile.repeatCount)}
              variant="bordered"
            />
            <Select
              className="hero-select"
              label={
                <FieldLabel description="选择模拟点击使用的鼠标按键">
                  鼠标按键
                </FieldLabel>
              }
              labelPlacement="outside"
              onSelectionChange={(keys) => {
                if (keys === "all") return;
                const value = Array.from(keys)[0];
                if (value === "left" || value === "right")
                  update("button", value);
              }}
              placeholder="请选择鼠标按键"
              selectedKeys={new Set([profile.button])}
              size="sm"
              variant="bordered"
            >
              <SelectItem key="left">左键</SelectItem>
              <SelectItem key="right">右键</SelectItem>
            </Select>
            <Select
              className="hero-select"
              label={
                <FieldLabel description="中心是指选中区域的中心位置；随机是指点击选中区域中随机位置。">
                  点击位置
                </FieldLabel>
              }
              labelPlacement="outside"
              onSelectionChange={(keys) => {
                if (keys === "all") return;
                const value = Array.from(keys)[0];
                if (value === "center" || value === "random")
                  update("clickPosition", value);
              }}
              placeholder="请选择点击位置"
              selectedKeys={new Set([profile.clickPosition])}
              size="sm"
              variant="bordered"
            >
              <SelectItem key="center">中心</SelectItem>
              <SelectItem key="random">随机</SelectItem>
            </Select>
          </div>
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
      </section>
      {startCountdown > 0 && (
        <div
          className="start-countdown-overlay"
          role="status"
          aria-live="polite"
        >
          <div className="start-countdown-dialog">
            <p>请松开鼠标</p>
            <strong>{startCountdown}</strong>
            <small>秒后开始自动点击</small>
          </div>
        </div>
      )}
      {infoPanel && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-panel-title"
          >
            <div className="info-dialog-heading">
              <div>
                <p className="eyebrow">
                  {infoPanel === "help" ? "帮助" : "记录"}
                </p>
                <h2 id="info-panel-title">
                  {infoPanel === "help" ? "快捷键与权限" : "运行记录"}
                </h2>
              </div>
              <div className="info-dialog-heading-actions">
                {infoPanel === "logs" && (
                  <div className="log-summary">
                    {runLogs.length} 次运行 · {totalClicks} 次点击
                  </div>
                )}
                <Button
                  aria-label="关闭弹出层"
                  className="dialog-close-button"
                  isIconOnly
                  onPress={() => setInfoPanel(null)}
                  size="sm"
                  variant="light"
                >
                  ×
                </Button>
              </div>
            </div>
            {infoPanel === "help" ? (
              <>
                <p className="hint info-dialog-copy">
                  全局快捷键：⌘/Ctrl+Shift+Space 开始/停止，⌘/Ctrl+Shift+X
                  紧急停止。macOS 需要授予辅助功能权限。
                </p>
                <Button
                  className="hero-button"
                  variant="bordered"
                  onPress={() =>
                    void invoke("open_accessibility_settings").catch((error) =>
                      setMessage(formatErrorMessage(error)),
                    )
                  }
                >
                  打开辅助功能设置
                </Button>
              </>
            ) : (
              <>
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
                        {log.error && (
                          <small title={log.error}>{log.error}</small>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hint">
                    完成一次点击任务后，这里会显示运行结果。
                  </p>
                )}
                {runLogs.length > 0 && (
                  <Button
                    className="clear-logs-button"
                    isDisabled={running}
                    onPress={clearRunLogs}
                    variant="light"
                  >
                    清空运行记录
                  </Button>
                )}
              </>
            )}
            <div className="info-dialog-actions">
              <Button
                className="hero-button"
                onPress={() => setInfoPanel(null)}
                size="sm"
                variant="light"
              >
                关闭
              </Button>
            </div>
          </section>
        </div>
      )}
      {feedbackDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
          >
            <div className="info-dialog-heading">
              <div>
                <p className="eyebrow">反馈</p>
                <h2 id="feedback-title">问题反馈</h2>
              </div>
              <Button
                aria-label="关闭反馈弹出层"
                className="dialog-close-button"
                isIconOnly
                onPress={closeFeedbackDialog}
                size="sm"
                variant="light"
              >
                ×
              </Button>
            </div>
            <textarea
              className="feedback-textarea"
              maxLength={5000}
              onChange={(event) => setFeedbackMessage(event.target.value)}
              placeholder="请描述遇到的问题或希望改进的地方"
              value={feedbackMessage}
            />
            <div className="feedback-upload-row">
              <label className="feedback-upload-button">
                添加截图
                <input
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={selectFeedbackFiles}
                  type="file"
                />
              </label>
              <small>最多 3 张，每张不超过 5 MiB</small>
            </div>
            {feedbackFiles.length > 0 && (
              <div className="feedback-file-list">
                {feedbackFiles.map(({ previewName }, index) => (
                  <div
                    className="feedback-file"
                    key={`${previewName}-${index}`}
                  >
                    <span>{previewName}</span>
                    <button
                      onClick={() =>
                        setFeedbackFiles((current) =>
                          current.filter((_, fileIndex) => fileIndex !== index),
                        )
                      }
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
            {feedbackError && <p className="error">{feedbackError}</p>}
            {feedbackSuccess && (
              <p className="feedback-success" role="status">
                {feedbackSuccess}
              </p>
            )}
            <div className="feedback-dialog-actions">
              <Button
                className="hero-button"
                isDisabled={feedbackBusy}
                onPress={closeFeedbackDialog}
                size="sm"
                variant="light"
              >
                关闭
              </Button>
              <Button
                className="hero-button"
                color="primary"
                isDisabled={feedbackBusy}
                onPress={() => void sendFeedback()}
                size="sm"
              >
                {feedbackBusy ? "提交中…" : "提交反馈"}
              </Button>
            </div>
          </section>
        </div>
      )}
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
                  <Button
                    className="hero-button"
                    onPress={() => void closeUpdateDialog()}
                    size="sm"
                    type="button"
                    variant="light"
                  >
                    关闭
                  </Button>
                )}
              {updateState === "available" && (
                <Button
                  className="hero-button"
                  color="primary"
                  onPress={() => void installUpdate()}
                  size="sm"
                  type="button"
                >
                  更新并重启
                </Button>
              )}
              {updateState === "error" && (
                <Button
                  className="hero-button"
                  color="primary"
                  onPress={() => void checkForUpdates(true)}
                  size="sm"
                  type="button"
                >
                  重试
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function AuthenticatedApp() {
  const [session, setSession] = useState<AuthSession | null>(() =>
    getSession(),
  );
  const [loginRequired, setLoginRequired] = useState(false);
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
  if (loginRequired) {
    return (
      <AuthPage
        onAuthenticated={(nextSession) => {
          setSession(nextSession);
          setLoginRequired(false);
        }}
      />
    );
  }
  return <ClickerPage />;
}

export default function App() {
  return new URLSearchParams(window.location.search).has("selection") ? (
    <SelectionOverlay />
  ) : (
    <AuthenticatedApp />
  );
}
