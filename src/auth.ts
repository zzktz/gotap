import { invoke } from "@tauri-apps/api/core";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  created_at: string;
  account_expires_at: string | null;
}

export interface AuthSession {
  token: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

export interface AuthSettings {
  registration_enabled: boolean;
}

export interface FeedbackAttachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface FeedbackItem {
  id: string;
  message: string;
  status: "open" | "replied" | string;
  reply: string | null;
  created_at: string;
  updated_at: string;
  replied_at: string | null;
  attachments: FeedbackAttachment[];
}

export interface FeedbackScreenshot {
  filename: string;
  data: string;
}

const SESSION_KEY = "gotap.auth.session";
const REMEMBERED_LOGIN_KEY = "gotap.login.remembered";

export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(
      /error\s+sending\s+request\s+for\s+url\s*\([^)]*\)/giu,
      "网络请求失败",
    )
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/giu, "请求地址")
    .trim();
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  try {
    return await invoke<T>("control_request", {
      path,
      method: init.method ?? "GET",
      body,
      accessToken:
        headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null,
    });
  } catch (error) {
    throw new Error(formatErrorMessage(error));
  }
}

function saveSession(response: AuthResponse): AuthSession {
  const session: AuthSession = {
    token: response.access_token,
    refreshToken: response.refresh_token,
    user: response.user,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getSession(): AuthSession | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    if (!value) return null;
    const session = JSON.parse(value) as Partial<AuthSession>;
    return session.token && session.refreshToken && session.user?.id
      ? (session as AuthSession)
      : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export interface RememberedLogin {
  email: string;
  password: string;
}

export function getRememberedLogin(): RememberedLogin | null {
  try {
    const value = localStorage.getItem(REMEMBERED_LOGIN_KEY);
    return value ? (JSON.parse(value) as RememberedLogin) : null;
  } catch {
    return null;
  }
}

export function saveRememberedLogin(email: string, password: string): void {
  localStorage.setItem(
    REMEMBERED_LOGIN_KEY,
    JSON.stringify({ email, password }),
  );
}

export function clearRememberedLogin(): void {
  localStorage.removeItem(REMEMBERED_LOGIN_KEY);
}

function authenticatedHeaders(): HeadersInit {
  const session = getSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

export async function getFeedback(): Promise<FeedbackItem[]> {
  const response = await request<{ items: FeedbackItem[] }>("/v1/feedback", {
    method: "GET",
    headers: authenticatedHeaders(),
  });
  return response.items;
}

export function submitFeedback(
  message: string,
  screenshots: FeedbackScreenshot[],
): Promise<FeedbackItem> {
  return request<FeedbackItem>("/v1/feedback", {
    method: "POST",
    headers: {
      ...authenticatedHeaders(),
      "content-type": "application/json",
    },
    body: JSON.stringify({ message, screenshots }),
  });
}

export function getAuthSettings(): Promise<AuthSettings> {
  return request<AuthSettings>("/v1/auth/settings", { method: "GET" });
}

export async function login(
  email: string,
  password: string,
): Promise<AuthSession> {
  return saveSession(
    await request<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    }),
  );
}

export async function register(
  name: string,
  email: string,
  verificationCode: string,
  password: string,
): Promise<AuthSession> {
  return saveSession(
    await request<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        verification_code: verificationCode,
        password,
      }),
    }),
  );
}

export async function requestRegistrationCode(email: string): Promise<void> {
  await request("/v1/auth/register/send-code", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

export async function requestPasswordResetCode(email: string): Promise<void> {
  await request("/v1/auth/password-reset/send-code", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

export async function resetPassword(
  email: string,
  verificationCode: string,
  password: string,
): Promise<void> {
  await request("/v1/auth/password-reset", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      verification_code: verificationCode,
      password,
    }),
  });
}

export async function refreshSession(
  session: AuthSession,
): Promise<AuthSession> {
  return saveSession(
    await request<AuthResponse>("/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    }),
  );
}

export async function logout(): Promise<void> {
  const session = getSession();
  localStorage.removeItem(SESSION_KEY);
  if (session)
    await request("/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    }).catch(() => undefined);
}
