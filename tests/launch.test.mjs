import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContactWorker } from '../src/contact-worker.mjs';

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const APEX = 'https://lavishtreeservice.com';
const PREVIEW = 'https://lavish-tree-service.3clo1979.workers.dev';
const originalRewriter = globalThis.HTMLRewriter;
// Node-only parser for this controlled static fixture. The genuine HTMLRewriter
// is independently exercised in tests/runtime/launch.mjs under actual workerd.
before(() => { globalThis.HTMLRewriter = class {
  on(selector, handler) { assert.equal(selector, 'meta'); this.handler = handler; return this; }
  transform(response) {
    const handler = this.handler;
    return new Response(new ReadableStream({ async start(controller) {
      const html = (await response.text()).replace(/<meta\b[^>]*>/gi, tag => {
        let removed = false;
        handler.element({ getAttribute: name => name === 'name' ? /\bname=["']([^"']+)["']/i.exec(tag)?.[1] ?? null : null, remove() { removed = true; } });
        return removed ? '' : tag;
      });
      controller.enqueue(new TextEncoder().encode(html)); controller.close();
    } }), response);
  }
}; });
after(() => { if (originalRewriter === undefined) delete globalThis.HTMLRewriter; else globalThis.HTMLRewriter = originalRewriter; });

function fixture(extraHeaders = {}, status = 200) {
  const calls = [];
  const worker = createContactWorker({ fetchImpl() { throw new Error('No provider/network calls permitted in launch tests'); } });
  const env = { ASSETS: { async fetch(request) {
    calls.push(request);
    return new Response(request.method === 'HEAD' || [204, 304].includes(status) ? null : HTML, { status, headers: {
      'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'public, max-age=0, must-revalidate', 'Content-Length': String(new TextEncoder().encode(HTML).length),
      ETag: '"preview-source-etag"', 'Last-Modified': 'Fri, 23 Oct 2026 10:00:00 GMT', 'Accept-Ranges': 'bytes',
      'Content-MD5': 'old-md5', Digest: 'old-digest', 'Content-Digest': 'old-content-digest', 'Repr-Digest': 'old-repr-digest',
      ...extraHeaders,
    } });
  } } };
  return { worker, env, calls };
}

test('only exact HTTPS apex HTML becomes indexable while form and visual source stay unchanged', async () => {
  const f = fixture(); const response = await f.worker.fetch(new Request(APEX + '/'), f.env);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), null);
  assert.ok(!/<meta\b[^>]*name=["']robots["']/i.test(html));
  assert.equal(html, HTML.replace('<meta name="robots" content="noindex,nofollow">', ''));
  assert.ok(html.includes('href="https://lavishtreeservice.com/"'));
  assert.ok(html.includes('<form id="quote-form"'));
  assert.ok(html.includes('<script type="module" src="contact.js"></script>'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const header of ['content-length', 'etag', 'last-modified', 'content-md5', 'digest', 'content-digest', 'repr-digest', 'accept-ranges', 'content-range']) assert.equal(response.headers.get(header), null, header);
});

test('preview and every lookalike/other origin keep original noindex HTML and headers', async () => {
  for (const origin of [PREVIEW, PREVIEW.replace('https:', 'http:'), 'https://lavishtreeservice.com.evil.example', 'https://other.workers.dev', 'https://lavishtreeservice.com:8443']) {
    const f = fixture(); const response = await f.worker.fetch(new Request(origin + '/'), f.env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), HTML);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('etag'), '"preview-source-etag"');
    assert.equal(response.headers.get('location'), null);
  }
});

test('page requests strip source validators and ranges and request identity encoding before asset fetch', async () => {
  for (const path of ['/', '/index.html', '/tree-work']) {
    const f = fixture();
    const response = await f.worker.fetch(new Request(APEX + path, { headers: {
      'If-None-Match': '"preview-source-etag"', 'If-Modified-Since': 'yesterday', 'If-Match': 'old',
      'If-Unmodified-Since': 'yesterday', Range: 'bytes=0-99', 'If-Range': 'old', 'Accept-Encoding': 'gzip, br',
    } }), f.env);
    await response.text();
    for (const header of ['if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since', 'range', 'if-range']) assert.equal(f.calls[0].headers.get(header), null, header);
    assert.equal(f.calls[0].headers.get('accept-encoding'), 'identity');
  }
});

test('HEAD matches public HTML headers without a body or stale source length', async () => {
  const f = fixture(); const response = await f.worker.fetch(new Request(APEX + '/', { method: 'HEAD' }), f.env);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('x-robots-tag'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('etag'), null);
});

test('unexpected encoded or non-success HTML stays fail-closed rather than indexed incorrectly', async () => {
  for (const [headers, status] of [[{ 'Content-Encoding': 'gzip' }, 200], [{}, 404], [{}, 304]]) {
    const f = fixture(headers, status); const response = await f.worker.fetch(new Request(APEX + '/'), f.env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    if (status !== 304) assert.equal(await response.text(), HTML);
  }
});

test('binary assets retain bytes, validators and caching while security headers are explicit', async () => {
  const f = fixture(); const bytes = new Uint8Array([0, 1, 255]);
  f.env.ASSETS.fetch = async request => { f.calls.push(request); return new Response(bytes, { headers: {
    'Content-Type': 'image/webp', 'Content-Length': '3', ETag: '"asset"', 'Cache-Control': 'public, max-age=3600',
  } }); };
  for (const origin of [APEX, PREVIEW]) {
    const response = await f.worker.fetch(new Request(origin + '/assets/photo.webp', { headers: { 'If-None-Match': '"asset"' } }), f.env);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('etag'), '"asset"');
    assert.equal(response.headers.get('content-length'), '3');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-robots-tag'), origin === APEX ? null : 'noindex, nofollow');
  }
});

test('apex robots permits public crawling, excludes API, and links a single-homepage sitemap', async () => {
  const f = fixture();
  const robots = await f.worker.fetch(new Request(APEX + '/robots.txt?cache=test'), f.env);
  assert.equal(await robots.text(), 'User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://lavishtreeservice.com/sitemap.xml\n');
  assert.equal(robots.headers.get('x-robots-tag'), null);
  const sitemap = await f.worker.fetch(new Request(APEX + '/sitemap.xml'), f.env);
  const xml = await sitemap.text();
  assert.equal(sitemap.status, 200); assert.match(sitemap.headers.get('content-type'), /^application\/xml/);
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), [APEX + '/']);
  assert.equal(f.calls.length, 0);
});

test('preview, lookalikes and nonstandard ports never get an allow robots or public sitemap', async () => {
  for (const origin of [PREVIEW, 'https://lavishtreeservice.com.evil.example', 'https://lavishtreeservice.com:8443']) {
    const f = fixture();
    const robots = await f.worker.fetch(new Request(origin + '/robots.txt'), f.env);
    assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
    assert.equal(robots.headers.get('x-robots-tag'), 'noindex, nofollow');
    const sitemap = await f.worker.fetch(new Request(origin + '/sitemap.xml'), f.env);
    assert.equal(sitemap.status, 404); assert.equal(sitemap.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(f.calls.length, 0);
  }
});

test('robots/sitemap support HEAD and reject mutating methods without asset or email calls', async () => {
  const f = fixture();
  for (const path of ['/robots.txt', '/sitemap.xml']) {
    const head = await f.worker.fetch(new Request(APEX + path, { method: 'HEAD' }), f.env);
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const post = await f.worker.fetch(new Request(APEX + path, { method: 'POST' }), f.env);
    assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET, HEAD');
  }
  assert.equal(f.calls.length, 0);
});

test('exact HTTP apex is upgraded to HTTPS with path/query preserved; preview is never upgraded', async () => {
  const f = fixture();
  for (const path of ['/', '/assets/photo.webp?v=3', '/api/contact?source=http', '/robots.txt']) {
    const response = await f.worker.fetch(new Request('http://lavishtreeservice.com' + path), f.env);
    assert.equal(response.status, 308); assert.equal(response.headers.get('location'), APEX + path);
  }
  assert.equal(f.calls.length, 0);
});

test('host handling does not change API config shape or expose secret values', async () => {
  const f = fixture();
  for (const origin of [APEX, PREVIEW]) {
    const response = await f.worker.fetch(new Request(origin + '/api/contact-config'), { CONTACT_ALLOWED_ORIGINS: APEX });
    assert.deepEqual(await response.json(), { enabled: false, recipient: 'sales@lavishtreeservice.com' });
  }
  assert.equal(f.calls.length, 0);
});

test('Worker-generated public HTML keeps every existing non-robot security header exactly', async () => {
  const f = fixture();
  const response = await f.worker.fetch(new Request(APEX + '/'), f.env);
  await response.text();
  const raw = readFileSync(new URL('../dist/_headers', import.meta.url), 'utf8');
  for (const match of raw.matchAll(/^  ([^:]+): (.+)$/gm)) {
    if (match[1].toLowerCase() !== 'x-robots-tag') assert.equal(response.headers.get(match[1]), match[2], match[1]);
  }
});

test('staged config runs host handling first without changing bindings, vars, secrets or rate limits', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.name, 'lavish-tree-service'); assert.equal(config.assets.directory, './dist');
  assert.equal(config.routes, undefined); assert.equal(config.route, undefined);
  assert.equal(config.vars.RESEND_API_KEY, undefined); assert.equal(config.vars.TURNSTILE_SECRET_KEY, undefined);
  assert.deepEqual(config.ratelimits[0].simple, { limit: 5, period: 60 });
  const sourceHeaders = readFileSync(new URL('../dist/_headers', import.meta.url), 'utf8');
  assert.match(sourceHeaders, /X-Robots-Tag: noindex, nofollow/);
  assert.match(HTML, /name="robots" content="noindex,nofollow"/);
});
