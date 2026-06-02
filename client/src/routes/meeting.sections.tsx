import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  useCreateSection,
  useDeleteSection,
  useReorderSections,
  useSections,
  useUpdateSection,
} from "../lib/api.ts";
import { StepNav } from "../components/StepNav.tsx";
import { useState } from "react";

export function SectionsPage() {
  const { id } = useParams({ strict: false });
  const meetingId = Number(id);
  const navigate = useNavigate();
  const sectionsQ = useSections(meetingId);
  const update = useUpdateSection(meetingId);
  const create = useCreateSection(meetingId);
  const del = useDeleteSection(meetingId);
  const reorder = useReorderSections(meetingId);
  const [newTitle, setNewTitle] = useState("");
  const sections = sectionsQ.data?.sections ?? [];

  const move = async (index: number, delta: -1 | 1) => {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    await reorder.mutateAsync(next.map((s) => s.section_key));
  };

  return (
    <div>
      <StepNav meetingId={meetingId} current="section" />
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Sections</h1>
          <p className="text-sm text-slate-500 mt-1">
            Sections are loaded in template/header order by default. Reorder, remove, add, or choose exact-template vs AI-updated wording before uploading sources.
          </p>
        </div>
        <button
          onClick={() => navigate({ to: "/m/$id/sources", params: { id: String(meetingId) } })}
          className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-2 text-sm font-medium"
        >
          Continue to sources →
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {sections.length === 0 && <p className="p-4 text-sm text-slate-500">No sections yet.</p>}
        {sections.map((section, index) => (
          <div key={section.section_key} className="p-4">
            <div className="flex gap-3 items-start">
              <div className="w-8 text-sm text-slate-400 pt-2">{index + 1}.</div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium text-slate-900">{section.title}</h2>
                  <span className="text-[10px] uppercase tracking-wider rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">
                    {section.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-[14rem_1fr] gap-4">
                  <label className="block">
                    <span className="text-xs text-slate-600">Wording mode</span>
                    <select
                      value={section.mode}
                      onChange={(e) =>
                        update.mutate({
                          key: section.section_key,
                          mode: e.target.value as "template" | "ai",
                        })
                      }
                      className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                    >
                      <option value="template">Match template wording</option>
                      <option value="ai">AI update allowed</option>
                    </select>
                  </label>
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Current text</p>
                    <div className="text-xs bg-slate-50 border border-slate-200 rounded px-3 py-2 text-slate-700 max-h-36 overflow-auto whitespace-pre-wrap">
                      {section.preview_md || "No text yet."}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Recommended sources</p>
                    {section.required_sources.length > 0 ? (
                      <ul className="grid grid-cols-2 gap-1">
                        {section.required_sources.map((source) => (
                          <li key={source} className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700">
                            {source}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-400">No specific source detected for this section.</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || reorder.isPending}
                  className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  title="Move up"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  onClick={() => move(index, 1)}
                  disabled={index === sections.length - 1 || reorder.isPending}
                  className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  title="Move down"
                >
                  <ArrowDown className="size-4" />
                </button>
                <Link
                  to="/m/$id/section/$key"
                  params={{ id: String(meetingId), key: section.section_key }}
                  className="px-2 py-1.5 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Edit
                </Link>
                <button
                  onClick={() => del.mutate(section.section_key)}
                  className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                  title="Delete"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const title = newTitle.trim();
          if (!title) return;
          await create.mutateAsync({ title, mode: "ai" });
          setNewTitle("");
        }}
        className="mt-4 bg-white border border-slate-200 rounded-lg p-4 flex gap-2"
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a custom section title"
          className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm"
        />
        <button
          disabled={create.isPending || !newTitle.trim()}
          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Plus className="size-4" /> Add section
        </button>
      </form>
    </div>
  );
}
