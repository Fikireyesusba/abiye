/**
 * Content-Security-Policy for every page.
 *   scripts: only Next.js' own scripts carrying this request's nonce
 *            ('strict-dynamic' lets them load their chunks); no inline/eval.
 *   styles:  'unsafe-inline' is needed for React style attributes and the
 *            toast library; styles cannot run code.
 *   network: this site + the Supabase project (browser uploads to Storage).
 *   images:  this site (next/image) + Supabase Storage (receipt previews).
 */
export function buildContentSecurityPolicy({ nonce, supabaseUrl, dev }: { nonce: string; supabaseUrl?: string; dev: boolean }): string {
  let supabase = "";
  try {
    if (supabaseUrl) supabase = new URL(supabaseUrl).origin;
  } catch {}
  const https = supabase.startsWith("https://") || !supabase;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(supabase ? [supabase] : [])],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(supabase ? [supabase] : []), ...(dev ? ["ws:", "wss:"] : [])],
    "media-src": ["'self'", "data:", ...(supabase ? [supabase] : [])], // courier ringtone (public app-sounds bucket)
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev && https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
