import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import {
  useCreateSection,
  useDeleteSection,
  useMeeting,
  useOrganizations,
  useProviders,
  useSaveVariableValues,
  useSections,
  useSectionTemplates,
  useTemplates,
  useTemplateVariables,
  useUpdateMeeting,
  useUpdateTemplateVariable,
  useCreateTemplateVariable,
  useUpdateVariableValue,
  useDeleteTemplateVariable,
  useDeleteVariableValue,
  useVariableValues,
  type MeetingType,
  type Placeholder,
  type ProviderInfo,
  type SectionTemplate,
} from "../lib/api.ts";
import { StepNav } from "../components/StepNav.tsx";
import { SectionPicker } from "../components/SectionPicker.tsx";

const GENDER_ROLES = [
  {
    baseToken: "trustee-1",
    genderToken: "managing-trustee-gender",
    pronounTokens: [
      "managing-trustee-subject-pronoun",
      "managing-trustee-object-pronoun",
      "managing-trustee-possessive-pronoun",
    ],
  },
  {
    baseToken: "secretary",
    genderToken: "secretary-gender",
    pronounTokens: [
      "secretary-subject-pronoun",
      "secretary-object-pronoun",
      "secretary-possessive-pronoun",
    ],
  },
  {
    baseToken: "treasurer",
    genderToken: "treasurer-gender",
    pronounTokens: [
      "treasurer-subject-pronoun",
      "treasurer-object-pronoun",
      "treasurer-possessive-pronoun",
    ],
  },
  {
    baseToken: "income-tax-representative",
    genderToken: "income-tax-representative-gender",
    pronounTokens: [
      "income-tax-representative-subject-pronoun",
      "income-tax-representative-object-pronoun",
      "income-tax-representative-possessive-pronoun",
    ],
  },
  {
    baseToken: "medical-superintendent-of-jkc-mangarh",
    genderToken: "medical-superintendent-gender",
    pronounTokens: [
      "medical-superintendent-subject-pronoun",
      "medical-superintendent-object-pronoun",
      "medical-superintendent-possessive-pronoun",
    ],
  },
];

const GENDER_METADATA_TOKENS = new Set(
  GENDER_ROLES.flatMap((role) => [role.genderToken, ...role.pronounTokens]),
);
const GENDER_ROLE_BY_BASE_TOKEN = new Map(GENDER_ROLES.map((role) => [role.baseToken, role]));

function isGenderMetadataToken(token: string): boolean {
  return GENDER_METADATA_TOKENS.has(token);
}

export function SetupPage() {
  const { id } = useParams({ strict: false });
  const meetingId = Number(id);
  const navigate = useNavigate();
  const meetingQ = useMeeting(meetingId);
  const templatesQ = useTemplates();
  const organizationsQ = useOrganizations();
  const providersQ = useProviders();
  const sectionsQ = useSections(meetingId);
  const templateVariablesQ = useTemplateVariables(meetingQ.data?.meeting.organization_id);
  const update = useUpdateMeeting(meetingId);
  const createSection = useCreateSection(meetingId);
  const deleteSection = useDeleteSection(meetingId);
  const variableValuesQ = useVariableValues();
  const saveVariableValues = useSaveVariableValues();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyAddKey, setBusyAddKey] = useState<string | null>(null);
  const [variableManagerOpen, setVariableManagerOpen] = useState(false);

  const meeting = meetingQ.data?.meeting;
  const template = useMemo(
    () => templatesQ.data?.templates.find((t) => t.id === meeting?.template_id),
    [meeting, templatesQ.data],
  );
  const organization = organizationsQ.data?.organizations.find(
    (candidate) => candidate.id === meeting?.organization_id,
  );
  const isRgs = organization?.slug === "rgs";

  const [vars, setVars] = useState<Record<string, string>>({});
  const [meetingDate, setMeetingDate] = useState("");
  const [previousDate, setPreviousDate] = useState("");
  const [isAnnual, setIsAnnual] = useState(false);
  const [meetingType, setMeetingType] = useState<MeetingType>("");
  const [provider, setProvider] = useState<ProviderInfo["id"] | "">("");
  const [model, setModel] = useState("");

  useEffect(() => {
    if (!meeting) return;
    setVars(meeting.variables ?? {});
    setMeetingDate(meeting.meeting_date ?? "");
    setPreviousDate(meeting.previous_meeting_date ?? "");
    setIsAnnual(!!meeting.is_annual);
    setMeetingType(meeting.meeting_type || (meeting.is_annual ? "annual" : ""));
    if (meeting.ai_provider) setProvider(meeting.ai_provider as ProviderInfo["id"]);
    if (meeting.ai_model) setModel(meeting.ai_model);
  }, [meeting]);

  useEffect(() => {
    const selected = providersQ.data?.providers.find((p) => p.id === provider);
    if (!selected?.models.length) return;
    if (!model || !selected.models.includes(model)) setModel(selected.models[0] ?? "");
  }, [providersQ.data?.providers, provider, model]);

  const placeholders =
    templateVariablesQ.data?.variables ?? template?.parsed.globalPlaceholders ?? [];

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
    const sections = sectionsQ.data?.sections ?? [];
    // Primary source of truth: the server-computed required_variables for each
    // selected section (covers explicit per-section mappings too).
    for (const s of sections) {
      for (const token of s.required_variables ?? []) used.add(token);
    }
    // Fallback: also scan the section body AND title for <placeholders> — some
    // placeholders (e.g. Financial Year) only appear in the section heading.
    const bodies = sections.flatMap((s) => [s.template_body_text ?? "", s.title ?? ""]);
    for (const body of bodies) {
      for (const m of body.matchAll(/<([^<>\n]{2,200}?)>/g)) {
        used.add(slugToken(m[1] ?? ""));
      }
    }
    return used;
  }, [sectionsQ.data?.sections]);

  const requiredGenderByBaseToken = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of GENDER_ROLES) {
      if (
        usedTokens.has(role.genderToken) ||
        role.pronounTokens.some((token) => usedTokens.has(token))
      ) {
        map.set(role.baseToken, role.genderToken);
      }
    }
    return map;
  }, [usedTokens]);

  const visiblePlaceholders = useMemo(() => {
    return placeholders.filter((p) => {
      if (isGenderMetadataToken(p.token)) return false;
      if (p.required) return true;
      if (requiredGenderByBaseToken.has(p.token)) return true;
      const aliases = DATE_ALIASES[p.token];
      if (aliases) return aliases.some((a) => usedTokens.has(a));
      return usedTokens.has(p.token);
    });
  }, [placeholders, requiredGenderByBaseToken, usedTokens]);

  const savedValues = variableValuesQ.data?.values ?? {};
  const savedGenders = variableValuesQ.data?.genders ?? {};
  const selectedSections = sectionsQ.data?.sections ?? [];
  const hasIntro = selectedSections.some(
    (s) => s.section_key === "introduction" || s.section_key.endsWith("-introduction"),
  );

  return (
    <div>
      <StepNav meetingId={meetingId} current="setup" />
      <h1 className="text-2xl font-semibold mb-4">{meeting?.label ?? "Loading…"}</h1>

      <SafetyBanner provider={provider as ProviderInfo["id"]} />

      <div className="grid grid-cols-2 gap-4 mt-6">
        <DateField label="Previous meeting date" value={previousDate} onChange={setPreviousDate} />
        <DateField label="This meeting date" value={meetingDate} onChange={setMeetingDate} />
      </div>

      {isRgs ? (
        <label className="mt-4 block rounded-lg border border-slate-200 bg-white p-3">
          <span className="text-sm font-medium text-slate-800">Meeting type</span>
          <select
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value as MeetingType)}
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            required
          >
            <option value="">— select meeting type —</option>
            <option value="annual">Annual meeting</option>
            <option value="emergency">Emergency meeting</option>
            <option value="extraordinary">Extraordinary meeting</option>
          </select>
          <span className="mt-1 block text-sm text-slate-500">
            Changes only the first line of the introduction in the exported minutes.
          </span>
        </label>
      ) : (
        <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isAnnual}
            onChange={(e) => setIsAnnual(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span className="text-sm">
            <span className="font-medium text-slate-800">
              Annual meeting (adoption of accounts)
            </span>
            <span className="block text-slate-500">
              When on, the introduction uses the annual-meeting wording for the selected
              organization.
            </span>
          </span>
        </label>
      )}

      <div className="mt-8 mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Template variables</h2>
        <button
          type="button"
          onClick={() => setVariableManagerOpen(true)}
          className="text-sm border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50"
        >
          Manage variables
        </button>
      </div>
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
          const genderToken = requiredGenderByBaseToken.get(p.token);
          return (
            <VariableField
              key={p.token}
              placeholder={p}
              value={vars[p.token] ?? ""}
              savedValues={savedValues[p.token] ?? []}
              savedGenders={savedGenders[p.token] ?? {}}
              gender={genderToken ? (vars[genderToken] ?? "") : undefined}
              genderToken={genderToken}
              onChange={(v, storedGender) => {
                setVars((prev) => {
                  const next = { ...prev, [p.token]: v };
                  if (genderToken && storedGender) next[genderToken] = storedGender;
                  return next;
                });
              }}
              onChangeGender={
                genderToken
                  ? (gender) => setVars((prev) => ({ ...prev, [genderToken]: gender }))
                  : undefined
              }
            />
          );
        })}
      </div>

      <TemplateVariableManager
        open={variableManagerOpen}
        onClose={() => setVariableManagerOpen(false)}
        savedValues={savedValues}
        savedGenders={savedGenders}
      />

      <h2 className="text-lg font-medium mt-8 mb-3">Sections</h2>
      <p className="text-sm text-slate-500 mb-3">
        The meeting starts with every section from{" "}
        <span className="font-medium">{template?.title ?? "the template"}</span>. Remove ones you
        don’t need, or add more from any template before moving to the editor.
      </p>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {selectedSections.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No sections in this meeting yet.</p>
        )}
        {selectedSections.map((s) => (
          <div key={s.section_key} className="flex items-start gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400">
                  {s.section_key === "introduction" || s.section_key.endsWith("-introduction")
                    ? ""
                    : `${hasIntro ? s.ordinal - 1 : s.ordinal}.`}
                </span>
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
        organizationId={meeting?.organization_id ?? template?.organization_id ?? null}
        onPick={async (s: SectionTemplate) => {
          setBusyAddKey(s.key);
          try {
            await createSection.mutateAsync({
              title: s.title,
              template_body_text: s.body_text,
              content_md: s.body_text,
              required_sources: s.required_sources,
              required_variables: s.required_variables,
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
              is_annual: isRgs ? meetingType === "annual" : isAnnual,
              meeting_type: isRgs ? meetingType : undefined,
              ai_provider: provider || undefined,
              ai_model: model || undefined,
            });
            // Persist non-empty text variable values so they can be reused as
            // dropdown options on future meetings.
            const entries = visiblePlaceholders
              .filter((p) => p.kind !== "date")
              .map((p) => {
                const genderToken = requiredGenderByBaseToken.get(p.token);
                return {
                  token: p.token,
                  value: (vars[p.token] ?? "").trim(),
                  gender: genderToken ? vars[genderToken] : undefined,
                };
              })
              .filter((e) => e.value.length > 0);
            if (entries.length) await saveVariableValues.mutateAsync(entries).catch(() => {});
            navigate({ to: "/m/$id/sections", params: { id: String(meetingId) } });
          }}
          disabled={update.isPending || (isRgs && !meetingType)}
          className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Save & continue →
        </button>
      </div>
    </div>
  );
}

function TemplateVariableManager({
  open,
  onClose,
  savedValues,
  savedGenders,
}: {
  open: boolean;
  onClose: () => void;
  savedValues: Record<string, string[]>;
  savedGenders: Record<string, Record<string, string>>;
}) {
  const variablesQ = useTemplateVariables();
  const sectionsQ = useSectionTemplates();
  const createVariable = useCreateTemplateVariable();
  const updateVariable = useUpdateTemplateVariable();
  const deleteVariable = useDeleteTemplateVariable();
  const updateValue = useUpdateVariableValue();
  const deleteValue = useDeleteVariableValue();
  const variables = (variablesQ.data?.variables ?? []).filter(
    (v) => !isGenderMetadataToken(v.token),
  );
  const sections = sectionsQ.data?.sections ?? [];
  const [editing, setEditing] = useState<Placeholder | "new" | null>(null);
  const [raw, setRaw] = useState("");
  const [kind, setKind] = useState<"text" | "date">("text");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [valueEdits, setValueEdits] = useState<Record<string, string>>({});
  const [valueGenderEdits, setValueGenderEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const currentToken = editing && editing !== "new" ? editing.token : "";
  const currentValues = currentToken ? (savedValues[currentToken] ?? []) : [];
  const currentSupportsGender = GENDER_ROLE_BY_BASE_TOKEN.has(currentToken);
  const busy = createVariable.isPending || updateVariable.isPending || deleteVariable.isPending;

  function startEdit(v: Placeholder | "new") {
    setEditing(v);
    setError(null);
    if (v === "new") {
      setRaw("");
      setKind("text");
      setSelected(new Set());
      setValueEdits({});
      setValueGenderEdits({});
    } else {
      setRaw(v.raw);
      setKind(v.kind === "date" ? "date" : "text");
      setSelected(new Set(v.section_keys ?? []));
      setValueEdits(
        Object.fromEntries((savedValues[v.token] ?? []).map((value) => [value, value])),
      );
      setValueGenderEdits(
        Object.fromEntries(
          (savedValues[v.token] ?? []).map((value) => [
            value,
            savedGenders[v.token]?.[value] ?? "",
          ]),
        ),
      );
    }
  }

  function toggleSection(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function deleteCurrentVariable() {
    if (!editing || editing === "new") return;
    if (
      !confirm(
        `Delete template variable "${editing.raw}"? This will also delete its stored values.`,
      )
    )
      return;
    try {
      await deleteVariable.mutateAsync(editing.token);
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveVariable() {
    const section_keys = [...selected];
    if (!raw.trim()) {
      setError("Variable name is required.");
      return;
    }
    if (!section_keys.length) {
      setError("Map this variable to at least one section template.");
      return;
    }
    try {
      if (editing === "new") await createVariable.mutateAsync({ raw, kind, section_keys });
      else if (editing)
        await updateVariable.mutateAsync({ token: editing.token, raw, kind, section_keys });
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-lg font-semibold">Manage template variables</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-[18rem_1fr] min-h-0 flex-1">
          <aside className="border-r border-slate-100 overflow-auto p-3 space-y-1">
            <button
              type="button"
              onClick={() => startEdit("new")}
              className="w-full text-left text-sm rounded-md px-3 py-2 bg-brand-600 text-white hover:bg-brand-700"
            >
              + New variable
            </button>
            {variables.map((v) => (
              <button
                key={v.token}
                type="button"
                onClick={() => startEdit(v)}
                className={`w-full text-left text-sm rounded-md px-3 py-2 ${editing !== "new" && editing?.token === v.token ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50 text-slate-700"}`}
              >
                <span className="block font-medium">{v.raw}</span>
                <span className="block text-[10px] text-slate-400">{v.token}</span>
              </button>
            ))}
          </aside>
          <main className="overflow-auto p-5 space-y-4">
            {!editing && (
              <p className="text-sm text-slate-500">
                Select a variable to edit it, or create a new one.
              </p>
            )}
            {editing && (
              <>
                <div className="grid grid-cols-[1fr_10rem] gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">Variable name</span>
                    <input
                      value={raw}
                      onChange={(e) => setRaw(e.target.value)}
                      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                      placeholder="e.g. Caretaker of Gardens"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">Type</span>
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value as "text" | "date")}
                      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
                    >
                      <option value="text">Text</option>
                      <option value="date">Date</option>
                    </select>
                  </label>
                </div>
                <div>
                  <span className="text-sm font-medium text-slate-700">
                    Mapped section templates
                  </span>
                  <p className="text-xs text-slate-500 mb-2">
                    At least one section template is required.
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-h-56 overflow-auto border border-slate-200 rounded-md p-3">
                    {sections.map((s) => (
                      <label
                        key={`${s.template_slug}:${s.key}`}
                        className="flex items-start gap-2 text-sm text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(s.key)}
                          onChange={() => toggleSection(s.key)}
                          className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span>
                          {s.title}
                          <span className="block text-[10px] text-slate-400">
                            {s.template_title}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                {editing !== "new" && currentToken && (
                  <div>
                    <span className="text-sm font-medium text-slate-700">Stored values</span>
                    <div className="mt-2 space-y-2">
                      {currentValues.length === 0 && (
                        <p className="text-xs text-slate-500">No stored values yet.</p>
                      )}
                      {currentValues.map((value) => (
                        <div key={value} className="flex gap-2">
                          <input
                            value={valueEdits[value] ?? value}
                            onChange={(e) =>
                              setValueEdits({ ...valueEdits, [value]: e.target.value })
                            }
                            className="flex-1 border border-slate-300 rounded-md px-3 py-1.5 text-sm"
                          />
                          {currentSupportsGender && (
                            <select
                              value={valueGenderEdits[value] ?? ""}
                              onChange={(e) =>
                                setValueGenderEdits({
                                  ...valueGenderEdits,
                                  [value]: e.target.value,
                                })
                              }
                              className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
                            >
                              <option value="">Gender</option>
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                            </select>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              updateValue.mutate({
                                token: currentToken,
                                old_value: value,
                                value: valueEdits[value] ?? value,
                                gender: currentSupportsGender
                                  ? (valueGenderEdits[value] ?? "")
                                  : undefined,
                              })
                            }
                            className="text-xs border border-slate-300 rounded-md px-2 hover:bg-slate-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteValue.mutate({ token: currentToken, value })}
                            className="text-xs border border-rose-200 text-rose-600 rounded-md px-2 hover:bg-rose-50"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <div className="flex justify-between gap-2 border-t border-slate-100 pt-3">
                  <div>
                    {editing !== "new" && (
                      <button
                        type="button"
                        onClick={deleteCurrentVariable}
                        disabled={busy}
                        className="text-sm border border-rose-200 text-rose-600 rounded-md px-3 py-1.5 hover:bg-rose-50 disabled:opacity-50"
                      >
                        Delete variable
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="text-sm text-slate-600 px-3 py-1.5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveVariable}
                      disabled={busy}
                      className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      Save variable
                    </button>
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
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

function VariableField({
  placeholder,
  value,
  savedValues,
  savedGenders,
  gender,
  genderToken,
  onChange,
  onChangeGender,
}: {
  placeholder: Placeholder;
  value: string;
  savedValues: string[];
  savedGenders: Record<string, string>;
  gender?: string;
  genderToken?: string;
  onChange: (v: string, storedGender?: string) => void;
  onChangeGender?: (v: string) => void;
}) {
  const isDate = placeholder.kind === "date";
  // "adding" mode reveals a free-text input to enter a brand-new value.
  const [adding, setAdding] = useState(false);

  const label = (
    <span className="text-xs text-slate-600">
      {placeholder.raw}
      {placeholder.required && <span className="text-rose-500 ml-0.5">*</span>}
    </span>
  );

  if (isDate) {
    return (
      <label className="block">
        {label}
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
        />
      </label>
    );
  }

  // Free-text mode depends ONLY on whether saved values exist (and the explicit
  // "add new" toggle). It must NOT depend on the current value, otherwise typing
  // the first character would flip the field into a dropdown mid-keystroke.
  const useFreeText = adding || savedValues.length === 0;
  // Options shown in the dropdown: saved values plus the current value if it is
  // not already one of them (so a previously-entered value stays selected).
  const options = [...savedValues];
  if (value && !options.includes(value)) options.unshift(value);

  const genderControl =
    genderToken && onChangeGender ? (
      <select
        value={gender ?? ""}
        onChange={(e) => onChangeGender(e.target.value)}
        className="mt-1 w-24 border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
        title="Gender for pronouns"
      >
        <option value="">Gender</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
    ) : null;

  return (
    <label className="block">
      {label}
      {useFreeText ? (
        <div className="flex gap-1">
          <input
            type="text"
            autoFocus={adding}
            value={value}
            placeholder="Enter a value"
            onChange={(e) => onChange(e.target.value, savedGenders[e.target.value])}
            className="mt-1 flex-1 w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
          />
          {genderControl}
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="mt-1 text-xs text-slate-500 hover:text-slate-800 px-2 border border-slate-200 rounded-md"
              title="Pick from saved values"
            >
              List
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-1">
          <select
            value={value}
            onChange={(e) => {
              if (e.target.value === "__add__") {
                setAdding(true);
                onChange("");
              } else {
                onChange(e.target.value, savedGenders[e.target.value]);
              }
            }}
            className="mt-1 flex-1 w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white"
          >
            <option value="">— select —</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
            <option value="__add__">+ Add new value…</option>
          </select>
          {genderControl}
        </div>
      )}
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
  const enterpriseSelected = selected?.category === "enterprise";

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex gap-2 flex-wrap">
        {providers.map((p) => {
          const isSelected = provider === p.id;
          const isEnterprise = p.category === "enterprise";
          return (
            <button
              key={p.id}
              type="button"
              disabled={!p.configured}
              title={
                p.configured
                  ? isEnterprise
                    ? "Cloud model — data may leave the premises"
                    : undefined
                  : `Set the API key for ${p.id} in the server .env to enable it`
              }
              onClick={() => {
                if (!p.configured) return;
                onChangeProvider(p.id);
                onChangeModel(p.models[0] ?? "");
              }}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                isSelected
                  ? isEnterprise
                    ? "border-yellow-400 bg-yellow-100 text-yellow-900"
                    : "border-brand-600 bg-brand-50 text-brand-700"
                  : p.configured
                    ? "border-slate-300 text-slate-700 hover:bg-slate-50"
                    : "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
              }`}
            >
              {p.id}{" "}
              <span className="text-xs ml-1">({p.configured ? p.category : "needs API key"})</span>
            </button>
          );
        })}
      </div>
      {selected && (
        <label className="block">
          <span className="text-sm text-slate-700">Model</span>
          <select
            value={model}
            onChange={(e) => onChangeModel(e.target.value)}
            className={`mt-1 w-full border rounded-md px-3 py-2 text-sm ${
              enterpriseSelected
                ? "border-yellow-400 bg-yellow-100 text-yellow-900"
                : "border-slate-300"
            }`}
          >
            {selected.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {enterpriseSelected && (
            <span className="mt-1 block text-xs text-yellow-700">
              Cloud model selected — data may leave the premises.
            </span>
          )}
        </label>
      )}
    </div>
  );
}
