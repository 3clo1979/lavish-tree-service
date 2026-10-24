# Lavish domain launch — staged only

This copy is prepared for a separately authorized domain launch. It has not been published and does not change DNS, custom-domain bindings, mailbox records, accounts, plans, secrets, or provider settings.

## Intended behavior

- Exact `www.lavishtreeservice.com` redirects permanently (308) to `https://lavishtreeservice.com`, retaining path and query. Exact `http://lavishtreeservice.com` also redirects to HTTPS. The HTTP-apex redirect is an additional staged action to include in launch approval.
- Only origin `https://lavishtreeservice.com` gets indexable HTML, an allow-crawling `robots.txt` (excluding `/api/`), and a sitemap listing the homepage once.
- The Workers preview and all unrelated/lookalike origins remain noindex and robots-disallowed. They receive no public sitemap. Host/forwarded-host headers cannot select the public origin.
- Original `dist/index.html`, `dist/_headers`, and `dist/robots.txt` remain noindex/disallowed as a fail-safe. No layout, photos, form behavior, business details, canonical URL or Open Graph URL are changed.
- Contact APIs, recipient, secrets, public variables, rate-limit settings and delivery handling remain unchanged. The temporary verification endpoint remains removed.

## Implementation

`assets.run_worker_first` becomes `true`, so canonical and host-aware behavior runs before assets. Existing custom-domain configuration is not added to Wrangler. This also routes asset requests through the Worker; confirm the existing free-plan request allowance before launch. No upgrade or paid usage is enabled here.

The built-in streaming `HTMLRewriter` removes the robots meta element on successful public HTML responses only. The Worker explicitly preserves the current security headers because generated responses cannot rely solely on `_headers` rules.

For public HTML candidates, source conditional/range headers are removed and identity encoding is requested from the asset service. Transformed responses discard stale Content-Length, ETag, Last-Modified, integrity and range headers and use `Cache-Control: no-store`; binary assets retain their bytes, cache headers and validators. HEAD receives matching public headers without a body or stale length. Unexpected encoded HTML and non-success HTML fail closed with noindex rather than being transformed incorrectly.

## Validation

- `npm run check` runs all mocked Node tests, including hostname isolation, path/query redirects, crawler routes, header/validator behavior and existing form tests.
- `workerd test -I <directory-containing-workerd-package> tests/runtime/config.capnp` runs two network-isolated services: native HTMLRewriter/host behavior, and the original contact integration using local provider mocks. No real emails are sent.
- Node's launch test includes a small fixture-only HTMLRewriter substitute. Actual parsing is verified separately with genuine workerd and the complete site HTML.

After separately authorized domain configuration/publication, verify both custom hosts, TLS, redirects, exact apex HTML/meta/headers, robots, sitemap, preview noindex, static assets and desktop/mobile form readiness. If apex HTML still carries noindex, inspect unexpected source encoding before declaring launch complete. Do not send another real email without authorization.

Official implementation references: [Workers asset headers](https://developers.cloudflare.com/workers/static-assets/headers/), [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/), [safe HTML transform header handling](https://developers.cloudflare.com/cloudflare-one/traffic-controls/integrate-workers/worker-templates/watermark/).
