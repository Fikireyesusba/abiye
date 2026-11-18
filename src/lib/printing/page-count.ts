import { PDFDocument } from "pdf-lib";
import type { DetectedType } from "@/lib/validation/upload";

export const MAX_PAGES_PER_FILE = 2000;

/**
 * Pages to print for an uploaded file, or null when it cannot be counted
 * reliably (→ the job needs a manual quote before payment).
 *  - PDF: parsed with pdf-lib (encrypted/odd files: best effort, else null)
 *  - JPG/PNG: 1 page
 *  - DOCX: null — page count depends on fonts/layout; staff quote it
 */
export async function countPages(bytes: Uint8Array, type: DetectedType): Promise<number | null> {
  if (type === "image/jpeg" || type === "image/png") return 1;
  if (type !== "application/pdf") return null;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const n = doc.getPageCount();
    return Number.isInteger(n) && n >= 1 && n <= MAX_PAGES_PER_FILE ? n : null;
  } catch {
    return null;
  }
}
