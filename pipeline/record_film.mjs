// Render dashboard/film/ frame by frame (needs playwright-core and the dashboard served on :8780). Usage: node record_film.mjs <outDir> [fromSec] [toSec] [fps]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [out, from = 0, to = 60, fps = 25] = [process.argv[2], ...process.argv.slice(3).map(Number)];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:8780/film/?r=' + Date.now(), { waitUntil: 'load' });
await page.evaluate(() => window.ready());
for (let f = Math.round(from * fps); f < Math.round(to * fps); f++) {
  await page.evaluate(t => window.render(t), f / fps);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${out}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  if (f % 125 === 0) console.log('t', f / fps);
}
await browser.close();
