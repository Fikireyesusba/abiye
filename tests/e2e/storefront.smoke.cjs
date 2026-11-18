/**
 * Storefront smoke test (browser). Requires: local Supabase (`npx supabase start`
 * + `npm run dev:sample-images`) and the app on BASE_URL (default :3100).
 *   NODE_PATH=$(npm root -g) node tests/e2e/storefront.smoke.cjs
 * Replaced by a proper Playwright suite in Phase 7.
 */
const { chromium } = require('playwright');
const B = process.env.BASE_URL ?? 'http://localhost:3100';
const results = [];
const check = (ok, msg) => { results.push(`${ok ? 'ok  ' : 'FAIL'} - ${msg}`); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('response', r => { if (r.status() === 404) errors.push('404 ' + r.url()); });
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  for (const path of ['/', '/shop', '/cosmetics', '/electronics', '/printing', '/about', '/contact', '/privacy', '/terms', '/cart']) {
    const r = await p.goto(B + path, { waitUntil: 'networkidle' });
    check(r.status() === 200, `${path} → ${r.status()}`);
  }
  check((await p.goto(B + '/products/does-not-exist')).status() === 404, 'unknown product → 404');
  check((await p.goto(B + '/products/sample-draft-phone-case')).status() === 404, 'draft product → 404 (not public)');

  errors.length = 0; // the two 404s above are intentional
  await p.goto(B + '/shop');
  const count = await p.locator('article').count();
  check(count === 10, `/shop lists 10 active products (got ${count})`);
  await p.goto(B + '/cosmetics');
  check(await p.locator('article').count() === 5, '/cosmetics shows only cosmetics (5)');
  await p.goto(B + '/electronics?category=chargers');
  check(await p.locator('article').count() === 1, 'subcategory filter (chargers = 1)');
  await p.goto(B + '/shop?q=charger');
  check(await p.locator('article').count() === 1, 'search "charger" finds 1');
  await p.goto(B + '/shop?q=' + encodeURIComponent('ሽቶ'));
  check(await p.locator('article').count() >= 1, 'Amharic search "ሽቶ" finds perfumes');
  await p.goto(B + '/shop?q=' + encodeURIComponent('a),status.eq.draft,(name_en.ilike.*'));
  check((await p.locator('h1').count()) === 1 && (await p.locator('article').count()) === 0, 'filter-injection attempt returns nothing (no drafts leaked)');
  await p.goto(B + '/shop?sort=price_asc');
  const prices = await p.locator('article h3').allTextContents();
  check(prices[0].includes('Cable'), `price ascending: cheapest first (${prices[0]})`);
  await p.goto(B + '/shop?stock=1');
  check(await p.locator('article').count() === 9, 'in-stock filter hides sold-out hair oil (9)');

  // Sort select auto-submits
  await p.goto(B + '/shop');
  await p.selectOption('select[name=sort]', 'price_desc');
  await p.waitForURL(/sort=price_desc/);
  const first = await p.locator('article h3').first().textContent();
  check(first.includes('Smartphone'), `sort select works (most expensive: ${first})`);

  // Product page + gallery + add to cart
  await p.goto(B + '/products/sample-oud-perfume-100ml', { waitUntil: 'networkidle' });
  check(await p.locator('h1').textContent() === '[SAMPLE] Oud Eau de Parfum 100ml', 'product page title');
  const imgOk = await p.locator('main img').first().evaluate(i => i.complete && i.naturalWidth > 0);
  check(imgOk, 'product image loads through next/image');
  check(await p.locator('button[aria-label^="Image"]').count() === 3, 'gallery has 3 thumbnails');
  await p.click('button[aria-label="Increase quantity"]');
  await p.click('main button:has-text("Add to basket")');
  await p.waitForTimeout(300);
  const badge = await p.locator('header a[href="/cart"]').getAttribute('aria-label');
  check(badge.includes('2'), `cart badge updated (${badge})`);

  await p.goto(B + '/products/sample-usb-c-fast-charger');
  await p.click('main button:has-text("Add to basket")');
  await p.goto(B + '/products/sample-argan-hair-oil');
  check(await p.locator('main button:has-text("Out of stock")').isDisabled(), 'sold-out product cannot be added');

  // Cart totals: 2 × 2850 + 850 = 6550, + Addis 150 = 6700
  await p.goto(B + '/cart', { waitUntil: 'load' });
  await p.waitForSelector('text=Order summary');
  await p.selectOption('select:near(:text("Delivery to"))', { label: 'Addis Ababa — 150 ETB' });
  const total = await p.locator('dl div:has(dt:text-is("Total")) dd').textContent();
  check(total === '6,700 ETB', `cart total with delivery = ${total}`);
  await p.check('input[type=radio] >> nth=1');
  const totalPickup = await p.locator('dl div:has(dt:text-is("Total")) dd').textContent();
  check(totalPickup === '6,550 ETB', `pickup total = ${totalPickup}`);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('text=Order summary');
  check((await p.locator('ul.divide-y > li').count()) === 2, 'cart persists after refresh');
  await p.click('button[aria-label^="Remove"] >> nth=1');
  await p.waitForTimeout(200);
  check((await p.locator('ul.divide-y > li').count()) === 1, 'remove item');

  require('child_process').execSync(`psql -q "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "update products set price_etb = 3300 where slug = 'sample-oud-perfume-100ml'"`);
  await p.goto(B + '/products/sample-oud-perfume-100ml');
  check((await p.locator('main s').first().textContent()) === '3,300 ETB', 'admin price change visible immediately');
  require('child_process').execSync(`psql -q "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "update products set price_etb = 3200 where slug = 'sample-oud-perfume-100ml'"`);

  // Over-stock: 5 requested, 3 available -> checkout blocked until fixed
  await p.evaluate(() => localStorage.setItem('cart:v1', JSON.stringify([{type:'product',productId:'20000000-0000-0000-0000-000000000003',quantity:5}])));
  await p.goto(B + '/cart'); await p.waitForSelector('text=Only 3 in stock.');
  await p.check('input[type=radio] >> nth=0');
  await p.selectOption('select:near(:text("Delivery to"))', { label: 'Addis Ababa — 150 ETB' });
  check(await p.locator('button:has-text("Proceed to checkout")').isDisabled(), 'checkout blocked when quantity exceeds stock');
  await p.click('button:has-text("Set to 3")');
  await p.waitForSelector('a:has-text("Proceed to checkout")');
  check(true, 'one-tap fix enables checkout');
  check((await p.locator('dl div:has(dt:text-is("Total")) dd').textContent()) === '2,190 ETB', 'total after fix = 3×680 + 150 = 2,190 ETB');

  // Language switch
  await p.goto(B + '/');
  await p.click('header button:has-text("አማርኛ")');
  await p.waitForFunction(() => document.documentElement.lang === 'am');
  check((await p.locator('nav[aria-label=Main]').textContent()).includes('የውበት ምርቶች'), 'language switch to Amharic');
  await p.goto(B + '/products/sample-oud-perfume-100ml');
  check((await p.locator('h1').textContent()).includes('ኡድ'), 'product name shown in Amharic');
  check((await p.locator('main').textContent()).includes('ብር'), 'prices shown in ብር');

  // Mobile
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(B + '/', { waitUntil: 'networkidle' });
  await m.click('button[aria-label="Open menu"]');
  await m.click('[role=dialog] a:has-text("Electronics")');
  await m.waitForURL(/electronics/);
  check(true, 'mobile menu navigates');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'no horizontal overflow on mobile');

  const unexpected = errors.filter((e) => !e.includes('/checkout') && !e.startsWith('Failed to load resource'));
  check(unexpected.length === 0, `no unexpected browser errors (${unexpected.slice(0, 3).join(' | ')})`);
  console.log(results.join('\n'));
  await b.close();
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
