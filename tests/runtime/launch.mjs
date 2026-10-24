import worker from './contact-worker.mjs';
import html from './home.html';

const apex = 'https://lavishtreeservice.com';
const preview = 'https://lavish-tree-service.3clo1979.workers.dev';
function check(condition, label) { if (!condition) throw new Error(label); }

export default {
  async test() {
    const requests = [];
    const env = { ASSETS: { async fetch(request) {
      requests.push(request);
      return new Response(request.method === 'HEAD' ? null : html, { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow',
        'Content-Length': String(new TextEncoder().encode(html).length), ETag: '"source"',
      } });
    } } };
    const live = await worker.fetch(new Request(apex + '/', { headers: { 'If-None-Match': '"source"', Range: 'bytes=0-99' } }), env);
    const liveHtml = await live.text();
    check(live.status === 200, 'Public HTML status');
    check(!liveHtml.includes('name="robots"'), 'Native HTMLRewriter removes robots metadata');
    check(liveHtml === html.replace('<meta name="robots" content="noindex,nofollow">', ''), 'Only robots metadata changes');
    check(!live.headers.has('x-robots-tag') && !live.headers.has('etag') && !live.headers.has('content-length'), 'Public transform headers');
    check(live.headers.get('content-security-policy').includes("frame-ancestors 'none'"), 'Security headers applied in Worker');
    check(!requests[0].headers.has('if-none-match') && !requests[0].headers.has('range'), 'Source conditional headers stripped');
    check(requests[0].headers.get('accept-encoding') === 'identity', 'Uncompressed source requested');

    const held = await worker.fetch(new Request(preview + '/'), env);
    check(await held.text() === html, 'Preview body unchanged');
    check(held.headers.get('x-robots-tag') === 'noindex, nofollow', 'Preview remains noindex');

    for (const source of ['https://www.lavishtreeservice.com', 'http://www.lavishtreeservice.com', 'http://lavishtreeservice.com']) {
      const redirect = await worker.fetch(new Request(source + '/work?source=runtime'), env);
      check(redirect.status === 308 && redirect.headers.get('location') === apex + '/work?source=runtime', 'Canonical redirect preserves path/query');
    }
    const before = requests.length;
    const robots = await worker.fetch(new Request(apex + '/robots.txt'), env);
    check((await robots.text()).includes('Allow: /\n'), 'Public robots allows');
    const blockedRobots = await worker.fetch(new Request(preview + '/robots.txt'), env);
    check(await blockedRobots.text() === 'User-agent: *\nDisallow: /\n', 'Preview robots blocks');
    const sitemap = await worker.fetch(new Request(apex + '/sitemap.xml'), env);
    check((await sitemap.text()).split('<loc>').length === 2, 'Sitemap has one homepage');
    const blockedSitemap = await worker.fetch(new Request(preview + '/sitemap.xml'), env);
    check(blockedSitemap.status === 404, 'Preview has no public sitemap');
    check(requests.length === before, 'Crawler endpoints do not read assets or providers');
    const head = await worker.fetch(new Request(apex + '/', { method: 'HEAD' }), env);
    check(await head.text() === '' && !head.headers.has('content-length'), 'HEAD has no stale length/body');
    console.log('PASS: native HTMLRewriter, canonical redirects, preview isolation and crawler endpoints; local assets only');
  },
};
