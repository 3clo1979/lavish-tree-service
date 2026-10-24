import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('dist/index.html'), headers=read('dist/_headers');
const config=JSON.parse(read('wrangler.jsonc'));
test('published client is identical to tested source and loaded once as a module',()=>{
  assert.equal(read('dist/contact.js'),read('src/contact-client.mjs'));
  assert.equal((html.match(/<script type="module" src="contact.js"><\/script>/g)||[]).length,1);
});
test('Turnstile CSP grants only required script/frame and same-origin API access',()=>{
  assert.ok(headers.includes("script-src 'self' https://challenges.cloudflare.com;"));
  assert.ok(headers.includes('frame-src https://challenges.cloudflare.com;'));
  assert.ok(headers.includes("connect-src 'self';"));
  assert.ok(headers.includes("form-action 'none'"));
  assert.ok(!headers.includes('unsafe-inline')&&!headers.includes('unsafe-eval'));
});
test('worker and asset routing preserve the preview identity and do not alter domain routes',()=>{
  assert.equal(config.name,'lavish-tree-service'); assert.equal(config.main,'src/contact-worker.mjs');
  assert.equal(config.assets.binding,'ASSETS'); assert.deepEqual(config.assets.run_worker_first,['/api/*']);
  assert.equal(config.routes,undefined);assert.equal(config.route,undefined);
  assert.equal(config.vars.CONTACT_FROM,'webforms@notify.lavishtreeservice.com');
  assert.equal(config.vars.CONTACT_ALLOWED_ORIGINS,'https://lavishtreeservice.com,https://www.lavishtreeservice.com');
  assert.equal(config.vars.RESEND_API_KEY,undefined);assert.equal(config.vars.TURNSTILE_SECRET_KEY,undefined);
});
test('enabled deployment must include public site key and rate limiter prerequisites',()=>{
  assert.ok(['false','true'].includes(config.vars.CONTACT_FORM_ENABLED));
  if(config.vars.CONTACT_FORM_ENABLED==='true'){
    assert.match(config.vars.TURNSTILE_SITE_KEY,/^[A-Za-z0-9_-]{10,100}$/);
    const rate=config.ratelimits.find(r=>r.name==='CONTACT_RATE_LIMITER');
    assert.match(rate.namespace_id,/^[1-9][0-9]*$/); assert.deepEqual(rate.simple,{limit:5,period:60});
  }
});
