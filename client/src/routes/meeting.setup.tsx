import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import {
  useCreateSection,
  useDeleteSection,
  useMeeting,
  useProviders,
  useSections,
  useTemplates,
  useUpdateMeeting,
  type ProviderInfo,
  type SectionTemplate,
} from "../lib/api.ts";
import { StepNav } from "../components/StepNav.tsx";
import { SectionPicker } from "../components/SectionPicker.tsx";

export function SetupPage() {
  const { id } = useParams({ strict: false });
  const meetingId = Number(id);
  const navigate = useNavigate();
  const meetingQ = useMeeting(meetingId);
  const templatesQ = useTemplates();
  const providersQ = useProviders();
  const sectionsQ = useSections(meetingId);
  const update = useUpdateMeeting(meetingId);
  const createSection = useCreateSection(meetingId);
  const deleteSection = useDeleteSection(meetingId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyAddKey, setBusyAddKey] = useState<string | null>(null);

  const meeting = meetingQ.data?.meeting;
  const template = useMemo(
    () => templatesQ.data?.templates.find((t) => t.id === meeting?.template_id),
    [meeting, templatesQ.data],
  );

  const [vars, setVars] = useState<Record<string, string>>({});
  const [meetingDate, setMeetingDate] = useState("");
  const [previousDate, setPreviousDate] = useState("");
  const [provider, setProvider] = useState<ProviderInfo["id"] | "">("");
  const [model, setModel] = useState("");

  useEffect(() => {
    if (!meeting) return;
    setVars(meeting.variables ?? {});
    setMeetingDate(meeting.meeting_date ?? "");
    setPreviousDate(meeting.previous_meeting_date ?? "");
    if (meeting.ai_provider) setProvider(meeting.ai_provider as ProviderInfo["id"]);
    if (meeting.ai_model) setModel(meeting.ai_model);
  }, [meeting]);

  useEffect(() => {
    const selected = providersQ.data?.providers.find((p) => p.id === provider);
    if (!selected?.models.length) return;
    if (!model || !selected.models.includes(model)) setModel(selected.models[0] ?? "");
  }, [providersQ.data?.providers, provider, model]);

  const placeholders = template?.parsed.globalPlaceholders ?? [];

  // Tokens that map a "date" placeholder to the derived day/month/year tokens
  // the template actually contains. If any of the derived tokens are used by a
  // selected section, surface the date input on the setup page.
  const DATE_ALIASES: Record<string, string[]> = {
    "adoption-of-annual-accounts-date": [
      "adoption-of-annual-accounts-day",
      "adoption-of-annual-accounts-month",
      "adoption-of-annual-accounts-year",
    ],
  };

  const usedTokens = useMemo(() => {
    const used = new Set<string>();
    // Scan both the section body AND title — some placeholders (e.g. Financial
    // Year) only appear in the section heading.
    const bodies = (sectionsQ.data?.sections ?? []).flatMap((s) => [
      s.template_body_text ?? "",
      s.title ?? "",
    ]);
    for (const body of bodies) {
      for (const m of body.matchAll(/<([^<>\n]{2,200}?)>/g)) {
        used.add(slugToken(m[1] ?? ""));
      }
    }
    return used;
  }, [sectionsQ.data?.sections]);

  const visiblePlaceholders = useMemo(() => {
    return placeholders.filter((p) => {
      const aliases = DATE_ALIASES[p.token];
      if (aliases) return aliases.some((a) => usedTokens.has(a));
      return usedTokens.has(p.token);
    });
  }, [placeholders, usedTokens]);

  return (
    <div>
      <StepNav meetingId={meetingId} current="setup" />
      <h1 className="text-2xl font-semibold mb-4">{meeting?.label ?? "Loading…"}</h1>

      <SafetyBanner provider={provider as ProviderInfo["id"]} />

      <div className="grid grid-cols-2 gap-4 mt-6">
        <DateField label="Previous meeting date" value={previousDate} onChange={setPreviousDate} />
        <DateField label="This meeting date" value={meetingDate} onChange={setMeetingDate} />
      </div>

      <h2 className="text-lg font-medium mt-8 mb-3">Template variables</h2>
      <p className="text-sm text-slate-500 mb-3">
        Fill the placeholders found in the template header. Anything left blank stays as
        <code className="mx-1">&lt;…&gt;</code> in the final document.
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 bg-white border border-slate-200 rounded-lg p-4">
        {visiblePlaceholders.length === 0 && (
          <p className="text-slate-500 col-span-2">
            No template variables are referenced by the sections currently selected.
          </p>
        )}
        {visiblePlaceholders.map((p) => {
          const isDate = p.kind === "date";
          return (
            <label key={p.token} className="block">
              <span className="text-xs text-slate-600">{p.raw}</span>
              <input
                type={isDate ? "date" : "text"}
                value={vars[p.token] ?? ""}
                onChange={(e) => setVars({ ...vars, [p.token]: e.target.value })}
                className="mt-1 w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
              />
            </label>
          );
        })}
      </div>

      <h2 className="text-lg font-medium mt-8 mb-3">Sections</h2>
      <p className="text-sm text-slate-500 mb-3">
        The meeting starts with every section from <span className="font-medium">{template?.title ?? "the template"}</span>.
        Remove ones you don’t need, or add more from any template before moving to the editor.
      </p>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {(sectionsQ.data?.sections ?? []).length === 0 && (
          <p className="p-4 text-sm text-slate-500">No sections in this meeting yet.</p>
        )}
        {(sectionsQ.data?.sections ?? []).map((s) => (
          <div key={s.section_key} className="flex items-start gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400">{s.ordinal}.</span>
                <span className="text-sm font-medium text-slate-900">{s.title}</span>
              </div>
              {s.required_sources.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {s.required_sources.map((source) => (
                    <li
                      key={source}
                      className="text-[10px] bg-amber-50 border border-amber-200 text-amber-800 rounded px-2 py-0.5"
                    >
                      {source}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={async () => {
                if (!confirm(`Remove section "${s.title}"?`)) return;
                await deleteSection.mutateAsync(s.section_key);
              }}
              disabled={deleteSection.isPending}
              className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              title="Remove section"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <div className="p-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-center gap-1 text-sm border border-dashed border-slate-300 hover:border-brand-400 hover:bg-brand-50 text-slate-600 rounded-md py-2"
          >
            <Plus className="size-4" /> Add section from catalog
          </button>
        </div>
      </div>

      <SectionPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeKeys={(sectionsQ.data?.sections ?? []).map((s) => s.section_key)}
        busyKey={busyAddKey}
        onPick={async (s: SectionTemplate) => {
          setBusyAddKey(s.key);
          try {
            await createSection.mutateAsync({
              title: s.title,
              template_body_text: s.body_text,
              content_md: s.body_text,
              required_sources: s.required_sources,
              mode: "template",
            });
          } finally {
            setBusyAddKey(null);
          }
        }}
      />

      <h2 className="text-lg font-medium mt-8 mb-3">AI provider</h2>
      <ProviderPicker
        providers={providersQ.data?.providers ?? []}
        provider={provider as ProviderInfo["id"]}
        model={model}
        onChangeProvider={setProvider}
        onChangeModel={setModel}
      />

      <div className="mt-8 flex justify-end gap-2">
        <button
          onClick={async () => {
            await update.mutateAsync({
              variables: vars,
              meeting_date: meetingDate || undefined,
              previous_meeting_date: previousDate || undefined,
              ai_provider: provider || undefined,
              ai_model: model || undefined,
            });
            navigate({ to: "/m/$id/sections", params: { id: String(meetingId) } });
          }}
          disabled={update.isPending}
          className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Save & continue →
        </button>
      </div>
    </div>
  );
}

function slugToken(raw: string): string {
  const base = raw
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (base === "trustee-1-aka-managing-trustee" || base === "managing-trustee") return "trustee-1";
  if (base === "day-of-month") return "day";
  if (base === "year-of-meeting") return "year";
  if (base === "year-of-adoption-of-annual-accounts") return "adoption-of-annual-accounts-year";
  if (base.startsWith("financial-year")) return "financial-year";
  return base;
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm text-slate-700">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
      />
    </label>
  );
}

function SafetyBanner({ provider }: { provider: ProviderInfo["id"] | "" }) {
  const isLocal = provider === "ollama";
  const Icon = isLocal ? ShieldCheck : AlertTriangle;
  const cls = isLocal
    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
    : "bg-amber-50 border-amber-200 text-amber-900";
  const msg = isLocal
    ? "Local Ollama is safer for sensitive financial data, but slower."
    : provider
      ? "Enterprise AI is fast and capable, but data leaves the network. To stay safe, avoid uploading sources that contain account information, bank statements, or trust details \u2014 stick to summaries and operational documents."
      : "Pick a provider below. Local Ollama is safer for sensitive data; enterprise providers are faster but data leaves the network. Regardless of provider, avoid uploading sources that contain account information or trust details.";
  return (
    <div className={`flex gap-3 items-start border rounded-md p-3 text-sm ${cls}`}>
      <Icon className="size-5 mt-0.5" />
      <p>{msg}</p>
    </div>
  );
}

function ProviderPicker({
  providers,
  provider,
  model,
  onChangeProvider,
  onChangeModel,
}: {
  providers: ProviderInfo[];
  provider: ProviderInfo["id"] | "";
  model: string;
  onChangeProvider: (p: ProviderInfo["id"]) => void;
  onChangeModel: (m: string) => void;
}) {
  const selected = providers.find((p) => p.id === provider && p.configured);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex gap-2 flex-wrap">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!p.configured}
            title={p.configured ? undefined : `Set the API key for ${p.id} in the server .env to enable it`}
            onClick={() => {
              if (!p.configured) return;
              onChangeProvider(p.id);
              onChangeModel(p.models[0] ?? "");
            }}
            className={`px-3 py-1.5 rounded-md text-sm border ${
              provider === p.id
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : p.configured
                  ? "border-slate-300 text-slate-700 hover:bg-slate-50"
                  : "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
            }`}
          >
            {p.id} <span className="text-xs ml-1">({p.configured ? p.category : "needs API key"})</span>
          </button>
        ))}
      </div>
      {selected && (
        <label className="block">
          <span className="text-sm text-slate-700">Model</span>
          <select
            value={model}
            onChange={(e) => onChangeModel(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
          >
            {selected.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
