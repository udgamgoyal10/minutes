import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTemplates, useCreateMeeting } from "../lib/api.ts";

export function NewMeetingPage() {
  const { data: templatesData, isLoading } = useTemplates();
  const create = useCreateMeeting();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [label, setLabel] = useState("");

  const templates = templatesData?.templates ?? [];

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">New meeting</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!templateId) return;
          const res = await create.mutateAsync({ template_id: templateId, label });
          navigate({ to: "/m/$id/setup", params: { id: String(res.meeting.id) } });
        }}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-4"
      >
        <label className="block">
          <span className="text-sm text-slate-700">Template</span>
          <select
            value={templateId ?? ""}
            onChange={(e) => setTemplateId(Number(e.target.value) || null)}
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            required
          >
            <option value="">— select —</option>
            {isLoading && <option>Loading…</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.slug}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-700">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. BD Board Meeting — March 2026"
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
          />
        </label>
        {create.error && (
          <p className="text-sm text-rose-600">{(create.error as Error).message}</p>
        )}
        <button
          type="submit"
          disabled={!templateId || create.isPending}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </form>
    </div>
  );
}
