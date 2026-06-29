import { useState } from "react";
import { Loader2, Plus, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth.tsx";
import { useCreateUser, useUsers } from "../lib/api.ts";

export function AdminUsersPage() {
  const { user } = useAuth();
  const usersQ = useUsers();
  const create = useCreateUser();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  if (user?.role !== "super_admin") {
    return <p className="text-rose-600">Only the super admin can manage users.</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Users</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setCreatedEmail(null);
          const res = await create.mutateAsync({ email, role });
          setCreatedEmail(res.user.email);
          setEmail("");
          setRole("user");
        }}
        className="bg-white border border-slate-200 rounded-lg p-4 mb-6 grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 items-end"
      >
        <label className="block">
          <span className="text-sm text-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-700">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "user" | "admin")}
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add user
        </button>
      </form>
      {createdEmail && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-4 mb-6 text-sm">
          Added {createdEmail}. They can sign in with Google and set up Google Authenticator on first login.
        </div>
      )}
      {create.error && <p className="text-sm text-rose-600 mb-4">{(create.error as Error).message}</p>}
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {usersQ.isLoading && <p className="p-4 text-slate-500">Loading users…</p>}
        {usersQ.data?.users.map((u) => (
          <div key={u.id} className="p-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900">{u.email}</p>
              <p className="text-sm text-slate-500">Role: {u.role}</p>
            </div>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${u.two_factor_enabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              <ShieldCheck className="size-3.5" />
              {u.two_factor_enabled ? "2FA enabled" : "Setup pending"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
