import { useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { useDeleteSectionTemplate, useSectionTemplates, type SectionTemplate } from "../lib/api.ts";

export function SectionPicker({
  open,
  onClose,
  onPick,
  excludeKeys,
  busyKey,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (s: SectionTemplate) => void | Promise<void>;
  excludeKeys?: string[];
  busyKey?: string | null;
}) {
  const q = useSectionTemplates();
  const delTemplate = useDeleteSectionTemplate();
  const [search, setSearch] = useState("");

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

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-lg font-semibold">Add section from catalog</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
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
                    <button
                      onClick={() => onPick(s)}
                      disabled={alreadyAdded || busy}
                      className="flex items-center gap-1 bg-brand-600 hover:bg-brand-700 text-white rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                      <Plus className="size-3.5" />
                      {alreadyAdded ? "Added" : busy ? "Adding…" : "Add"}
                    </button>
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
