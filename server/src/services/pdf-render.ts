import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Convert a .docx (as bytes) to a PDF using LibreOffice headless.
export async function renderPdfFromDocx(docxBytes: Uint8Array): Promise<Uint8Array> {
  const workDir = join(tmpdir(), `minutes-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(workDir, { recursive: true });
  const docxPath = join(workDir, "minutes.docx");
  await writeFile(docxPath, docxBytes);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("libreoffice", [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        docxPath,
      ]);
      proc.on("error", reject);
      proc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`libreoffice exit ${code}`)),
      );
    });
    return await readFile(join(workDir, "minutes.pdf"));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
