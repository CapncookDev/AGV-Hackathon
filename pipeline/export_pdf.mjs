// Export the pitch deck to a 16:9 PDF for hand-in: one slide per page, links pointing at the live site.
// Usage: node export_pdf.mjs <out.pdf>   (needs playwright-core, system Chrome, dashboard served on :8780)
import { chromium } from 'playwright-core';
const out = process.argv[2];
const LIVE = 'https://capncookdev.github.io/AGV-Hackathon/dashboard/pitch/';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:8780/pitch/', { waitUntil: 'networkidle' });
await page.evaluate(async live => {
  document.querySelectorAll('a[href]').forEach(a => { a.href = new URL(a.getAttribute('href'), live).href.replace('?v=__BUILD__', ''); });
  await document.fonts.ready;
  await Promise.all([...document.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
}, LIVE);
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: out, width: '1600px', height: '900px', printBackground: true, preferCSSPageSize: true });
await browser.close();
