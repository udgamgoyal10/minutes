import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import {
  useDeleteSource,
  useSources,
  useUploadSources,
  type SectionDraft,
} from "../lib/api.ts";

export function SectionSourcePanel({
  meetingId,
  section,
}: {
  meetingId: number;
  section: SectionDraft;
}) {
  const sourcesQ = useSources(meetingId, section.section_key);
  const upload = useUploadSources(meetingId);
  const del = useDeleteSource(meetingId);

  const recommended = section.required_sources;
  const [label, setLabel] = useState(recommended[0] ?? "");
  const [pasted, setPasted] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (recommended.length && !recommended.includes(label)) {
      setLabel(recommended[0] ?? "");
    }
  }, [recommended, label]);

  const uploadedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sourcesQ.data?.sources ?? []) {
      const key = s.label?.trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [sourcesQ.data?.sources]);

  if (recommended.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        No specific source needed for this section.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {recommended.map((source) => (
          <button
            key={source}
            type="button"
            onClick={() => setLabel(source)}
            className={`text-left text-xs border rounded px-3 py-2 ${
              label === source
                ? "bg-brand-50 border-brand-300 text-brand-800"
                : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-brand-50"
            }`}
          >
            <span className="block font-medium">{source}</span>
            <span className="block text-[10px] text-slate-400 mt-1">
              Uploaded: {uploadedCounts.get(source) ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-md p-3 flex flex-col">
          <p className="text-xs font-medium flex items-center gap-1 mb-2">
            <Upload className="size-3.5" /> Upload files for "{label}"
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".docx,.xlsx,.csv,.pdf,.txt,.png,.jpg,.jpeg,.webp"
            onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full text-xs border border-dashed border-slate-300 hover:border-brand-400 hover:bg-brand-50 text-slate-600 rounded-md py-2 px-3 text-left"
          >
            {pendingFiles.length === 0
              ? "Click to choose files (.docx, .xlsx, .pdf, .txt, .png, …)"
              : `${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} ready: ${pendingFiles
                  .map((f) => f.name)
                  .join(", ")}`}
          </button>
          <button
            onClick={async () => {
              if (pendingFiles.length === 0 || !label.trim()) return;
              await upload.mutateAsync({ files: pendingFiles, label });
              setPendingFiles([]);
              if (fileRef.current) fileRef.current.value = "";
            }}
            disabled={upload.isPending || !label.trim() || pendingFiles.length === 0}
            className="mt-2 w-full bg-brand-600 hover:bg-brand-700 text-white rounded-md py-1.5 text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1"
          >
            {upload.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
          {upload.error && (
            <p className="text-xs text-rose-600 mt-1">{(upload.error as Error).message}</p>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-md p-3">
          <p className="text-xs font-medium flex items-center gap-1 mb-2">
            <FileText className="size-3.5" /> Paste text for "{label}"
          </p>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            placeholder="Paste a block of text or a table"
            className="w-full border border-slate-300 rounded-md px-2 py-1 text-xs font-mono"
          />
          <button
            onClick={async () => {
              if (!pasted.trim() || !label.trim()) return;
              await upload.mutateAsync({ text: pasted, label });
              setPasted("");
            }}
            disabled={upload.isPending || !pasted.trim() || !label.trim()}
            className="mt-2 w-full bg-brand-600 hover:bg-brand-700 text-white rounded-md py-1 text-xs font-medium disabled:opacity-50"
          >
            Add text
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-600 mb-1">Uploaded for this section</p>
        {sourcesQ.data?.sources.length === 0 ? (
          <p className="text-xs text-slate-400">No sources uploaded yet.</p>
        ) : (
          <ul className="space-y-1">
            {sourcesQ.data?.sources.map((s) => (
              <li
                key={s.id}
                className="text-xs flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-2 py-1"
              >
                <span className="truncate">
                  [{s.kind}] {s.original_name ?? s.label ?? "pasted text"}
                  <span className="text-slate-400 ml-2">{s.label}</span>
                </span>
                <button
                  onClick={() => del.mutate(s.id)}
                  className="text-slate-400 hover:text-rose-600"
                  title="Delete"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
