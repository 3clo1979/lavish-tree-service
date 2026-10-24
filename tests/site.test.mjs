import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
const css = readFileSync(resolve(root, 'dist/style.css'), 'utf8');
const js = readFileSync(resolve(root, 'dist/app.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
test('unique element IDs and working same-page anchors', () => {
  assert.equal(ids.length, new Set(ids).size);
  for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(m[1]), m[1]);
});
test('all local HTML and CSS files exist', () => {
  const files = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(s => !/^(?:https?:|tel:|mailto:)/.test(s));
  files.push(...[...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]));
  for (const f of files) assert.ok(existsSync(resolve(root, 'dist', f)), f);
});
test('responsive image sources exist', () => {
  for (const m of html.matchAll(/srcset="([^"]+)"/g)) for (const part of m[1].split(',')) assert.ok(existsSync(resolve(root, 'dist', part.trim().split(' ')[0])));
});
test('only verified business phone is used for calls', () => {
  const phones = [...html.matchAll(/href="tel:([^"]+)"/g)].map(m => m[1]);
  assert.ok(phones.length >= 7); assert.deepEqual([...new Set(phones)], ['+14404527240']);
});
test('Facebook work connections appear throughout page without embeds', () => {
  assert.ok(html.split('https://www.facebook.com/lavishtreeservice/').length >= 6);
  assert.ok(!html.includes('<iframe')); assert.ok(!html.includes('facebook.com/plugins'));
  assert.ok(html.includes('class="nav-facebook"'));
});
test('real Facebook media is self-hosted and provenance exists', () => {
  assert.ok(html.includes('assets/facebook-crane-removal.webp'));
  assert.ok(html.includes('assets/facebook-bucket-crew.webp'));
  assert.ok(existsSync(resolve(root, 'ASSETS.md')));
});
test('preview-only form is clear and safe when JS does not run', () => {
  assert.ok(html.includes('Design preview only.'));
  assert.ok(html.includes('Nothing is sent or stored.'));
  assert.match(html, /class="button form-submit" type="submit" disabled/);
  assert.ok(js.includes('event.preventDefault()'));
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(js));
  assert.ok(js.includes('.textContent = ['));
});
test('preview remains unindexed and has no form delivery', () => {
  assert.ok(html.includes('content="noindex,nofollow"'));
  const headers = readFileSync(resolve(root, 'dist/_headers'), 'utf8');
  assert.ok(headers.includes('X-Robots-Tag: noindex, nofollow'));
  assert.ok(headers.includes("form-action 'none'"));
});
test('gallery supports dismissal, focus return, keyboard and repeated views', () => {
  for (const text of ['showModal()', "'close'", 'galleryTrigger?.focus', "'ArrowLeft'", "'ArrowRight'", 'if (!dialog.open)', "'Escape'"]) assert.ok(js.includes(text), text);
});
test('layout supports narrow widths and reduced motion', () => {
  assert.ok(css.includes('@media(max-width:360px)'));
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
  assert.ok(css.includes('safe-area-inset-bottom'));
});
test('Camyta attribution preserved and no fabricated credentials added', () => {
  assert.ok(html.includes('https://camytagroup.com')); assert.ok(html.includes('Camyta Marketing Group'));
  assert.ok(!/fully insured|licensed arborist|certified arborist|five.star|5.star|guaranteed response/i.test(html));
});
test('deployment identity unchanged', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.name, 'lavish-tree-service'); assert.equal(config.assets.directory, './dist');
  assert.equal(config.routes, undefined); assert.equal(config.route, undefined);
});

test('section, gallery and service labels use semantic SVG icons, not numbering', () => {
  assert.ok(!html.includes('service-number'));
  assert.ok(!/0[1-4] (?:—|\/)/.test(html));
  for (const name of ['chainsaw', 'tree', 'removal', 'pruning', 'stump', 'storm']) assert.ok(html.includes(`id="i-${name}"`), name);
  for (const m of html.matchAll(/<svg class="icon service-icon"[^>]*>/g)) assert.ok(m[0].includes('aria-hidden="true"'));
  assert.equal([...html.matchAll(/class="icon service-icon"/g)].length, 4);
});
test('meaningful telephone numbers and gallery position counts remain intact', () => {
  assert.ok(html.includes('440-452-7240'));
  assert.ok(html.includes('id="gallery-count" aria-live="polite">1 / 3'));
  assert.ok(js.includes('${photoIndex + 1} / ${photos.length}'));
});
