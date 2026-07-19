import { useMemo, useState } from "react";
import { ArrowLeft, FilePlus, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  useCreateOrganizationSectionTemplate,
  useCreateSectionTemplate,
  useDeleteSectionTemplate,
  useResetOrganizationSectionTemplate,
  useSectionTemplates,
  useSharedSectionTemplates,
  useTemplateVariables,
  useUpdateBaseSectionTemplate,
  useUpdateOrganizationSectionTemplate,
  useUpdateSectionTemplate,
  useUpdateSharedSectionTemplate,
  type SectionTemplate,
} from "../lib/api.ts";

function isGenderMetadataToken(token: string): boolean {
  return token.endsWith("-gender") || token.endsWith("-subject-pronoun") || token.endsWith("-object-pronoun") || token.endsWith("-possessive-pronoun");
}

export function SectionPicker({
  open,
  onClose,
  onPick,
  excludeKeys,
  busyKey,
  organizationId,
  manageOnly = false,
  sharedDefaults = false,
}: {
  open: boolean;
  onClose: () => void;
  onPick?: (s: SectionTemplate) => void | Promise<void>;
  excludeKeys?: string[];
  busyKey?: string | null;
  organizationId?: number | null;
  manageOnly?: boolean;
  sharedDefaults?: boolean;
}) {
  const organizationQ = useSectionTemplates(organizationId, !sharedDefaults);
  const sharedQ = useSharedSectionTemplates(sharedDefaults);
  const q = sharedDefaults ? sharedQ : organizationQ;
  const delTemplate = useDeleteSectionTemplate();
  const [search, setSearch] = useState("");
  // null = browse list; "new" = create form; SectionTemplate = edit that custom template.
  const [editing, setEditing] = useState<null | "new" | SectionTemplate>(null);

  const excludeSet = useMemo(() => new Set(excludeKeys ?? []), [excludeKeys]);
  const filtered = useMemo(() => {
    const all = q.data?.sections ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((s) =>
      [
        s.title,
        s.template_title,
        s.body_text,
        s.required_sources.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [q.data?.sections, search]);

  if (!open) return null;

  if (editing !== null) {
    return (
      <SectionTemplateEditor
        existing={editing === "new" ? null : editing}
        onCancel={() => setEditing(null)}
        onClose={onClose}
        organizationId={organizationId}
        sharedDefaults={sharedDefaults}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-lg font-semibold">{manageOnly ? "Section templates" : "Add section from catalog"}</h2>
          <div className="flex items-center gap-2">
            {!sharedDefaults && (
              <button
                onClick={() => setEditing("new")}
                className="flex items-center gap-1 text-sm border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-1.5"
              >
                <FilePlus className="size-4" /> New section template
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, template, content, or required source"
              className="w-full border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto px-5 py-3 space-y-2">
          {q.isLoading && <p className="text-sm text-slate-500">Loading templates…</p>}
          {q.error && (
            <p className="text-sm text-rose-600">
              Failed to load section templates: {(q.error as Error).message}
            </p>
          )}
          {!q.isLoading && filtered.length === 0 && (
            <p className="text-sm text-slate-500">No matching sections.</p>
          )}
          {filtered.map((s) => {
            const alreadyAdded = excludeSet.has(s.key);
            const busy = busyKey === s.key;
            return (
              <div
                key={`${s.template_slug}:${s.key}`}
                className="border border-slate-200 rounded-lg p-3 hover:border-brand-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-slate-900">{s.title}</h3>
                      <span className="text-[10px] uppercase tracking-wider rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">
                        {s.template_title}
                      </span>
                    </div>
                    {s.required_sources.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1">
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
                    {s.body_text && (
                      <p className="mt-2 text-xs text-slate-500 whitespace-pre-wrap line-clamp-3">
                        {s.body_text.slice(0, 400)}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    {s.can_edit !== false && (
                      <button
                        onClick={() => setEditing(s)}
                        className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-brand-600 hover:bg-brand-50"
                        title="Edit template"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    {s.custom_id != null && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete saved template "${s.title}"?`)) {
                            delTemplate.mutate(s.custom_id!);
                          }
                        }}
                        className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        title="Delete saved template"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                    {!manageOnly && onPick && (
                      <button
                        onClick={() => onPick(s)}
                        disabled={alreadyAdded || busy}
                        className="flex items-center gap-1 bg-brand-600 hover:bg-brand-700 text-white rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        <Plus className="size-3.5" />
                        {alreadyAdded ? "Added" : busy ? "Adding…" : "Add"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 text-right">
          <button
            onClick={onClose}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionTemplateEditor({
  existing,
  onCancel,
  onClose,
  organizationId,
  sharedDefaults,
}: {
  existing: SectionTemplate | null;
  onCancel: () => void;
  onClose: () => void;
  organizationId?: number | null;
  sharedDefaults?: boolean;
}) {
  const create = useCreateSectionTemplate();
  const createOrganizationTemplate = useCreateOrganizationSectionTemplate();
  const updateTemplate = useUpdateSectionTemplate();
  const updateBaseTemplate = useUpdateBaseSectionTemplate();
  const updateOrganizationTemplate = useUpdateOrganizationSectionTemplate();
  const updateSharedTemplate = useUpdateSharedSectionTemplate();
  const resetOrganizationTemplate = useResetOrganizationSectionTemplate();
  const variablesQ = useTemplateVariables();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body_text ?? "");
  const [sources, setSources] = useState((existing?.required_sources ?? []).join(", "));
  const [selectedVars, setSelectedVars] = useState<Set<string>>(
    new Set(existing?.required_variables ?? []),
  );
  const [newVarName, setNewVarName] = useState("");
  const [newVars, setNewVars] = useState<Array<{ raw: string; kind: "text" | "date" }>>([]);
  const [error, setError] = useState<string | null>(null);

  const isEdit = existing != null;
  const busy = create.isPending || createOrganizationTemplate.isPending || updateTemplate.isPending ||
    updateBaseTemplate.isPending || updateOrganizationTemplate.isPending || updateSharedTemplate.isPending || resetOrganizationTemplate.isPending;
  const catalog = [...(variablesQ.data?.variables ?? []), ...newVars.map((v) => ({ token: slugToken(v.raw), raw: v.raw, kind: v.kind }))]
    .filter((v) => !isGenderMetadataToken(v.token));

  function toggleVar(token: string) {
    setSelectedVars((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }

  function addLocalVariable() {
    const raw = newVarName.trim();
    if (!raw) return;
    const token = slugToken(raw);
    if (!token) return;
    setNewVars((prev) => (prev.some((v) => slugToken(v.raw) === token) ? prev : [...prev, { raw, kind: "text" }]));
    setSelectedVars((prev) => new Set([...prev, token]));
    setNewVarName("");
  }

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required.");
      return;
    }
    const required_sources = sources
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const required_variables = [...selectedVars];
    try {
      if (sharedDefaults && isEdit && existing?.section_template_id != null) {
        await updateSharedTemplate.mutateAsync({
          sectionTemplateId: existing.section_template_id,
          title: trimmed,
          body_text: body,
          required_sources,
          required_variables,
        });
      } else if (isEdit && existing?.custom_id != null) {
        await updateTemplate.mutateAsync({
          customId: existing.custom_id,
          title: trimmed,
          body_text: body,
          required_sources,
          required_variables,
          new_variables: newVars,
        });
      } else if (organizationId && isEdit && existing?.section_template_id != null) {
        await updateOrganizationTemplate.mutateAsync({
          organizationId,
          sectionTemplateId: existing.section_template_id,
          title: trimmed,
          body_text: body,
          required_sources,
          required_variables,
        });
      } else if (organizationId && !isEdit) {
        await createOrganizationTemplate.mutateAsync({
          organizationId,
          title: trimmed,
          body_text: body,
          required_sources,
          required_variables,
        });
      } else if (isEdit && existing) {
        await updateBaseTemplate.mutateAsync({

          sectionKey: existing.key,
          title: trimmed,
          body_text: body,
          required_sources,
          required_variables,
          new_variables: newVars,
        });
      } else {
        await create.mutateAsync({ title: trimmed, body_text: body, required_sources, required_variables, new_variables: newVars });
      }
      onCancel();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100"
              aria-label="Back"
            >
              <ArrowLeft className="size-5" />
            </button>
            <div>
              <h2 className="text-lg font-semibold">
                {isEdit ? "Edit section template" : "New section template"}
              </h2>
              {(organizationId || sharedDefaults) && (
                <p className="text-xs text-slate-500">
                  {sharedDefaults ? "Shared default for all organizations" : existing?.is_overridden ? "Organization override" : existing?.is_shared ? "Using shared default" : "Organization-specific section"}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Approval of Annual Accounts"
              className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Body</span>
            <p className="text-xs text-slate-500 mb-1">
              Use <span className="font-mono">&lt;…&gt;</span> for template variables (e.g.
              <span className="font-mono"> &lt;Trust Name&gt;</span>).
            </p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder="Section wording…"
              className="w-full border border-slate-300 rounded-md p-3 font-mono text-sm disabled:bg-slate-50 disabled:text-slate-500"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Required sources</span>
            <p className="text-xs text-slate-500 mb-1">Comma-separated labels (optional).</p>
            <input
              value={sources}
              onChange={(e) => setSources(e.target.value)}
              placeholder="e.g. Investment Chart, Progress Report"
              className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            />
          </label>
          <div>
            <span className="text-sm font-medium text-slate-700">Required template variables</span>
            <p className="text-xs text-slate-500 mb-2">
              Choose which variables this section needs. Selected variables appear on the meeting
              Setup page whenever this section is included.
            </p>
            <div className="mb-3 flex gap-2">
              <input
                value={newVarName}
                onChange={(e) => setNewVarName(e.target.value)}
                placeholder="New variable for this section"
                className="flex-1 border border-slate-300 rounded-md px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={addLocalVariable}
                className="text-sm border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50"
              >
                Add variable
              </button>
            </div>
            {variablesQ.isLoading && <p className="text-xs text-slate-500">Loading variables…</p>}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {catalog.map((v) => (
                <label key={v.token} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedVars.has(v.token)}
                    onChange={() => toggleVar(v.token)}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>{v.raw}</span>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-between gap-2">
          <div>
            {organizationId && existing?.section_template_id != null && existing.is_overridden && (
              <button
                onClick={async () => {
                  await resetOrganizationTemplate.mutateAsync({ organizationId, sectionTemplateId: existing.section_template_id! });
                  onCancel();
                }}
                disabled={busy}
                className="text-sm text-amber-700 hover:text-amber-900 px-3 py-1.5 disabled:opacity-50"
              >
                Reset to shared default
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1 bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function slugToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
