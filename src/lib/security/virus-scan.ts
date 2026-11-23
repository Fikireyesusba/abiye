import "server-only";
import { getServerEnv } from "@/lib/env";

/**
 * Cloudmersive advanced virus scan for files customers upload (payment / top-up receipts, printing documents).
 * Fails CLOSED: a file is accepted only when Cloudmersive says it is clean. Not configured, unreachable,
 * over the monthly limit or an unexpected answer → "unavailable", and the caller refuses the upload.
 *
 * Besides viruses / malware, the scan refuses: executables, scripts, macros, embedded HTML, XML external
 * entities, insecure deserialization, invalid (disguised / broken) files, password-protected files, and any
 * file whose real format is not one of the expected types.
 */
export type ScanResult =
  | { ok: true }
  | { ok: false; reason: "infected"; findings: string[] }
  | { ok: false; reason: "unavailable"; detail: string };

const DEFAULT_BASE = "https://api.cloudmersive.com";
const TIMEOUT_MS = 30_000;

/** Cloudmersive "advanced scan" answer (only the fields we read). */
type AdvancedScan = {
  CleanResult?: boolean;
  FoundViruses?: { FileName?: string; VirusName?: string }[] | null;
  ContainsExecutable?: boolean;
  ContainsInvalidFile?: boolean;
  ContainsScript?: boolean;
  ContainsPasswordProtectedFile?: boolean;
  ContainsRestrictedFileFormat?: boolean;
  ContainsMacros?: boolean;
  ContainsXmlExternalEntities?: boolean;
  ContainsInsecureDeserialization?: boolean;
  ContainsHtml?: boolean;
  VerifiedFileFormat?: string | null;
};

const FLAGS: [keyof AdvancedScan, string][] = [
  ["ContainsExecutable", "contains a program (executable)"],
  ["ContainsScript", "contains a script"],
  ["ContainsMacros", "contains macros"],
  ["ContainsHtml", "contains HTML"],
  ["ContainsXmlExternalEntities", "contains XML external entities"],
  ["ContainsInsecureDeserialization", "contains insecure serialized data"],
  ["ContainsPasswordProtectedFile", "is password-protected"],
  ["ContainsInvalidFile", "is not a valid file (broken or disguised)"],
  ["ContainsRestrictedFileFormat", "is not an allowed file format"],
];

export function scanConfigured(): boolean {
  return !!getServerEnv().CLOUDMERSIVE_API_KEY;
}

/** What the scan found, in plain words (for staff alerts; never shown to customers). */
export function describeScan(r: AdvancedScan): string[] {
  const out = (r.FoundViruses ?? []).map((v) => `virus: ${String(v.VirusName ?? "unknown").slice(0, 80)}`);
  for (const [k, label] of FLAGS) if (r[k] === true) out.push(label);
  return out.length ? out : ["not clean (no details given)"];
}

/**
 * @param extensions allowed real formats, e.g. [".pdf", ".jpg", ".png"]
 */
export async function scanFile(bytes: Uint8Array, fileName: string, extensions: readonly string[]): Promise<ScanResult> {
  const env = getServerEnv();
  if (!env.CLOUDMERSIVE_API_KEY) return { ok: false, reason: "unavailable", detail: "virus scanning is not set up (CLOUDMERSIVE_API_KEY)" };
  const form = new FormData();
  form.append("inputFile", new Blob([new Uint8Array(bytes)]), fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "upload");
  let res: Response;
  try {
    res = await fetch(`${env.CLOUDMERSIVE_API_BASE ?? DEFAULT_BASE}/virus/scan/file/advanced`, {
      method: "POST",
      headers: {
        Apikey: env.CLOUDMERSIVE_API_KEY,
        allowExecutables: "false",
        allowInvalidFiles: "false",
        allowScripts: "false",
        allowPasswordProtectedFiles: "false",
        allowMacros: "false",
        allowXmlExternalEntities: "false",
        allowInsecureDeserialization: "false",
        allowHtml: "false",
        restrictFileTypes: extensions.join(","),
      },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, reason: "unavailable", detail: `scanner not reachable: ${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message}`.slice(0, 200) };
  }
  if (!res.ok) {
    // 401/403: wrong key; 429 / quota: monthly limit used up; 5xx: outage. The body is not logged (may echo input).
    return { ok: false, reason: "unavailable", detail: `scanner answered HTTP ${res.status}` };
  }
  let body: AdvancedScan;
  try {
    body = (await res.json()) as AdvancedScan;
  } catch {
    return { ok: false, reason: "unavailable", detail: "scanner answer was not JSON" };
  }
  if (body.CleanResult === true) return { ok: true };
  if (body.CleanResult === false) return { ok: false, reason: "infected", findings: describeScan(body) };
  return { ok: false, reason: "unavailable", detail: "scanner answer had no result" };
}
