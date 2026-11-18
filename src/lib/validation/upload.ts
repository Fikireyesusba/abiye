/**
 * File upload validation by CONTENT (magic bytes), not by the browser-supplied
 * MIME type or file name. Stored file names are always server-generated.
 */
export type DetectedType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const EXT: Record<DetectedType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

export function detectFileType(bytes: Uint8Array, originalName = ""): DetectedType | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  // DOCX is a ZIP container; accept only with a .docx name (contents are re-checked when page counting).
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(originalName)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

export const RECEIPT_TYPES: readonly DetectedType[] = ["image/jpeg", "image/png", "application/pdf"];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const PRINT_TYPES: readonly DetectedType[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
];
export const PRODUCT_IMAGE_TYPES: readonly DetectedType[] = ["image/jpeg", "image/png", "image/webp"];

export type UploadCheck =
  | { ok: true; type: DetectedType; extension: string }
  | { ok: false; reason: "empty" | "too_large" | "unsupported_type" };

export function validateUpload(
  bytes: Uint8Array,
  opts: { allowed: readonly DetectedType[]; maxBytes: number; originalName?: string },
): UploadCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > opts.maxBytes) return { ok: false, reason: "too_large" };
  const type = detectFileType(bytes, opts.originalName);
  if (!type || !opts.allowed.includes(type)) return { ok: false, reason: "unsupported_type" };
  return { ok: true, type, extension: EXT[type] };
}

/** Server-generated storage key: <prefix>/<uuid>.<ext>. Never derived from user input. */
export function buildStoragePath(prefix: string, extension: string): string {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(prefix)) throw new Error("Invalid storage prefix");
  return `${prefix}/${crypto.randomUUID()}.${extension}`;
}

/** Display-safe version of a user-provided file name (for admin UI only). */
export function sanitizeDisplayName(name: string): string {
  return name.replace(/[\u0000-\u001F\u007F<>:"/\\|?*]/g, "_").slice(0, 120) || "file";
}
