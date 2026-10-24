import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, serializeRequest, requestFingerprint, describeDeliveryFailure, initializeContactForm } from '../src/contact-client.mjs';

test('live client stays disabled unless server explicitly confirms all public readiness fields', () => {
  for (const config of [undefined, {}, { enabled: true }, { enabled: 'true', recipient: 'sales@lavishtreeservice.com', siteKey: 'valid_test_key_123' }, { enabled: true, recipient: 'wrong@example.com', siteKey: 'valid_test_key_123' }, { enabled: true, recipient: 'sales@lavishtreeservice.com', siteKey: '<script>' }]) assert.deepEqual(normalizeConfig(config), { enabled: false });
  assert.deepEqual(normalizeConfig({ enabled: true, recipient: 'sales@lavishtreeservice.com', siteKey: 'valid_test_key_123' }), { enabled: true, siteKey: 'valid_test_key_123' });
});
test('client serializes only expected fields without an arbitrary recipient or sender', () => {
  const values = serializeRequest(new Map([['name', '  Preview  '], ['email', 'test@example.invalid'], ['to', 'other@example.invalid'], ['from', 'other@example.invalid']]));
  assert.equal(values.name, 'Preview'); assert.equal(values.phone, ''); assert.equal(values.website, '');
  assert.equal(values.to, undefined); assert.equal(values.from, undefined);
});
test('submission identity stays stable for retries but changes when request content changes', () => {
  const a = serializeRequest(new Map([['name', 'Test'], ['message', 'Tree project']]));
  assert.equal(requestFingerprint(a), requestFingerprint({ ...a, turnstileToken: 'new-token' }));
  assert.notEqual(requestFingerprint(a), requestFingerprint({ ...a, message: 'Changed project' }));
});
test('disabled, unreachable and static-only config preserves the existing preview DOM', async () => {
  const untouched = () => { throw new Error('Disabled mode must not mutate DOM'); };
  const submit = {};
  const form = { querySelector: () => submit };
  const document = { querySelector: () => form, createElement: untouched };
  const window = {};
  for (const fetch of [async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ enabled: false }) }), async () => { throw new Error('Network unavailable'); }, async () => ({ ok: true, json: async () => { throw new Error('HTML, not JSON'); } })]) {
    assert.equal(await initializeContactForm({ document, window, fetch }), false);
  }
  assert.deepEqual(submit, {});
});

function harness(post = async () => ({ ok: true, status: 202, json: async () => ({ ok: true, requestId: 'mock-provider-id' }) })) {
  const node = tag => ({ tag, attrs: {}, children: [], hidden: false, textContent: '', setAttribute(k,v) { this.attrs[k]=v; }, append(c) { this.children.push(c); }, before(c) { this.beforeNode=c; }, focus() { this.focused=true; } });
  const submit = node('button');
  const oldResult = node('div');
  const badge = node('span');
  const paragraphs = [node('p'), node('p')];
  const form = node('form');
  form.values = new Map([['name','Preview'],['phone','440-555-0100'],['email','test@example.invalid'],['service','Tree removal'],['address','Lorain'],['message','Preview only']]);
  form.querySelector = () => submit;
  form.reportValidity = () => true;
  form.addEventListener = (type, listener, options) => { form.listener=listener; form.options=options; };
  form.reset = () => { form.resets=(form.resets||0)+1; };
  const document = { head: node('head'), createElement: node, querySelector(selector) { return ({'#quote-form':form, '#form-result':oldResult, '.quote-description':{querySelectorAll:()=>paragraphs}, '.quote-heading > span':badge})[selector]; } };
  let uuid = 0;
  const window = { FormData: class extends Map { constructor(f) { super(f.values); } }, crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`}, AbortController, setTimeout:()=>1, clearTimeout:()=>{}, turnstile:{render(el, options) { window.widget=options; return 'widget-id'; }, reset() { window.resets=(window.resets||0)+1; }} };
  const requests=[];
  const fetch=async (url,options)=>{ if(url==='/api/contact-config')return {ok:true,json:async()=>({enabled:true,recipient:'sales@lavishtreeservice.com',siteKey:'valid_test_key_123'})};requests.push({url,options,payload:JSON.parse(options.body)});return post(); };
  const event=()=>({preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}});
  return {document,window,fetch,form,submit,requests,event,status:()=>form.children.find(n=>n.className==='form-result delivery-result')};
}

test('enabled form blocks submission until security validation, then sends only to its own endpoint', async () => {
  const h=harness(); assert.equal(await initializeContactForm(h),true); assert.equal(h.submit.disabled,true);
  await h.form.listener(h.event()); assert.equal(h.requests.length,0);
  h.window.widget.callback('mock-turnstile-token'); assert.equal(h.submit.disabled,false);
  const e=h.event();await h.form.listener(e);
  assert.equal(e.prevented,true);assert.equal(e.stopped,true);assert.equal(h.form.options.capture,true);
  assert.equal(h.requests.length,1); assert.equal(h.requests[0].url,'/api/contact');
  assert.equal(h.requests[0].payload.turnstileToken,'mock-turnstile-token');
  assert.equal(h.requests[0].payload.to,undefined);assert.equal(h.requests[0].payload.from,undefined);
  assert.equal(h.form.resets,1);assert.match(h.status().textContent,/on its way/);
  h.window.widget.callback('fresh-token');assert.equal(h.status().hidden,false,'security refresh must not hide the success notice');
});
test('failed delivery keeps entries and reuses submission identity across a user retry', async () => {
  const h=harness(async()=>({ok:false,json:async()=>({ok:false,error:'Unavailable'})}));await initializeContactForm(h);
  h.window.widget.callback('first-token');await h.form.listener(h.event());
  assert.equal(h.form.resets,undefined);assert.match(h.status().textContent,/could not confirm/);
  h.window.widget.callback('second-token');await h.form.listener(h.event());
  assert.equal(h.requests[0].payload.submissionId,h.requests[1].payload.submissionId);
  assert.equal(h.requests[1].payload.turnstileToken,'second-token');
  h.form.values.set('message','A changed project');h.window.widget.callback('third-token');await h.form.listener(h.event());
  assert.notEqual(h.requests[1].payload.submissionId,h.requests[2].payload.submissionId);
});
test('repeated clicks while sending cannot create a second request', async () => {
  let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));await initializeContactForm(h);
  h.window.widget.callback('mock-token');const sending=h.form.listener(h.event());
  await h.form.listener(h.event());assert.equal(h.requests.length,1);assert.equal(h.submit.disabled,true);
  finish({ok:true,status:202,json:async()=>({ok:true,requestId:'mock-provider-id'})});await sending;
});
test('expired and failed challenge tokens disable sending', async () => {
  const h=harness();await initializeContactForm(h);
  h.window.widget.callback('mock-token');h.window.widget['expired-callback']();assert.equal(h.submit.disabled,true);
  await h.form.listener(h.event());assert.equal(h.requests.length,0);
  h.window.widget.callback('mock-token');h.window.widget['error-callback']();assert.equal(h.submit.disabled,true);
});

for (const [name, response] of [
  ['non-acceptance status', { ok: true, status: 200, json: async () => ({ok:true,requestId:'id'}) }],
  ['missing provider receipt', { ok: true, status: 202, json: async () => ({ok:true}) }],
  ['malformed provider receipt', { ok: true, status: 202, json: async () => ({ok:true,requestId:'<invalid>'}) }]
]) test(`client never claims delivery for ${name}`, async () => {
  const h=harness(async()=>response); await initializeContactForm(h);
  h.window.widget.callback('mock-token'); await h.form.listener(h.event());
  assert.equal(h.form.resets, undefined); assert.match(h.status().textContent,/could not confirm/);
});

test('safe failure descriptions never claim no send without a recognized pre-provider code', () => {
  assert.match(describeDeliveryFailure({code:'RATE_LIMIT_BINDING_UNAVAILABLE',deliveryState:'not_sent'}),/was not sent.*Reference: RATE_LIMIT_BINDING_UNAVAILABLE/);
  assert.match(describeDeliveryFailure({code:'RESEND_REJECTED',deliveryState:'rejected'}),/did not accept/);
  for(const value of [{code:'RESEND_RESULT_UNKNOWN',deliveryState:'unknown'},{code:'RESEND_REJECTED',deliveryState:'not_sent'},{code:'<script>',deliveryState:'not_sent'},{code:'constructor',deliveryState:'not_sent'},{}]){
    const message=describeDeliveryFailure(value); assert.match(message,/could not confirm/); assert.ok(!message.includes('<script>'));
  }
});
test('diagnostic response preserves entries and displays only the safe public reference',async()=>{
  const h=harness(async()=>({ok:false,status:503,json:async()=>({ok:false,code:'RATE_LIMIT_BINDING_UNAVAILABLE',deliveryState:'not_sent',error:'raw upstream must not be shown'})}));
  await initializeContactForm(h);h.window.widget.callback('mock-token');await h.form.listener(h.event());
  assert.equal(h.form.resets,undefined);assert.match(h.status().textContent,/Reference: RATE_LIMIT_BINDING_UNAVAILABLE/);assert.ok(!h.status().textContent.includes('raw upstream'));
  const notice=h.status().textContent;
  h.window.widget['expired-callback']();h.window.widget.callback('new-token');
  assert.equal(h.status().textContent,notice);assert.equal(h.status().hidden,false);
});
test('success notice survives later CAPTCHA expiration and refresh without another send',async()=>{
  const h=harness();await initializeContactForm(h);h.window.widget.callback('mock-token');await h.form.listener(h.event());
  const notice=h.status().textContent;h.window.widget['expired-callback']();h.window.widget.callback('new-token');
  assert.equal(h.status().textContent,notice);assert.equal(h.status().hidden,false);assert.equal(h.requests.length,1);
});
test('granular verification diagnostics show only safe status or exception category',()=>{
  assert.match(describeDeliveryFailure({code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:400}),/CAPTCHA_HTTP_ERROR \(HTTP 400\)/);
  assert.match(describeDeliveryFailure({code:'CAPTCHA_FETCH_ERROR',deliveryState:'not_sent',exceptionType:'TypeError'}),/CAPTCHA_FETCH_ERROR \(TypeError\)/);
  for(const value of [{code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:'sensitive'},{code:'CAPTCHA_FETCH_ERROR',deliveryState:'not_sent',exceptionType:'sensitive'}])assert.ok(!describeDeliveryFailure(value).includes('sensitive'));
});

test('HTTP provider classification displays only the fixed diagnostic enum',()=>{
 assert.match(describeDeliveryFailure({code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:400,providerCategory:'configuration'}),/HTTP 400.*category: configuration/);
 assert.ok(!describeDeliveryFailure({code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',providerCategory:'sensitive value'}).includes('sensitive'));
});

test('provider error code is chosen from the fixed documented allowlist only',()=>{
 assert.match(describeDeliveryFailure({code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:400,providerCode:'invalid-input-secret'}),/provider: invalid-input-secret/);
 assert.ok(!describeDeliveryFailure({code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',providerCode:'sensitive value'}).includes('sensitive'));
});
