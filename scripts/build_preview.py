"""Build a static public preview from an explicit asset allowlist."""
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parents[1]
JS=('dom','brand','locale','i18n','tz','schedule','grid','member-colors','overlap-model','week-picker','demo-data')
CSS=('app','workspace','overlap','week-picker','week-grid-select','weekly-preview')

def build():
    docs=ROOT/'docs'
    for folder in ('assets/js/views','assets/css'):
        (docs/folder).mkdir(parents=True,exist_ok=True)
    shutil.copyfile(ROOT/'preview/index.html',docs/'index.html')
    (docs/'.nojekyll').write_text('',encoding='utf-8')
    shutil.copyfile(ROOT/'public/favicon.svg',docs/'assets/favicon.svg')
    for name in JS:
        shutil.copyfile(ROOT/f'public/js/{name}.js',docs/f'assets/js/{name}.js')
    for name in CSS:
        shutil.copyfile(ROOT/f'public/css/{name}.css',docs/f'assets/css/{name}.css')
    for name in ('preview','ui','time'):
        shutil.copyfile(ROOT/f'preview/{name}.js',docs/f'assets/js/{name}.js')
    shutil.copyfile(ROOT/'preview/preview.css',docs/'assets/css/preview.css')
    demo=(ROOT/'public/js/views/demo.js').read_text(encoding='utf-8')
    demo=demo.replace('export function DemoView() {','export function DemoView({standalone=false}={}) {')
    demo=demo.replace('let weekStart = null, selectedIndex',"let weekStart = standalone ? addDays(mondayForDate(today(tz)), 7) : null, selectedIndex")
    (docs/'assets/js/views/demo.js').write_text(demo,encoding='utf-8')
    print('Static preview built. No API or account modules included.')

if __name__=='__main__': build()
