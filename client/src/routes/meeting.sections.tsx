import { useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useSections } from "../lib/api.ts";

export function SectionsPage() {
  const { id } = useParams({ strict: false });
  const meetingId = Number(id);
  const navigate = useNavigate();
  const sectionsQ = useSections(meetingId);

  useEffect(() => {
    if (!sectionsQ.data) return;
    const first = sectionsQ.data.sections[0];
    if (first) {
      navigate({
        to: "/m/$id/section/$key",
        params: { id: String(meetingId), key: first.section_key },
        replace: true,
      });
    } else {
      navigate({
        to: "/m/$id/setup",
        params: { id: String(meetingId) },
        replace: true,
      });
    }
  }, [sectionsQ.data, meetingId, navigate]);

  return <div className="text-sm text-slate-500">Loading sections…</div>;
}
