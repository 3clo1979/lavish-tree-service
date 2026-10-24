/**
 * Lavish contact endpoint. Disabled unless every prerequisite is configured.
 * No customer data, tokens, provider responses, or credentials are logged.
 * Tests inject fetch; production uses the platform's fetch implementation.
 */
const RECIPIENT = 'sales@lavishtreeservice.com';
const PREVIEW_ORIGIN = 'https://lavish-tree-service.3clo1979.workers.dev';
const FUTURE_ORIGINS = new Set(['https://lavishtreeservice.com', 'https://www.lavishtreeservice.com']);
const SERVICES = new Set(['Tree removal', 'Tree trimming', 'Stump grinding', 'Storm response', 'Not sure yet']);
const FIELDS = new Set(['name', 'phone', 'email', 'service', 'address', 'message', 'website', 'turnstileToken', 'submissionId']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16_384;
const MAX_UPSTREAM_BYTES = 16_384;
const UNAVAILABLE = 'Online requests are unavailable right now. Please call Lavish or email sales@lavishtreeservice.com.';
const NOT_CONFIRMED = 'We could not confirm your request was accepted. Your details have been kept here. Please retry with the same details or contact Lavish directly.';
const VERIFICATION_UNAVAILABLE = 'Verification is unavailable. Please try again or contact Lavish directly.';
const EXCEPTION_TYPES = new Set(['TypeError', 'RangeError', 'Error', 'AbortError', 'TimeoutError', 'OtherError']);
const EXCEPTION_CODES = new Set(['CAPTCHA_REQUEST_ERROR', 'CAPTCHA_FETCH_ERROR', 'CAPTCHA_TIMEOUT', 'CAPTCHA_RESPONSE_INVALID']);
// Ordered by diagnostic priority; unrecognized provider strings never escape.
const PROVIDER_CODES = new Map([
  ['missing-input-secret', 'configuration'], ['invalid-input-secret', 'configuration'],
  ['missing-input-response', 'token'], ['invalid-input-response', 'token'], ['timeout-or-duplicate', 'token'],
  ['bad-request', 'request'], ['internal-error', 'internal'], ['unknown', 'unknown'],
]);

class RequestError extends Error {
  constructor(status, message, code = 'VALIDATION_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

// Codes are stable, public categories only. Never include input, credentials,
// upstream error text, or raw exceptions in a response or diagnostic log.
// `not_sent` is only safe before invoking Resend. An attempted send with no
// conclusive response is `unknown`; only an observed non-2xx is `rejected`.
function failure(status, error, code, deliveryState = 'not_sent', headers, upstreamStatus, exceptionType, providerCode) {
  const safeStatus = code === 'CAPTCHA_HTTP_ERROR' && Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599;
  const safeException = EXCEPTION_CODES.has(code) && EXCEPTION_TYPES.has(exceptionType);
  const safeProvider = code === 'CAPTCHA_HTTP_ERROR' && PROVIDER_CODES.has(providerCode);
  return json({ ok: false, error, code, deliveryState, ...(safeStatus ? { upstreamStatus } : {}), ...(safeException ? { exceptionType } : {}),
    ...(safeProvider ? { providerCode, providerCategory: PROVIDER_CODES.get(providerCode) } : {}),
  }, status, headers);
}
function exceptionCategory(error) { return EXCEPTION_TYPES.has(error?.name) ? error.name : 'OtherError'; }
function nonemptySetting(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\s\x00-\x1f\x7f]/.test(value);
}

function allowedOrigins(env) {
  const origins = new Set([PREVIEW_ORIGIN]);
  if (env.CONTACT_ALLOWED_ORIGINS === undefined || env.CONTACT_ALLOWED_ORIGINS === '') return origins;
  if (typeof env.CONTACT_ALLOWED_ORIGINS !== 'string') return null;
  for (const origin of env.CONTACT_ALLOWED_ORIGINS.split(',').map(value => value.trim())) {
    if (!FUTURE_ORIGINS.has(origin) && origin !== PREVIEW_ORIGIN) return null;
    origins.add(origin);
  }
  return origins;
}

function validEmail(value) {
  if (value.length > 200 || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && local.length <= 64 && /^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~.-]+$/.test(local)
    && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
    && domain.length <= 253 && domain.includes('.')
    && domain.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

function configuration(env) {
  const origins = allowedOrigins(env);
  const from = env.CONTACT_FROM;
  const enabled = env.CONTACT_FORM_ENABLED === 'true'
    && nonemptySetting(env.RESEND_API_KEY)
    && nonemptySetting(env.TURNSTILE_SECRET_KEY)
    && nonemptySetting(env.TURNSTILE_SITE_KEY)
    && typeof from === 'string' && validEmail(from)
    && from.split('@')[1] === 'notify.lavishtreeservice.com'
    && typeof env.CONTACT_RATE_LIMITER?.limit === 'function'
    && origins !== null;
  return { enabled: Boolean(enabled), origins, from };
}

async function readChunk(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) throw signal.reason;
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(signal.reason);
      // Do not await cancellation of an unresponsive upstream stream.
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    reader.read().then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

async function boundedJson(body, maximum = MAX_BODY_BYTES, signal) {
  if (signal?.aborted) throw signal.reason;
  const length = body.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    throw new RequestError(413, 'This request is too large. Please shorten your details.', 'BODY_TOO_LARGE');
  }
  if (!body.body) throw new RequestError(400, 'Please provide your request details.');
  const reader = body.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        throw new RequestError(413, 'This request is too large. Please shorten your details.', 'BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new RequestError(400, 'Please check your request details and try again.'); }
}

function validate(body) {
  const invalid = () => { throw new RequestError(400, 'Please check your request details and try again.'); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
  if (Object.keys(body).some(key => !FIELDS.has(key))) invalid();
  const read = (key, max, required = true, multiline = false) => {
    const raw = body[key] === undefined && !required ? '' : body[key];
    if (typeof raw !== 'string' || raw.length > max) invalid();
    if ((multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(raw)) invalid();
    const value = raw.replace(/\r\n?/g, '\n').trim();
    if (required && !value) invalid();
    return value;
  };
  const data = {
    name: read('name', 100),
    phone: read('phone', 40),
    email: read('email', 200, false),
    service: read('service', 40),
    address: read('address', 250),
    message: read('message', 3000, true, true),
    website: read('website', 200, false),
    turnstileToken: read('turnstileToken', 2048),
    submissionId: read('submissionId', 36),
  };
  if (data.website || !SERVICES.has(data.service) || !UUID.test(data.submissionId)) invalid();
  if (!/^[+()\d .-]+$/.test(data.phone) || !/^\d{7,15}$/.test(data.phone.replace(/\D/g, ''))) invalid();
  if (data.email && !validEmail(data.email)) invalid();
  return data;
}

function validateVerificationOnly(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'turnstileToken')
    || typeof body.turnstileToken !== 'string' || body.turnstileToken.length === 0
    || body.turnstileToken.length > 2048 || /[\s\x00-\x1f\x7f]/.test(body.turnstileToken)) {
    throw new RequestError(400, 'Please complete the verification before checking.');
  }
  return { turnstileToken: body.turnstileToken };
}

function verificationTimeout(error, signal) {
  return signal?.aborted === true || error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

async function providerDiagnostic(response, signal) {
  try {
    const body = await boundedJson(response, MAX_UPSTREAM_BYTES, signal);
    const codes = body && typeof body === 'object' && !Array.isArray(body) && Array.isArray(body['error-codes']) ? body['error-codes'] : [];
    for (const code of PROVIDER_CODES.keys()) if (codes.includes(code)) return code;
  } catch { /* HTTP failure remains a failure even if its body cannot be read. */ }
  return 'unknown';
}

// One shared Siteverify implementation for contact and the no-email diagnostic.
// Only fixed categories and an HTTP status may escape this boundary.
async function verifyTurnstile(data, ip, hostname, env, fetchImpl) {
  let options;
  try {
    options = {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: data.turnstileToken, remoteip: ip }),
      // Workers does not support redirect:'error'. Manual never forwards secrets.
      redirect: 'manual', signal: AbortSignal.timeout(8000),
    };
  } catch (error) { return failure(503, VERIFICATION_UNAVAILABLE, 'CAPTCHA_REQUEST_ERROR', 'not_sent', undefined, undefined, exceptionCategory(error)); }

  let response;
  try { response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', options); }
  catch (error) {
    return failure(503, VERIFICATION_UNAVAILABLE, verificationTimeout(error, options.signal) ? 'CAPTCHA_TIMEOUT' : 'CAPTCHA_FETCH_ERROR', 'not_sent', undefined, undefined, exceptionCategory(error));
  }
  if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status) || response.status < 100 || response.status > 599
    || response.ok !== (response.status >= 200 && response.status < 300)) {
    return failure(503, VERIFICATION_UNAVAILABLE, 'CAPTCHA_RESPONSE_INVALID');
  }
  if (!response.ok) {
    const providerCode = await providerDiagnostic(response, options.signal);
    return failure(503, VERIFICATION_UNAVAILABLE, 'CAPTCHA_HTTP_ERROR', 'not_sent', undefined, response.status, undefined, providerCode);
  }

  let verification;
  try { verification = await boundedJson(response, MAX_UPSTREAM_BYTES); }
  catch (error) {
    return failure(503, VERIFICATION_UNAVAILABLE, verificationTimeout(error, options.signal) ? 'CAPTCHA_TIMEOUT' : 'CAPTCHA_RESPONSE_INVALID', 'not_sent', undefined, undefined, exceptionCategory(error));
  }
  if (!verification || typeof verification !== 'object' || Array.isArray(verification) || typeof verification.success !== 'boolean'
    || (verification['error-codes'] !== undefined && (!Array.isArray(verification['error-codes']) || verification['error-codes'].some(code => typeof code !== 'string')))) {
    return failure(503, VERIFICATION_UNAVAILABLE, 'CAPTCHA_RESPONSE_INVALID');
  }
  if (!verification.success) {
    const codes = verification['error-codes'] || [];
    if (codes.some(code => ['missing-input-secret', 'invalid-input-secret'].includes(code))) {
      return failure(503, 'Verification is unavailable. Please contact Lavish directly.', 'CAPTCHA_CONFIGURATION_ERROR');
    }
    if (codes.includes('internal-error')) return failure(503, VERIFICATION_UNAVAILABLE, 'CAPTCHA_PROVIDER_ERROR');
    return failure(403, 'Please complete the verification again before submitting.', 'CAPTCHA_TOKEN_INVALID');
  }
  if (verification.hostname !== hostname || verification.action !== 'contact') {
    return failure(403, 'Please complete the verification again before submitting.', 'CAPTCHA_CONTEXT_MISMATCH');
  }
  return null;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function emailPayload(data, from) {
  const payload = {
    from: `Lavish Tree Service <${from}>`,
    to: [RECIPIENT],
    subject: `Website request: ${data.service}`,
    text: [
      'New website request for Lavish Tree Service',
      '',
      `Name: ${data.name}`,
      `Phone: ${data.phone}`,
      `Email: ${data.email || 'Not provided'}`,
      `Service: ${data.service}`,
      `Property: ${data.address}`,
      '',
      'Job details:',
      data.message,
      '',
      'This is a customer-submitted request. Contact the customer to confirm scope and availability.',
    ].join('\n'),
  };
  if (data.email) payload.reply_to = data.email;
  return payload;
}

export function createContactWorker({ fetchImpl = globalThis.fetch } = {}) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) {
        return typeof env.ASSETS?.fetch === 'function'
          ? env.ASSETS.fetch(request)
          : new Response('Not found', { status: 404 });
      }
      if (!['/api/contact', '/api/contact-config', '/api/contact-verify'].includes(url.pathname)) return failure(404, 'Not found.', 'NOT_FOUND');
      const verificationOnly = url.pathname === '/api/contact-verify';
      if (verificationOnly && url.origin !== PREVIEW_ORIGIN) return failure(403, 'This request is not allowed.', 'ORIGIN_NOT_ALLOWED');
      const config = configuration(env);
      if (!config.origins) return failure(403, 'This request is not allowed.', 'CONFIG_NOT_READY');
      if (!config.origins.has(url.origin)) return failure(403, 'This request is not allowed.', 'ORIGIN_NOT_ALLOWED');

      if (url.pathname === '/api/contact-config') {
        if (request.method !== 'GET') return failure(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED', 'not_sent', { Allow: 'GET' });
        return json({ enabled: config.enabled, recipient: RECIPIENT, diagnosticsVersion: 3, ...(config.enabled ? { siteKey: env.TURNSTILE_SITE_KEY } : {}) });
      }
      if (request.method !== 'POST') return failure(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED', 'not_sent', { Allow: 'POST' });
      if (request.headers.get('origin') !== url.origin
        || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) {
        return failure(403, 'This request is not allowed.', 'ORIGIN_NOT_ALLOWED');
      }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')
        || (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity')) {
        return failure(415, 'Please submit this request through the website form.', 'CONTENT_TYPE_UNSUPPORTED');
      }
      if (!config.enabled) {
        const code = env.CONTACT_FORM_ENABLED === 'true' && typeof env.CONTACT_RATE_LIMITER?.limit !== 'function'
          ? 'RATE_LIMIT_BINDING_UNAVAILABLE' : 'CONFIG_NOT_READY';
        return failure(503, UNAVAILABLE, code);
      }

      let sendAttempted = false;
      try {
        // Cloudflare supplies this header. Never trust X-Forwarded-For as a fallback.
        const ip = request.headers.get('cf-connecting-ip');
        if (!ip || ip.length > 45 || !/^[\da-fA-F:.]+$/.test(ip)) return failure(503, UNAVAILABLE, 'CLIENT_IP_UNAVAILABLE');
        let rate;
        try { rate = await env.CONTACT_RATE_LIMITER.limit({ key: `lavish-contact:${await sha256(ip)}` }); }
        catch { return failure(503, UNAVAILABLE, 'RATE_LIMIT_BINDING_UNAVAILABLE'); }
        if (typeof rate?.success !== 'boolean') return failure(503, UNAVAILABLE, 'RATE_LIMIT_BINDING_UNAVAILABLE');
        if (!rate.success) return failure(429, 'Too many attempts. Please wait one minute or contact Lavish directly.', 'RATE_LIMITED', 'not_sent', { 'Retry-After': '60' });
        const body = await boundedJson(request);
        const data = verificationOnly ? validateVerificationOnly(body) : validate(body);
        const verificationFailure = await verifyTurnstile(data, ip, url.hostname, env, fetchImpl);
        if (verificationFailure) return verificationFailure;
        // Structurally exit before creating any email or reaching the Resend code.
        if (verificationOnly) return json({ ok: true, verified: true, deliveryState: 'not_sent' });

        const payload = JSON.stringify(emailPayload(data, config.from));
        // Stable for unchanged entries + submission UUID, even after a fresh CAPTCHA.
        // Resend retains its idempotency record for 24 hours; this is not a permanent ledger.
        const idempotencyKey = `lavish-contact/${await sha256(`${data.submissionId.toLowerCase()}\n${payload}`)}`;
        let response;
        try {
          const sendOptions = {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
            body: payload,
            // Keep credentials and customer details on this exact endpoint.
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
          };
          sendAttempted = true;
          response = await fetchImpl('https://api.resend.com/emails', sendOptions);
          if (!response.ok) return failure(502, NOT_CONFIRMED, 'RESEND_REJECTED', 'rejected');
          const result = await boundedJson(response, MAX_UPSTREAM_BYTES);
          if (!result || typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) return failure(502, NOT_CONFIRMED, 'RESEND_RESULT_UNKNOWN', 'unknown');
          // This confirms provider acceptance, not mailbox delivery or appointment booking.
          return json({ ok: true, requestId: result.id }, 202);
        } catch {
          return sendAttempted
            ? failure(502, NOT_CONFIRMED, 'RESEND_RESULT_UNKNOWN', 'unknown')
            : failure(503, UNAVAILABLE, 'INTERNAL_ERROR');
        }
      } catch (error) {
        if (sendAttempted) return failure(502, NOT_CONFIRMED, 'RESEND_RESULT_UNKNOWN', 'unknown');
        if (error instanceof RequestError) return failure(error.status, error.message, error.code);
        return failure(503, UNAVAILABLE, 'INTERNAL_ERROR');
      }
    },
  };
}

export default createContactWorker();
