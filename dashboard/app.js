import { DEFAULTS, POF, solvePipe, componentSplit } from './model.js';

const $ = id => document.getElementById(id);
const eur = n => (n < 0 ? '−' : '') + '€' + Math.round(Math.abs(n)).toLocaleString('en-US');
const keur = n => Math.abs(n) >= 1e6 ? '€' + (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? '€' + Math.round(n / 1e3) + 'k' : eur(n);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const COLORS = () => ({ defer: css('--defer'), reline: css('--reline'), replace: css('--replace') });

const P = { ...DEFAULTS };

// Every model input with its value(s) and where it comes from.
// status: 'sourced' = official / published figure · 'partly' = method sourced, number ours · 'assumption' = our estimate, to verify
const SRC = {
  nmd1: ['NMD Bepalingsmethode 1.0 (MKI set 1, €0.05/kg CO₂-eq), used by the Ecoinvent sheet in the data set', 'https://milieudatabase.nl/en/downloads/download/197'],
  nmd2: ['MKI/ECI set 2 (EN 15804+A2), ≈ €0.116/kg CO₂-eq, mandatory from July 2025', 'https://helpcenter.ecochain.com/en/articles/9094591-the-updated-eci-mki-weighting-factors'],
  iv: ['Integrated value lecture (Schoenmaker): shadow carbon price $224/t ≈ €210/t', null],
  disc: ['Werkgroep discontovoet 2020 / kabinetsreactie: 2.25 % standard, 1.85–2.65 % sensitivity', 'https://www.rijksfinancien.nl/sites/default/files/hafir/bestuurlijke-regels/Kabinetsreactie-rapport-werkgroep-discontovoet.pdf'],
  tree: ['Amsterdam replanting duty + Herplantfonds, value by NVTB method; Haarlem 2019: €3,500 for a small street tree', 'https://lokaleregelgeving.overheid.nl/CVDR697591'],
  slide: ['Organisers’ UC4 slide: reline +20–30 yr (class 3–4), +10–20 yr (class 5–6)', null],
  wior: ['Amsterdam WIOR: sewer works median 14 days (calibration of closure days)', 'https://api.data.amsterdam.nl/v1/wior/'],
  mkba: ['No per-day figure found; check Werkwijzer MKBA milieu §C.6 (overige hinder)', null],
  rioned: ['Barendrecht Programma Stedelijk Water 2024-2028, unit prices 2023 per diameter (replace €636–1,386/m, reline €248–563/m), excl. road surface; road restoration €80/m² added (assumption). Amsterdam check: GRP 2016-21, 4,100 km worth €2.5 bn ≈ €610/m', 'https://lokaleregelgeving.overheid.nl/CVDR718027'],
  rioned2: ['No sourced figure; to verify with Waternet', null],
  vmm: ['VMM 2018 “Kosten voor riolering”: 158 sewer projects, dense-urban re-laying €1,619/m, relining ≈ €350/m (2016 prices), indexed +44 % with CBS GWW input price index 2016→2025', 'https://publicaties.vlaanderen.be/view-file/28404'],
  plan: ['Stadsregie programme + NDW planning feed (live)', 'https://opendata.ndw.nu/'],
};
const PARAMS = [
  { group: 'Shadow prices' },
  { key: 'carbon', label: 'CO₂ price inside MKI', unit: v => `€${v}/t`, status: 'sourced',
    options: [[116, 'MKI set 2 (current) · €116/t', 'nmd2'], [50, 'MKI set 1 (old) · €50/t', 'nmd1'], [210, 'Welfare price · €210/t', 'iv']] },
  { key: 'rate', label: 'Discount rate', unit: v => `${v} %`, status: 'sourced',
    options: [[2.25, 'Standard · 2.25 %', 'disc'], [1.85, 'Low · 1.85 %', 'disc'], [2.65, 'High · 2.65 %', 'disc']] },
  { key: 'treeCost', label: 'Tree within 4 m of a dig', unit: eur, status: 'partly', options: [[3500, '€3,500 per tree', 'tree']] },
  { key: 'protTreeCost', label: 'Protected tree within 10 m', unit: eur, status: 'assumption', options: [[15000, '€15,000 per tree', 'tree']] },
  { key: 'dayBase', label: 'Road closure, per day', unit: eur, status: 'assumption', options: [[250, '€250 per day', 'mkba']] },
  { key: 'dayPerAddr', label: '+ per address within 30 m', unit: eur, status: 'assumption', options: [[10, '€10 per address per day', 'mkba']] },
  { group: 'Work and failure' },
  { key: 'repMul', label: 'Replace cost per metre (by Ø)', unit: v => `${v}×`, status: 'partly', options: [[1, 'Barendrecht 2023 + road · ≈ €614/m at Ø250', 'rioned'], [3.8, 'VMM dense urban, indexed · ≈ €2,330/m at Ø250', 'vmm']] },
  { key: 'relMul', label: 'Reline cost per metre (by Ø)', unit: v => `${v}×`, status: 'sourced', options: [[1, 'Barendrecht 2023 · ≈ €207/m at Ø250', 'rioned'], [1.48, 'VMM, indexed · ≈ €305/m at Ø250', 'vmm']] },
  { key: 'damage', label: 'Damage per failure (Ø300)', unit: eur, status: 'assumption', options: [[20000, '€20,000', 'rioned2']] },
  { key: 'linerLife', label: 'Liner life, relined at class 1–4', unit: v => `${v} yr`, status: 'partly', options: [[25, '25 years', 'slide'], [20, '20 years', 'slide'], [30, '30 years', 'slide']] },
  { key: 'linerLifeLate', label: 'Liner life, relined at class 5–6', unit: v => `${v} yr`, status: 'partly', options: [[15, '15 years', 'slide'], [10, '10 years', 'slide'], [20, '20 years', 'slide']] },
  { key: 'coordYears', label: 'Combine with works starting within', unit: v => `${v} yr`, status: 'sourced', options: [[5, '5 years', 'plan'], [0, 'off', 'plan'], [10, '10 years', 'plan']] },
  { check: 'reline6', label: 'Relining possible at class 6', status: 'assumption' },
];
const STATUS_TXT = { sourced: 'sourced', partly: 'partly sourced', assumption: 'assumption' };

let pipes = [], pipeLayer, selected = null, solveToken = 0;
const map = L.map('map', { preferCanvas: true, zoomControl: true });
const renderer = L.canvas({ tolerance: 6 });

// ---------- controls: sourced values, choices only where a source gives alternatives ----------
function buildControls() {
  const srcLink = id => { const [t, u] = SRC[id]; return u ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : t; };
  $('controls').innerHTML = PARAMS.map((p, i) => {
    if (p.group) return `<div class="group">${p.group}</div>`;
    const chip = `<span class="st ${p.status}">${STATUS_TXT[p.status]}</span>`;
    if (p.check) return `<div class="param"><label class="ctl check"><input type="checkbox" id="c-${p.check}" ${P[p.check] ? 'checked' : ''}><span>${p.label}</span></label>${chip}</div>`;
    const cur = p.options.find(o => o[0] === P[p.key]) || p.options[0];
    P[p.key] = cur[0];
    const value = p.options.length > 1
      ? `<select id="c-${p.key}">${p.options.map(o => `<option value="${o[0]}" ${o[0] === cur[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`
      : `<b>${p.unit(cur[0])}</b>`;
    return `<div class="param"><div class="row"><span>${p.label}</span>${value}</div><div class="src" id="s-${p.key}">${chip} ${srcLink(cur[2])}</div></div>`;
  }).join('');
  PARAMS.forEach(p => {
    if (p.check) { $('c-' + p.check).onchange = e => { P[p.check] = e.target.checked; scheduleSolve(); }; return; }
    if (!p.options || p.options.length < 2) return;
    $('c-' + p.key).onchange = e => {
      const o = p.options.find(x => String(x[0]) === e.target.value);
      P[p.key] = o[0];
      const [t, u] = SRC[o[2]];
      $('s-' + p.key).innerHTML = `<span class="st ${p.status}">${STATUS_TXT[p.status]}</span> ${u ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : t}`;
      scheduleSolve();
    };
  });
}

// ---------- solving ----------
let solveTimer;
function scheduleSolve() { clearTimeout(solveTimer); solveTimer = setTimeout(solveAll, 120); }

function solveAll() {
  const token = ++solveToken;
  let i = 0;
  const step = () => {
    if (token !== solveToken) return;
    const end = Math.min(pipes.length, i + 250);
    for (; i < end; i++) {
      const p = pipes[i];
      p.sol = solvePipe(p.props, P, p.sol?.V);
    }
    if (i < pipes.length) setTimeout(step, 0);
    else { restyle(); renderSummary(); renderLimitations(); if (selected) renderSelection(selected); }
  };
  step();
}

// ---------- styling ----------
const AGE_BUCKETS = [[20, '#7fb3c9'], [40, '#4f8fb0'], [60, '#c4840a'], [80, '#b0432d'], [999, '#6e1f12']];
const COND_COL = ['', '#2e7d4f', '#7aa65a', '#c7b23a', '#d98a1c', '#c4512a', '#7e1d12'];
const SETTLE_COL = { low: '#7aa65a', medium: '#d9a21c', high: '#b0432d' };
const MAT_COL = { concrete: '#6b6f74', PVC: '#2f7fb7', stoneware: '#a0623a', 'asbestos cement': '#b0432d', 'cast iron': '#3a3a3a', PE: '#7e57c2', unknown: '#aaa' };

function pipeColor(p) {
  const by = $('colorBy').value, c = COLORS();
  if (by === 'action') return c[p.sol.action];
  if (by === 'cond') return COND_COL[p.props.cond];
  if (by === 'material') return MAT_COL[p.props.material] || '#aaa';
  if (by === 'age') return AGE_BUCKETS.find(([a]) => p.props.age < a)[1];
  if (by === 'settle') return SETTLE_COL[p.props.settle] || '#aaa';
  const v = p.sol.ivNow;
  return v <= 0 ? '#c9d3da' : v < 5000 ? '#f2c66d' : v < 25000 ? '#e08a2c' : v < 100000 ? '#c4512a' : '#7e1d12';
}

const SHOW = { defer: true, reline: true, replace: true };
function applyFilter() {
  pipes.forEach(p => {
    const on = SHOW[p.sol.action];
    if (on && !pipeLayer.hasLayer(p.layer)) pipeLayer.addLayer(p.layer);
    if (!on && pipeLayer.hasLayer(p.layer)) pipeLayer.removeLayer(p.layer);
  });
  scene3d?.filter(id => SHOW[pipeById[id]?.sol.action]);
}
function renderFilter() {
  const n = { defer: 0, reline: 0, replace: 0 };
  pipes.forEach(p => n[p.sol.action]++);
  $('filterBar').innerHTML = '<span class="lbl">Show</span>' + ['defer', 'reline', 'replace'].map(a =>
    `<button type="button" class="chip ${a} ${SHOW[a] ? 'on' : ''}" data-a="${a}" aria-pressed="${SHOW[a]}">${a} <b>${n[a]}</b></button>`).join('');
  $('filterBar').querySelectorAll('button').forEach(b => { b.onclick = () => { SHOW[b.dataset.a] = !SHOW[b.dataset.a]; renderFilter(); applyFilter(); }; });
}
let pipeById = {};

function restyle() {
  if (!pipes.length || pipes.some(p => !p.sol)) return; // wait until every pipe is solved
  renderFilter(); applyFilter();
  pipes.forEach(p => p.layer.setStyle({ color: pipeColor(p), weight: 1.5 + p.props.diameter_mm / 250, opacity: selected === p ? 1 : 0.9 }));
  if (selected) selected.layer.setStyle({ weight: 7 });
  if (scene3d) { scene3d.recolor(Object.fromEntries(pipes.map(p => [p.props.id, pipeColor(p)]))); scene3d.select(selected?.props.id); }
  renderLegend();
}

// ---------- 2D / 3D switch ----------
let scene3d = null;
function selectPipe(p) { selected = p; renderSelection(p); restyle(); }
async function setView(view) {
  document.querySelectorAll('#viewSwitch button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('map').hidden = view !== 'map';
  $('scene3d').hidden = view !== '3d';
  $('viewNote').hidden = view !== '3d';
  if (view === 'map') { map.invalidateSize(); if (!map._fitted) { map.fitBounds(L.featureGroup(pipes.map(p => p.layer)).getBounds(), { padding: [10, 10] }); map._fitted = true; } return; }
  if (!scene3d) {
    $('viewNote').firstChild.textContent = 'Loading the 3D island… ';
    const { initScene } = await import('./scene3d.js');
    scene3d = await initScene($('scene3d'), {
      diameters: Object.fromEntries(pipes.map(p => [p.props.id, p.props.diameter_mm])),
      onPick: id => { const p = pipes.find(x => x.props.id === id); if (p) selectPipe(p); },
      onStation: () => openBim('station'),
    });
    $('viewNote').firstChild.textContent = 'Depth below ground drawn 6× deeper, pipes 5× thicker. Drag to orbit, right-drag to pan, scroll to zoom. Click a pipe or the blue pumping station. ';
    restyle();
  } else scene3d.resize();
}
document.querySelectorAll('#viewSwitch button').forEach(b => { b.onclick = () => setView(b.dataset.view); });
$('seeThrough').onchange = e => scene3d?.setGround(e.target.checked);
['buildings', 'trees', 'manholes', 'soil'].forEach(k => { $('show-' + k).onchange = e => scene3d?.show(k, e.target.checked); });

function renderLegend() {
  const by = $('colorBy').value, c = COLORS();
  let items;
  if (by === 'action') items = [['defer', c.defer], ['reline', c.reline], ['replace', c.replace]];
  else if (by === 'cond') items = [1, 2, 3, 4, 5, 6].map(s => [`class ${s}`, COND_COL[s]]);
  else if (by === 'material') items = Object.entries(MAT_COL);
  else if (by === 'settle') items = [['low settlement risk', SETTLE_COL.low], ['medium', SETTLE_COL.medium], ['high (peat / clay below)', SETTLE_COL.high]];
  else if (by === 'age') items = [['< 20 yr', AGE_BUCKETS[0][1]], ['20–39', AGE_BUCKETS[1][1]], ['40–59', AGE_BUCKETS[2][1]], ['60–79', AGE_BUCKETS[3][1]], ['80+', AGE_BUCKETS[4][1]]];
  else items = [['no gain (defer)', '#c9d3da'], ['< €5k', '#f2c66d'], ['€5–25k', '#e08a2c'], ['€25–100k', '#c4512a'], ['> €100k', '#7e1d12']];
  $('legend').innerHTML = items.map(([k, col]) => `<span style="--c:${col}">${k}</span>`).join('');
}

// ---------- limitations: both cost sources side by side + age leakage ----------
const COST_SOURCES = { barendrecht: { repMul: 1, relMul: 1, label: 'Barendrecht 2023' }, vmm: { repMul: 3.8, relMul: 1.48, label: 'VMM 2018 (indexed)' } };
function renderLimitations() {
  const rows = Object.values(COST_SOURCES).map(src => {
    const PP = { ...P, repMul: src.repMul, relMul: src.relMul };
    const n = { defer: 0, reline: 0, replace: 0 }; let fv = 0; const acts = [];
    for (const p of pipes) {
      const sol = solvePipe(p.props, PP);
      n[sol.action]++; acts.push(sol.action);
      if (sol.action !== 'defer') fv += (sol.action === 'replace' ? sol.costs.rep.fv : sol.costs.rel.fv);
    }
    return { src, n, fv, acts };
  });
  const same = rows[0].acts.filter((a, i) => a === rows[1].acts[i]).length;
  // leakage: best single age/life threshold that reproduces act vs defer
  const act = pipes.map(p => p.sol.action !== 'defer'), rel = pipes.map(p => p.props.age / p.props.life);
  let best = 0, bt = 0;
  for (let t = 0.2; t < 1.6; t += 0.01) { let ok = 0; rel.forEach((r, i) => { if ((r >= t) === act[i]) ok++; }); if (ok > best) { best = ok; bt = t; } }
  const pct = x => Math.round(100 * x / pipes.length) + ' %';
  $('limitations').innerHTML = `
    <h3>1 · Cost source decides how, not whether</h3>
    <table><thead><tr><th>Cost source</th><th>Defer</th><th>Reline</th><th>Replace</th><th>Invest now</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.src.label}</td><td>${r.n.defer}</td><td>${r.n.reline}</td><td>${r.n.replace}</td><td>${keur(r.fv)}</td></tr>`).join('')}
    </tbody></table>
    <p class="note">${pct(same)} of sections get the same advice under both. The difference is mostly replace ↔ reline. Fix: Waternet’s own Maximo costs per diameter.</p>
    <h3>2 · Synthetic condition leaks age and material</h3>
    <p class="note" style="margin:0">The condition class is simulated from age and material, and the decision model also uses age and material (expected life, ageing). The rule “act once a pipe is past ${Math.round(bt * 100)} % of its expected life” reproduces <b>${pct(best)}</b> of the act / defer advice, so the class adds little independent information. Fix: real NEN inspection scores replace the synthetic class; the model stays the same.</p>
    <p class="note"><a href="slides/limitations.html" target="_blank" rel="noopener">Open as presentation slide →</a></p>`;
}

function renderSummary() {
  const n = { defer: 0, reline: 0, replace: 0 };
  let fv = 0, sv = 0, ev = 0, clim = 0, iv = 0;
  for (const p of pipes) {
    const a = p.sol.action; n[a]++;
    if (a !== 'defer') {
      const o = a === 'replace' ? p.sol.costs.rep : p.sol.costs.rel;
      fv += o.fv; sv += o.sv; ev += o.ev; iv += p.sol.ivNow;
      clim += a === 'replace' ? p.props.ev_rep_clim : p.props.ev_rel_clim;
    }
  }
  const st = (v, k, cls = '') => `<div class="stat ${cls}"><span class="v">${v}</span><span class="k">${k}</span></div>`;
  $('summary').innerHTML = st(pipes.length, 'pipes') + st(n.defer, 'defer', 'defer') + st(n.reline, 'reline', 'reline') + st(n.replace, 'replace', 'replace') +
    st(keur(fv), 'invest now (FV)') + st(keur(sv), 'disruption (SV)') + st(keur(ev), 'MKI (EV)') + st(Math.round(clim / 50) + ' t', 'CO₂e of works') + st(keur(iv), 'value of acting now');
}

// ---------- pipe card (floating box in the map pane) ----------
const THIS_YEAR = 2026, TODAY = '2026-11-13';
const cap = a => a[0].toUpperCase() + a.slice(1);

// When will this section need work? Now, or the expected year it ages into the first class where the advice is not "defer".
function interventionTiming(pr, s) {
  if (s.action !== 'defer') return { year: THIS_YEAR, action: s.action, cls: pr.cond, now: true };
  const k = s.policy.findIndex((a, i) => i + 1 > pr.cond && a !== 'defer');
  if (k < 0) return null;
  const years = Math.round((k + 1 - pr.cond) * pr.life / 4); // Markov ageing: 4 class steps per expected life
  return { year: THIS_YEAR + years, action: s.policy[k], cls: k + 1, now: false };
}

function nextOpening(pr) {
  const w = (pr.planned_works || []).filter(x => String(x.end || '9999') >= TODAY)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))[0];
  return w || null;
}

function renderSelection(p) {
  const pr = p.props, s = p.sol, C = s.costs;
  const t = interventionTiming(pr, s);
  const act = t ? t.action : s.action;
  const o = act === 'replace' ? C.rep : act === 'reline' ? C.rel : null;
  const split = componentSplit(pr, P, s);
  const d = c => (s.action !== 'defer' && split.defer && split[s.action]) ? split.defer[c] - split[s.action][c] : 0;
  const risk = POF[pr.cond] * C.fail.total;
  const open = nextOpening(pr);
  const remaining = Math.max(0, pr.life - pr.age);

  const whenTxt = !t ? 'No intervention needed within the model horizon'
    : t.now ? `<b>Now (${t.year})</b>`
    : `Expected around <b>${t.year}</b>, when it reaches class ${t.cls} → ${t.action}`;

  const ivBlock = o ? `
    <table class="fsv">
      <thead><tr><th></th><th>FV</th><th>SV</th><th>EV</th><th>Total</th></tr></thead>
      <tbody>
        <tr><td>${cap(act)} ${t && !t.now ? '<span class="muted">(today’s prices)</span>' : 'now'}</td><td>${eur(o.fv)}</td><td>${eur(o.sv)}</td><td>${eur(o.ev)}</td><td><b>${eur(o.total)}</b></td></tr>
        ${s.action !== 'defer' ? `<tr class="best"><td>Value of acting now</td><td>${eur(d('fv'))}</td><td>${eur(d('sv'))}</td><td>${eur(d('ev'))}</td><td><b>${eur(s.ivNow)}</b></td></tr>` : ''}
        <tr><td>Carbon (GWP)</td><td colspan="4">${act === 'replace' ? (pr.gwp_rep_kg / 1000).toFixed(1) : (pr.gwp_rel_kg / 1000).toFixed(1)} t CO₂e <span class="muted">· pipe/liner from NMD via Madaster, works from Ecoinvent</span></td></tr>
        <tr><td>Risk of waiting /yr</td><td>${eur(POF[pr.cond] * C.fail.fv)}</td><td>${eur(POF[pr.cond] * C.fail.sv)}</td><td>${eur(POF[pr.cond] * C.fail.ev)}</td><td>${eur(risk)}</td></tr>
      </tbody>
    </table>
    <p class="note">FV = money Waternet spends · SV = disruption (closure days, trees) · EV = environmental cost (MKI) · all in €.</p>` : `<p class="muted">No intervention planned. Risk of waiting: ${eur(risk)} a year.</p>`;

  const rows = ['defer', 'reline', 'replace'].map(a => {
    const ok = Number.isFinite(s.q[a]);
    return `<tr class="${a === s.action ? 'best' : ''}"><td>${a}</td>${ok ? `<td>${keur(s.q[a])}</td>` : '<td class="muted">not possible</td>'}</tr>`;
  }).join('');

  $('pipeCard').innerHTML = `
    <div class="card-head">
      <div><div class="eyebrow">Sewer section</div><h2>${pr.id} <span class="muted" style="font-weight:500">· ${pr.kind}</span></h2></div>
      <span class="badge ${s.action}">${s.action}</span>
      <button type="button" class="x" id="cardClose" aria-label="Close">×</button>
    </div>
    <section>
      <h3>Current state</h3>
      <dl class="grid">
        <dt>Built</dt><dd>${pr.year_flag ? '<span class="tag">year unknown</span>' : `${pr.year} · ${pr.age} yr old`}</dd>
        <dt>Material</dt><dd>${pr.material} <span class="muted">(${pr.material_raw || '–'})</span></dd>
        <dt>Size</dt><dd>Ø${pr.diameter_mm} mm · ${pr.length_m} m long · ${pr.depth_m} m deep</dd>
        <dt>Expected life</dt><dd>${pr.life} yr · ${remaining ? `~${remaining} yr left` : 'past expected life'}</dd>
        <dt>Condition</dt><dd>class ${pr.cond} of 6 <span class="tag">synthetic</span> · ${(POF[pr.cond] * 100).toFixed(1)} % failure chance /yr</dd>
        <dt>Soil (GeoTOP)</dt><dd>pipe in ${pr.soil_at_pipe === "anthropogenic" ? "made ground (raised fill)" : pr.soil_at_pipe}; below it ${pr.peat_m} m peat, ${pr.clay_m} m clay → <b>${pr.settle} settlement risk</b></dd>
        <dt>Surroundings</dt><dd>${pr.addresses_30m} addresses ≤30 m · ${pr.trees_4m} trees ≤4 m${pr.protected_trees_10m ? ` · <b>${pr.protected_trees_10m} protected</b> ≤10 m` : ''}</dd>
      </dl>
    </section>
    <section>
      <h3>Advice</h3>
      <p class="when">${whenTxt}</p>
      <p class="threshold">${thresholdTxt(pr, s)}</p>
      <div class="why">${whyText(pr, s, t)}</div>
    </section>
    <section>
      <h3>Integrated value</h3>
      ${ivBlock}
    </section>
    <section>
      <h3>Street openings</h3>
      <dl class="grid">
        <dt>${open && String(open.start) < TODAY ? 'Ongoing' : 'Next planned'}</dt><dd>${open ? `${String(open.start) < TODAY ? 'until' : `<b>${open.start || '?'}</b> →`} <b>${open.end || '?'}</b> · ${open.source}: ${open.name || ''}${open.hindrance ? ` <span class="muted">(${open.hindrance})</span>` : ''}` : 'No planned works known on this street'}</dd>
        <dt>By this model</dt><dd>${t ? `${t.year} · ${t.action}${t.action === 'replace' ? ' (street opened)' : ' (no excavation: liner pulled in through manholes)'}` : '–'}</dd>
        ${C.coordWith && t && t.action === 'replace' && t.year <= +String(C.coordWith.end || '9999').slice(0, 4) ? `<dt>Combine</dt><dd>Replacement combined with ${C.coordWith.source} works: shared digging, less disruption</dd>`
          : open && t && t.year > +String(open.end || '0').slice(0, 4) ? `<dt>Note</dt><dd>These works end before this section needs work, so they can't be combined; check whether bringing the work forward pays off.</dd>` : ''}
      </dl>
    </section>
    <details>
      <summary>Model detail: lifetime cost per option</summary>
      <table><thead><tr><th>Option</th><th>Lifetime integrated cost</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">Lifetime = expected discounted FV + SV + EV + risk, following the best choice in later years too.</p>
    </details>`;
  $('pipeCard').hidden = false;
  $('cardClose').onclick = () => { $('pipeCard').hidden = true; selected = null; restyle(); };
}

// The condition class is an input; this states at which class this particular pipe tips from waiting to acting.
function thresholdTxt(pr, s) {
  const k = s.policy.findIndex(a => a !== 'defer');
  if (k < 0) return `For this pipe, waiting stays cheapest at every condition class. Currently class ${pr.cond}.`;
  return `This pipe needs action from <b>class ${k + 1}</b> (${s.policy[k]}${s.policy.slice(k).some(a => a !== s.policy[k]) ? `, ${s.policy.slice(k).find(a => a !== s.policy[k])} at worse classes` : ''}). Currently <b>class ${pr.cond}</b>.`;
}

function whyText(pr, s, t) {
  const C = s.costs, risk = POF[pr.cond] * C.fail.total;
  if (s.action === 'defer') return `At class ${pr.cond} the failure risk costs about <b>${eur(risk)}</b> a year, less than any intervention is worth today.${t ? ` As the pipe ages the risk grows; around ${t.year} ${t.action} becomes the cheapest option.` : ''} Re-inspect to confirm the (synthetic) condition.`;
  const alt = s.action === 'reline' ? 'replace' : 'reline';
  const altTxt = Number.isFinite(s.q[alt]) ? `${alt} would cost ${keur(s.q[alt] - s.q[s.action])} more over its lifetime` : `${alt} is not possible here`;
  const coord = C.coordWith && s.action === 'replace' ? ' The street opens anyway for planned works, so digging is cheaper and causes little extra disruption.' : '';
  const trees = pr.protected_trees_10m && s.action === 'reline' ? ' Relining also spares the protected trees nearby.' : '';
  return `Failure risk at class ${pr.cond} is <b>${eur(risk)}</b> a year. <b>${s.action[0].toUpperCase() + s.action.slice(1)}</b> now has the lowest lifetime integrated cost; ${altTxt}.${coord}${trees}`;
}

// ---------- BIM ----------
async function openBim(key = 'station') {
  $('bimModal').hidden = false;
  const isSewer = key.startsWith('sewer');
  $('bimTitle').textContent = isSewer ? 'Sewer network in 3D (IFC)' : 'Pumping station (IFC)';
  $('bimScale').hidden = !isSewer;
  $('soilToggle').hidden = !isSewer;
  document.querySelectorAll('#bimScale button').forEach(b => {
    b.classList.toggle('on', b.dataset.key === key);
    b.onclick = () => openBim(b.dataset.key);
  });
  try {
    const mod = await import('./bim.js');
    await mod.showModel($('bimView'), $('bimInfo'), key);
  } catch (e) {
    $('bimInfo').textContent = 'Could not load the BIM viewer: ' + e.message;
  }
}
$('bimClose').onclick = () => { $('bimModal').hidden = true; };

// ---------- map + data ----------
async function load(name) { const r = await fetch('data/' + name, { cache: 'no-cache' }); return r.json(); }

async function main() {
  buildControls();
  const base = L.tileLayer('https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Kaart © PDOK / Kadaster' }).addTo(map);
  const aerial = L.tileLayer('https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Luchtfoto © PDOK' });

  const [pipeGj, manholes, trees, stad, wior, ndw, station, addresses] = await Promise.all(
    ['pipes.geojson', 'manholes.geojson', 'trees.geojson', 'stadsregie.geojson', 'wior.geojson', 'ndw.geojson', 'station.geojson', 'addresses.json'].map(load));

  pipeLayer = L.layerGroup();
  pipes = pipeGj.features.map(f => {
    const p = { props: f.properties };
    p.layer = L.polyline(f.geometry.coordinates.map(([x, y]) => [y, x]), { renderer, weight: 2 }).addTo(pipeLayer);
    p.layer.on('click', () => selectPipe(p));
    return p;
  });
  pipeById = Object.fromEntries(pipes.map(p => [p.props.id, p]));

  const pop = (f, keys) => keys.map(k => f.properties[k] ? `<b>${k}</b>: ${f.properties[k]}` : '').filter(Boolean).join('<br>');
  const manholeLayer = L.geoJSON(manholes, { pointToLayer: (f, ll) => L.circleMarker(ll, { renderer, radius: 2, color: '#56656f', weight: 1, fillOpacity: .6 }) })
    .bindPopup(l => `Manhole ${l.feature.properties.name} (${l.feature.properties.year})`);
  const treeLayer = L.geoJSON(trees, {
    pointToLayer: (f, ll) => f.properties.protected
      ? L.circleMarker(ll, { renderer, radius: 5, color: '#1b5e20', weight: 2, fillColor: '#43a047', fillOpacity: .9 })
      : L.circleMarker(ll, { renderer, radius: 2.5, color: '#43a047', weight: 0, fillOpacity: .55 }),
  }).bindPopup(l => pop(l.feature, ['species', 'height', 'trunk', 'planted', 'protected']));
  const addrLayer = L.layerGroup(addresses.map(([x, y]) => L.circleMarker([y, x], { renderer, radius: 1.2, color: '#8a6d5a', weight: 0, fillOpacity: .5 })));
  const workStyle = col => ({ color: col, weight: 1.5, fillOpacity: .12, dashArray: '4 3' });
  const workPop = l => pop(l.feature, ['source', 'name', 'type', 'start', 'end', 'hindrance', 'status']);
  const stadLayer = L.geoJSON(stad, { style: () => workStyle('#7b3fa0') }).bindPopup(workPop);
  const wiorLayer = L.geoJSON(wior, { style: f => workStyle((f.properties.end || '') >= '2026-11-13' ? '#d17a00' : '#8b98a2') }).bindPopup(workPop);
  const ndwLayer = L.geoJSON(ndw, {
    style: () => ({ color: '#d1342f', weight: 4 }),
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: '#d1342f', weight: 2, fillOpacity: .3 }),
  }).bindPopup(workPop);
  const stationLayer = L.geoJSON(station, {
    pointToLayer: (f, ll) => L.marker(ll, { icon: L.divIcon({ className: '', html: '<div style="background:#0d6a87;color:#fff;font:600 11px IBM Plex Sans,sans-serif;padding:3px 6px;border-radius:3px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">Pumping station · BIM</div>', iconAnchor: [10, 10] }) }),
  });
  stationLayer.on('click', () => openBim('station'));
  $('openStation').onclick = e => { e.preventDefault(); openBim('station'); };
  $('openNetwork').onclick = e => { e.preventDefault(); openBim('sewer'); };
  $('soilOn').onchange = async e => { (await import('./bim.js')).setSoil(e.target.checked); };

  pipeLayer.addTo(map); stationLayer.addTo(map); stadLayer.addTo(map); ndwLayer.addTo(map);
  L.control.layers({ 'Map (PDOK)': base, 'Aerial (PDOK)': aerial }, {
    'Sewer pipes (advice)': pipeLayer,
    'Pumping station (BIM)': stationLayer,
    'Manholes': manholeLayer,
    'Trees (protected = large)': treeLayer,
    'Addresses (BAG)': addrLayer,
    'Planned: Stadsregie programme': stadLayer,
    'Planned & current: NDW roadworks': ndwLayer,
    'Street works WIOR (orange = ongoing)': wiorLayer,
  }, { position: 'topleft', collapsed: false }).addTo(map);

  map.setView([52.378, 4.845], 15); // real fit happens when the 2D view is first shown
  window.dashboard = {
    pipes, P,
    select(id) { const p = pipes.find(x => x.props.id === id); if (p) p.layer.fire('click'); return !!p; },
  };
  $('colorBy').onchange = restyle;
  solveAll();
  setView('3d'); // 3D island is the default view
}

main();
