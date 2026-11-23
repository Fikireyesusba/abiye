import "server-only";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { appNameForSurface, surfaceForHost } from "./hosts";

/** iPhone "Add to Home Screen" name for this address (e.g. "Abiye Courier"). */
export async function staffAppMetadata(base: Metadata): Promise<Metadata> {
  const surface = surfaceForHost((await headers()).get("host"));
  return { ...base, appleWebApp: { capable: true, title: appNameForSurface(surface), statusBarStyle: "default" } };
}
