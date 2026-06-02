import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Sparkles, Check, Loader2 } from "lucide-react";
import {
  useMeeting,
  useSections,
  useSources,
  useProviders,
  useUpdateSection,
  useGenerateSection,
  type SectionDraft,
  type ProviderInfo,
} from "../lib/api.ts";
import { StepNav } from "../components/StepNav.tsx";

export function SectionPage() {
  const params = useParams({ strict: false });
  const meetingId = Number(params.id);
  const sectionKey = params.key as string;
  const navigate = useNavigate();

  const meetingQ = useMeeting(meetingId);
  const sectionsQ = useSections(meetingId);
  const sourcesQ = useSources(meetingId);
  const providersQ = useProviders();
  const update = useUpdateSection(meetingId);
  const gen = useGenerateSection(meetingId);

  const sections = sectionsQ.data?.sections ?? [];
  const section = useMemo(() => sections.find((s) => s.section_key === sectionKey), [sections, sectionKey]);
  const idx = sections.findIndex((s) => s.section_key === sectionKey);
  const next = idx >= 0 && idx < sections.length - 1 ? sections[idx + 1] : null;

  const [content, setContent] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderInfo["id"] | "">("");
  const [model, setModel] = useState("");

  useEffect(() => {
    if (section) setContent(section.content_md);
  }, [section?.id]);

  useEffect(() => {
    const m = meetingQ.data?.meeting;
    if (m?.ai_provider) setProvider(m.ai_provider as ProviderInfo["id"]);
    if (m?.ai_model) setModel(m.ai_model);
  }, [meetingQ.data]);

  useEffect(() => {
    const selected = providersQ.data?.providers.find((p) => p.id === provider);
    if (!selected?.models.length) return;
    if (!model || !selected.models.includes(model)) setModel(selected.models[0] ?? "");
  }, [providersQ.data?.providers, provider, model]);

  if (!section) {
    return <div className="text-slate-500">Loading section…</div>;
  }

  return (
    <div>
      <StepNav meetingId={meetingId} current="section" />
      <div className="grid grid-cols-[16rem_1fr] gap-6">
        <aside className="space-y-1">
          {sections.map((s) => (
            <Link
              key={s.section_key}
              to="/m/$id/section/$key"
              params={{ id: String(meetingId), key: s.section_key }}
              className={`block px-3 py-2 rounded-md text-sm ${
                s.section_key === sectionKey
                  ? "bg-brand-50 text-brand-700 border border-brand-200"
                  : "hover:bg-slate-100 text-slate-700"
              }`}
            >
              <span className="text-xs text-slate-400 mr-2">{s.ordinal}.</span>
              {s.title}
              <StatusPill status={s.status} />
            </Link>
          ))}
        </aside>

        <main>
          <h1 className="text-xl font-semibold mb-2">{section.title}</h1>
          <p className="text-xs text-slate-500 mb-4">
            {section.last_ai_provider
              ? `Last edited by ${section.last_ai_provider}/${section.last_ai_model}`
              : "No AI run yet"}
          </p>

          <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Section mode</p>
                <p className="text-xs text-slate-500">
                  {section.mode === "template"
                    ? "Match the template wording except variables and changed data."
                    : "AI update is allowed for this section."}
                </p>
              </div>
              <select
                value={section.mode}
                onChange={(e) =>
                  update.mutate({
                    key: section.section_key,
                    mode: e.target.value as "template" | "ai",
                  })
                }
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
              >
                <option value="template">Match template wording</option>
                <option value="ai">AI update allowed</option>
              </select>
            </div>
            <div className="mt-3">
              <p className="text-xs text-slate-600 mb-1">Required sources</p>
              {section.required_sources.length > 0 ? (
                <ul className="grid grid-cols-2 gap-1">
                  {section.required_sources.map((source) => (
                    <li key={source} className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1">
                      {source}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">No specific source detected for this section.</p>
              )}
            </div>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="w-full border border-slate-300 rounded-md p-3 font-mono text-sm"
          />

          <div className="mt-4 bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="size-4 text-brand-600" /> Revise with AI
            </p>
            {section.mode === "template" && (
              <p className="text-xs text-amber-700">
                This section is set to match the template wording. Switch to AI update allowed if you want generated rewriting.
              </p>
            )}
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={2}
              placeholder="Extra instructions (optional). Leave blank to use the generic template prompt."
              className="w-full border border-slate-300 rounded-md p-2 text-sm"
            />
            <div className="flex gap-2 items-center">
              <select
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as ProviderInfo["id"];
                  setProvider(p);
                  const found = providersQ.data?.providers.find((x) => x.id === p);
                  if (found) setModel(found.models[0] ?? "");
                }}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
              >
                <option value="">provider</option>
                {(providersQ.data?.providers ?? [])
                  .filter((p) => p.configured)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} ({p.category})
                    </option>
                  ))}
              </select>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1"
              >
                {(providersQ.data?.providers.find((p) => p.id === provider)?.models ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                disabled={!provider || gen.isPending || section.mode === "template"}
                onClick={async () => {
                  await gen.mutateAsync({
                    key: section.section_key,
                    provider: provider as ProviderInfo["id"],
                    model,
                    user_prompt: userPrompt || undefined,
                  });
                }}
                className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1"
              >
                {gen.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Generate
              </button>
            </div>
            {gen.error && <p className="text-xs text-rose-600">{(gen.error as Error).message}</p>}
            <p className="text-xs text-slate-500">
              Sources available: {sourcesQ.data?.sources.length ?? 0}
            </p>
          </div>

          <div className="mt-6 flex justify-between">
            <button
              onClick={() => update.mutate({ key: section.section_key, content_md: content })}
              disabled={update.isPending}
              className="text-sm text-slate-700 underline"
            >
              Save draft
            </button>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await update.mutateAsync({
                    key: section.section_key,
                    content_md: content,
                    status: "approved",
                  });
                  if (next) {
                    navigate({
                      to: "/m/$id/section/$key",
                      params: { id: String(meetingId), key: next.section_key },
                    });
                  } else {
                    navigate({ to: "/m/$id/export", params: { id: String(meetingId) } });
                  }
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-md px-4 py-2 text-sm font-medium flex items-center gap-1"
              >
                <Check className="size-4" />
                {next ? "Approve & next" : "Approve & export"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: SectionDraft["status"] }) {
  const cls =
    status === "approved"
      ? "bg-emerald-100 text-emerald-700"
      : status === "draft"
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-500";
  return <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{status}</span>;
}
