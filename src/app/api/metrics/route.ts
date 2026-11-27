import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { toPrometheus } from "@/lib/monitoring/prometheus";
import { clientIpKey, rateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Token from "Authorization: Bearer <token>" or Basic auth (any user name, the token as password). */
function givenToken(header: string): string {
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    return decoded.slice(decoded.indexOf(":") + 1);
  }
  return "";
}
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * Private metrics link for Grafana Cloud (Prometheus format). Exists only when METRICS_TOKEN is set in Vercel.
 * Totals only (no customer data). Wrong tokens are refused and limited per address.
 */
export async function GET(request: Request) {
  const token = getServerEnv().METRICS_TOKEN;
  if (!token) return new NextResponse("Not found", { status: 404, headers });
  if (!same(givenToken(request.headers.get("authorization") ?? ""), token)) {
    if (!(await rateLimit(`metrics-denied:${await clientIpKey()}`, 30, 3600))) return new NextResponse("Too many requests", { status: 429, headers });
    return new NextResponse("Unauthorized", { status: 401, headers: { ...headers, "WWW-Authenticate": 'Basic realm="metrics"' } });
  }
  if (!(await rateLimit("metrics", 600, 3600))) return new NextResponse("Too many requests", { status: 429, headers });
  // Secret key only after the token and rate-limit checks above; the function returns totals only.
  const { data, error } = await getSupabaseAdmin().rpc("metrics_snapshot");
  if (error || !data) {
    console.error("[metrics] snapshot failed:", error?.message);
    return new NextResponse("# HELP abiye_up 1 when the website could read the database\n# TYPE abiye_up gauge\nabiye_up 0\n",
      { status: 200, headers: { ...headers, "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } });
  }
  return new NextResponse(toPrometheus(data as Record<string, unknown>), {
    status: 200, headers: { ...headers, "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
