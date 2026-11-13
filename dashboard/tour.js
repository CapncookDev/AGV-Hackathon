// Guided tour of the dashboard: a spotlight on one part at a time with a short explanation.
// Starts automatically with ?tour=1 (the pitch deck links here) and from the "Tour" button.

const $ = s => document.querySelector(s);
const topPipe = () => {
  const ps = (window.dashboard?.pipes || []).filter(p => p.sol && p.sol.action !== 'defer');
  return ps.sort((a, b) => b.sol.ivNow - a.sol.ivNow)[0];
};
const openPanel = sel => { const d = $(sel); if (d && d.tagName === 'DETAILS') d.open = true; };

const STEPS = [
  { title: 'Sewer Renewal Dashboard',
    text: 'Every sewer section in Bos en Lommer gets one advice: <b class="d">defer</b>, <b class="r">reline</b> or <b class="x">replace</b>. Money, disruption and carbon are weighed together in euros, with the risk of waiting. This tour takes about a minute.' },
  { target: '.view', title: 'The neighbourhood in 3D',
    text: '1,804 sewer sections from the Waternet knowledge graph, under real buildings, trees and streets. The layered sides are the actual soil from TNO GeoTOP: made ground, peat, clay, sand. Drag to turn, scroll to zoom.' },
  { target: '#summary', title: 'The whole network at a glance',
    text: 'How many sections to defer, reline or replace now, what that costs (FV), the disruption (SV), the environmental cost (EV, MKI) and the CO₂ of the works.' },
  { target: '#filterBar', title: 'Filter by advice',
    text: 'Switch groups on or off. Turn off <b class="d">defer</b> to see only the sections where acting now pays off.' },
  { target: '#pipeCard', before: () => { const p = topPipe(); if (p) window.dashboard.select(p.props.id); },
    title: 'One section, fully explained',
    text: 'Clicking a pipe opens its card: current state (age, material, depth, synthetic condition, soil underneath) and the advice with the reason why. This is the section with the highest value of acting now.' },
  { target: '#pipeCard section:nth-of-type(3)', scrollCard: true, title: 'Money, disruption and carbon',
    text: '<b>FV</b> = what Waternet pays · <b>SV</b> = road closure and trees · <b>EV</b> = environmental cost (MKI), plus CO₂ in tonnes and the pipe’s remaining capacity. “Value of acting now” is what doing it today saves over the pipe’s life.' },
  { target: '#pipeCard section:nth-of-type(4)', scrollCard: true, title: 'When does the street open?',
    text: 'Planned works from the city (Stadsregie, NDW, WIOR) next to the year this model would open the street. Overlapping works can be combined: dig once.' },
  { target: '#rankPanel', before: () => openPanel('#rankPanel'), title: 'Ranking within a budget',
    text: 'All interventions ranked by value of acting now. Set a yearly budget to see which ones fit. Click a row to jump to that pipe.' },
  { target: '#viewSwitch', title: '3D island or 2D map',
    text: 'The 2D map adds layers such as planned street works, trees and addresses. In the side panel you can open the IFC 4.3 model of the network with its soil layers, and the BIM model of the pumping station.' },
  { target: '#limitsPanel', before: () => openPanel('#limitsPanel'), title: 'What we know, and what we don’t',
    text: 'Both cost sources side by side, and how much of the advice an age rule already explains. Under <b>Assumptions</b> every input shows its source and whether it is sourced, estimated or assumed.' },
  { title: 'Your turn',
    text: 'Click around: pipes, filters, the 2D map, the IFC model. Restart this tour any time with the <b>Tour</b> button.',
    end: true },
];

let i = 0, root, spot, card;

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  spot = root.querySelector('.tour-spot');
  card = root.querySelector('.tour-card');
  window.addEventListener('resize', place);
  document.addEventListener('keydown', e => {
    if (root.hidden) return;
    if (e.key === 'ArrowRight') go(i + 1);
    if (e.key === 'ArrowLeft') go(i - 1);
    if (e.key === 'Escape') stop();
  });
}

function place() {
  const st = STEPS[i];
  const el = st.target && $(st.target);
  const pad = 8;
  if (!el || el.offsetParent === null) {
    spot.style.cssText = 'left:50%;top:50%;width:0;height:0';
    card.style.left = `${Math.max(16, (innerWidth - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(16, (innerHeight - card.offsetHeight) / 2)}px`;
    return;
  }
  const r = el.getBoundingClientRect();
  spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + 2 * pad}px;height:${r.height + 2 * pad}px`;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  // prefer right of the target, then left, then below, then above; always inside the viewport
  let x = r.right + 16, y = r.top;
  if (x + cw > innerWidth - 16) x = r.left - cw - 16;
  if (x < 16) { x = Math.min(Math.max(16, r.left), innerWidth - cw - 16); y = r.bottom + 16; }
  if (y + ch > innerHeight - 16) y = Math.max(16, r.top - ch - 16);
  if (y + ch > innerHeight - 16) y = innerHeight - ch - 16;
  card.style.left = `${x}px`;
  card.style.top = `${Math.max(16, y)}px`;
}

function go(n) {
  if (n < 0 || n >= STEPS.length) return;
  i = n;
  const st = STEPS[i];
  st.before?.();
  card.innerHTML = `
    <div class="tour-step">Step ${i + 1} of ${STEPS.length}</div>
    <h3>${st.title}</h3>
    <p>${st.text}</p>
    <div class="tour-nav">
      <button type="button" class="tour-skip">${st.end ? 'Close' : 'Skip tour'}</button>
      <span class="tour-dots">${STEPS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</span>
      <span>
        <button type="button" class="tour-prev" ${i === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" class="tour-next">${st.end ? 'Explore the dashboard' : 'Next'}</button>
      </span>
    </div>`;
  card.querySelector('.tour-skip').onclick = stop;
  card.querySelector('.tour-prev').onclick = () => go(i - 1);
  const nx = card.querySelector('button.tour-next');
  if (nx) nx.onclick = () => (st.end ? stop() : go(i + 1));
  const el = st.target && $(st.target);
  if (el) el.scrollIntoView({ block: st.scrollCard ? 'start' : 'nearest', behavior: 'instant' });
  // wait a frame so opened panels and the card have their final size
  requestAnimationFrame(() => requestAnimationFrame(place));
}

export function startTour() {
  ensureDom();
  root.hidden = false;
  go(0);
}

function stop() {
  root.hidden = true;
}

// start when the data is ready (every pipe solved), if asked for in the URL
function whenReady(fn, tries = 0) {
  const ps = window.dashboard?.pipes;
  if (ps && ps.length && ps.every(p => p.sol)) return setTimeout(fn, 600);
  if (tries < 200) setTimeout(() => whenReady(fn, tries + 1), 150);
}
document.getElementById('tourBtn')?.addEventListener('click', () => whenReady(startTour));
if (new URLSearchParams(location.search).has('tour')) whenReady(startTour);
