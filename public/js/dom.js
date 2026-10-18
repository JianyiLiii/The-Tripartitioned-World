// Tiny DOM helpers. All text goes in through text nodes, never innerHTML,
// so names and titles typed by users can't inject markup.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value != null) el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function setProps(el, props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      if (key in el) el[key] = true;
      else el.setAttribute(key, '');
    } else el.setAttribute(key, value);
  }
}

/** Replace an element's children; like replaceChildren, but skips null/false. */
export function fill(el, ...children) {
  el.textContent = '';
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Stroke icons on a 24px grid. Dots are zero-length segments with round caps.
const ICONS = {
  grid: ['M3 3h7v7H3Z', 'M14 3h7v7h-7Z', 'M3 14h7v7H3Z', 'M14 14h7v7h-7Z'],
  folder: ['M3 7V5h6l2 2h10v13H3Z'],
  layers: ['m12 3 10 5-10 5L2 8Z', 'm2 12 10 5 10-5', 'm2 16 10 5 10-5'],
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  chevronDown: 'm6 9 6 6 6-6',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6M14 11v6'],
  pencil: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
  globe: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M2 12h20',
    'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z'],
  clock: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M12 6v6l4 2'],
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  logOut: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  sun: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41'],
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z',
  monitor: ['M3 4h18v12H3Z', 'M8 20h8M12 16v4'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14', 'm21 21-4.35-4.35'],
  calendar: ['M3 5h18v16H3Z', 'M16 3v4M8 3v4M3 10h18'],
  copy: ['M8 8h12v12H8Z', 'M4 16V4h12'],
  pin: ['M12 21s-7-6.13-7-11a7 7 0 0 1 14 0c0 4.87-7 11-7 11Z', 'M12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5'],
  star: 'm12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z',
  info: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M12 16v-4M12 8h.01'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  video: ['m22 8-6 4 6 4V8Z', 'M3 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z'],
  calendarPlus: ['M3 5h18v16H3Z', 'M16 3v4M8 3v4M3 10h18', 'M12 13v5M9.5 15.5h5'],
  sparkles: ['M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z', 'M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z'],
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  repeat: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
};

export function icon(name, size = 16) {
  const el = svg('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': name === 'more' ? 2.6 : 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', class: 'icon',
  });
  for (const d of [].concat(ICONS[name])) el.append(svg('path', { d }));
  return el;
}
