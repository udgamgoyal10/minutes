export const SOURCE_CATALOG = [
  "Tally JKP: Daan Patra Ledger Voucher Export or free form text",
  "Details on Distributions (e.g., free form text, screenshots of text from magazine)",
  "Tally JKP Investment Group Vouchers (Sanitized) or free form text",
  "Capital Work in Progress Group Vouchers > 1L or free form text",
  "Tally JKC Day Book Vouchers > 1L (Sanitized)",
  "New Departments Created",
  "Tally JKC Donations in Kind Voucher Export",
  "Medical Camp Text or Sheet",
  "Tally JKP Expenses > 1L and Tally JKC Expenses > 1L not included in above",
  "Tally JKP Livestock Expenses Voucher Export",
  "Tally JKP Agricultural Expenses Voucher Export",
  "Tally JKP Garden Expenses Voucher Export",
  "Reasons for Purchasing New Land",
] as const;

const SECTION_SOURCE_MAP: Record<string, string[]> = {
  "opening-of-daan-peti": [SOURCE_CATALOG[0]],
  "free-distribution-program-for-underprivileged-school-children-and-poor-people": [SOURCE_CATALOG[1]],
  "investment-chart": [SOURCE_CATALOG[2]],
  "progress-report-on-construction-projects": [SOURCE_CATALOG[3]],
  "maintenance-of-livestock": [SOURCE_CATALOG[9]],
  "maintenance-of-agricultural-fields": [SOURCE_CATALOG[10]],
  "maintenance-of-the-agricultural-fields": [SOURCE_CATALOG[10]],
  "maintenance-of-gardens": [SOURCE_CATALOG[11]],
  "maintenance-of-gardens-amra-vatika-bhakti-kunj-and-all-the-other-gardens": [SOURCE_CATALOG[11]],
  "discussions-as-to-the-functioning-of-jagadguru-kripalu-chikitsalaya": [
    SOURCE_CATALOG[4],
    SOURCE_CATALOG[5],
    SOURCE_CATALOG[6],
    SOURCE_CATALOG[7],
  ],
  "review-of-significant-activities": [SOURCE_CATALOG[8]],
  "purchase-and-sale-of-land-standing-instruction": [SOURCE_CATALOG[12]],
  "purchase-and-sale-of-land": [SOURCE_CATALOG[12]],
};

export function inferRequiredSources(title: string, bodyText = ""): string[] {
  const key = normalizeTitle(title);
  if (SECTION_SOURCE_MAP[key]) return SECTION_SOURCE_MAP[key];
  if (key === "opening-of-daan-peti-standing-instructions") return [];
  const bodyKey = normalizeTitle(bodyText.split(/\r?\n/).find(Boolean) ?? "");
  return SECTION_SOURCE_MAP[bodyKey] ?? [];
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
