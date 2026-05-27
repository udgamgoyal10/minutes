import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";

export async function extractSpreadsheet(path: string, kind: "xlsx" | "csv"): Promise<string> {
  const buf = await readFile(path);
  const wb = XLSX.read(buf, { type: "buffer" });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    out.push(kind === "xlsx" ? `# Sheet: ${name}\n${csv}` : csv);
  }
  return out.join("\n\n").trim();
}
