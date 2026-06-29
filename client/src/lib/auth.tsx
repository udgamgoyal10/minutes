import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type AuthUser = { id: number; email: string; role: string };
export type LoginResult =
  | { status: "ok" }
  | { status: "2fa_setup_required"; setupToken: string; qrDataUrl: string; manualSecret: string }
  | { status: "2fa_required"; challengeToken: string };

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  loginWithGoogle: (credential: string) => Promise<LoginResult>;
  verifyTwoFactorSetup: (setupToken: string, code: string) => Promise<void>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  logout: () => void;
};

const STORAGE_KEY = "minutes.auth";
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"] as const;

const AuthContext = createContext<AuthState | null>(null);

type PersistedAuth = { user: AuthUser; accessToken: string; refreshToken: string; lastActivityAt?: number };
type Persisted = PersistedAuth | null;

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Persisted;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(() => loadPersisted());

  useEffect(() => {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const mark = () => {
      const next = markAuthActivity();
      if (next) setState(next);
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, mark, { passive: true });
    }
    const timer = window.setInterval(() => {
      if (isAuthInactive()) {
        setState(null);
        if (window.location.pathname !== "/login") window.location.assign("/login");
      }
    }, 60_000);
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, mark);
      }
      window.clearInterval(timer);
    };
  }, [state]);

  const finishLogin = useCallback((data: { user: AuthUser; access_token: string; refresh_token: string }) => {
    setState({ user: data.user, accessToken: data.access_token, refreshToken: data.refresh_token, lastActivityAt: Date.now() });
  }, []);

  const loginWithGoogle = useCallback(async (credential: string): Promise<LoginResult> => {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || "Google sign-in failed");
    }
    const data = (await res.json()) as {
      user?: AuthUser;
      access_token?: string;
      refresh_token?: string;
      two_factor_setup_required?: boolean;
      setup_token?: string;
      qr_data_url?: string;
      manual_secret?: string;
      two_factor_required?: boolean;
      challenge_token?: string;
    };
    if (data.access_token && data.refresh_token && data.user) {
      finishLogin({ user: data.user, access_token: data.access_token, refresh_token: data.refresh_token });
      return { status: "ok" };
    }
    if (data.two_factor_setup_required && data.setup_token && data.qr_data_url && data.manual_secret) {
      return { status: "2fa_setup_required", setupToken: data.setup_token, qrDataUrl: data.qr_data_url, manualSecret: data.manual_secret };
    }
    if (data.two_factor_required && data.challenge_token) {
      return { status: "2fa_required", challengeToken: data.challenge_token };
    }
    throw new Error("Unexpected login response");
  }, [finishLogin]);

  const verifyTwoFactorSetup = useCallback(async (setupToken: string, code: string) => {
    const res = await fetch("/api/auth/2fa/setup/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ setup_token: setupToken, code }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || "Authenticator setup failed");
    }
    finishLogin(await res.json());
  }, [finishLogin]);

  const verifyTwoFactor = useCallback(async (challengeToken: string, code: string) => {
    const res = await fetch("/api/auth/2fa/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge_token: challengeToken, code }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || "Authenticator verification failed");
    }
    finishLogin(await res.json());
  }, [finishLogin]);

  const logout = useCallback(() => setState(null), []);

  const value = useMemo<AuthState>(
    () => ({
      user: state?.user ?? null,
      accessToken: state?.accessToken ?? null,
      refreshToken: state?.refreshToken ?? null,
      loginWithGoogle,
      verifyTwoFactorSetup,
      verifyTwoFactor,
      logout,
    }),
    [state, loginWithGoogle, verifyTwoFactorSetup, verifyTwoFactor, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function getAccessTokenFromStorage(): string | null {
  return loadPersisted()?.accessToken ?? null;
}

export function getRefreshTokenFromStorage(): string | null {
  return loadPersisted()?.refreshToken ?? null;
}

export function persistTokens(accessToken: string, refreshToken?: string): void {
  const current = loadPersisted();
  if (!current) return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...current, accessToken, refreshToken: refreshToken ?? current.refreshToken, lastActivityAt: Date.now() }),
  );
}

export function markAuthActivity(): Persisted {
  const current = loadPersisted();
  if (!current) return null;
  const next = { ...current, lastActivityAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function isAuthInactive(now = Date.now()): boolean {
  const current = loadPersisted();
  if (!current) return true;
  return now - (current.lastActivityAt ?? now) >= INACTIVITY_TIMEOUT_MS;
}

export function clearPersistedAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}
