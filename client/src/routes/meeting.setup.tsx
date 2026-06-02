import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import {
  useMeeting,
  useTemplates,
  useProviders,
  useUpdateMeeting,
  type ProviderInfo,
} from "../lib/api.ts";
import { StepNav } from "../components/StepNav.tsx";

export function SetupPage() {
  const { id } = useParams({ strict: false });
  const meetingId = Number(id);
  const navigate = useNavigate();
  const meetingQ = useMeeting(meetingId);
  const templatesQ = useTemplates();
  const providersQ = useProviders();
  const update = useUpdateMeeting(meetingId);

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
        {placeholders.length === 0 && <p className="text-slate-500 col-span-2">No placeholders detected.</p>}
        {placeholders.map((p) => (
          <label key={p.token} className="block">
            <span className="text-xs text-slate-600">{p.raw}</span>
            <input
              value={vars[p.token] ?? ""}
              onChange={(e) => setVars({ ...vars, [p.token]: e.target.value })}
              className="mt-1 w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>

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
            navigate({ to: "/m/$id/sources", params: { id: String(meetingId) } });
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
      ? "Enterprise AI is fast and capable, but data leaves the network. Avoid uploading sources containing monetary values where possible."
      : "Pick a provider below. Local Ollama is safer for sensitive data; enterprise providers are faster but data leaves the network.";
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
  const configured = providers.filter((p) => p.configured);
  const selected = configured.find((p) => p.id === provider);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex gap-2 flex-wrap">
        {configured.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onChangeProvider(p.id);
              onChangeModel(p.models[0] ?? "");
            }}
            className={`px-3 py-1.5 rounded-md text-sm border ${
              provider === p.id
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {p.id} <span className="text-xs text-slate-500 ml-1">({p.category})</span>
          </button>
        ))}
        {configured.length === 0 && (
          <p className="text-sm text-slate-500">
            No providers configured. Set <code>OLLAMA_BASE_URL</code>, <code>ANTHROPIC_API_KEY</code>,
            or <code>GOOGLE_API_KEY</code> in the server .env.
          </p>
        )}
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
