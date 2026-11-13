// Run the dashboard's decision model (default settings) for every pipe and save the result,
// so the IFC export can carry the advice and integrated value per pipe.
// Usage: node pipeline/decisions.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, solvePipe, componentSplit } from '../dashboard/model.js';

const pipes = JSON.parse(readFileSync(new URL('../dashboard/data/pipes.geojson', import.meta.url))).features.map(f => f.properties);
const out = {};
for (const p of pipes) {
  const s = solvePipe(p, DEFAULTS);
  const split = componentSplit(p, DEFAULTS, s);
  const d = c => (s.action !== 'defer' && split.defer && split[s.action]) ? split.defer[c] - split[s.action][c] : 0;
  const now = s.action === 'replace' ? s.costs.rep : s.action === 'reline' ? s.costs.rel : { fv: 0, sv: 0, ev: 0 };
  out[p.id] = {
    action: s.action, iv_now: Math.round(s.ivNow), dFV: Math.round(d('fv')), dSV: Math.round(d('sv')), dEV: Math.round(d('ev')),
    fv_now: Math.round(now.fv), sv_now: Math.round(now.sv), ev_now: Math.round(now.ev), policy: s.policy.join(','),
  };
}
writeFileSync(new URL('../data/out/decisions.json', import.meta.url), JSON.stringify({ params: DEFAULTS, pipes: out }));
const n = Object.values(out).reduce((a, x) => ({ ...a, [x.action]: (a[x.action] || 0) + 1 }), {});
console.log('decisions:', n);
