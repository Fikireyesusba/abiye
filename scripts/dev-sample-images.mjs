#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY. Generates clearly-labelled "SAMPLE" product images for the
 * seeded sample products, uploads them to the local `product-images` bucket and
 * links them in product_images. Refuses to run against a non-local Supabase.
 *
 *   node --env-file=.env.local scripts/dev-sample-images.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

// Playwright is a dev tool, not an app dependency: resolve it from NODE_PATH / global installs.
const { chromium } = createRequire(import.meta.url)("playwright");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (use --env-file=.env.local)");
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Refusing to upload sample images to a non-local Supabase project.");
}

const db = createClient(url, key, { auth: { persistSession: false } });
const HUES = { cosmetics: 5, electronics: 255, printing: 55 };

const { data: products, error } = await db
  .from("products")
  .select("id, slug, name_en, category:categories(department)")
  .like("sku", "SMP-%");
if (error) throw error;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });

for (const p of products) {
  const hue = HUES[p.category.department] ?? 165;
  const variants = p.slug === "sample-oud-perfume-100ml" ? 3 : 1; // one product gets a gallery
  await db.from("product_images").delete().eq("product_id", p.id);
  for (let v = 0; v < variants; v++) {
    const label = p.name_en.replace("[SAMPLE] ", "");
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div style="width:800px;height:800px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;
        font-family:system-ui,sans-serif;background:radial-gradient(circle at ${30 + v * 25}% 30%, oklch(0.93 0.05 ${hue}), oklch(0.78 0.11 ${hue}));">
        <div style="width:300px;height:300px;border-radius:${v === 1 ? "50%" : "48px"};background:oklch(0.55 0.14 ${hue} / .9);
          box-shadow:0 40px 80px -20px oklch(0.3 0.1 ${hue} / .5)"></div>
        <div style="font-size:40px;font-weight:600;color:oklch(0.25 0.06 ${hue});text-align:center;max-width:640px">${label.replace(/[<>&]/g, "")}</div>
        <div style="position:absolute;top:28px;right:28px;padding:8px 16px;border-radius:999px;background:#fff;font:700 22px system-ui;letter-spacing:.1em">SAMPLE</div>
      </div></body></html>`);
    const png = await page.screenshot({ type: "png" });
    const path = `samples/${p.slug}-${v + 1}.png`;
    const up = await db.storage.from("product-images").upload(path, png, { contentType: "image/png", upsert: true });
    if (up.error) throw up.error;
    const ins = await db.from("product_images").insert({
      product_id: p.id, storage_path: path, alt_en: `${label} (sample image)`, alt_am: `${label} (ናሙና ምስል)`,
      sort_order: v, is_primary: v === 0,
    });
    if (ins.error) throw ins.error;
  }
  console.log(`✓ ${p.slug}`);
}
await browser.close();
