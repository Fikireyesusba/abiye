import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { getSiteSettings } from "@/lib/catalog/settings";
import { publicImageUrl } from "@/lib/storage";

/**
 * App / browser-tab icon drawn from the business's own images (Admin → Settings):
 *   1. the uploaded square "App icon", full size; otherwise
 *   2. the logo, centred on white; otherwise
 *   3. the built-in brand icon (public/icons).
 * Variants: 32 (tab), 180 (iPhone), 192, 512, maskable-512 (Android safe zone).
 */
const VARIANTS: Record<string, { size: number; maskable: boolean; fallback: string }> = {
  "32": { size: 32, maskable: false, fallback: "/icons/icon-192.png" },
  "180": { size: 180, maskable: false, fallback: "/icons/apple-touch-icon.png" },
  "192": { size: 192, maskable: false, fallback: "/icons/icon-192.png" },
  "512": { size: 512, maskable: false, fallback: "/icons/icon-512.png" },
  "maskable-512": { size: 512, maskable: true, fallback: "/icons/maskable-512.png" },
};
const CACHE = "public, max-age=3600, stale-while-revalidate=86400";

/** PNG/JPEG only (what the image renderer reads), max 5 MB. */
async function loadImage(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return null;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpg) return null;
    return `data:image/${png ? "png" : "jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: RouteContext<"/app-icon/[variant]">) {
  const v = VARIANTS[(await params).variant];
  if (!v) return new NextResponse("Not found", { status: 404 });
  const s = await getSiteSettings();
  const icon = await loadImage(publicImageUrl("site-assets", s.business.app_icon_path));
  const logo = icon ? null : await loadImage(publicImageUrl("site-assets", s.business.logo_path));
  if (!icon && !logo) {
    const res = NextResponse.redirect(new URL(v.fallback, request.url), 307);
    res.headers.set("Cache-Control", CACHE);
    return res;
  }
  const { size } = v;
  // Android may crop maskable icons to a circle: keep the artwork in the middle ~80%.
  const scale = icon ? (v.maskable ? 0.8 : 1) : v.maskable ? 0.66 : 0.84;
  const inner = Math.round(size * scale);
  const img = await new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- rendered to PNG, never shown as HTML */}
        <img src={(icon ?? logo)!} width={inner} height={inner} style={{ objectFit: icon ? "cover" : "contain" }} />
      </div>
    ),
    { width: size, height: size },
  );
  return new NextResponse(img.body, { headers: { "Content-Type": "image/png", "Cache-Control": CACHE } });
}
