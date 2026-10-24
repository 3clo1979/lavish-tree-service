import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactWorker } from '../src/contact-worker.mjs';

const ORIGIN = 'https://lavish-tree-service.3clo1979.workers.dev';
const HOST = new URL(ORIGIN).hostname;
const RECIPIENT = 'sales@lavishtreeservice.com';
const MAIL_ID = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794';
const sample = () => ({
  name: 'Example Customer', phone: '(440) 555-0123', email: 'customer@example.com',
  service: 'Tree removal', address: 'Example city', message: 'Please discuss a tree near our driveway.',
  website: '', turnstileToken: 'local-mock-token', submissionId: '2fa342f7-a4e4-4d02-9ed0-2aa0704e4489',
});

function request(body = sample(), options = {}) {
  const method = options.method ?? 'POST';
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: options.origin ?? ORIGIN, 'CF-Connecting-IP': '192.0.2.1', 'Sec-Fetch-Site': 'same-origin' });
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value === null) headers.delete(key); else headers.set(key, value);
  }
  return new Request(`${options.urlOrigin ?? ORIGIN}${options.path ?? '/api/contact'}`, {
    method, headers,
    ...(!['GET', 'HEAD'].includes(method) ? { body: options.rawBody ?? JSON.stringify(body) } : {}),
  });
}

function fixture(overrides = {}) {
  const calls = [];
  const rateCalls = [];
  const env = {
    CONTACT_FORM_ENABLED: 'true', CONTACT_FROM: 'webforms@notify.lavishtreeservice.com',
    RESEND_API_KEY: 'mock-resend-not-a-credential', TURNSTILE_SECRET_KEY: 'mock-turnstile-not-a-credential', TURNSTILE_SITE_KEY: 'mock-public-site-key',
    CONTACT_RATE_LIMITER: { async limit(value) { rateCalls.push(value); return { success: true }; } },
    ASSETS: { async fetch() { return new Response('STATIC ASSET'); } },
    ...overrides,
  };
  // All upstream requests terminate here. No test calls the real global fetch.
  let verify = () => Response.json({ success: true, hostname: HOST, action: 'contact' });
  let send = () => Response.json({ id: MAIL_ID });
  const worker = createContactWorker({ fetchImpl: async (url, init) => {
    // Match workerd's supported modes instead of accepting Node-only options.
    // Production Workers throws before network I/O for redirect: 'error'.
    if (!['manual', 'follow'].includes(init.redirect)) throw new TypeError('Unsupported redirect mode');
    calls.push({ url, init });
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return verify(url, init);
    if (url === 'https://api.resend.com/emails') return send(url, init);
    throw new Error('Unexpected mocked URL');
  } });
  return { worker, env, calls, rateCalls, setVerify(fn) { verify = fn; }, setSend(fn) { send = fn; } };
}

test('disabled by default and never calls an upstream provider', async () => {
  const f = fixture({ CONTACT_FORM_ENABLED: undefined });
  const config = await f.worker.fetch(request(null, { method: 'GET', path: '/api/contact-config' }), f.env);
  assert.deepEqual(await config.json(), { enabled: false, recipient: RECIPIENT, diagnosticsVersion: 3 });
  assert.equal((await f.worker.fetch(request(), f.env)).status, 503);
  assert.equal(f.calls.length, 0);
  assert.equal(f.rateCalls.length, 0);
});

test('enabled configuration exposes only public settings, never secrets or sender', async () => {
  const f = fixture();
  const response = await f.worker.fetch(request(null, { method: 'GET', path: '/api/contact-config' }), f.env);
  assert.deepEqual(await response.json(), { enabled: true, recipient: RECIPIENT, diagnosticsVersion: 3, siteKey: 'mock-public-site-key' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

for (const [name, patch] of [
  ['missing Resend key', { RESEND_API_KEY: '' }],
  ['missing Turnstile key', { TURNSTILE_SECRET_KEY: '' }],
  ['missing site key', { TURNSTILE_SITE_KEY: '' }],
  ['missing sender', { CONTACT_FROM: '' }],
  ['wrong brand sender', { CONTACT_FROM: 'webforms@notify.camytaconsulting.com' }],
  ['unapproved sender subdomain', { CONTACT_FROM: 'webforms@other.lavishtreeservice.com' }],
  ['root mailbox sender', { CONTACT_FROM: 'sales@lavishtreeservice.com' }],
  ['sender header injection', { CONTACT_FROM: 'webforms@notify.lavishtreeservice.com\r\nBcc: attacker@example.com' }],
  ['sender display name', { CONTACT_FROM: 'Lavish <webforms@notify.lavishtreeservice.com>' }],
  ['missing rate limiter', { CONTACT_RATE_LIMITER: undefined }],
  ['invalid rate limiter', { CONTACT_RATE_LIMITER: {} }],
  ['boolean enable rather than exact string', { CONTACT_FORM_ENABLED: true }],
  ['whitespace in secret', { RESEND_API_KEY: 'invalid key' }],
]) {
  test(`fail closed with ${name}`, async () => {
    const f = fixture(patch);
    assert.equal((await f.worker.fetch(request(), f.env)).status, 503);
    const config = await f.worker.fetch(request(null, { method: 'GET', path: '/api/contact-config' }), f.env);
    assert.deepEqual(await config.json(), { enabled: false, recipient: RECIPIENT, diagnosticsVersion: 3 });
    assert.equal(f.calls.length, 0);
  });
}

test('static assets are untouched; unknown API paths do not fall back to HTML', async () => {
  const f = fixture({ CONTACT_FORM_ENABLED: undefined });
  assert.equal(await (await f.worker.fetch(request(null, { method: 'GET', path: '/assets/lavish-logo.webp' }), f.env)).text(), 'STATIC ASSET');
  assert.equal((await f.worker.fetch(request(null, { method: 'GET', path: '/api/unknown' }), f.env)).status, 404);
  assert.equal((await f.worker.fetch(request(null, { method: 'GET', path: '/' }), {})).status, 404);
  assert.equal(f.calls.length, 0);
});

for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
  test(`contact endpoint rejects ${method}`, async () => {
    const f = fixture();
    const response = await f.worker.fetch(request(null, { method }), f.env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.equal(f.calls.length, 0);
  });
}

test('config endpoint is GET-only', async () => {
  const f = fixture();
  const response = await f.worker.fetch(request({}, { path: '/api/contact-config' }), f.env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

for (const [name, options] of [
  ['cross-origin', { origin: 'https://attacker.example' }],
  ['missing Origin', { headers: { Origin: null } }],
  ['null Origin', { origin: 'null' }],
  ['same-site rather than same-origin', { headers: { 'Sec-Fetch-Site': 'same-site' } }],
  ['unapproved deployment hostname', { urlOrigin: 'https://other.workers.dev', origin: 'https://other.workers.dev' }],
  ['HTTP URL', { urlOrigin: ORIGIN.replace('https:', 'http:'), origin: ORIGIN.replace('https:', 'http:') }],
  ['unapproved port', { urlOrigin: `${ORIGIN}:8443`, origin: `${ORIGIN}:8443` }],
]) {
  test(`rejects ${name} before provider calls`, async () => {
    const f = fixture();
    assert.equal((await f.worker.fetch(request(sample(), options), f.env)).status, 403);
    assert.equal(f.calls.length, 0);
  });
}

for (const origin of ['https://lavishtreeservice.com', 'https://www.lavishtreeservice.com']) test(`custom domain ${origin} needs exact allowlist and matching CAPTCHA hostname`, async () => {
  const f = fixture();
  assert.equal((await f.worker.fetch(request(sample(), { urlOrigin: origin, origin }), f.env)).status, 403);
  f.env.CONTACT_ALLOWED_ORIGINS = origin;
  f.setVerify(() => Response.json({ success: true, hostname: new URL(origin).hostname, action: 'contact' }));
  assert.equal((await f.worker.fetch(request(sample(), { urlOrigin: origin, origin }), f.env)).status, 202);
});

for (const value of ['*', 'https://attacker.example', 'https://lavishtreeservice.com/', 'http://lavishtreeservice.com', 'https://lavishtreeservice.com.evil.example', 'https://lavishtreeservice.com:8443']) {
  test(`invalid additional origin fails closed: ${value}`, async () => {
    const f = fixture({ CONTACT_ALLOWED_ORIGINS: value });
    assert.equal((await f.worker.fetch(request(), f.env)).status, 403);
    assert.equal(f.calls.length, 0);
  });
}

for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/json; charset=iso-8859-1', '']) {
  test(`rejects unsupported content type ${contentType}`, async () => {
    const f = fixture();
    assert.equal((await f.worker.fetch(request(sample(), { headers: { 'Content-Type': contentType } }), f.env)).status, 415);
    assert.equal(f.calls.length, 0);
  });
}

test('rejects encoded bodies', async () => {
  const f = fixture();
  assert.equal((await f.worker.fetch(request(sample(), { headers: { 'Content-Encoding': 'gzip' } }), f.env)).status, 415);
});

test('requires platform IP and ignores untrusted X-Forwarded-For fallback', async () => {
  const f = fixture();
  assert.equal((await f.worker.fetch(request(sample(), { headers: { 'CF-Connecting-IP': null, 'X-Forwarded-For': '192.0.2.1' } }), f.env)).status, 503);
  assert.equal(f.calls.length, 0);
});

test('rate limiter denies before CAPTCHA and returns Retry-After', async () => {
  const f = fixture({ CONTACT_RATE_LIMITER: { async limit() { return { success: false }; } } });
  const response = await f.worker.fetch(request(), f.env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(f.calls.length, 0);
});

test('rate limiter outage fails closed', async () => {
  const f = fixture({ CONTACT_RATE_LIMITER: { async limit() { throw new Error('mock outage'); } } });
  assert.equal((await f.worker.fetch(request(), f.env)).status, 503);
  assert.equal(f.calls.length, 0);
});

test('rate keys hash platform IP and do not contain raw PII', async () => {
  const f = fixture();
  await f.worker.fetch(request(), f.env);
  await f.worker.fetch(request(), f.env);
  assert.match(f.rateCalls[0].key, /^lavish-contact:[a-f0-9]{64}$/);
  assert.equal(f.rateCalls[0].key, f.rateCalls[1].key);
  assert.ok(!f.rateCalls[0].key.includes('192.0.2.1'));
});

for (const [name, patch] of [
  ['empty name', { name: ' ' }], ['long name', { name: 'x'.repeat(101) }],
  ['name newline', { name: 'Customer\r\nInjected' }], ['numeric name', { name: 3 }],
  ['short phone', { phone: '123' }], ['phone letters', { phone: 'call me' }],
  ['long phone', { phone: '1'.repeat(41) }], ['invalid email', { email: 'bad@@example.com' }],
  ['email injection', { email: 'a@example.com\r\nBcc: b@example.com' }],
  ['email list', { email: 'a@example.com,b@example.com' }], ['bad domain', { email: 'a@-example.com' }],
  ['unknown service', { service: 'Injected subject' }], ['empty address', { address: '' }],
  ['long address', { address: 'x'.repeat(251) }], ['empty message', { message: '' }],
  ['long message', { message: 'x'.repeat(3001) }], ['message NUL', { message: 'a\0b' }],
  ['honeypot', { website: 'https://spam.example' }], ['missing CAPTCHA token', { turnstileToken: '' }],
  ['oversized CAPTCHA token', { turnstileToken: 'x'.repeat(2049) }],
  ['bad submission ID', { submissionId: '../invalid' }], ['recipient injection', { to: 'other@example.com' }],
  ['sender injection', { from: 'other@example.com' }], ['arbitrary HTML field', { html: '<b>bad</b>' }],
]) {
  test(`rejects ${name} before upstream calls`, async () => {
    const f = fixture();
    assert.equal((await f.worker.fetch(request({ ...sample(), ...patch }), f.env)).status, 400);
    assert.equal(f.calls.length, 0);
  });
}

for (const rawBody of ['{broken', 'null', '[]', '"string"', '42']) {
  test(`rejects malformed or nonobject JSON ${rawBody}`, async () => {
    const f = fixture();
    assert.equal((await f.worker.fetch(request(null, { rawBody }), f.env)).status, 400);
    assert.equal(f.calls.length, 0);
  });
}

test('caps actual request bytes even without Content-Length', async () => {
  const f = fixture();
  assert.equal((await f.worker.fetch(request(null, { rawBody: ' '.repeat(16_385) }), f.env)).status, 413);
  assert.equal(f.calls.length, 0);
});

test('caps declared length before reading request', async () => {
  const f = fixture();
  assert.equal((await f.worker.fetch(request(sample(), { headers: { 'Content-Length': '999999' } }), f.env)).status, 413);
  assert.equal(f.calls.length, 0);
});

test('byte limit handles multibyte text, not only character count', async () => {
  const f = fixture();
  assert.equal((await f.worker.fetch(request(null, { rawBody: JSON.stringify({ message: '🌳'.repeat(5000) }) }), f.env)).status, 413);
});

for (const verification of [
  { success: false, hostname: HOST, action: 'contact' },
  { success: true, hostname: 'attacker.example', action: 'contact' },
  { success: true, hostname: HOST, action: 'other' },
  { success: true }, null,
]) {
  test(`rejects invalid Turnstile validation ${JSON.stringify(verification)}`, async () => {
    const f = fixture();
    f.setVerify(() => Response.json(verification));
    assert.equal((await f.worker.fetch(request(), f.env)).status, verification === null ? 503 : 403);
    assert.equal(f.calls.length, 1);
  });
}

for (const [name, fn] of [
  ['HTTP error', () => new Response('unavailable', { status: 500 })],
  ['malformed JSON', () => new Response('not JSON')],
  ['network failure', () => { throw new Error('mock outage'); }],
  ['oversized JSON', () => Response.json({ data: 'x'.repeat(20_000) })],
]) {
  test(`Turnstile ${name} never reaches mail provider`, async () => {
    const f = fixture(); f.setVerify(fn);
    assert.equal((await f.worker.fetch(request(), f.env)).status, 503);
    assert.equal(f.calls.length, 1);
  });
}

test('accepted request uses only fixed recipient/from, validated reply_to, text body and bounded upstream calls', async () => {
  const f = fixture();
  const body = { ...sample(), message: '<script>alert("example")</script>\r\nSecond line' };
  const response = await f.worker.fetch(request(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }), f.env);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, requestId: MAIL_ID });
  assert.equal(f.calls.length, 2);
  const verify = f.calls[0];
  assert.deepEqual(JSON.parse(verify.init.body), { secret: f.env.TURNSTILE_SECRET_KEY, response: body.turnstileToken, remoteip: '192.0.2.1' });
  const mail = f.calls[1];
  const payload = JSON.parse(mail.init.body);
  assert.deepEqual(payload.to, [RECIPIENT]);
  assert.equal(payload.from, 'Lavish Tree Service <webforms@notify.lavishtreeservice.com>');
  assert.equal(payload.reply_to, body.email);
  assert.equal(payload.subject, 'Website request: Tree removal');
  assert.ok(payload.text.includes('<script>alert("example")</script>\nSecond line'));
  assert.equal(payload.html, undefined);
  assert.equal(payload.bcc, undefined);
  assert.equal(payload.cc, undefined);
  assert.equal(mail.init.headers.Authorization, `Bearer ${f.env.RESEND_API_KEY}`);
  assert.match(mail.init.headers['Idempotency-Key'], /^lavish-contact\/[a-f0-9]{64}$/);
  assert.ok(!mail.init.body.includes(body.turnstileToken));
  assert.ok(!mail.init.body.includes('192.0.2.1'));
  for (const call of f.calls) { assert.equal(call.init.redirect, 'manual'); assert.ok(call.init.signal instanceof AbortSignal); }
});

test('optional email and honeypot can be omitted; no reply_to is invented', async () => {
  const f = fixture(); const body = sample(); delete body.email; delete body.website;
  assert.equal((await f.worker.fetch(request(body), f.env)).status, 202);
  const payload = JSON.parse(f.calls[1].init.body);
  assert.equal(payload.reply_to, undefined);
  assert.ok(payload.text.includes('Email: Not provided'));
});

test('retry with same entries/UUID and fresh CAPTCHA has identical provider payload and idempotency key', async () => {
  const f = fixture();
  await f.worker.fetch(request(), f.env);
  await f.worker.fetch(request({ ...sample(), turnstileToken: 'fresh-token' }), f.env);
  assert.equal(f.calls[1].init.body, f.calls[3].init.body);
  assert.equal(f.calls[1].init.headers['Idempotency-Key'], f.calls[3].init.headers['Idempotency-Key']);
});

test('changed entries produce a different idempotency key, avoiding a provider payload conflict', async () => {
  const f = fixture();
  await f.worker.fetch(request(), f.env);
  await f.worker.fetch(request({ ...sample(), message: 'Changed job details' }), f.env);
  assert.notEqual(f.calls[1].init.headers['Idempotency-Key'], f.calls[3].init.headers['Idempotency-Key']);
});

test('new submission UUID produces a new request key', async () => {
  const f = fixture();
  await f.worker.fetch(request(), f.env);
  await f.worker.fetch(request({ ...sample(), submissionId: '2fa342f7-a4e4-4d02-9ed0-2aa0704e4490' }), f.env);
  assert.notEqual(f.calls[1].init.headers['Idempotency-Key'], f.calls[3].init.headers['Idempotency-Key']);
});

for (const status of [400, 401, 403, 409, 429, 500, 503]) {
  test(`Resend ${status} is never falsely reported as success and provider data stays private`, async () => {
    const f = fixture();
    f.setSend(() => Response.json({ message: `private details ${f.env.RESEND_API_KEY}` }, { status }));
    const response = await f.worker.fetch(request(), f.env);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'RESEND_REJECTED');
    assert.equal(result.deliveryState, 'rejected');
    assert.match(result.error, /could not confirm/);
    assert.ok(!JSON.stringify(result).includes(f.env.RESEND_API_KEY));
    assert.equal(f.calls.length, 2); // No automatic retries.
  });
}

for (const [name, fn] of [
  ['network uncertainty', () => { throw new Error('mock timeout'); }],
  ['invalid JSON', () => new Response('not JSON')],
  ['missing ID', () => Response.json({})],
  ['unsafe ID', () => Response.json({ id: '<script>unsafe</script>' })],
  ['oversized response', () => Response.json({ id: 'x'.repeat(20_000) })],
]) {
  test(`Resend ${name} returns truthful uncertainty`, async () => {
    const f = fixture(); f.setSend(fn);
    const response = await f.worker.fetch(request(), f.env);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'RESEND_RESULT_UNKNOWN');
    assert.equal(result.deliveryState, 'unknown');
  });
}

for (const [name, options] of [
  ['disabled configuration', { env: { CONTACT_FORM_ENABLED: 'false' }, status: 503, code: 'CONFIG_NOT_READY' }],
  ['missing mail credential', { env: { RESEND_API_KEY: '' }, status: 503, code: 'CONFIG_NOT_READY' }],
  ['invalid origin configuration', { env: { CONTACT_ALLOWED_ORIGINS: '*' }, status: 403, code: 'CONFIG_NOT_READY' }],
  ['foreign origin', { request: { origin: 'https://attacker.example' }, status: 403, code: 'ORIGIN_NOT_ALLOWED' }],
  ['unknown API route', { request: { path: '/api/missing' }, status: 404, code: 'NOT_FOUND' }],
  ['wrong method', { request: { method: 'GET' }, status: 405, code: 'METHOD_NOT_ALLOWED' }],
  ['wrong content type', { request: { headers: { 'Content-Type': 'text/plain' } }, status: 415, code: 'CONTENT_TYPE_UNSUPPORTED' }],
  ['invalid input', { body: { name: '' }, status: 400, code: 'VALIDATION_FAILED' }],
  ['malformed JSON', { request: { rawBody: '{bad' }, status: 400, code: 'VALIDATION_FAILED' }],
  ['oversized JSON', { request: { rawBody: ' '.repeat(16_385) }, status: 413, code: 'BODY_TOO_LARGE' }],
  ['missing platform IP', { request: { headers: { 'CF-Connecting-IP': null } }, status: 503, code: 'CLIENT_IP_UNAVAILABLE' }],
  ['missing rate binding', { env: { CONTACT_RATE_LIMITER: undefined }, status: 503, code: 'RATE_LIMIT_BINDING_UNAVAILABLE' }],
  ['failed rate binding', { env: { CONTACT_RATE_LIMITER: { async limit() { throw new Error('private binding failure'); } } }, status: 503, code: 'RATE_LIMIT_BINDING_UNAVAILABLE' }],
  ['malformed rate result', { env: { CONTACT_RATE_LIMITER: { async limit() { return {}; } } }, status: 503, code: 'RATE_LIMIT_BINDING_UNAVAILABLE' }],
  ['rate limited', { env: { CONTACT_RATE_LIMITER: { async limit() { return { success: false }; } } }, status: 429, code: 'RATE_LIMITED' }],
  ['CAPTCHA HTTP failure', { verify: () => new Response('private provider failure', { status: 500 }), status: 503, code: 'CAPTCHA_HTTP_ERROR', upstreamStatus: 500, providerCode: 'unknown', providerCategory: 'unknown' }],
  ['CAPTCHA connection failure', { verify: () => { throw new Error('private upstream error'); }, status: 503, code: 'CAPTCHA_FETCH_ERROR', exceptionType: 'Error' }],
  ['CAPTCHA bad JSON', { verify: () => new Response('{bad'), status: 503, code: 'CAPTCHA_RESPONSE_INVALID', exceptionType: 'Error' }],
  ['CAPTCHA internal error category', { verify: () => Response.json({ success: false, 'error-codes': ['internal-error'] }), status: 503, code: 'CAPTCHA_PROVIDER_ERROR' }],
  ['CAPTCHA invalid secret category', { verify: () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }), status: 503, code: 'CAPTCHA_CONFIGURATION_ERROR' }],
  ['CAPTCHA missing secret category', { verify: () => Response.json({ success: false, 'error-codes': ['missing-input-secret'] }), status: 503, code: 'CAPTCHA_CONFIGURATION_ERROR' }],
  ['CAPTCHA rejected token', { verify: () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }), status: 403, code: 'CAPTCHA_TOKEN_INVALID' }],
  ['CAPTCHA malformed error categories', { verify: () => Response.json({ success: false, 'error-codes': 'private provider data' }), status: 503, code: 'CAPTCHA_RESPONSE_INVALID' }],
  ['CAPTCHA hostname mismatch', { verify: () => Response.json({ success: true, hostname: 'other.example', action: 'contact' }), status: 403, code: 'CAPTCHA_CONTEXT_MISMATCH' }],
  ['CAPTCHA action mismatch', { verify: () => Response.json({ success: true, hostname: HOST, action: 'other' }), status: 403, code: 'CAPTCHA_CONTEXT_MISMATCH' }],
]) {
  test(`safe diagnostic for ${name} is not_sent before Resend is invoked`, async () => {
    const f = fixture(options.env);
    if (options.verify) f.setVerify(options.verify);
    const response = await f.worker.fetch(request({ ...sample(), ...options.body }, options.request), f.env);
    assert.equal(response.status, options.status);
    const result = await response.json();
    assert.deepEqual(Object.keys(result).sort(), ['code', 'deliveryState', 'error', 'ok', ...(options.upstreamStatus ? ['upstreamStatus'] : []), ...(options.exceptionType ? ['exceptionType'] : []), ...(options.providerCode ? ['providerCode', 'providerCategory'] : [])].sort());
    assert.equal(result.upstreamStatus, options.upstreamStatus);
    assert.equal(result.exceptionType, options.exceptionType);
    assert.equal(result.providerCode, options.providerCode);
    assert.equal(result.providerCategory, options.providerCategory);
    assert.equal(result.ok, false);
    assert.equal(result.code, options.code);
    assert.equal(result.deliveryState, 'not_sent');
    assert.ok(f.calls.every(call => call.url !== 'https://api.resend.com/emails'));
    for (const privateValue of [sample().name, sample().email, sample().phone, sample().message, sample().turnstileToken, '192.0.2.1', 'private', f.env.RESEND_API_KEY, f.env.TURNSTILE_SECRET_KEY].filter(Boolean)) {
      assert.ok(!JSON.stringify(result).includes(privateValue), `diagnostics must not expose ${privateValue}`);
    }
  });
}

test('unexpected request-stream exception is a private internal error before any send', async () => {
  const f = fixture();
  const original = request();
  const broken = new Request(original.url, {
    method: 'POST', headers: original.headers, duplex: 'half',
    body: new ReadableStream({ start(controller) { controller.error(new Error('private request stream data')); } }),
  });
  const response = await f.worker.fetch(broken, f.env);
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.code, 'INTERNAL_ERROR');
  assert.equal(result.deliveryState, 'not_sent');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(f.calls.length, 0);
});

test('a synchronous send-fetch exception remains unknown, never claims not_sent or rejected', async () => {
  const f = fixture();
  f.setSend(() => { throw new Error(`private ${f.env.RESEND_API_KEY} ${sample().email}`); });
  const response = await f.worker.fetch(request(), f.env);
  const result = await response.json();
  assert.equal(result.code, 'RESEND_RESULT_UNKNOWN');
  assert.equal(result.deliveryState, 'unknown');
  assert.equal(f.calls.length, 2);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes(f.env.RESEND_API_KEY));
  assert.ok(!JSON.stringify(result).includes(sample().email));
});

test('authorized empty-object diagnostic probe cannot invoke CAPTCHA or Resend', async () => {
  const f=fixture();const response=await f.worker.fetch(request({}),f.env);const body=await response.json();
  assert.equal(response.status,400);assert.equal(body.code,'VALIDATION_FAILED');assert.equal(body.deliveryState,'not_sent');assert.equal(f.calls.length,0);assert.equal(f.rateCalls.length,1);
});
test('empty-object diagnostic exposes a broken rate binding without any upstream call', async () => {
  const f=fixture({CONTACT_RATE_LIMITER:{async limit(){throw new Error('mock binding error');}}});
  const response=await f.worker.fetch(request({}),f.env);const body=await response.json();
  assert.equal(response.status,503);assert.equal(body.code,'RATE_LIMIT_BINDING_UNAVAILABLE');assert.equal(body.deliveryState,'not_sent');assert.equal(f.calls.length,0);
});

test('both upstream calls use a workerd-supported non-following redirect mode', async () => {
  const f = fixture();
  const response = await f.worker.fetch(request(), f.env);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, requestId: MAIL_ID });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map(call => call.init.redirect), ['manual', 'manual']);
});

test('every 3xx Siteverify response fails closed without a redirect follow or Resend call', async () => {
  for (let status = 300; status < 400; status++) {
    const f = fixture();
    f.setVerify(() => new Response(null, { status, headers: { Location: 'https://untrusted.example/collect' } }));
    const response = await f.worker.fetch(request(), f.env);
    const result = await response.json();
    assert.equal(response.status, 503, `Siteverify ${status}`);
    assert.equal(result.code, 'CAPTCHA_HTTP_ERROR');
    assert.equal(result.upstreamStatus, status);
    assert.equal(result.deliveryState, 'not_sent');
    assert.deepEqual(f.calls.map(call => call.url), ['https://challenges.cloudflare.com/turnstile/v0/siteverify']);
    assert.equal(f.calls[0].init.redirect, 'manual');
  }
});

test('every 3xx Resend response is rejected without following or leaking credentials to a new endpoint', async () => {
  for (let status = 300; status < 400; status++) {
    const f = fixture();
    f.setSend(() => new Response(null, { status, headers: { Location: 'https://untrusted.example/collect' } }));
    const response = await f.worker.fetch(request(), f.env);
    const result = await response.json();
    assert.equal(response.status, 502, `Resend ${status}`);
    assert.equal(result.code, 'RESEND_REJECTED');
    assert.equal(result.deliveryState, 'rejected');
    assert.deepEqual(f.calls.map(call => call.url), [
      'https://challenges.cloudflare.com/turnstile/v0/siteverify', 'https://api.resend.com/emails',
    ]);
    assert.deepEqual(f.calls.map(call => call.init.redirect), ['manual', 'manual']);
  }
});

test('local CAPTCHA request setup failure has its own safe category without upstream I/O', async t => {
  const f = fixture();
  t.mock.method(AbortSignal, 'timeout', () => { throw new TypeError('private runtime construction detail'); });
  const response = await f.worker.fetch(request(), f.env);
  const result = await response.json();
  assert.equal(result.code, 'CAPTCHA_REQUEST_ERROR');
  assert.equal(result.exceptionType, 'TypeError');
  assert.equal(result.deliveryState, 'not_sent');
  assert.equal(f.calls.length, 0);
  assert.ok(!JSON.stringify(result).includes('private'));
});

for (const name of ['TypeError', 'RangeError', 'Error', 'AbortError', 'TimeoutError', 'private exception name']) {
  test(`CAPTCHA fetch exception exposes only an allowlisted class: ${name}`, async () => {
    const f = fixture();
    f.setVerify(() => { throw Object.assign(new Error('private provider message'), { name }); });
    const result = await (await f.worker.fetch(request(), f.env)).json();
    assert.equal(result.code, ['AbortError', 'TimeoutError'].includes(name) ? 'CAPTCHA_TIMEOUT' : 'CAPTCHA_FETCH_ERROR');
    assert.equal(result.exceptionType, name.startsWith('private') ? 'OtherError' : name);
    assert.equal(result.deliveryState, 'not_sent');
    assert.equal(result.upstreamStatus, undefined);
    assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify(result).includes('private'));
  });
}

test('CAPTCHA body stream timeout is distinguished from malformed JSON', async () => {
  const f = fixture();
  f.setVerify(() => new Response(new ReadableStream({
    start(controller) { controller.error(new DOMException('private timeout detail', 'TimeoutError')); },
  })));
  const result = await (await f.worker.fetch(request(), f.env)).json();
  assert.equal(result.code, 'CAPTCHA_TIMEOUT');
  assert.equal(result.exceptionType, 'TimeoutError');
  assert.equal(result.deliveryState, 'not_sent');
  assert.equal(f.calls.length, 1);
});

for (const [name, responseFactory] of [
  ['empty response', () => new Response(null)],
  ['invalid UTF-8', () => new Response(new Uint8Array([0xff, 0xfe]))],
  ['HTML error page with 200 status', () => new Response('<html>private origin data</html>')],
  ['JSON array', () => Response.json([])],
  ['JSON null', () => Response.json(null)],
  ['missing success flag', () => Response.json({})],
  ['truthy nonboolean success flag', () => Response.json({ success: 'true', hostname: HOST, action: 'contact' })],
  ['nonstring error category', () => Response.json({ success: false, 'error-codes': [123] })],
  ['invalid length header', () => new Response('{}', { headers: { 'Content-Length': 'private length' } })],
  ['no response object', () => null],
  ['noninteger HTTP status', () => ({ ok: false, status: 'private status' })],
  ['out-of-range HTTP status', () => ({ ok: false, status: 999 })],
  ['inconsistent response status', () => ({ ok: true, status: 500 })],
]) {
  test(`CAPTCHA malformed response diagnostic: ${name}`, async () => {
    const f = fixture(); f.setVerify(responseFactory);
    const response = await f.worker.fetch(request(), f.env);
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.code, 'CAPTCHA_RESPONSE_INVALID');
    assert.equal(result.deliveryState, 'not_sent');
    assert.equal(result.upstreamStatus, undefined);
    assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify(result).includes('private'));
  });
}

test('valid streamed Siteverify JSON works with split UTF-8 chunks and real HTTP-style headers', async () => {
  const f = fixture();
  f.setVerify(() => {
    const bytes = new TextEncoder().encode(JSON.stringify({ success: true, hostname: HOST, action: 'contact', extra: '🌳 café' }));
    return new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(bytes.length) } });
  });
  assert.equal((await f.worker.fetch(request(), f.env)).status, 202);
  assert.equal(f.calls.length, 2);
});

const verificationRequest = (body = { turnstileToken: 'local-mock-token' }, options = {}) => request(body, { path: '/api/contact-verify', ...options });

test('verification-only success structurally exits before email construction and Resend', async () => {
  const f = fixture();
  f.setSend(() => { throw new Error('Resend must never be reached'); });
  const response = await f.worker.fetch(verificationRequest(), f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, verified: true, deliveryState: 'not_sent' });
  assert.deepEqual(f.calls.map(call => call.url), ['https://challenges.cloudflare.com/turnstile/v0/siteverify']);
  assert.equal(f.rateCalls.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(f.calls[0].init.body)).sort(), ['remoteip', 'response', 'secret']);
});

for (const origin of ['https://lavishtreeservice.com', 'https://www.lavishtreeservice.com', 'https://other.workers.dev', ORIGIN.replace('https:', 'http:')]) {
  test(`verification-only endpoint is denied on ${origin} even when normal custom origins are enabled`, async () => {
    const f = fixture({ CONTACT_ALLOWED_ORIGINS: 'https://lavishtreeservice.com,https://www.lavishtreeservice.com' });
    const response = await f.worker.fetch(verificationRequest(undefined, { urlOrigin: origin, origin }), f.env);
    const result = await response.json();
    assert.equal(response.status, 403);
    assert.equal(result.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(result.deliveryState, 'not_sent');
    assert.equal(f.calls.length, 0);
  });
}

for (const [name, body] of [
  ['missing token', {}], ['null', null], ['array', []], ['empty token', { turnstileToken: '' }],
  ['whitespace token', { turnstileToken: ' ' }], ['numeric token', { turnstileToken: 123 }],
  ['oversized token', { turnstileToken: 'x'.repeat(2049) }],
  ['contact fields', { ...sample() }],
  ['email recipient', { turnstileToken: 'local-mock-token', to: RECIPIENT }],
  ['customer data', { turnstileToken: 'local-mock-token', email: 'customer@example.com' }],
  ['send switch', { turnstileToken: 'local-mock-token', send: true }],
]) {
  test(`verification-only rejects ${name} without upstream calls`, async () => {
    const f = fixture();
    const response = await f.worker.fetch(verificationRequest(body), f.env);
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.code, 'VALIDATION_FAILED');
    assert.equal(result.deliveryState, 'not_sent');
    assert.equal(f.calls.length, 0);
  });
}

for (const [name, options, env, status, code] of [
  ['GET', { method: 'GET' }, {}, 405, 'METHOD_NOT_ALLOWED'],
  ['OPTIONS', { method: 'OPTIONS' }, {}, 405, 'METHOD_NOT_ALLOWED'],
  ['foreign Origin', { origin: 'https://attacker.example' }, {}, 403, 'ORIGIN_NOT_ALLOWED'],
  ['missing Origin', { headers: { Origin: null } }, {}, 403, 'ORIGIN_NOT_ALLOWED'],
  ['same-site not same-origin', { headers: { 'Sec-Fetch-Site': 'same-site' } }, {}, 403, 'ORIGIN_NOT_ALLOWED'],
  ['bad content type', { headers: { 'Content-Type': 'text/plain' } }, {}, 415, 'CONTENT_TYPE_UNSUPPORTED'],
  ['missing platform IP', { headers: { 'CF-Connecting-IP': null } }, {}, 503, 'CLIENT_IP_UNAVAILABLE'],
  ['disabled config', {}, { CONTACT_FORM_ENABLED: 'false' }, 503, 'CONFIG_NOT_READY'],
  ['missing rate limiter', {}, { CONTACT_RATE_LIMITER: undefined }, 503, 'RATE_LIMIT_BINDING_UNAVAILABLE'],
  ['rate limit denial', {}, { CONTACT_RATE_LIMITER: { async limit() { return { success: false }; } } }, 429, 'RATE_LIMITED'],
]) {
  test(`verification-only enforces ${name}`, async () => {
    const f = fixture(env);
    const response = await f.worker.fetch(verificationRequest(undefined, options), f.env);
    const result = await response.json();
    assert.equal(response.status, status);
    assert.equal(result.code, code);
    assert.equal(result.deliveryState, 'not_sent');
    assert.equal(f.calls.length, 0);
  });
}

for (const [name, providerResponse, code] of [
  ['invalid response', null, 'CAPTCHA_RESPONSE_INVALID'],
  ['invalid success type', { success: 1 }, 'CAPTCHA_RESPONSE_INVALID'],
  ['failed token', { success: false }, 'CAPTCHA_TOKEN_INVALID'],
  ['wrong hostname', { success: true, hostname: 'attacker.example', action: 'contact' }, 'CAPTCHA_CONTEXT_MISMATCH'],
  ['wrong action', { success: true, hostname: HOST, action: 'other' }, 'CAPTCHA_CONTEXT_MISMATCH'],
  ['provider error', { success: false, 'error-codes': ['internal-error'] }, 'CAPTCHA_PROVIDER_ERROR'],
  ['invalid secret', { success: false, 'error-codes': ['invalid-input-secret'] }, 'CAPTCHA_CONFIGURATION_ERROR'],
]) {
  test(`verification-only ${name} can never reach Resend`, async () => {
    const f = fixture(); f.setVerify(() => Response.json(providerResponse));
    const result = await (await f.worker.fetch(verificationRequest(), f.env)).json();
    assert.equal(result.code, code);
    assert.equal(result.deliveryState, 'not_sent');
    assert.deepEqual(f.calls.map(call => call.url), ['https://challenges.cloudflare.com/turnstile/v0/siteverify']);
  });
}

for (const [providerCode, providerCategory] of [
  ['missing-input-secret', 'configuration'], ['invalid-input-secret', 'configuration'],
  ['missing-input-response', 'token'], ['invalid-input-response', 'token'], ['timeout-or-duplicate', 'token'],
  ['bad-request', 'request'], ['internal-error', 'internal'], ['unknown', 'unknown'],
]) {
  test(`HTTP failure exposes only fixed provider code ${providerCode} and category`, async () => {
    for (const path of ['/api/contact', '/api/contact-verify']) {
      const f = fixture();
      f.setVerify(() => Response.json({ success: false, 'error-codes': [providerCode], private: 'private upstream details' }, { status: 400 }));
      const req = path === '/api/contact' ? request() : verificationRequest();
      const response = await f.worker.fetch(req, f.env);
      const result = await response.json();
      assert.equal(response.status, 503);
      assert.deepEqual(result, {
        ok: false, error: 'Verification is unavailable. Please try again or contact Lavish directly.',
        code: 'CAPTCHA_HTTP_ERROR', deliveryState: 'not_sent', upstreamStatus: 400, providerCode, providerCategory,
      });
      assert.equal(f.calls.length, 1);
      assert.ok(f.calls.every(call => call.url !== 'https://api.resend.com/emails'));
      assert.ok(!JSON.stringify(result).includes('private'));
    }
  });
}

test('configuration code takes priority over other allowlisted provider categories', async () => {
  const f = fixture();
  f.setVerify(() => Response.json({ 'error-codes': ['internal-error', 'bad-request', 'invalid-input-response', 'invalid-input-secret'] }, { status: 400 }));
  const result = await (await f.worker.fetch(verificationRequest(), f.env)).json();
  assert.equal(result.providerCode, 'invalid-input-secret');
  assert.equal(result.providerCategory, 'configuration');
  assert.equal(result.code, 'CAPTCHA_HTTP_ERROR');
  assert.equal(result.upstreamStatus, 400);
  assert.equal(f.calls.length, 1);
});

for (const [name, responseFactory] of [
  ['unrecognized provider data', () => Response.json({ 'error-codes': ['private-secret-value'], private: 'private customer data' }, { status: 400 })],
  ['nonarray error codes', () => Response.json({ 'error-codes': 'invalid-input-secret' }, { status: 400 })],
  ['nested arbitrary objects', () => Response.json({ 'error-codes': [{ private: 'private data' }] }, { status: 400 })],
  ['malformed JSON', () => new Response('{private', { status: 400 })],
  ['HTML body', () => new Response('<html>private error</html>', { status: 400 })],
  ['null body', () => new Response(null, { status: 400 })],
  ['oversized body', () => Response.json({ 'error-codes': ['invalid-input-secret'], padding: 'x'.repeat(16_385) }, { status: 400 })],
  ['misleading success body', () => Response.json({ success: true, hostname: HOST, action: 'contact' }, { status: 400 })],
]) {
  test(`non-2xx ${name} stays HTTP_ERROR/unknown with no Resend`, async () => {
    const f = fixture(); f.setVerify(responseFactory);
    const result = await (await f.worker.fetch(verificationRequest(), f.env)).json();
    assert.equal(result.code, 'CAPTCHA_HTTP_ERROR');
    assert.equal(result.upstreamStatus, 400);
    assert.equal(result.providerCode, 'unknown');
    assert.equal(result.providerCategory, 'unknown');
    assert.equal(result.deliveryState, 'not_sent');
    assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify(result).includes('private'));
  });
}

test('non-2xx body uses existing CAPTCHA deadline, cancels a stalled read, and stays HTTP_ERROR/unknown', async t => {
  const controller = new AbortController();
  const durations = [];
  t.mock.method(AbortSignal, 'timeout', duration => { durations.push(duration); return controller.signal; });
  const f = fixture();
  let cancelled = false;
  f.setVerify(() => {
    setTimeout(() => controller.abort(new DOMException('private timeout detail', 'TimeoutError')), 5);
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 400 });
  });
  const result = await (await f.worker.fetch(verificationRequest(), f.env)).json();
  assert.deepEqual(durations, [8000]);
  assert.equal(result.code, 'CAPTCHA_HTTP_ERROR');
  assert.equal(result.upstreamStatus, 400);
  assert.equal(result.providerCode, 'unknown');
  assert.equal(result.providerCategory, 'unknown');
  assert.equal(result.deliveryState, 'not_sent');
  assert.equal(cancelled, true);
  assert.equal(f.calls.length, 1);
  assert.ok(!JSON.stringify(result).includes('private'));
});
