import type { ParsedTemplate } from "./template-parser.ts";

export const MEETING_TEMPLATE_TITLES: Record<string, string> = {
  "meeting-1": "First Meeting",
  "meeting-2": "Approval of Accounts Meeting",
  "meeting-3": "Adoption of Accounts Meeting",
  "flexible-meeting": "Flexible Meeting",
};

const FLEXIBLE_SECTION_KEYS = [
  "introduction",
  "investment-chart",
  "progress-report-on-construction-projects",
  "discussions-as-to-the-functioning-of-jagadguru-kripalu-chikitsalaya",
  "review-of-significant-activities",
  "vote-of-thanks",
];

export function buildFlexibleMeetingTemplate(base: ParsedTemplate): ParsedTemplate {
  const byKey = new Map(base.sections.map((section) => [section.key, section]));
  const sections = FLEXIBLE_SECTION_KEYS.map((key, index) => {
    const section = byKey.get(key);
    if (!section) throw new Error(`Flexible Meeting section missing from base template: ${key}`);
    return { ...section, ordinal: index + 1 };
  });
  return {
    ...base,
    title: MEETING_TEMPLATE_TITLES["flexible-meeting"]!,
    sections,
  };
}
