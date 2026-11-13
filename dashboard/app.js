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
  rioned: ['No official per-metre figure found; replace with Waternet / RIONED cost figures', 'https://www.riool.net'],
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
  { key: 'repMul', label: 'Replace cost (≈ €600 + 2×Ø per m)', unit: v => `${v}×`, status: 'assumption', options: [[1, 'base estimate', 'rioned']] },
  { key: 'relMul', label: 'Reline cost (≈ €250 + 0.85×Ø per m)', unit: v => `${v}×`, status: 'assumption', options: [[1, 'base estimate', 'rioned']] },
  { key: 'damage', label: 'Damage per failure (Ø300)', unit: eur, status: 'assumption', options: [[20000, '€20,000', 'rioned']] },
  { key: 'linerLife', label: 'Liner life (class 2 → 6)', unit: v => `${v} yr`, status: 'partly', options: [[25, '25 years', 'slide'], [15, '15 years', 'slide'], [30, '30 years', 'slide']] },
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
    else { restyle(); renderSummary(); if (selected) renderSelection(selected); }
  };
  step();
}

// ---------- styling ----------
const AGE_BUCKETS = [[20, '#7fb3c9'], [40, '#4f8fb0'], [60, '#c4840a'], [80, '#b0432d'], [999, '#6e1f12']];
const COND_COL = ['', '#2e7d4f', '#7aa65a', '#c7b23a', '#d98a1c', '#c4512a', '#7e1d12'];
const MAT_COL = { concrete: '#6b6f74', PVC: '#2f7fb7', stoneware: '#a0623a', 'asbestos cement': '#b0432d', 'cast iron': '#3a3a3a', PE: '#7e57c2', unknown: '#aaa' };

function pipeColor(p) {
  const by = $('colorBy').value, c = COLORS();
  if (by === 'action') return c[p.sol.action];
  if (by === 'cond') return COND_COL[p.props.cond];
  if (by === 'material') return MAT_COL[p.props.material] || '#aaa';
  if (by === 'age') return AGE_BUCKETS.find(([a]) => p.props.age < a)[1];
  const v = p.sol.ivNow;
  return v <= 0 ? '#c9d3da' : v < 5000 ? '#f2c66d' : v < 25000 ? '#e08a2c' : v < 100000 ? '#c4512a' : '#7e1d12';
}

function restyle() {
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
  if (view === 'map') { map.invalidateSize(); return; }
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
['buildings', 'trees', 'manholes'].forEach(k => { $('show-' + k).onchange = e => scene3d?.show(k, e.target.checked); });

function renderLegend() {
  const by = $('colorBy').value, c = COLORS();
  let items;
  if (by === 'action') items = [['defer', c.defer], ['reline', c.reline], ['replace', c.replace]];
  else if (by === 'cond') items = [1, 2, 3, 4, 5, 6].map(s => [`class ${s}`, COND_COL[s]]);
  else if (by === 'material') items = Object.entries(MAT_COL);
  else if (by === 'age') items = [['< 20 yr', AGE_BUCKETS[0][1]], ['20–39', AGE_BUCKETS[1][1]], ['40–59', AGE_BUCKETS[2][1]], ['60–79', AGE_BUCKETS[3][1]], ['80+', AGE_BUCKETS[4][1]]];
  else items = [['no gain (defer)', '#c9d3da'], ['< €5k', '#f2c66d'], ['€5–25k', '#e08a2c'], ['€25–100k', '#c4512a'], ['> €100k', '#7e1d12']];
  $('legend').innerHTML = items.map(([k, col]) => `<span style="--c:${col}">${k}</span>`).join('');
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

// ---------- selection panel ----------
function renderSelection(p) {
  const pr = p.props, s = p.sol, C = s.costs;
  const split = componentSplit(pr, P, s);
  const rows = ['defer', 'reline', 'replace'].map(a => {
    const now = a === 'defer' ? { fv: POF[pr.cond] * C.fail.fv, sv: POF[pr.cond] * C.fail.sv, ev: POF[pr.cond] * C.fail.ev } : a === 'reline' ? C.rel : C.rep;
    const ok = Number.isFinite(s.q[a]);
    return `<tr class="${a === s.action ? 'best' : ''}"><td>${a}${a === 'defer' ? ' <span class="muted">(risk/yr)</span>' : ''}</td>` +
      (ok ? `<td>${eur(now.fv)}</td><td>${eur(now.sv)}</td><td>${eur(now.ev)}</td><td>${keur(s.q[a])}</td>` : `<td colspan="4" class="muted">not possible</td>`) + '</tr>';
  }).join('');
  let delta = '';
  if (s.action !== 'defer' && split.defer && split[s.action]) {
    const d = c => split.defer[c] - split[s.action][c];
    delta = `<dl class="kv"><dt>Financial (FV)</dt><dd>${eur(d('fv'))}</dd><dt>Social (SV)</dt><dd>${eur(d('sv'))}</dd><dt>Environmental (EV)</dt><dd>${eur(d('ev'))}</dd></dl>`;
  }
  const works = (pr.planned_works || []).map(w => `<li><b>${w.source}</b> ${w.name || ''} <span class="muted">${w.start || ''} → ${w.end || ''}${w.hindrance ? ' · ' + w.hindrance : ''}</span></li>`).join('');
  const why = whyText(pr, s);
  $('selection').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <h2>Pipe ${pr.id}</h2><span class="badge ${s.action}">${s.action}</span>
    </div>
    <div class="muted" style="font-size:12px">${pr.kind} · ${pr.material} (${pr.material_raw || 'unknown'}) · Ø${pr.diameter_mm} mm · ${pr.length_m} m · ${pr.depth_m} m deep</div>
    <dl class="kv">
      <dt>Built</dt><dd>${pr.year_flag ? `<span class="tag">${pr.year_flag}</span>` : `${pr.year} (${pr.age} yr)`} · expected life ${pr.life} yr</dd>
      <dt>Condition</dt><dd>class ${pr.cond} <span class="tag">synthetic</span> · P(fail) ${(POF[pr.cond] * 100).toFixed(1)} %/yr</dd>
      <dt>Addresses ≤30 m</dt><dd>${pr.addresses_30m} → closure ${eur(C.dayPrice)}/day</dd>
      <dt>Trees ≤4 m</dt><dd>${pr.trees_4m}${pr.protected_trees_10m ? ` · <b>${pr.protected_trees_10m} protected</b> ≤10 m` : ''}</dd>
    </dl>
    ${works ? `<div><h3>Planned works nearby</h3><ul class="works">${works}</ul>${C.coordWith ? `<p class="note">Replacement combined with: ${C.coordWith.name}</p>` : ''}</div>` : ''}
    <div class="why">${why}</div>
    <div><h3>Options</h3>
      <table><thead><tr><th>Option</th><th>FV now</th><th>SV now</th><th>EV now</th><th>Lifetime</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">“Now” = cost of doing it today. “Lifetime” = expected discounted integrated cost (FV+SV+EV+risk) when the best policy is followed afterwards.</p>
    </div>
    ${s.action !== 'defer' ? `<div><h3>Integrated value of acting now</h3><div class="big">${eur(s.ivNow)}</div>${delta}<p class="note">Lifetime saving of ${s.action} today versus waiting a year, split into its parts.</p></div>` : ''}
    <div><h3>Advice for this pipe per condition class</h3>
      <div class="policy">${s.policy.map((a, i) => `<div class="${a} ${i + 1 === pr.cond ? 'cur' : ''}" title="${a}">${i + 1}</div>`).join('')}</div>
      <p class="note">Outlined: current (synthetic) class. Colours: green defer, amber reline, red replace.</p>
    </div>`;
}

function whyText(pr, s) {
  const C = s.costs, risk = POF[pr.cond] * C.fail.total;
  if (s.action === 'defer') return `Waiting costs about <b>${eur(risk)}</b> a year in failure risk, less than any intervention is worth today. Re-inspect and decide again later.`;
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
async function load(name) { const r = await fetch('data/' + name); return r.json(); }

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

  map.fitBounds(L.featureGroup(pipes.map(p => p.layer)).getBounds(), { padding: [10, 10] });
  window.dashboard = {
    pipes, P,
    select(id) { const p = pipes.find(x => x.props.id === id); if (p) p.layer.fire('click'); return !!p; },
  };
  $('colorBy').onchange = restyle;
  solveAll();
}

main();
