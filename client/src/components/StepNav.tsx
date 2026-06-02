import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

export type StepKey = "setup" | "section" | "export";

const STEPS: Array<{ key: StepKey; label: string; pathSuffix: (id: number) => string }> = [
  { key: "setup", label: "Setup", pathSuffix: (id) => `/m/${id}/setup` },
  { key: "section", label: "Sections", pathSuffix: (id) => `/m/${id}/sections` },
  { key: "export", label: "Export", pathSuffix: (id) => `/m/${id}/export` },
];

export function StepNav({
  meetingId,
  current,
}: {
  meetingId: number;
  current: StepKey;
}) {
  return (
    <ol className="flex items-center gap-3 text-sm mb-8">
      {STEPS.map((s, i) => {
        const isCurrent = s.key === current;
        const done = STEPS.findIndex((x) => x.key === current) > i;
        const href = s.pathSuffix(meetingId);
        return (
          <li key={s.key} className="flex items-center gap-2">
            <Link
              to={href}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${
                isCurrent
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : done
                    ? "border-slate-300 text-slate-700"
                    : "border-slate-200 text-slate-500"
              }`}
            >
              <span
                className={`size-5 rounded-full flex items-center justify-center text-xs ${
                  isCurrent
                    ? "bg-brand-600 text-white"
                    : done
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-200"
                }`}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              {s.label}
            </Link>
            {i < STEPS.length - 1 && <span className="text-slate-300">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
