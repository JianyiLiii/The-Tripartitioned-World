import { h } from './dom.js';
import { tr, getLanguage } from './locale.js';

export const PRODUCT_NAME = 'The Tripartitioned World';

export function brandLink(className = '') {
  return h('a', { class: `brand product-brand ${className}`, href: '#/', 'aria-label': `${tr(PRODUCT_NAME)} — ${tr('Overview')}` },
    h('span', { class: 'brand-symbol', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('span', { class: 'brand-name' }, getLanguage() === 'zh' ? h('span', {}, tr(PRODUCT_NAME)) : [h('span', {}, 'The Tripartitioned'), h('span', {}, 'World')]));
}
