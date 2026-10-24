# Verification — October 24, 2026

## Automated checks

- `npm run check`: JavaScript syntax and 12/12 static integrity tests passed against the final site files.
- Local asset paths, responsive sources, anchors/IDs, verified telephone links, Facebook connections, preview-only form boundary, gallery controls, reduced-motion CSS, and unchanged Worker identity are covered.
- All used job images and fonts are self-hosted. Photo provenance is in `ASSETS.md`.

## Deployed browser verification

Verified live at https://lavish-tree-service.3clo1979.workers.dev/ after commit `51746923254fa5484064c05fdaa7337591122d34`.

- The exact Cloudflare Workers check succeeded at 14:08:04 UTC. Build `b73d4c78-ff4d-434c-b66f-13c1b31a2d78`, deployed version `1b3c317c-254f-4c35-9a33-d04f3996e365`.
- Desktop at 1180 CSS px; narrow Chromium layouts at 390 and 325 CSS px. No horizontal overflow; all job photos, logos, and fonts rendered. Narrow checks used native window resizing and browser zoom, not iOS emulation.
- Inspected the opening photograph, emergency strip, project gallery, services, large contact number, and persistent mobile call/emergency actions.
- Gallery: open, next/previous, repeated opening, close button, Escape, focus restoration, and scroll-unlock passed.
- Mobile navigation: open, Escape dismissal, repeated open, contact-anchor dismissal, Facebook work link visibility, and Back/Forward dismissal passed.
- Form: empty required fields rejected; a test-only request generated a local summary explicitly marked **not sent**. Repeated submission updated it. HTML-like test text remained literal rather than being inserted as markup. No request was sent or stored.
- Telephone and email destinations match the publicly verified business information. Calls and emails were not initiated. Facebook destination was independently verified as the business page; no login-gated embed is used.

## Limits and launch boundary

- These are Chromium desktop/responsive checks, not physical iPhone/Android tests or an exhaustive accessibility audit.
- Local browser/server attempts were blocked by executor setup limitations; rendered checks were completed on the authorized existing HTTPS preview instead.
- The request-planning form remains preview-only. A real delivery backend is not configured or implied.
- No custom domain, Namecheap DNS, email routing, or backend configuration was changed. The existing live custom domain remains outside this preview deployment.
- Preview indexing blocks are preserved. Domain cutover, production indexability, form delivery, and cancellation of legacy hosting still require separate approval.
