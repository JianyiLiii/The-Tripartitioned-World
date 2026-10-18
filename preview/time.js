// Public demo clock: device time only. No server, API, session, or credentials.
import { zonedParts } from './tz.js';
export const now = () => Date.now();
export const clockReady = () => true;
export function today(tz) {
  const {year,month,day}=zonedParts(now(),tz);
  return {year,month,day};
}
export function subscribeClock(listener) {
  const timer=setInterval(()=>{if(!document.hidden)listener();},30000);
  return ()=>clearInterval(timer);
}
