/** Progressive delivery enhancement: disabled unless the server confirms full readiness. */
export const RECIPIENT = 'sales@lavishtreeservice.com';
const KEYS = ['name', 'phone', 'email', 'service', 'address', 'message'];
export function normalizeConfig(value) {
  return value?.enabled === true && value.recipient === RECIPIENT &&
    typeof value.siteKey === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(value.siteKey)
    ? { enabled: true, siteKey: value.siteKey } : { enabled: false };
}
export function serializeRequest(data) {
  return Object.fromEntries([...KEYS, 'website'].map(key => [key, String(data.get(key) || '').trim()]));
}
export function requestFingerprint(values) {
  return JSON.stringify(KEYS.map(key => values[key] || ''));
}

const UNSURE = 'We could not confirm your request was sent. Your details are still here. Please call 440-452-7240 or email sales@lavishtreeservice.com before trying again.';
const PRE_SEND_REASONS = Object.freeze({
  CONFIG_NOT_READY: 'Online requests are temporarily unavailable.',
  ORIGIN_NOT_ALLOWED: 'This page could not submit the request. Please reload it.',
  VALIDATION_FAILED: 'Please check your contact details and project information.',
  BODY_TOO_LARGE: 'Please shorten your project details.',
  CLIENT_IP_UNAVAILABLE: 'Online requests are temporarily unavailable.',
  RATE_LIMIT_BINDING_UNAVAILABLE: 'Online requests are temporarily unavailable.',
  RATE_LIMITED: 'Too many attempts. Please wait one minute.',
  INTERNAL_ERROR: 'Online requests are temporarily unavailable.',
  NOT_FOUND: 'The request endpoint is unavailable.',
  METHOD_NOT_ALLOWED: 'This page could not submit the request. Please reload it.',
  CONTENT_TYPE_UNSUPPORTED: 'This page could not submit the request. Please reload it.',
  CAPTCHA_CONFIGURATION_ERROR: 'The security check is temporarily unavailable.',
  CAPTCHA_CONTEXT_MISMATCH: 'The security check could not verify this page.',
  CAPTCHA_UPSTREAM_UNAVAILABLE: 'The security check is temporarily unavailable.',
  CAPTCHA_HTTP_ERROR: 'The security check is temporarily unavailable.',
  CAPTCHA_REQUEST_ERROR: 'The security check is temporarily unavailable.',
  CAPTCHA_FETCH_ERROR: 'The security check is temporarily unavailable.',
  CAPTCHA_TIMEOUT: 'The security check took too long.',
  CAPTCHA_RESPONSE_INVALID: 'The security check is temporarily unavailable.',
  CAPTCHA_PROVIDER_ERROR: 'The security check is temporarily unavailable.',
  CAPTCHA_TOKEN_INVALID: 'The security check could not be verified. Please complete it again.'
});
export function safeFailureReference(result) {
  if (!Object.hasOwn(PRE_SEND_REASONS, result?.code)) return '';
  let reference = result.code;
  if (result.code === 'CAPTCHA_HTTP_ERROR' && Number.isInteger(result.upstreamStatus) && result.upstreamStatus >= 100 && result.upstreamStatus <= 599) reference += ` (HTTP ${result.upstreamStatus})`;
  if (['CAPTCHA_REQUEST_ERROR', 'CAPTCHA_FETCH_ERROR', 'CAPTCHA_TIMEOUT', 'CAPTCHA_RESPONSE_INVALID'].includes(result.code) && ['TypeError', 'RangeError', 'Error', 'AbortError', 'TimeoutError', 'OtherError'].includes(result.exceptionType)) reference += ` (${result.exceptionType})`;
  return reference;
}
export function describeDeliveryFailure(result) {
  const code = result?.code;
  if (result?.deliveryState === 'not_sent' && Object.hasOwn(PRE_SEND_REASONS, code)) {
    return `Your request was not sent. ${PRE_SEND_REASONS[code]} Your details are still here. Call 440-452-7240 or email sales@lavishtreeservice.com for help. Reference: ${safeFailureReference(result)}.`;
  }
  if (result?.deliveryState === 'rejected' && code === 'RESEND_REJECTED') {
    return 'The email service did not accept your request. Your details are still here. Please call 440-452-7240 or email sales@lavishtreeservice.com. Reference: RESEND_REJECTED.';
  }
  return UNSURE + (code === 'RESEND_RESULT_UNKNOWN' && result?.deliveryState === 'unknown' ? ' Reference: RESEND_RESULT_UNKNOWN.' : '');
}

export async function initializeContactForm({ document, window, fetch = window.fetch.bind(window) }) {
  const form = document.querySelector('#quote-form');
  const submit = form?.querySelector('.form-submit');
  if (!form || !submit) return false;
  let config;
  try {
    const response = await fetch('/api/contact-config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) return false;
    config = normalizeConfig(await response.json());
  } catch { return false; }
  if (!config.enabled) return false; // Preserve the existing explicitly preview-only experience.

  let token = '';
  let pending = false;
  let widgetId;
  let statusMode = 'general';
  let previousFingerprint = '';
  let submissionId = '';
  const status = document.createElement('div');
  status.className = 'form-result delivery-result';
  status.setAttribute('role', 'status');
  status.setAttribute('tabindex', '-1');
  status.hidden = true;
  form.append(status);
  const setStatus = (message, focus = false, mode = 'general') => {
    statusMode = mode;
    status.textContent = message;
    status.hidden = false;
    if (focus) status.focus({ preventScroll: true });
  };
  const refreshButton = () => { submit.disabled = pending || !token; };
  const resetChallenge = () => {
    token = '';
    if (window.turnstile && widgetId !== undefined) window.turnstile.reset(widgetId);
    refreshButton();
  };

  // Keep the honeypot out of keyboard and screen-reader navigation.
  const trap = document.createElement('label');
  trap.className = 'form-honeypot';
  trap.setAttribute('aria-hidden', 'true');
  trap.textContent = 'Leave this field empty';
  const trapInput = document.createElement('input');
  trapInput.name = 'website';
  trapInput.tabIndex = -1;
  trapInput.autocomplete = 'off';
  trap.append(trapInput);
  form.append(trap);
  const security = document.createElement('div');
  security.className = 'contact-security';
  security.setAttribute('aria-label', 'Spam prevention');
  submit.before(security);

  const description = document.querySelector('.quote-description');
  if (description) {
    const paragraphs = description.querySelectorAll('p');
    if (paragraphs[0]) paragraphs[0].textContent = 'Tell us about the work you need. Your request goes to sales@lavishtreeservice.com. For urgent tree concerns, please call instead.';
    if (paragraphs[1]) paragraphs[1].textContent = 'Your contact details and project information are sent to Lavish to respond to your request. Please do not include sensitive information.';
  }
  const formBadge = document.querySelector('.quote-heading > span');
  if (formBadge) formBadge.textContent = 'REQUEST A QUOTE';
  document.querySelector('#form-result')?.setAttribute('hidden', '');
  submit.textContent = 'Send request';
  submit.disabled = true;
  setStatus('Complete the security check to send your request.', false, 'security');

  // Capture prevents the old local-preview submit handler from running in verified live mode.
  form.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pending || !form.reportValidity()) return;
    if (!token) { setStatus('Please complete the security check first.', true); return; }
    const values = serializeRequest(new window.FormData(form));
    const fingerprint = requestFingerprint(values);
    if (!submissionId || fingerprint !== previousFingerprint) {
      previousFingerprint = fingerprint;
      submissionId = window.crypto.randomUUID();
    }
    pending = true;
    refreshButton();
    submit.textContent = 'Sending…';
    setStatus('Sending your request. Please keep this page open.');
    const controller = new window.AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let failureMessage = UNSURE;
    try {
      const response = await fetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...values, turnstileToken: token, submissionId }), signal: controller.signal
      });
      const result = await response.json();
      if (response.status !== 202 || result?.ok !== true || typeof result.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.requestId)) {
        failureMessage = describeDeliveryFailure(result);
        throw new Error('Request acceptance was not confirmed');
      }
      setStatus('Thank you — your request is on its way to Lavish. For urgent concerns, call 440-452-7240.', true, 'delivery');
      form.reset();
    } catch {
      setStatus(failureMessage, true, 'delivery');
    } finally {
      window.clearTimeout(timeout);
      pending = false;
      submit.textContent = 'Send request';
      resetChallenge();
    }
  }, { capture: true });

  const onWidgetReady = () => {
    try {
      widgetId = window.turnstile.render(security, {
        sitekey: config.siteKey, action: 'contact', theme: 'dark', size: 'flexible',
        callback: value => { token = value; refreshButton(); if (!pending && statusMode === 'security') status.hidden = true; },
        'expired-callback': () => { token = ''; refreshButton(); if (statusMode !== 'delivery') setStatus('The security check expired. Please complete it again.', false, 'security'); },
        'error-callback': () => { token = ''; refreshButton(); if (statusMode !== 'delivery') setStatus('The security check could not complete. Please try again, or call or email Lavish.', false, 'security'); }
      });
    } catch { setStatus('The security check is unavailable. Please call or email Lavish.'); }
  };
  if (window.turnstile) onWidgetReady();
  else {
    window.lavishContactTurnstileReady = onWidgetReady;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=lavishContactTurnstileReady&render=explicit';
    script.async = true;
    script.onerror = () => setStatus('The security check could not load. Please call or email Lavish.');
    document.head.append(script);
  }
  return true;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initializeContactForm({ document, window });
}
