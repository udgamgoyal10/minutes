import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { FileText, LogOut, Plus, Users } from "lucide-react";
import { useAuth } from "../lib/auth.tsx";

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <FileText className="size-5 text-brand-600" />
            <span>Meeting Minutes</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              to="/m/new"
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700"
            >
              <Plus className="size-4" /> New meeting
            </Link>
            {user?.role === "super_admin" && (
              <Link to="/admin/users" className="flex items-center gap-1 text-slate-600 hover:text-slate-900">
                <Users className="size-4" /> Users
              </Link>
            )}
            <span className="text-slate-500">{user?.email}</span>
            <button
              onClick={() => {
                logout();
                navigate({ to: "/login" });
              }}
              className="flex items-center gap-1 text-slate-600 hover:text-slate-900"
            >
              <LogOut className="size-4" /> Log out
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
      <footer className="text-xs text-slate-400 text-center py-4">
        path: <code>{path}</code>
      </footer>
    </div>
  );
}
