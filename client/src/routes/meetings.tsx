import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Download, FileText, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import {
  downloadCombinedMeetingsExport,
  useDeleteMeeting,
  useMeetings,
  useOrganizations,
  useUpdateMeeting,
  type Meeting,
} from "../lib/api.ts";

export function MeetingsListPage() {
  const { data, isLoading, error } = useMeetings();
  const organizationsQ = useOrganizations();
  const del = useDeleteMeeting();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [year, setYear] = useState("");
  const selectedIds = [...selected];
  const organizations = organizationsQ.data?.organizations ?? [];
  const organizationNames = useMemo(
    () => new Map(organizations.map((organization) => [organization.id, organization.name])),
    [organizations],
  );
  const years = useMemo(
    () => [...new Set((data?.meetings ?? []).map(meetingYear))].sort((a, b) => b.localeCompare(a)),
    [data?.meetings],
  );
  const filteredMeetings = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return (data?.meetings ?? []).filter((meeting) => {
      const organizationName = organizationNames.get(meeting.organization_id ?? -1) ?? "";
      if (organizationId && meeting.organization_id !== Number(organizationId)) return false;
      if (year && meetingYear(meeting) !== year) return false;
      if (!search) return true;
      return [
        meeting.label,
        meeting.owner_email ?? "",
        meeting.status,
        meeting.meeting_date ?? "",
        organizationName,
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [data?.meetings, organizationId, organizationNames, searchTerm, year]);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Meetings</h1>
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
        <>
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)_minmax(8rem,auto)]">
            <label className="relative block">
              <span className="sr-only">Search meetings</span>
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search meetings"
                className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm"
              />
            </label>
            <label>
              <span className="sr-only">Filter by organization</span>
              <select
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All organizations</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by year</span>
              <select
                value={year}
                onChange={(event) => setYear(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All years</option>
                {years.map((meetingYearOption) => (
                  <option key={meetingYearOption} value={meetingYearOption}>
                    {meetingYearOption}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              type="button"
              onClick={async () => {
                if (!selectedIds.length) return;
                setExporting(true);
                try {
                  await downloadCombinedMeetingsExport(selectedIds);
                } finally {
                  setExporting(false);
                }
              }}
              disabled={exporting || selectedIds.length === 0}
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Export selected to one .docx
            </button>
            <span className="text-sm text-slate-500">
              {selectedIds.length} selected; export is ordered by meeting date.
            </span>
          </div>
          {filteredMeetings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
              No meetings match the current search and filters.
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredMeetings.map((m) => (
                <MeetingRow
                  key={m.id}
                  meeting={m}
                  organizationName={organizationNames.get(m.organization_id ?? -1)}
                  selected={selected.has(m.id)}
                  onSelect={(checked) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(m.id);
                      else next.delete(m.id);
                      return next;
                    });
                  }}
                  onDelete={async () => {
                    if (!confirm(`Delete meeting "${m.label}"? This cannot be undone.`)) return;
                    await del.mutateAsync(m.id);
                    setSelected((prev) => {
                      const next = new Set(prev);
                      next.delete(m.id);
                      return next;
                    });
                  }}
                  deleting={del.isPending}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function MeetingRow({
  meeting,
  organizationName,
  selected,
  onSelect,
  onDelete,
  deleting,
}: {
  meeting: Meeting;
  organizationName?: string;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onDelete: () => Promise<void> | void;
  deleting: boolean;
}) {
  const update = useUpdateMeeting(meeting.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.label);

  return (
    <li className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3">
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onSelect(e.target.checked)}
        className="size-4 rounded border-slate-300 text-brand-600"
        aria-label={`Select ${meeting.label}`}
      />
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
              {organizationName ? `${organizationName} · ` : ""}
              {meeting.owner_email ? `${meeting.owner_email} · ` : ""}
              {meeting.meeting_date ? `Meeting date: ${meeting.meeting_date} · ` : ""}Status:{" "}
              {meeting.status} · updated {new Date(meeting.updated_at).toLocaleString()}
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

function meetingYear(meeting: Meeting): string {
  return (meeting.meeting_date ?? meeting.created_at).slice(0, 4);
}
