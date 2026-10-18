import { h } from './dom.js';
import { brandLink } from './brand.js';
import { DemoView } from './views/demo.js';
import { getLanguage, setLanguage } from './locale.js';

const root = document.getElementById('preview-root');
const repo = 'https://github.com/JianyiLiii/The-Tripartitioned-World';
let view;
function render() {
  view?.destroy();
  const zh = getLanguage() === 'zh';
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  document.title = zh ? '三等分的世界 — 公开演示' : 'The Tripartitioned World — Preview';
  const brand = brandLink();
  brand.href = '#preview-root';
  const language = h('button', {class:'btn btn-sm',type:'button',onclick:() => {
    setLanguage(zh ? 'en' : 'zh'); render();
  }}, zh ? 'English' : '中文');
  view = DemoView({standalone:true});
  view.el.querySelector('.back-link')?.remove();
  root.replaceChildren(
    h('header',{class:'public-header'},brand,h('nav',{'aria-label':'Preview links'},language,
      h('a',{class:'btn btn-sm',href:repo,rel:'noopener noreferrer'},'GitHub'))),
    h('main',{},
      h('section',{class:'public-intro'},h('span',{class:'public-label'},zh ? '公开演示 · 无需登录' : 'PUBLIC PREVIEW · NO SIGN-IN'),
        h('h1',{},zh ? '三等分的世界' : 'The Tripartitioned World'),
        h('p',{class:'public-subtitle'},zh ? '协调不同时区的空闲时间，找到适合所有人的会议时间。' : 'Coordinate availability across time zones and find a meeting time for everyone.'),
        h('p',{},zh ? '切换时区、会议时长和空闲情况。每人一种颜色，橙色表示所有人都有空。' : 'Explore time zones, meeting lengths, and availability. Each person has a color. Orange means everyone is free.'),
        h('p',{class:'public-disclosure'},zh ? '此处只有匿名示例。操作不会创建真实会议，时间以当前设备为准。' : 'Anonymous sample data only. Nothing here creates a real meeting. Dates use your device clock.')),
      view.el),
    h('footer',{class:'public-footer'},h('span',{},'Created and primarily maintained by JianyiLiii.'),
      h('a',{href:repo+'/blob/main/LICENSE',rel:'noopener noreferrer'},'MIT License')));
}
render();
window.addEventListener('pagehide',()=>view?.destroy(),{once:true});
