/**
 * Generates the installable-app icons (public/icons/*.png) from an SVG.
 * Run: NODE_PATH=$(npm root -g) node scripts/generate-app-icons.cjs
 * To use a different design, edit the SVG below and run again.
 */
const { chromium } = require("playwright");
const path = require("path");

const GREEN = "#14523f";
const GOLD = "#d9a520";
// safe = fraction of the icon the artwork may use (maskable icons are cropped to a circle by Android).
const svg = (safe, rounded) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${GREEN}"/>
  <g transform="translate(256 256) scale(${safe}) translate(-256 -256)">
    <path d="M110 330 C 190 395, 330 395, 410 300" fill="none" stroke="${GOLD}" stroke-width="30" stroke-linecap="round"/>
    <text x="256" y="318" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="300" fill="#ffffff">A</text>
  </g>
</svg>`;

const outputs = [
  { file: "icon-192.png", size: 192, safe: 0.92, rounded: true },
  { file: "icon-512.png", size: 512, safe: 0.92, rounded: true },
  { file: "maskable-512.png", size: 512, safe: 0.72, rounded: false },
  { file: "apple-touch-icon.png", size: 180, safe: 0.86, rounded: false }, // iOS rounds the corners itself
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const o of outputs) {
    await page.setViewportSize({ width: o.size, height: o.size });
    await page.setContent(`<html><body style="margin:0">${svg(o.safe, o.rounded).replace('width="512" height="512"', `width="${o.size}" height="${o.size}"`)}</body></html>`);
    await page.screenshot({ path: path.join(__dirname, "..", "public", "icons", o.file), omitBackground: o.rounded, clip: { x: 0, y: 0, width: o.size, height: o.size } });
  }
  await browser.close();
  console.log("icons written to public/icons/");
})();
