// Minimal presentation helpers. Account, network, and scheduling actions are
// deliberately not part of the standalone preview's dependency graph.
import { h } from './dom.js';
import { memberColor } from './member-colors.js';
import { zonedParts, hm } from './tz.js';
import { weekday } from './i18n.js';
export const memberClass=index=>index>=0&&index<8?`mc-${index}`:'mc-x';
export function avatar(member,{size='md'}={}) {
  return h('span',{class:`avatar avatar-${size} ${memberClass(member.index)}`,
    style:{'--mc':memberColor(member.index)},title:member.name,'aria-hidden':'true'},String(member.index+1));
}
export function localRange(startMs,endMs,tz) {
  const a=zonedParts(startMs,tz),b=zonedParts(endMs-60000,tz);
  const from=hm(a.hour*60+a.minute),to=hm(b.hour*60+b.minute+1);
  return a.weekday===b.weekday&&endMs-startMs<86400000
    ?`${weekday(a.weekday)} ${from}–${to}`:`${weekday(a.weekday)} ${from} – ${weekday(b.weekday)} ${to}`;
}
