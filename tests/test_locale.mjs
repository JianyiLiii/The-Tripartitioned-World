import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getLanguage, setLanguage, tr, ZH } from '../public/js/locale.js';
import { t, weekday, monthDay } from '../public/js/i18n.js';
import { ApiError, errorText } from '../public/js/api.js';

test('language preference persists and translations preserve interpolated user content', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(getLanguage(), 'en');
  setLanguage('zh');
  assert.equal(values.get('ttw.language'), 'zh');
  assert.equal(tr('The Tripartitioned World'), '三等分的世界');
  assert.equal(t('item.by', { name: 'Weekly availability' }), '组织者：Weekly availability');
  assert.equal(weekday(0), '周一');
  assert.equal(monthDay(10, 18), '10月18日');
  assert.match(errorText(new ApiError(409, 'name_in_use')), /用户名已存在/);
  assert.match(errorText(new ApiError(409, 'user_limit_reached', { limit: 100, remaining: 2 })), /100.*2.*本次未添加/);
  assert.match(errorText(new ApiError(507, 'storage_full')), /存储空间已满/);
  setLanguage('en');
  assert.equal(tr('The Tripartitioned World'), 'The Tripartitioned World');
  assert.equal(t('item.by', { name: '三等分的世界' }), 'Organized by 三等分的世界');
  assert.match(errorText(new ApiError(409, 'user_limit_reached', { limit: 100, remaining: 0 })), /100.*0/);
  delete globalThis.localStorage;
  assert.equal(getLanguage(), 'en');
});

test('the existing interface catalog has Chinese translations', () => {
  const source = readFileSync(new URL('../public/js/i18n.js', import.meta.url), 'utf8');
  for (const [, key, value] of source.matchAll(/^\s*'([^']+)': '([^']*)',/gm)) {
    if (!/[a-zA-Z]{2}/.test(value.replace(/\{\w+\}/g, ''))) continue;
    assert.ok(ZH[value], `Missing translation: ${key}: ${value}`);
  }
});
