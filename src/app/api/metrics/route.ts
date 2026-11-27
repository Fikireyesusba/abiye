import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { toPrometheus } from "@/lib/monitoring/prometheus";
import { clientIpKey, rateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabasePublic } from "@/lib/supabase/public";

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

const prom = (body: string) => new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } });
const unauthorized = () => new NextResponse("Unauthorized", { status: 401, headers: { ...headers, "WWW-Authenticate": 'Basic realm="metrics"' } });

/**
 * Private metrics link for Grafana Cloud (Prometheus format). Totals only (no customer data).
 * Token: created by the Super Admin in Admin → Notifications → Telegram groups & alerts → Grafana (only its fingerprint
 * is stored; checked in the database), or the METRICS_TOKEN variable in Vercel. Requests are limited per address.
 */
export async function GET(request: Request) {
  const token = getServerEnv().METRICS_TOKEN;
  if (!token) {
    // Token made in the admin: checked by the database (no secret key needed), after the per-address limit.
    if (!(await rateLimit(`metrics-ip:${await clientIpKey()}`, 180, 3600))) return new NextResponse("Too many requests", { status: 429, headers });
    const given = givenToken(request.headers.get("authorization") ?? "");
    if (given.length < 32 || given.length > 200) return unauthorized();
    const { data, error } = await getSupabasePublic().rpc("metrics_snapshot_for", { p_token: given });
    if (error) return error.message === "forbidden" ? unauthorized() : prom("# TYPE abiye_up gauge\nabiye_up 0\n");
    return prom(toPrometheus(data as Record<string, unknown>));
  }
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
