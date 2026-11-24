import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getSiteSettings } from "@/lib/catalog/settings";
import { appNameForSurface, homePathForSurface, surfaceForHost } from "@/lib/security/hosts";

/** Web app manifest: makes the shop installable on Android (and gives iPhone its name/colours). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const s = await getSiteSettings();
  const name = s.business.name.en || "Abiye";
  // Staff / Super Admin / courier addresses install their own app (own name and start page).
  const surface = surfaceForHost((await headers()).get("host"));
  if (surface && surface !== "customer") {
    const appName = appNameForSurface(surface, name);
    const start = homePathForSurface(surface);
    // Scope = the whole address, so signing in (/admin/login) stays inside the installed app.
    return {
      id: start, name: appName, short_name: appName.slice(0, 12), start_url: start, scope: "/",
      display: "standalone", orientation: "portrait", background_color: "#faf9f6", theme_color: "#14523f", lang: "en",
      icons: [
        { src: "/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/app-icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };
  }
  return {
    id: "/",
    name,
    short_name: name.slice(0, 12),
    description: s.business.tagline.en || "Cosmetics, electronics and printing services in Ethiopia.",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf9f6",
    theme_color: "#14523f",
    lang: "en",
    categories: ["shopping"],
    // Drawn from the business's own app icon / logo (Admin → Settings), see app/app-icon/[variant].
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Shop", url: "/shop", icons: [{ src: "/app-icon/192", sizes: "192x192" }] },
      { name: "Printing", url: "/printing", icons: [{ src: "/app-icon/192", sizes: "192x192" }] },
      { name: "My orders", url: "/account", icons: [{ src: "/app-icon/192", sizes: "192x192" }] },
    ],
  };
}
