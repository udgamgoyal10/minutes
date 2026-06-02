import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, Trash2, Upload, FileText } from "lucide-react";
import {
  useSections,
  useSources,
  useUploadSources,
  useDeleteSource,
} from "../lib/api.ts";
import { StepNav } from "../components/StepNav.tsx";

export function SourcesPage() {
  const { id } = useParams({ strict: false });
  const meetingId = Number(id);
  const navigate = useNavigate();
  const sourcesQ = useSources(meetingId);
  const sectionsQ = useSections(meetingId);
  const upload = useUploadSources(meetingId);
  const del = useDeleteSource(meetingId);

  const [pasted, setPasted] = useState("");
  const [label, setLabel] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(true);

  const recommendedSources = useMemo(
    () => [...new Set((sectionsQ.data?.sections ?? []).flatMap((s) => s.required_sources))],
    [sectionsQ.data?.sections],
  );

  return (
    <div>
      <StepNav meetingId={meetingId} current="sources" />
      <h1 className="text-2xl font-semibold mb-4">Sources</h1>

      {showDisclaimer && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-4 mb-6 flex gap-3">
          <AlertTriangle className="size-5 mt-0.5 shrink-0" />
          <div className="text-sm flex-1">
            <p className="font-medium mb-1">Strip monetary values where possible</p>
            <p>
              Before importing Tally exports, screenshots, or other financial sources, redact or remove
              rupee amounts. This lets you safely use enterprise AI providers (Claude, Gemini, OpenAI)
              without sending sensitive financial figures off-prem. If a file must contain amounts,
              switch the provider to <strong>Local (Ollama)</strong> for that section.
            </p>
          </div>
          <button
            onClick={() => setShowDisclaimer(false)}
            className="text-xs text-amber-700 hover:underline self-start"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
        <h2 className="font-medium mb-2">Recommended sources based on selected sections</h2>
        {recommendedSources.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {recommendedSources.map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setLabel(source)}
                className="text-left text-xs bg-slate-50 hover:bg-brand-50 border border-slate-200 hover:border-brand-200 rounded px-3 py-2 text-slate-700"
              >
                {source}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No specific source recommendation was detected from the current sections.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="font-medium mb-2 flex items-center gap-2">
            <Upload className="size-4" /> Upload files
          </h2>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional, e.g. 'Tally FD export')"
            className="mb-2 w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".docx,.xlsx,.csv,.pdf,.txt,.png,.jpg,.jpeg,.webp"
            className="block w-full text-sm"
          />
          <button
            onClick={async () => {
              const files = fileRef.current?.files;
              if (!files || files.length === 0) return;
              await upload.mutateAsync({ files, label });
              if (fileRef.current) fileRef.current.value = "";
              setLabel("");
            }}
            disabled={upload.isPending}
            className="mt-3 w-full bg-brand-600 hover:bg-brand-700 text-white rounded-md py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="font-medium mb-2 flex items-center gap-2">
            <FileText className="size-4" /> Paste text / table
          </h2>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder="Paste a block of text, a table, a resolution, etc."
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
          />
          <button
            onClick={async () => {
              if (!pasted.trim()) return;
              await upload.mutateAsync({ text: pasted, label });
              setPasted("");
              setLabel("");
            }}
            disabled={upload.isPending || !pasted.trim()}
            className="mt-2 w-full bg-brand-600 hover:bg-brand-700 text-white rounded-md py-1.5 text-sm font-medium disabled:opacity-50"
          >
            Add as source
          </button>
        </div>
      </div>

      <h2 className="text-lg font-medium mt-8 mb-3">Uploaded sources</h2>
      <ul className="space-y-2">
        {sourcesQ.data?.sources.length === 0 && (
          <li className="text-sm text-slate-500">No sources yet.</li>
        )}
        {sourcesQ.data?.sources.map((s) => (
          <li key={s.id} className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  [{s.kind}] {s.original_name ?? s.label ?? "pasted text"}
                </p>
                <p className="text-xs text-slate-500 truncate">{s.label}</p>
              </div>
              <button
                onClick={() => del.mutate(s.id)}
                className="text-slate-400 hover:text-rose-600"
                title="Delete"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            {s.extracted_text && (
              <details className="mt-2">
                <summary className="text-xs text-slate-500 cursor-pointer">
                  preview ({s.extracted_text.length} chars)
                </summary>
                <pre className="mt-2 text-xs bg-slate-50 p-2 rounded max-h-48 overflow-auto whitespace-pre-wrap">
                  {s.extracted_text.slice(0, 4000)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-8 flex justify-end gap-2">
        <button
          onClick={() => navigate({ to: "/m/$id/setup", params: { id: String(meetingId) } })}
          className="border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md px-4 py-2 text-sm font-medium"
        >
          Back to setup
        </button>
        <button
          onClick={() => navigate({ to: "/m/$id/sections", params: { id: String(meetingId) } })}
          className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Continue to sections →
        </button>
      </div>
    </div>
  );
}
