import { Link } from "@tanstack/react-router";
import { useMeetings } from "../lib/api.ts";
import { FileText, Loader2 } from "lucide-react";

export function MeetingsListPage() {
  const { data, isLoading, error } = useMeetings();
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Your meetings</h1>
      {isLoading && (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-rose-600">{(error as Error).message}</p>}
      {data && data.meetings.length === 0 && (
        <div className="bg-white border border-dashed border-slate-300 rounded-lg p-12 text-center">
          <FileText className="size-10 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-600 mb-4">No meetings yet.</p>
          <Link
            to="/m/new"
            className="inline-flex items-center px-4 py-2 bg-brand-600 text-white rounded-md hover:bg-brand-700"
          >
            Create your first meeting
          </Link>
        </div>
      )}
      {data && data.meetings.length > 0 && (
        <ul className="space-y-2">
          {data.meetings.map((m) => (
            <li
              key={m.id}
              className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between"
            >
              <div>
                <Link
                  to="/m/$id/setup"
                  params={{ id: String(m.id) }}
                  className="font-medium text-slate-900 hover:text-brand-700"
                >
                  {m.label}
                </Link>
                <p className="text-sm text-slate-500">
                  Status: {m.status} · updated {new Date(m.updated_at).toLocaleString()}
                </p>
              </div>
              <Link
                to="/m/$id/export"
                params={{ id: String(m.id) }}
                className="text-sm text-brand-600 hover:underline"
              >
                Export →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
