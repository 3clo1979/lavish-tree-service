/** Preview-only troubleshooting UI. This module never calls the email endpoint. */
export function describeVerificationResult(result) {
  if (result?.ok === true && result.verified === true && result.deliveryState === 'not_sent') return 'Security verification passed. No email was sent.';
  const codes = ['CONFIG_NOT_READY','ORIGIN_NOT_ALLOWED','VALIDATION_FAILED','BODY_TOO_LARGE','CLIENT_IP_UNAVAILABLE','RATE_LIMIT_BINDING_UNAVAILABLE','RATE_LIMITED','INTERNAL_ERROR','NOT_FOUND','METHOD_NOT_ALLOWED','CONTENT_TYPE_UNSUPPORTED','CAPTCHA_CONFIGURATION_ERROR','CAPTCHA_CONTEXT_MISMATCH','CAPTCHA_TOKEN_INVALID','CAPTCHA_HTTP_ERROR','CAPTCHA_REQUEST_ERROR','CAPTCHA_FETCH_ERROR','CAPTCHA_TIMEOUT','CAPTCHA_RESPONSE_INVALID','CAPTCHA_PROVIDER_ERROR'];
  if (result?.deliveryState !== 'not_sent' || !codes.includes(result?.code)) return 'The security-check result could not be read. This diagnostic does not send email.';
  let reference = result.code;
  if (result.code === 'CAPTCHA_HTTP_ERROR' && Number.isInteger(result.upstreamStatus) && result.upstreamStatus >= 100 && result.upstreamStatus <= 599) reference += ` (HTTP ${result.upstreamStatus})`;
  if (['CAPTCHA_REQUEST_ERROR','CAPTCHA_FETCH_ERROR','CAPTCHA_TIMEOUT','CAPTCHA_RESPONSE_INVALID'].includes(result.code) && ['TypeError','RangeError','Error','AbortError','TimeoutError','OtherError'].includes(result.exceptionType)) reference += ` (${result.exceptionType})`;
  if (result.code === 'CAPTCHA_HTTP_ERROR' && ['configuration','token','request','internal','unknown'].includes(result.providerCategory)) reference += ` [category: ${result.providerCategory}]`;
  if (result.code === 'CAPTCHA_HTTP_ERROR' && ['missing-input-secret','invalid-input-secret','missing-input-response','invalid-input-response','timeout-or-duplicate','bad-request','internal-error','unknown'].includes(result.providerCode)) reference += ` [provider: ${result.providerCode}]`;
  return `Verification did not pass. No email was sent. Reference: ${reference}.`;
}
export async function initializeVerificationCheck({document,window,fetch = window.fetch.bind(window)}) {
  const form = document.querySelector('#verification-check-form');
  const status = document.querySelector('#verification-status');
  const button = form?.querySelector('button');
  if (!form || !status || !button) return false;
  const say = message => { status.textContent = message; };
  if (window.location.origin !== 'https://lavish-tree-service.3clo1979.workers.dev') { say('This diagnostic is available only on the Cloudflare preview. No email can be sent here.'); return false; }
  let config;
  try {
    const response = await fetch('/api/contact-config',{cache:'no-store',headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error('Configuration unavailable');
    config = await response.json();
    if (config?.enabled !== true || config.diagnosticsVersion !== 3 || config.recipient !== 'sales@lavishtreeservice.com' || typeof config.siteKey !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(config.siteKey)) throw new Error('Configuration not ready');
  } catch { say('The verification diagnostic is not ready. No email was sent.'); return false; }
  let token = '', pending = false, widgetId, resultShown = false;
  const refresh = () => { button.disabled = pending || !token; };
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (pending || !token) return;
    pending = true; refresh(); say('Checking security verification only…');
    const controller = new window.AbortController();
    const timer = window.setTimeout(()=>controller.abort(),15000);
    try {
      const response = await fetch('/api/contact-verify',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({turnstileToken:token}),signal:controller.signal});
      const result = await response.json();
      say(response.ok || result?.ok === false ? describeVerificationResult(result) : 'The security-check result could not be read. No email can be sent by this diagnostic.');
    } catch { say('The security-check result could not be read. No email can be sent by this diagnostic.'); }
    finally { window.clearTimeout(timer); pending = false; resultShown = true; token = ''; if(window.turnstile && widgetId !== undefined)window.turnstile.reset(widgetId);refresh();status.focus({preventScroll:true}); }
  });
  const ready = () => {
    try {
      widgetId = window.turnstile.render(document.querySelector('#verification-widget'),{sitekey:config.siteKey,action:'contact',theme:'dark',size:'flexible',callback:value=>{token=value;refresh();if(!resultShown&&!pending)say('Ready to check. This diagnostic cannot send email.');},'expired-callback':()=>{token='';refresh();if(!resultShown&&!pending)say('Complete the security check again. No email was sent.');},'error-callback':()=>{token='';refresh();if(!resultShown&&!pending)say('The browser security check could not complete. No email was sent.');}});
    } catch { say('The browser security check is unavailable. No email was sent.'); }
  };
  say('Complete the security check, then use the button. No email will be sent.');
  if(window.turnstile)ready();
  else {window.lavishVerificationReady=ready;const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=lavishVerificationReady&render=explicit';script.async=true;script.onerror=()=>say('The browser security check could not load. No email was sent.');document.head.append(script);}
  return true;
}
if(typeof document!=='undefined'&&typeof window!=='undefined')initializeVerificationCheck({document,window});
