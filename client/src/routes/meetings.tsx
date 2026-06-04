import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, FileText, Loader2, Pencil, Trash2, X } from "lucide-react";
import {
  useDeleteMeeting,
  useMeetings,
  useUpdateMeeting,
  type Meeting,
} from "../lib/api.ts";

export function MeetingsListPage() {
  const { data, isLoading, error } = useMeetings();
  const del = useDeleteMeeting();
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
            <MeetingRow
              key={m.id}
              meeting={m}
              onDelete={async () => {
                if (!confirm(`Delete meeting "${m.label}"? This cannot be undone.`)) return;
                await del.mutateAsync(m.id);
              }}
              deleting={del.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MeetingRow({
  meeting,
  onDelete,
  deleting,
}: {
  meeting: Meeting;
  onDelete: () => Promise<void> | void;
  deleting: boolean;
}) {
  const update = useUpdateMeeting(meeting.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.label);

  return (
    <li className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const value = draft.trim();
              if (!value) return;
              await update.mutateAsync({ label: value });
              setEditing(false);
            }}
            className="flex items-center gap-2"
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 border border-slate-300 rounded-md px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={update.isPending || !draft.trim()}
              className="p-1.5 rounded-md border border-slate-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
              title="Save"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(meeting.label);
                setEditing(false);
              }}
              className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
              title="Cancel"
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <Link
                to="/m/$id/setup"
                params={{ id: String(meeting.id) }}
                className="font-medium text-slate-900 hover:text-brand-700"
              >
                {meeting.label}
              </Link>
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded text-slate-400 hover:text-brand-700 hover:bg-slate-100"
                title="Rename meeting"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
            <p className="text-sm text-slate-500">
              Status: {meeting.status} · updated {new Date(meeting.updated_at).toLocaleString()}
            </p>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/m/$id/setup"
            params={{ id: String(meeting.id) }}
            className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
            title="Edit meeting"
          >
            <Pencil className="size-4" />
          </Link>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </li>
  );
}
