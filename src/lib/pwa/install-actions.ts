"use server";
import { z } from "zod";
import { getSignedInUserId } from "@/lib/account/session";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const input = z.object({ deviceId: z.guid(), platform: z.enum(["android", "ios", "windows", "mac", "linux", "other"]) });

/**
 * The installed app (home-screen shortcut) was opened on this device. Counted per device;
 * linked to the signed-in account, if any. Validated and rate-limited before the secret-key client is used.
 */
export async function recordAppOpen(deviceId: unknown, platform: unknown): Promise<void> {
  const parsed = input.safeParse({ deviceId, platform });
  if (!parsed.success) return;
  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`app-open:ip:${ip}`, 30, 3600], [`app-open:dev:${parsed.data.deviceId}`, 6, 3600]]))) return;
  const userId = await getSignedInUserId();
  const { error } = await getSupabaseAdmin().rpc("record_app_install", {
    p_device_id: parsed.data.deviceId, p_platform: parsed.data.platform, p_user_id: userId ?? undefined,
  });
  if (error) console.error("[pwa] install record failed:", error.code);
}
