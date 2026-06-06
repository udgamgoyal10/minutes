import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, FilePlus, Loader2, Plus, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import {
  useCreateSection,
  useCreateSectionTemplate,
  useDeleteSection,
  useGenerateSection,
  useMeeting,
  useProviders,
  useReorderSections,
  useRevertSection,
  useSectionPrompt,
  useSections,
  useSources,
  useUpdateSection,
  type ProviderInfo,
  type SectionDraft,
  type SectionTemplate,
} from "../lib/api.ts";
import { StepNav } from "../components/StepNav.tsx";
import { SectionSourcePanel } from "../components/SectionSourcePanel.tsx";
import { SectionPicker } from "../components/SectionPicker.tsx";

export function SectionPage() {
  const params = useParams({ strict: false });
  const meetingId = Number(params.id);
  const sectionKey = params.key as string;
  const navigate = useNavigate();

  const meetingQ = useMeeting(meetingId);
  const sectionsQ = useSections(meetingId);
  const sourcesQ = useSources(meetingId, sectionKey);
  const providersQ = useProviders();
  const update = useUpdateSection(meetingId);
  const gen = useGenerateSection(meetingId);
  const revert = useRevertSection(meetingId);
  const createSection = useCreateSection(meetingId);
  const createTemplate = useCreateSectionTemplate();
  const deleteSection = useDeleteSection(meetingId);
  const reorder = useReorderSections(meetingId);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyAddKey, setBusyAddKey] = useState<string | null>(null);

  // Per-section AI generation tracking so revisions in different sections can run
  // in parallel, and a completing run only fills the section it was started on.
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({});
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});
  const currentKeyRef = useRef(sectionKey);
  useEffect(() => {
    currentKeyRef.current = sectionKey;
  }, [sectionKey]);

  const sections = sectionsQ.data?.sections ?? [];
  const section = useMemo(() => sections.find((s) => s.section_key === sectionKey), [sections, sectionKey]);
  const idx = sections.findIndex((s) => s.section_key === sectionKey);
  const next = idx >= 0 && idx < sections.length - 1 ? sections[idx + 1] : null;

  const [content, setContent] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderInfo["id"] | "">("");
  const [model, setModel] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);

  const promptQ = useSectionPrompt(meetingId, sectionKey);
  const defaultPrompt = promptQ.data?.prompt ?? "";

  const isEnterpriseProvider =
    providersQ.data?.providers.find((p) => p.id === provider)?.category === "enterprise";

  useEffect(() => {
    if (section) setContent(section.preview_md || section.content_md);
  }, [section?.id, section?.preview_md]);

  // Reset the editable prompt whenever the section changes or a fresh default
  // arrives, unless the user has manually edited it.
  useEffect(() => {
    setPromptDirty(false);
    setShowPrompt(false);
  }, [sectionKey]);

  useEffect(() => {
    if (!promptDirty) setPromptText(defaultPrompt);
  }, [defaultPrompt, promptDirty]);

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
      <div className="grid grid-cols-[18rem_1fr] gap-6">
        <aside className="space-y-1">
          <button
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-center gap-1 bg-brand-600 hover:bg-brand-700 text-white rounded-md py-2 text-sm font-medium"
          >
            <Plus className="size-4" /> Add section
          </button>
          <button
            onClick={async () => {
              const title = window.prompt("Title for the new blank section:")?.trim();
              if (!title) return;
              const result = await createSection.mutateAsync({
                title,
                content_md: "",
                template_body_text: "",
                mode: "ai",
              });
              const created = result.section;
              if (created) {
                navigate({
                  to: "/m/$id/section/$key",
                  params: { id: String(meetingId), key: created.section_key },
                });
              }
            }}
            className="w-full flex items-center justify-center gap-1 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md py-2 text-sm font-medium"
          >
            <FilePlus className="size-4" /> New blank section
          </button>
          {sections.map((s, index) => {
            const isActive = s.section_key === sectionKey;
            return (
              <div
                key={s.section_key}
                className={`group flex items-stretch gap-1 rounded-md ${
                  isActive ? "bg-brand-50 border border-brand-200" : "hover:bg-slate-100"
                }`}
              >
                <Link
                  to="/m/$id/section/$key"
                  params={{ id: String(meetingId), key: s.section_key }}
                  className={`flex-1 min-w-0 px-3 py-2 text-sm break-words ${
                    isActive ? "text-brand-700" : "text-slate-700"
                  }`}
                >
                  <span className="text-xs text-slate-400 mr-2">{s.ordinal}.</span>
                  <span>{s.title}</span>
                  <StatusPill status={s.status} />
                  {pendingKeys[s.section_key] && (
                    <Loader2 className="inline size-3.5 ml-1 animate-spin text-brand-600 align-text-bottom" />
                  )}
                </Link>
                <div className="flex flex-col items-center justify-center pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={async () => {
                      if (index === 0 || reorder.isPending) return;
                      const order = sections.map((x) => x.section_key);
                      const swap = order[index - 1]!;
                      order[index - 1] = s.section_key;
                      order[index] = swap;
                      await reorder.mutateAsync(order);
                    }}
                    disabled={index === 0 || reorder.isPending}
                    className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (index === sections.length - 1 || reorder.isPending) return;
                      const order = sections.map((x) => x.section_key);
                      const swap = order[index + 1]!;
                      order[index + 1] = s.section_key;
                      order[index] = swap;
                      await reorder.mutateAsync(order);
                    }}
                    disabled={index === sections.length - 1 || reorder.isPending}
                    className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Remove section "${s.title}"?`)) return;
                      await deleteSection.mutateAsync(s.section_key);
                      if (isActive) {
                        const remaining = sections.filter((x) => x.section_key !== s.section_key);
                        if (remaining.length) {
                          navigate({
                            to: "/m/$id/section/$key",
                            params: { id: String(meetingId), key: remaining[0]!.section_key },
                          });
                        }
                      }
                    }}
                    className="p-0.5 text-slate-400 hover:text-rose-600"
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </aside>

        <SectionPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          excludeKeys={sections.map((s) => s.section_key)}
          busyKey={busyAddKey}
          onPick={async (s: SectionTemplate) => {
            setBusyAddKey(s.key);
            try {
              const result = await createSection.mutateAsync({
                title: s.title,
                template_body_text: s.body_text,
                content_md: s.body_text,
                required_sources: s.required_sources,
                mode: "template",
              });
              setPickerOpen(false);
              const created = result.section;
              if (created) {
                navigate({
                  to: "/m/$id/section/$key",
                  params: { id: String(meetingId), key: created.section_key },
                });
              }
            } finally {
              setBusyAddKey(null);
            }
          }}
        />

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
              <p className="text-xs text-slate-600 mb-2">Sources for this section</p>
              <SectionSourcePanel meetingId={meetingId} section={section} />
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
              <p className="text-xs text-slate-500">
                Template mode: AI keeps the template wording exact and only fills <span className="font-mono">&lt;placeholders&gt;</span> using uploaded sources.
                Switch to "AI update allowed" if you want the AI to rewrite the section.
              </p>
            )}
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={2}
              placeholder="Extra instructions (optional). Leave blank to use the default section prompt."
              className="w-full border border-slate-300 rounded-md p-2 text-sm"
            />

            <div className="border border-slate-200 rounded-md">
              <button
                type="button"
                onClick={() => setShowPrompt((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <span className="flex items-center gap-1">
                  {showPrompt ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  {promptDirty ? "Edited prompt (sent to AI)" : "Default prompt for this section"}
                </span>
                {promptDirty && (
                  <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                    custom
                  </span>
                )}
              </button>
              {showPrompt && (
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-[11px] text-slate-500">
                    This is the exact prompt sent to the AI. Edit it to change behaviour for this run,
                    or reset to the system default. By default the AI only changes the
                    <span className="font-mono"> &lt;…&gt; </span> placeholder locations.
                  </p>
                  <textarea
                    value={promptText}
                    onChange={(e) => {
                      setPromptText(e.target.value);
                      setPromptDirty(true);
                    }}
                    rows={12}
                    className="w-full border border-slate-300 rounded-md p-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      setPromptDirty(false);
                      const fresh = await promptQ.refetch();
                      setPromptText(fresh.data?.prompt ?? defaultPrompt);
                    }}
                    className="text-xs text-brand-700 hover:underline flex items-center gap-1"
                  >
                    <RotateCcw className="size-3.5" /> Reset to default prompt
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2 items-center justify-between flex-wrap">
              <div className="flex gap-2 items-center text-xs">
                <select
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value as ProviderInfo["id"] | "";
                    setProvider(p);
                    if (p) {
                      const found = providersQ.data?.providers.find((x) => x.id === p);
                      setModel(found?.models[0] ?? "");
                    } else {
                      setModel("");
                    }
                  }}
                  className="border border-slate-300 rounded-md px-2 py-1 text-xs"
                  title="Provider for this section"
                >
                  <option value="">(provider)</option>
                  {(providersQ.data?.providers ?? []).map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.configured}>
                      {p.id}{p.configured ? "" : " (needs API key)"}
                    </option>
                  ))}
                </select>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={!provider}
                  className={`border rounded-md px-2 py-1 text-xs disabled:opacity-50 max-w-[14rem] ${
                    isEnterpriseProvider
                      ? "border-yellow-400 bg-yellow-100 text-yellow-900"
                      : "border-slate-300"
                  }`}
                  title={isEnterpriseProvider ? "Cloud model — data may leave the premises" : "Model for this section"}
                >
                  {(providersQ.data?.providers.find((p) => p.id === provider)?.models ?? []).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span className={isEnterpriseProvider ? "text-yellow-700" : "text-slate-400"}>
                  {isEnterpriseProvider ? "data may leave premises" : "defaults from Setup"}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const result = await revert.mutateAsync(section.section_key);
                    const next = result.section?.preview_md ?? result.section?.content_md;
                    if (next != null) setContent(next);
                  }}
                  disabled={revert.isPending || !section.template_body_text}
                  title="Replace current text with the original template wording"
                  className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                >
                  {revert.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  Revert to template
                </button>
                <button
                  disabled={!provider || pendingKeys[section.section_key]}
                  onClick={async () => {
                    const key = section.section_key;
                    const promptOverride = promptDirty ? promptText : undefined;
                    const extraPrompt = promptDirty ? undefined : userPrompt || undefined;
                    setGenErrors((m) => {
                      const n = { ...m };
                      delete n[key];
                      return n;
                    });
                    setPendingKeys((m) => ({ ...m, [key]: true }));
                    try {
                      const result = await gen.mutateAsync({
                        key,
                        provider: provider as ProviderInfo["id"],
                        model,
                        user_prompt: extraPrompt,
                        prompt_override: promptOverride,
                      });
                      const next = result.section?.preview_md ?? result.section?.content_md;
                      // Only fill the editor if the user is still on the section the
                      // run was started for.
                      if (next != null && currentKeyRef.current === key) setContent(next);
                    } catch (err) {
                      setGenErrors((m) => ({ ...m, [key]: (err as Error).message }));
                    } finally {
                      setPendingKeys((m) => {
                        const n = { ...m };
                        delete n[key];
                        return n;
                      });
                    }
                  }}
                  className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                >
                  {pendingKeys[section.section_key] ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Generate
                </button>
              </div>
            </div>
            {genErrors[section.section_key] && (
              <p className="text-xs text-rose-600">{genErrors[section.section_key]}</p>
            )}
            <p className="text-xs text-slate-500">
              Sources available: {sourcesQ.data?.sources.length ?? 0}
            </p>
          </div>

          <div className="mt-6 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <button
                onClick={() => update.mutate({ key: section.section_key, content_md: content })}
                disabled={update.isPending}
                className="text-sm text-slate-700 underline"
              >
                Save draft
              </button>
              <button
                onClick={async () => {
                  const title = window.prompt(
                    "Save the current text as a reusable section template. Template name:",
                    section.title,
                  )?.trim();
                  if (!title) return;
                  await createTemplate.mutateAsync({
                    title,
                    body_text: content,
                    required_sources: section.required_sources,
                  });
                  window.alert("Saved to \u201cMy templates\u201d. Add it any time from \u201cAdd section\u201d.");
                }}
                disabled={createTemplate.isPending}
                className="text-sm text-slate-700 hover:text-brand-700 flex items-center gap-1"
              >
                {createTemplate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save as template
              </button>
            </div>
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
