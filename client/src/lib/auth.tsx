import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type AuthUser = { id: number; email: string; role: string };

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const STORAGE_KEY = "minutes.auth";

const AuthContext = createContext<AuthState | null>(null);

type Persisted = { user: AuthUser; accessToken: string; refreshToken: string } | null;

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

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || "Login failed");
    }
    const data = (await res.json()) as {
      user: AuthUser;
      access_token: string;
      refresh_token: string;
    };
    setState({ user: data.user, accessToken: data.access_token, refreshToken: data.refresh_token });
  }, []);

  const logout = useCallback(() => setState(null), []);

  const value = useMemo<AuthState>(
    () => ({
      user: state?.user ?? null,
      accessToken: state?.accessToken ?? null,
      refreshToken: state?.refreshToken ?? null,
      login,
      logout,
    }),
    [state, login, logout],
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

export function clearPersistedAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}
