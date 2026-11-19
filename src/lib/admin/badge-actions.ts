"use server";
import { getAdminContext } from "@/lib/auth/guards";
import { getAdminBadges, type AdminBadges } from "./badges";

/** Polled by the admin menu so the red counts stay current without reloading. */
export async function refreshAdminBadges(): Promise<AdminBadges | null> {
  const ctx = await getAdminContext();
  return ctx ? getAdminBadges(ctx) : null;
}
