import { extractDocx } from "./docx.ts";
import { extractSpreadsheet } from "./spreadsheet.ts";
import { extractPdf } from "./pdf.ts";
import { extractImage } from "./image.ts";

export type SourceKind = "docx" | "xlsx" | "csv" | "pdf" | "image" | "text";

export function kindFromMime(name: string, mime: string): SourceKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx";
  }
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  ) return "xlsx";
  if (mime === "text/csv") return "csv";
  if (mime.startsWith("text/")) return "text";
  return "text";
}

export async function extract(
  kind: SourceKind,
  filePath: string,
  mime: string,
): Promise<string> {
  switch (kind) {
    case "docx":
      return extractDocx(filePath);
    case "xlsx":
    case "csv":
      return extractSpreadsheet(filePath, kind);
    case "pdf":
      return extractPdf(filePath);
    case "image":
      return extractImage(filePath, mime);
    case "text":
      return await Bun.file(filePath).text();
  }
}
