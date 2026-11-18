import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Constant-time comparison. */
export function isAuthorizedCron(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${getServerEnv().CRON_SECRET}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
