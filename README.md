# Lavish Tree Service — Camyta redesign

Static, dependency-free design preview for Lavish Tree Service. Built for Cloudflare Pages or Workers Static Assets. The existing live domain and email are **not** connected or changed by this package.

## Preview status

- Responsive HTML/CSS/JavaScript, self-hosted original logo/photos/fonts, project-photo lightbox, mobile navigation, service selection, and click-to-call links.
- Quote form deliberately previews a request only. **Nothing is sent or stored.** No recipient, backend, analytics, CRM, or email credentials are configured.
- Search crawling is blocked with robots.txt, HTML robots metadata, and X-Robots-Tag. Remove these only for the approved production launch.
- 12 static/DOM behavior checks passed. Browser-rendered desktop/mobile QA remains required after a reachable preview deployment.

## Cloudflare Pages

Create a Pages project from this repository. Choose no framework. No build command is needed; output directory: `dist`. Use the generated pages.dev hostname for review. Do not add the live custom domain yet.

## Cloudflare Workers Static Assets

A minimal `wrangler.jsonc` is included. The assets directory is `./dist`; no Worker code or secrets are required. From an authorized Cloudflare account, deploy with Wrangler or import the repository through Workers & Pages. Do not configure a custom domain or route until separately approved.

## Before production

1. Complete desktop and mobile browser QA, keyboard/dialog checks, contrast and tap-target review, and real-device phone-link checks.
2. Confirm approved copy, original-logo export rights, ownership of the reused photos, exact service area, and current availability of 24-hour emergency service. Existing logo artwork includes “Est. 2002”; no additional credential, rating, or experience claim is added.
3. Confirm the quote recipient and build a secure, spam-protected form delivery path. Replace the explicit preview-only UI only after real delivery is verified. Update CSP `connect-src` and `form-action` narrowly to the actual integration.
4. Keep Namecheap registration and Private Email intact. A complete DNS-zone export and explicit cutover approval are required. Preserve MX, SPF, DKIM, SRV, and mail convenience hostnames.
5. Confirm live canonical/OG metadata, add a social preview image and sitemap, structured business metadata using confirmed facts, and production privacy disclosures. Remove preview crawl blocks, then test the resulting indexability.
6. Support valid HTTPS at both apex and www. The legacy `/page` and `/home` routes redirect to `/` in this package. Inventory any additional routes before cutover.
7. Keep the Design.com site available for rollback. Do not cancel services without separate approval.

## Assets and licenses

Business logo and six project photographs are preserved from the owner's existing public website, https://lavishtreeservice.com, retrieved October 22, 2026. Photos were resized and converted to WebP; no synthetic jobsite images are used. Original assets remain the property of their respective owner and are not relicensed by this repository.

Camyta footer mark is supplied from the existing Camyta project; footer links to https://camytagroup.com.

DM Sans and Fraunces fonts are self-hosted. Their SIL Open Font License texts are included in `licenses/`.

No raw website snapshot, private research notes, DNS inventory, tokens, account credentials, or user messages are included in this release.
