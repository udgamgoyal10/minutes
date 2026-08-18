import { useParams } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { usePreview, downloadExport } from "../lib/api.ts";
import { StepNav } from "../components/StepNav.tsx";

export function ExportPage() {
  const { id } = useParams({ strict: false });
  const meetingId = Number(id);
  const previewQ = usePreview(meetingId);

  const sections = previewQ.data?.sections ?? [];
  const hasIntro = sections.some(
    (s) => s.section_key === "introduction" || s.section_key.endsWith("-introduction"),
  );
  return (
    <div>
      <StepNav meetingId={meetingId} current="export" />
      <h1 className="text-2xl font-semibold mb-4">Export</h1>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => downloadExport(meetingId, "docx")}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-2 text-sm font-medium"
        >
          <Download className="size-4" /> Download .docx
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-3">{previewQ.data?.label ?? "Loading…"}</h2>
        {sections.map((s) => (
          <section key={s.section_key} className="mb-6">
            <h3 className="font-semibold text-slate-900 mb-1">
              {s.section_key === "introduction" || s.section_key.endsWith("-introduction")
                ? ""
                : `${hasIntro ? s.ordinal - 1 : s.ordinal}. `}
              {s.title}
              <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500">
                {s.status}
              </span>
            </h3>
            <pre className="text-sm whitespace-pre-wrap font-sans text-slate-700">
              {s.content_md || <em className="text-slate-400">empty</em>}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}
