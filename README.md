# Lavish Tree Service — industrial redesign

A short, photography-led design preview for Lavish Tree Service. The October 24 redesign replaces the earlier cream/forest split layout with charcoal, white, safety orange, oversized condensed type, and authentic tree work. It is deliberately distinct from the Best Buds lawn-care site.

## Experience

- Large crane-removal introduction using an authentic Lavish Facebook photograph.
- Prominent general contact and 24-hour emergency click-to-call actions: **440-452-7240**.
- Persistent call / emergency actions on phones, compact mobile navigation, and visible Facebook work links in navigation, work, contact, and footer.
- Three original project photos with accessible, keyboard-operated enlargement and previous/next controls.
- Compact services and large contact details, including the publicly verified sales@lavishtreeservice.com address.
- An always-open contact form progressively enables delivery to **sales@lavishtreeservice.com** only when the server confirms every prerequisite. Until then it remains an explicitly labeled local request preview; nothing is submitted. Without JavaScript, use the prominent call/email links.
- Self-hosted images and fonts; no analytics or Facebook embeds. Verified live delivery uses Cloudflare Turnstile and a fixed-recipient Resend endpoint; no credentials reach browser assets.

See `ASSETS.md` for photo provenance. No synthetic project imagery or invented credentials are used. Availability language is sourced from both the existing public website and matching Facebook page; no response-time guarantee is added.

## Run and validate

`dist/` contains the deployable static output. `src/contact-worker.mjs` handles only contact API routes, and `dist/contact.js` must remain byte-identical to the tested `src/contact-client.mjs`. The integrity tests enforce that copy.

```sh
npm run check
python -m http.server 8080 --directory dist
```

`npm run check` checks JavaScript syntax and runs static integrity, mocked contact API and client integration tests. It is not a substitute for rendered desktop/mobile and interaction QA. See `QA.md` for the actual verification record and any environment limits.

## Deployment boundary

`wrangler.jsonc` keeps the service name `lavish-tree-service` and serves `./dist`, with `/api/*` routed through the Worker. The form is fail-closed unless its explicit enable flag, verified sender, credentials, Turnstile keys and rate-limit binding are configured. See `FORM-SETUP.md`. No custom-domain routes are added by this integration.

The live **lavishtreeservice.com** site, Namecheap registration, and Private Email DNS are not changed. Preview crawling remains blocked in HTML, robots.txt, and response headers. Real delivery must be verified independently from a successful deploy. A provider acceptance response is not proof of inbox delivery.

## Before production

1. Confirm business copy, current emergency availability, and final photos with the owner.
2. Complete mobile device, accessibility, and phone/email handoff tests.
3. Complete the approved spam-protected delivery configuration in `FORM-SETUP.md`. The recipient is fixed to sales@lavishtreeservice.com. Perform only the separately approved single labeled live test; verify provider status and recipient inbox.
4. Require explicit cutover approval and a complete DNS export. Preserve MX, SPF, DKIM, SRV, and mail hostnames. Keep Design.com available for rollback; do not cancel services.
5. Confirm canonical/OG metadata and privacy disclosures, add production sitemap/schema, then remove preview crawl blocks only for the approved launch.
6. Support valid HTTPS at apex and www. Preserve `/page` and `/home` redirects and inventory any additional legacy routes before cutover.
