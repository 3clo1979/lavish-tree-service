# Lavish Tree Service — industrial redesign

A short, photography-led static design preview for Lavish Tree Service. The October 24 redesign replaces the earlier cream/forest split layout with charcoal, white, safety orange, oversized condensed type, and authentic tree work. It is deliberately distinct from the Best Buds lawn-care site.

## Experience

- Large crane-removal introduction using an authentic Lavish Facebook photograph.
- Prominent general contact and 24-hour emergency click-to-call actions: **440-452-7240**.
- Persistent call / emergency actions on phones, compact mobile navigation, and visible Facebook work links in navigation, work, contact, and footer.
- Three original project photos with accessible, keyboard-operated enlargement and previous/next controls.
- Compact services and large contact details, including the publicly verified sales@lavishtreeservice.com address.
- An optional request-planning form preserves the earlier preview feature. **Nothing is sent or stored.** It is explicitly labeled preview-only and remains disabled without JavaScript. Real inquiries go through telephone or email links.
- Self-hosted images and fonts; no analytics, remote embeds, runtime dependencies, or new credentials.

See `ASSETS.md` for photo provenance. No synthetic project imagery or invented credentials are used. Availability language is sourced from both the existing public website and matching Facebook page; no response-time guarantee is added.

## Run and validate

There is no build step. `dist/` is the deployable static output.

```sh
npm run check
python -m http.server 8080 --directory dist
```

`npm run check` checks JavaScript syntax and runs twelve static integrity tests. It is not a substitute for rendered desktop/mobile and interaction QA. See `QA.md` for the actual verification record and any environment limits.

## Deployment boundary

The existing `wrangler.jsonc` keeps the service name `lavish-tree-service` and serves `./dist`. Git-connected Cloudflare Workers deployment is intended only for the existing preview endpoint. No custom routes are added.

The live **lavishtreeservice.com** site, Namecheap registration, and Private Email DNS are not changed. Preview crawling remains blocked in HTML, robots.txt, and response headers. No live form backend is connected.

## Before production

1. Confirm business copy, current emergency availability, and final photos with the owner.
2. Complete mobile device, accessibility, and phone/email handoff tests.
3. Obtain the approved form recipient and build a secure spam-protected delivery path only if requested. Verify actual delivery before removing preview labels.
4. Require explicit cutover approval and a complete DNS export. Preserve MX, SPF, DKIM, SRV, and mail hostnames. Keep Design.com available for rollback; do not cancel services.
5. Confirm canonical/OG metadata and privacy disclosures, add production sitemap/schema, then remove preview crawl blocks only for the approved launch.
6. Support valid HTTPS at apex and www. Preserve `/page` and `/home` redirects and inventory any additional legacy routes before cutover.
