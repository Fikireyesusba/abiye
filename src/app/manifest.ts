import type { MetadataRoute } from "next";
import { getSiteSettings } from "@/lib/catalog/settings";

/** Refreshed hourly so a renamed shop (Admin → Settings) reaches the app. */
export const revalidate = 3600;

/** Web app manifest: makes the shop installable on Android (and gives iPhone its name/colours). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const s = await getSiteSettings();
  const name = s.business.name.en || "Abiye";
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
