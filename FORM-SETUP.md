# Lavish contact email — prepared, not enabled

The backend in `src/contact-worker.mjs` is fail-closed. It does not deliver mail until the deployment configuration, verified sender, secrets, anti-abuse binding, and explicit enable switch are all present. Local tests inject mock responses: **no real email has been sent or delivery verified**.

## Fixed destination and sender

- Recipient is hard-coded server-side to **sales@lavishtreeservice.com**. Browser input cannot override it.
- Set `CONTACT_FROM` to a plain mailbox on **notify.lavishtreeservice.com**, for example `webforms@notify.lavishtreeservice.com`. This is a proposed sender, not an assertion that it has been verified. The server adds the Lavish display name.
- Create/verify the Lavish-specific sender in Resend and use a sending-only key scoped to that domain. Do not reuse another business's credentials. Obtain needed account/security approval at the point of action.
- Preserve all existing website/mailbox DNS, especially root-domain MX records. Only add the provider's exact authorized verification records on the sender subdomain after reviewing existing records. Do not migrate the custom domain or mailbox.

## Deployment configuration needed

The implementation integrates the Worker, public readiness client, CSP and assets binding. Deploy it with CONTACT_FORM_ENABLED=false first so the formerly static-only Worker can accept secrets. The deployment owner must complete the following settings in `wrangler.jsonc`:

```jsonc
{
  "main": "src/contact-worker.mjs",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]
  },
  "vars": {
    "CONTACT_FORM_ENABLED": "false",
    "CONTACT_FROM": "webforms@notify.lavishtreeservice.com",
    "TURNSTILE_SITE_KEY": "0x4AAAAAAFkHs_2LwMRbnnLJ"
  },
  "ratelimits": [{
    "name": "CONTACT_RATE_LIMITER",
    "namespace_id": "1601609128",
    "simple": { "limit": 5, "period": 60 }
  }]
}
```

Namespace candidate `1601609128` was generated randomly in the positive signed-32-bit range and accepted by Wrangler dry-run. Existing Lavish main had no rate-limit binding. Account-wide uniqueness was not independently inventoried; counter keys additionally use the `lavish-contact:` prefix. Wrangler must support rate-limit bindings (4.36.0 or newer). Confirm that all resources remain on the requested free plans; do not enable paid usage, automatic overages, or upgrades. Rate limiting is approximate and per Cloudflare location, **not** a global provider quota or spending cap. IP-based limits can also affect people sharing a connection.

Store `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` as encrypted secrets on the **lavish-tree-service** Worker. Never commit, print, or copy them into static assets. Do not publish a `.dev.vars` file. Configure the Turnstile widget for `lavish-tree-service.3clo1979.workers.dev` and action **contact**.

Leave `CONTACT_FORM_ENABLED` as the literal string `"false"` while setup is incomplete. Set it to the literal string `"true"` only after verifying the sender, domain-scoped credentials, widget, binding, frontend CSP/behavior, and free-plan constraints. Presence checks cannot prove a provider credential or sender is valid.

The default permitted origin is only `https://lavish-tree-service.3clo1979.workers.dev`. `CONTACT_ALLOWED_ORIGINS` may later explicitly add `https://lavishtreeservice.com` and/or `https://www.lavishtreeservice.com` as a comma-separated string. No custom-domain or DNS change is performed by this option; each future hostname must also be authorized on Turnstile. The prepared configuration now explicitly includes apex and www following user approval for eventual cutover. This only allows the form on those hostnames; it does not migrate DNS or remove noindex.

## Browser/API contract

`GET /api/contact-config` returns:

```js
{ enabled: false, recipient: "sales@lavishtreeservice.com" }
// When all prerequisites and explicit enable flag are present:
{ enabled: true, recipient: "sales@lavishtreeservice.com", siteKey: "public-widget-key" }
```

The browser must preserve existing local-preview behavior when this route is absent, unavailable, or disabled. Load Turnstile and enable sending only after an enabled config response. Never fall back to pretending a failed send succeeded.

Send same-origin JSON to `POST /api/contact`:

```js
{
  name, phone, email, service, address, message,
  website: "",            // hidden honeypot, never a customer-visible required field
  turnstileToken,          // widget action: contact
  submissionId           // crypto.randomUUID(), stable on unchanged-request retry
}
```

Name, phone, service, address, message, token and UUID are required. Email is optional; when present and valid it becomes `reply_to`. Service must match an existing dropdown option exactly. Unknown fields are rejected. Requests are bounded to 16 KiB; field limits mirror the current form (name 100, phone 40, email 200, address 250, message 3,000). The server trusts only Cloudflare's `CF-Connecting-IP`, not a forwarded-IP fallback.

- HTTP `202` + `{ok:true,requestId}` means **Resend accepted the request**, not proven inbox delivery, an appointment, or emergency dispatch.
- Errors return `{ok:false,error:"safe user-facing message"}` with a non-2xx status. Preserve entries and show the message. Fetch is never automatically retried.
- Refresh Turnstile after a failed attempt. Keep the submission UUID while the entries are unchanged. The server hashes that UUID and canonical mail payload for Resend's idempotency header; a fresh CAPTCHA does not change the key. Resend retains keys for 24 hours, not indefinitely. Changed entries or a new UUID intentionally create a different key.
- A timeout can leave provider acceptance unknown; the response explicitly says it could not be confirmed. Do not tell the customer nothing was sent. Retry unchanged details rather than creating a second request.
- CSP integration needs same-origin `connect-src`, Turnstile's script/frame permissions, and the existing strict script policy. Review changes narrowly; do not add wildcard sources.

## Verification and release

```sh
node --check src/contact-worker.mjs
node --test tests/contact.test.mjs
npm test
```

All backend network requests are mocked in these tests. They cover disabled state, missing settings, static fallback, methods/origins, rate limiting, body bounds, input/header injection, CAPTCHA validation, fixed destination, optional reply-to, retries, provider failures and truthful acceptance.

Before release, verify disabled and enabled UI behavior, keyboard/mobile layout and error recovery without a real send. Obtain explicit authorization and coordinate a single owner before sending any real test. Verify both provider status and recipient inbox. Do not repeat a send after an uncertain result without checking its outcome. Do not claim delivery from a successful API response alone. No analytics, storage, or customer-data logging is added by the backend.

## Official references

- [Cloudflare static assets with a Worker script](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Cloudflare rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Resend send-email endpoint](https://resend.com/docs/api-reference/emails/send-email)
- [Resend idempotency behavior](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Prepared client integration (not published)

`src/contact-client.mjs` and `tests/contact-client.test.mjs` are included in the private preparation bundle. The integration additionally loads `dist/contact.js` and stays in preview mode while disabled. The readiness response controls whether the form switches to real delivery.

When authenticated setup is ready:

1. Copy `src/contact-client.mjs` to `dist/contact.js`, load it with `<script type="module" src="contact.js"></script>` after the existing deferred app script, and retain the preview handler as the fail-closed fallback.
2. Add `.form-honeypot` offscreen positioning (absolute, 1px dimensions, overflow hidden) and `.contact-security` spacing. The honeypot already has `aria-hidden` and its input has `tabindex=-1`. Do not expose it as a real customer field.
3. Merge the Worker/assets/rate-limit configuration above, leaving `CONTACT_FORM_ENABLED` false. Preserve the current Worker name, account, noindex headers, and unrelated settings.
4. Update the static CSP narrowly: same-origin `connect-src`, `https://challenges.cloudflare.com` for `script-src` and `frame-src`; confirm current Turnstile documentation before release. Do not add wildcard sources or inline-script allowances.
5. Configure the Lavish-specific verified sender, sending-only domain-scoped secret, Turnstile hostname/site/secret, and anti-abuse binding. Keep credentials out of files and this bundle. Confirm free plans only and no existing MX changes.
6. Verify disabled/unconfigured UI stays preview-only and that failed security checks never enable sending. The client preserves entries and UUID on uncertain submission; it does not automatically retry or send. API success means provider acceptance, not confirmed delivery.
7. Enable only after prerequisites are verified; run all tests, deploy the authorized preview, and verify exact commit/build plus live desktop/narrow keyboard/layout/error states.
8. Obtain separate approval for a real test email. Then verify the provider event and the intended recipient inbox before claiming end-to-end delivery.

The source and local mock tests were prepared against GitHub main `90551e69f0bda3ff8702b3fa1553d29248f16f67` on 2026-10-24. The expanded local suite passes 136 tests, including both apex/www origin validation and client acceptance-receipt checks. Wrangler 4.152.0 dry-run compilation passes. Local runtime serving is blocked by the workspace network-interface system error; live preview QA remains required. A successful deploy alone does not establish delivery readiness.
