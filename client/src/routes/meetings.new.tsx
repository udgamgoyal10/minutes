import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCreateMeeting, useMeetingStructures, useOrganizations } from "../lib/api.ts";

export function NewMeetingPage() {
  const organizationsQ = useOrganizations();
  const create = useCreateMeeting();
  const navigate = useNavigate();
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const structuresQ = useMeetingStructures(organizationId);
  const [structureId, setStructureId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const organizations = organizationsQ.data?.organizations ?? [];
  const structures = useMemo(
    () => (structuresQ.data?.structures ?? []).filter((structure) => structure.is_active),
    [structuresQ.data?.structures],
  );

  useEffect(() => {
    if (organizationId || organizations.length === 0) return;
    setOrganizationId(organizations[0]!.id);
  }, [organizationId, organizations]);

  useEffect(() => {
    if (structures.length === 0) {
      setStructureId(null);
      return;
    }
    if (structures.some((structure) => structure.id === structureId)) return;
    setStructureId((structures.find((structure) => structure.is_default) ?? structures[0])!.id);
  }, [structureId, structures]);

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">New meeting</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!structureId) return;
          const res = await create.mutateAsync({ structure_id: structureId, label });
          navigate({ to: "/m/$id/setup", params: { id: String(res.meeting.id) } });
        }}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-4"
      >
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Organization</span>
          <select
            value={organizationId ?? ""}
            onChange={(e) => {
              setOrganizationId(Number(e.target.value) || null);
              setStructureId(null);
            }}
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            required
          >
            <option value="">— select organization —</option>
            {organizationsQ.isLoading && <option>Loading…</option>}
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Meeting type</span>
          <select
            value={structureId ?? ""}
            onChange={(e) => setStructureId(Number(e.target.value) || null)}
            disabled={!organizationId || structuresQ.isLoading}
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm disabled:bg-slate-50"
            required
          >
            <option value="">— select meeting type —</option>
            {structures.map((structure) => (
              <option key={structure.id} value={structure.id}>{structure.name}</option>
            ))}
          </select>
          {organizationId && !structuresQ.isLoading && structures.length === 0 && (
            <span className="mt-1 block text-xs text-amber-700">No active meeting types are configured for this organization.</span>
          )}
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. BD Board Meeting — March 2026"
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
          />
        </label>
        {create.error && <p className="text-sm text-rose-600">{(create.error as Error).message}</p>}
        <button
          type="submit"
          disabled={!structureId || create.isPending}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </form>
    </div>
  );
}
