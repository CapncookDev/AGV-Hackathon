// Sewer renewal decision model.
// Per pipe: integrated cost (FV + SV + EV, all in €) of reline and replace, risk of waiting,
// and a Markov decision process over condition classes 1–6 (unlined / relined) solved by value iteration.
// All € figures are assumptions unless they come from the data set; see ASSUMPTIONS.

export const POF = [0, 0.001, 0.003, 0.01, 0.03, 0.08, 0.20]; // index = condition class 1..6

export const DEFAULTS = {
  carbon: 116,         // €/t CO2e: current NMD weighting set 2 (EN 15804+A2); the Ecoinvent sheet itself is priced at set 1 (€50/t)
  rate: 2.25,          // discount rate, %/yr (Werkgroep discontovoet 2020)
  dayBase: 250,        // € per day of road closure, base
  dayPerAddr: 10,      // € per day per address within 30 m
  treeCost: 3500,      // € per tree within 4 m of a dig (replanting value, NVTB-based; Haarlem 2019 example)
  protTreeCost: 15000, // € per protected tree within 10 m (monumental / special)
  repMul: 3.8,         // × Barendrecht 2023 unit price + road (≈ €614/m at Ø250) → VMM 2018 dense-urban, indexed ≈ €2,330/m at Ø250
  relMul: 1.48,        // × Barendrecht 2023 reline price (≈ €207/m at Ø250) → VMM 2018 relining, indexed ≈ €305/m at Ø250
  damage: 20000,       // € damage per failure for a Ø300 pipe (scales with diameter)
  linerLife: 25,       // years until class 6 after relining at class 1–4 (organisers' slide: +20–30 yr at class 3–4)
  linerLifeLate: 15,   // years until class 6 after relining at class 5–6 (organisers' slide: +10–20 yr)
  coord: true,         // combine with planned street works
  coordYears: 5,       // horizon for combining, years
  reline6: false,      // allow relining at class 6
};

const TODAY = '2026-11-13';
const THIS_YEAR = 2026;

export function optionCosts(p, P) {
  const D = p.diameter_mm, L = p.length_m;
  // unit prices per metre (Barendrecht 2023, by diameter) + road restoration, from the pipeline
  const fvRepBase = p.cost_rep_m * L * P.repMul;
  const fvRel = p.cost_rel_m * L * P.relMul;
  const daysRep = 3 + L / 8, daysRel = 1 + L / 80;
  const dayPrice = P.dayBase + P.dayPerAddr * p.addresses_30m;
  const treeSV = p.trees_4m * P.treeCost + p.protected_trees_10m * P.protTreeCost;
  const ev = (base, clim) => base - clim + clim * P.carbon / 50;
  const evRep = ev(p.ev_rep, p.ev_rep_clim), evRel = ev(p.ev_rel, p.ev_rel_clim);

  const coordWith = P.coord ? (p.planned_works || []).find(w => w.year && w.year <= THIS_YEAR + P.coordYears && String(w.end || '9999') >= TODAY) : null;
  const fvRep = coordWith ? fvRepBase * 0.7 : fvRepBase;
  const svRepDays = daysRep * dayPrice * (coordWith ? 0.2 : 1);

  const rep = { fv: fvRep, sv: svRepDays + treeSV, ev: evRep, days: daysRep };
  const rel = { fv: fvRel, sv: daysRel * dayPrice, ev: evRel, days: daysRel };
  rep.total = rep.fv + rep.sv + rep.ev;
  rel.total = rel.fv + rel.sv + rel.ev;
  // cost of one failure: emergency replacement (1.5×), damage, double closure, materials
  const fail = { fv: 1.5 * fvRepBase + P.damage * D / 300, sv: 2 * daysRep * dayPrice + treeSV, ev: evRep };
  fail.total = fail.fv + fail.sv + fail.ev;
  return { rep, rel, fail, coordWith, dayPrice };
}

// state index: (class s, track l) -> (s-1) + 6*l; track 0 = unlined, 1 = relined at class 1–4, 2 = relined at class 5–6
const N = 18;
const idx = (s, l) => (s - 1) + 6 * l;

function buildMdp(p, P, C) {
  // ageing rates: each track reaches class 6 after its expected life (4 steps from class 2, 3 steps from class 3)
  const rates = [Math.min(1, 4 / p.life), Math.min(1, 4 / P.linerLife), Math.min(1, 3 / P.linerLifeLate)];
  const beta = 1 / (1 + P.rate / 100);
  const relOK = (s, l) => p.reline_possible && !l && (s <= 5 || P.reline6);
  const post = { rel: s => (s <= 4 ? idx(2, 1) : idx(3, 2)), rep: () => idx(1, 0) };
  // one year in state k after the action: risk cost + transition distribution
  const yearOf = k => {
    const s = (k % 6) + 1, l = Math.floor(k / 6), f = POF[s], pa = rates[l];
    const next = [[idx(1, 0), f]];
    if (s < 6) { next.push([idx(s + 1, l), (1 - f) * pa], [k, (1 - f) * (1 - pa)]); } else next.push([k, 1 - f]);
    return { risk: f, next };
  };
  const years = Array.from({ length: N }, (_, k) => yearOf(k));
  return { beta, relOK, post, years };
}

function qValues(V, k, M, C) {
  const s = (k % 6) + 1, l = Math.floor(k / 6);
  const cont = j => M.years[j].risk * C.fail.total + M.beta * M.years[j].next.reduce((a, [n, pr]) => a + pr * V[n], 0);
  const q = { defer: cont(k), reline: Infinity, replace: C.rep.total + cont(idx(1, 0)) };
  if (M.relOK(s, l)) q.reline = C.rel.total + cont(M.post.rel(s));
  return q;
}

const argmin = q => Object.keys(q).reduce((a, b) => (q[b] < q[a] ? b : a));

export function solvePipe(p, P, V0) {
  const C = optionCosts(p, P);
  const M = buildMdp(p, P, C);
  let V = V0?.length === N ? Float64Array.from(V0) : new Float64Array(N); // warm start after a slider change
  for (let it = 0; it < 3000; it++) {
    const W = new Float64Array(N);
    let delta = 0;
    for (let k = 0; k < N; k++) {
      const q = qValues(V, k, M, C);
      W[k] = Math.min(q.defer, q.reline, q.replace);
      delta = Math.max(delta, Math.abs(W[k] - V[k]));
    }
    V = W;
    if (delta < 0.5) break;
  }
  const k0 = idx(p.cond, 0);
  const q = qValues(V, k0, M, C);
  const action = argmin(q);
  const policy = [1, 2, 3, 4, 5, 6].map(s => argmin(qValues(V, idx(s, 0), M, C)));
  return { action, q, ivNow: q.defer - q[action], policy, costs: C, V, M };
}

// Split the lifetime value of each option into FV / SV / EV by evaluating the optimal policy per component.
export function componentSplit(p, P, sol) {
  const { costs: C, M, V } = sol;
  const pol = Array.from({ length: N }, (_, k) => argmin(qValues(V, k, M, C)));
  const comps = ['fv', 'sv', 'ev'];
  const imm = (a, c) => (a === 'replace' ? C.rep[c] : a === 'reline' ? C.rel[c] : 0);
  const postOf = (a, k) => (a === 'replace' ? idx(1, 0) : a === 'reline' ? M.post.rel((k % 6) + 1) : k);
  const Vc = Object.fromEntries(comps.map(c => [c, new Float64Array(N)]));
  for (let it = 0; it < 3000; it++) {
    let delta = 0;
    for (const c of comps) {
      const W = new Float64Array(N);
      for (let k = 0; k < N; k++) {
        const j = postOf(pol[k], k);
        W[k] = imm(pol[k], c) + M.years[j].risk * C.fail[c] + M.beta * M.years[j].next.reduce((a, [n, pr]) => a + pr * Vc[c][n], 0);
        delta = Math.max(delta, Math.abs(W[k] - Vc[c][k]));
      }
      Vc[c] = W;
    }
    if (delta < 0.5) break;
  }
  const k0 = idx(p.cond, 0);
  const out = {};
  for (const a of ['defer', 'reline', 'replace']) {
    if (!Number.isFinite(sol.q[a])) continue;
    const j = postOf(a, k0);
    out[a] = Object.fromEntries(comps.map(c => [c,
      imm(a, c) + M.years[j].risk * C.fail[c] + M.beta * M.years[j].next.reduce((s, [n, pr]) => s + pr * Vc[c][n], 0)]));
  }
  return out;
}
