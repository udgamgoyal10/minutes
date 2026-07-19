import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FileText, Plus, Settings2, X } from "lucide-react";
import { SectionPicker } from "../components/SectionPicker.tsx";
import {
  useCreateMeetingStructure,
  useCreateOrganization,
  useMeetingStructures,
  useOrganizations,
  useSectionTemplates,
  useTemplates,
  useUpdateMeetingStructure,
  type MeetingStructure,
  type SectionTemplate,
  type Template,
} from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";

export function AdminTemplatesPage() {
  const { user } = useAuth();
  const organizationsQ = useOrganizations();
  const templatesQ = useTemplates();
  const createOrganization = useCreateOrganization();
  const createStructure = useCreateMeetingStructure();
  const updateStructure = useUpdateMeetingStructure();
  const organizations = organizationsQ.data?.organizations ?? [];
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const structuresQ = useMeetingStructures(organizationId);
  const sectionsQ = useSectionTemplates(organizationId);
  const structures = structuresQ.data?.structures ?? [];
  const sections = sectionsQ.data?.sections ?? [];
  const [selectedStructureId, setSelectedStructureId] = useState<number | null>(null);
  const selectedStructure = structures.find((structure) => structure.id === selectedStructureId) ?? null;
  const [organizationName, setOrganizationName] = useState("");
  const [newStructureName, setNewStructureName] = useState("");
  const [newStructureLayout, setNewStructureLayout] = useState<number | null>(null);
  const [sectionManagerOpen, setSectionManagerOpen] = useState(false);
  const [sharedSectionManagerOpen, setSharedSectionManagerOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!organizationId && organizations[0]) setOrganizationId(organizations[0].id);
  }, [organizationId, organizations]);

  useEffect(() => {
    if (selectedStructureId && structures.some((structure) => structure.id === selectedStructureId)) return;
    setSelectedStructureId(structures[0]?.id ?? null);
  }, [selectedStructureId, structures]);

  useEffect(() => {
    if (!newStructureLayout && templatesQ.data?.templates[0]) setNewStructureLayout(templatesQ.data.templates[0].id);
  }, [newStructureLayout, templatesQ.data?.templates]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Organizations and meeting templates</h1>
        <p className="mt-1 text-sm text-slate-500">Shared section wording is inherited unless an organization override is saved. Existing meetings remain unchanged.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-72 flex-1">
            <span className="text-sm font-medium text-slate-700">Organization</span>
            <select
              value={organizationId ?? ""}
              onChange={(event) => {
                setOrganizationId(Number(event.target.value) || null);
                setSelectedStructureId(null);
              }}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
            </select>
          </label>
          {user?.role === "super_admin" && (
            <form
              className="flex items-end gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!organizationName.trim()) return;
                try {
                  const result = await createOrganization.mutateAsync({ name: organizationName });
                  setOrganizationName("");
                  setOrganizationId(result.organization.id);
                } catch (cause) {
                  setError((cause as Error).message);
                }
              }}
            >
              <label>
                <span className="text-sm font-medium text-slate-700">New organization</span>
                <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <button className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" disabled={createOrganization.isPending}>Add</button>
            </form>
          )}
          {user?.role === "super_admin" && (
            <button
              type="button"
              onClick={() => setSharedSectionManagerOpen(true)}
              className="flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
            >
              <FileText className="size-4" /> Shared defaults
            </button>
          )}
          <button
            type="button"
            onClick={() => setSectionManagerOpen(true)}
            disabled={!organizationId}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <FileText className="size-4" /> Organization wording
          </button>
        </div>
      </div>

      {organizationId && (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Meeting types</h2>
              <Settings2 className="size-4 text-slate-400" />
            </div>
            <div className="space-y-1">
              {structures.map((structure) => (
                <button
                  key={structure.id}
                  type="button"
                  onClick={() => setSelectedStructureId(structure.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${structure.id === selectedStructureId ? "bg-brand-50 text-brand-800" : "hover:bg-slate-50"}`}
                >
                  <span className="block font-medium">{structure.name}</span>
                  <span className="text-xs text-slate-500">{structure.sections.length} sections{structure.is_default ? " · Default" : ""}{!structure.is_active ? " · Inactive" : ""}</span>
                </button>
              ))}
              {structures.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">No meeting types yet.</p>}
            </div>
            <form
              className="mt-4 space-y-2 border-t border-slate-100 pt-4"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!newStructureName.trim() || !newStructureLayout) return;
                try {
                  const result = await createStructure.mutateAsync({
                    organization_id: organizationId,
                    name: newStructureName,
                    base_template_id: newStructureLayout,
                    section_template_ids: [],
                  });
                  setNewStructureName("");
                  setSelectedStructureId(result.structure.id);
                } catch (cause) {
                  setError((cause as Error).message);
                }
              }}
            >
              <input value={newStructureName} onChange={(event) => setNewStructureName(event.target.value)} placeholder="New meeting type name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <select value={newStructureLayout ?? ""} onChange={(event) => setNewStructureLayout(Number(event.target.value) || null)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                {(templatesQ.data?.templates ?? []).map((template) => <option key={template.id} value={template.id}>{template.title} layout</option>)}
              </select>
              <button disabled={!newStructureName.trim() || !newStructureLayout || createStructure.isPending} className="flex w-full items-center justify-center gap-1 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                <Plus className="size-4" /> Create meeting type
              </button>
            </form>
          </aside>

          <main>
            {selectedStructure ? (
              <StructureEditor
                key={`${selectedStructure.id}:${selectedStructure.sections.map((section) => section.section_template_id).join(",")}`}
                structure={selectedStructure}
                availableSections={sections}
                templates={templatesQ.data?.templates ?? []}
                busy={updateStructure.isPending}
                onSave={async (values) => {
                  try {
                    setError("");
                    await updateStructure.mutateAsync({ id: selectedStructure.id, organizationId, ...values });
                  } catch (cause) {
                    setError((cause as Error).message);
                  }
                }}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Create or select a meeting type.</div>
            )}
          </main>
        </div>
      )}

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <SectionPicker open={sharedSectionManagerOpen} onClose={() => setSharedSectionManagerOpen(false)} manageOnly sharedDefaults />
      <SectionPicker open={sectionManagerOpen} onClose={() => setSectionManagerOpen(false)} organizationId={organizationId} manageOnly />
    </div>
  );
}

function StructureEditor({
  structure,
  availableSections,
  templates,
  busy,
  onSave,
}: {
  structure: MeetingStructure;
  availableSections: SectionTemplate[];
  templates: Template[];
  busy: boolean;
  onSave: (values: { name: string; description: string; base_template_id: number; is_default: boolean; is_active: boolean; section_template_ids: number[] }) => Promise<void>;
}) {
  const [name, setName] = useState(structure.name);
  const [description, setDescription] = useState(structure.description);
  const [baseTemplateId, setBaseTemplateId] = useState(structure.base_template_id);
  const [isDefault, setIsDefault] = useState(structure.is_default);
  const [isActive, setIsActive] = useState(structure.is_active);
  const initialIds = structure.sections.map((section) => section.section_template_id).filter((id): id is number => id != null);
  const [sectionIds, setSectionIds] = useState<number[]>(initialIds);
  const [addSectionId, setAddSectionId] = useState<number | null>(null);
  const byId = useMemo(() => new Map(availableSections.map((section) => [section.section_template_id, section])), [availableSections]);
  const remaining = availableSections.filter((section) => section.section_template_id != null && !sectionIds.includes(section.section_template_id));

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sectionIds.length) return;
    setSectionIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <form
      className="space-y-5 rounded-lg border border-slate-200 bg-white p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave({ name, description, base_template_id: baseTemplateId, is_default: isDefault, is_active: isActive, section_template_ids: sectionIds });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className="text-sm font-medium text-slate-700">Meeting type name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
        </label>
        <label>
          <span className="text-sm font-medium text-slate-700">Document layout</span>
          <select value={baseTemplateId} onChange={(event) => setBaseTemplateId(Number(event.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Description</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div className="flex gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /> Default meeting type</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active</label>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium">Section order</h3>
          <span className="text-xs text-slate-500">Changes apply only to meetings created in the future.</span>
        </div>
        <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {sectionIds.map((id, index) => {
            const section = byId.get(id);
            return (
              <div key={id} className="flex items-center gap-2 px-3 py-2">
                <span className="w-7 text-xs text-slate-400">{index + 1}.</span>
                <span className="flex-1 text-sm">{section?.title ?? `Section ${id}`}</span>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="size-4" /></button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === sectionIds.length - 1} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="size-4" /></button>
                <button type="button" onClick={() => setSectionIds((current) => current.filter((value) => value !== id))} className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><X className="size-4" /></button>
              </div>
            );
          })}
          {sectionIds.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">No sections selected.</p>}
        </div>
        <div className="mt-2 flex gap-2">
          <select value={addSectionId ?? ""} onChange={(event) => setAddSectionId(Number(event.target.value) || null)} className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">— add section —</option>
            {remaining.map((section) => <option key={section.section_template_id} value={section.section_template_id!}>{section.title}</option>)}
          </select>
          <button type="button" disabled={!addSectionId} onClick={() => { if (addSectionId) setSectionIds((current) => [...current, addSectionId]); setAddSectionId(null); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Add</button>
        </div>
      </div>
      <div className="flex justify-end">
        <button disabled={busy || !name.trim()} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save meeting type"}</button>
      </div>
    </form>
  );
}
