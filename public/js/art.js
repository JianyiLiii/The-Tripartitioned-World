// Line art: the background dial (a 24-hour bezel around a tilted wireframe
// globe, with a hand that points at the current UTC time) and the logo.
// Everything is hairline strokes; color comes from CSS.

import { svg } from './dom.js';

const TAU = Math.PI * 2;
const SIZE = 1000;
const C = SIZE / 2;

const polar = (r, turn) => [C + r * Math.sin(turn * TAU), C - r * Math.cos(turn * TAU)];

function ticks() {
  const out = [];
  for (let i = 0; i < 96; i++) {           // every 15 minutes of a day
    const turn = i / 96;
    const kind = i % 24 === 0 ? 'cardinal' : i % 4 === 0 ? 'hour' : 'quarter';
    const inner = { cardinal: 446, hour: 462, quarter: 472 }[kind];
    const [x1, y1] = polar(480, turn);
    const [x2, y2] = polar(inner, turn);
    out.push(svg('line', { x1, y1, x2, y2, class: `tick ${kind}` }));
  }
  for (let hour = 0; hour < 24; hour++) {
    const [x, y] = polar(428, hour / 24);
    out.push(svg('text', { x, y, class: 'numeral', 'text-anchor': 'middle', 'dominant-baseline': 'central' },
      String(hour).padStart(2, '0')));
  }
  return out;
}

function globe(radius) {
  const lines = [svg('circle', { cx: C, cy: C, r: radius, class: 'rim' })];
  lines.push(svg('line', { x1: C, y1: C - radius, x2: C, y2: C + radius }));
  for (let k = 1; k <= 5; k++) {             // meridians every 15°
    lines.push(svg('ellipse', { cx: C, cy: C, rx: radius * Math.sin((k * 15 * Math.PI) / 180), ry: radius }));
  }
  for (const lat of [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75]) {
    const phi = (lat * Math.PI) / 180;
    const rx = radius * Math.cos(phi);
    lines.push(svg('ellipse', {
      cx: C, cy: C - radius * Math.sin(phi), rx, ry: rx * 0.16, class: lat === 0 ? 'equator' : null,
    }));
  }
  // Tilted like the Earth's axis.
  return svg('g', { transform: `rotate(-23.44 ${C} ${C})` }, lines);
}

export function meridianDial() {
  const hand = svg('g', { class: 'dial-hand' },
    svg('line', { x1: C, y1: C, x2: C, y2: C - 452 }),
    svg('circle', { cx: C, cy: C - 452, r: 4.5, class: 'hand-tip' }));
  const el = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'dial', 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { cx: C, cy: C, r: 480, class: 'ring' }),
    svg('circle', { cx: C, cy: C, r: 462, class: 'ring' }),
    svg('circle', { cx: C, cy: C, r: 404, class: 'ring dotted' }),
    svg('circle', { cx: C, cy: C, r: 392, class: 'ring' }),
    ticks(),
    globe(330),
    hand,
    svg('circle', { cx: C, cy: C, r: 3, class: 'hub' }));
  const setHand = () => {
    const now = new Date();
    const turn = (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
    hand.setAttribute('transform', `rotate(${(turn * 360).toFixed(2)} ${C} ${C})`);
  };
  setHand();
  setInterval(setHand, 60000);
  return el;
}

// Three circles drawn in ink; a seal-red dot where all three overlap.
export function logo(size = 28) {
  return svg('svg', { viewBox: '0 0 32 32', width: size, height: size, class: 'logo', 'aria-hidden': 'true' },
    svg('circle', { cx: 12, cy: 12.6, r: 7.6 }),
    svg('circle', { cx: 20, cy: 12.6, r: 7.6 }),
    svg('circle', { cx: 16, cy: 19.4, r: 7.6 }),
    svg('circle', { cx: 16, cy: 15, r: 1.7, class: 'logo-seal' }));
}
