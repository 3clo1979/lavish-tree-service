import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describeVerificationResult, initializeVerificationCheck } from '../src/verification-client.mjs';

function harness(post=async()=>({ok:true,json:async()=>({ok:true,verified:true,deliveryState:'not_sent'})}),origin='https://lavish-tree-service.3clo1979.workers.dev'){
  const node=()=>({textContent:'',disabled:true,children:[],append(x){this.children.push(x);},focus(){this.focused=true;}});
  const button=node(),status=node(),widget=node(),form=node();form.querySelector=()=>button;form.addEventListener=(type,listener)=>form.listener=listener;
  const document={querySelector:s=>({'#verification-check-form':form,'#verification-status':status,'#verification-widget':widget})[s],createElement:node,head:node()};
  const window={location:{origin},AbortController,setTimeout:()=>1,clearTimeout(){},turnstile:{render(el,options){window.widget=options;return 'id';},reset(){window.resetCount=(window.resetCount||0)+1;}}};
  const requests=[];const fetch=async(url,options)=>{requests.push({url,options});if(url==='/api/contact-config')return{ok:true,json:async()=>({enabled:true,diagnosticsVersion:3,recipient:'sales@lavishtreeservice.com',siteKey:'mock_public_site_key'})};return post();};
  return{document,window,fetch,button,status,form,requests,event:{preventDefault(){}}};
}
test('verification diagnostic stays preview-only and sends no requests on custom domains',async()=>{for(const origin of ['https://lavishtreeservice.com','https://www.lavishtreeservice.com','https://attacker.example']){const h=harness(undefined,origin);assert.equal(await initializeVerificationCheck(h),false);assert.equal(h.requests.length,0);assert.equal(h.button.disabled,true);}});
test('verification diagnostic requires exact readiness revision and valid public settings',async()=>{for(const config of [{enabled:true,diagnosticsVersion:1},{enabled:false,diagnosticsVersion:3},{enabled:true,diagnosticsVersion:3,recipient:'other@example.com',siteKey:'mock_public_site_key'}]){const h=harness();h.fetch=async()=>({ok:true,json:async()=>config});assert.equal(await initializeVerificationCheck(h),false);assert.equal(h.button.disabled,true);}});
test('no submission is possible without a genuine-widget callback; payload contains only token',async()=>{const h=harness();await initializeVerificationCheck(h);await h.form.listener(h.event);assert.equal(h.requests.length,1);h.window.widget.callback('local-mock-token');await h.form.listener(h.event);assert.equal(h.requests.length,2);assert.equal(h.requests[1].url,'/api/contact-verify');assert.deepEqual(JSON.parse(h.requests[1].options.body),{turnstileToken:'local-mock-token'});assert.match(h.status.textContent,/passed.*No email/);assert.equal(h.window.widget.action,'contact');});
test('verification diagnostic prevents concurrent repeats and never auto-retries',async()=>{let finish;const h=harness(()=>new Promise(r=>finish=r));await initializeVerificationCheck(h);h.window.widget.callback('local-mock');const first=h.form.listener(h.event);await h.form.listener(h.event);assert.equal(h.requests.length,2);finish({ok:false,json:async()=>({ok:false,code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:400})});await first;assert.match(h.status.textContent,/HTTP 400/);assert.equal(h.button.disabled,true);h.window.widget.callback('new-local-mock');assert.equal(h.requests.length,2);assert.match(h.status.textContent,/HTTP 400/);});
test('verification status displays only allowlisted categories and numeric status',()=>{assert.match(describeVerificationResult({ok:false,code:'CAPTCHA_FETCH_ERROR',deliveryState:'not_sent',exceptionType:'TypeError',error:'do not reveal'}),/CAPTCHA_FETCH_ERROR \(TypeError\)/);for(const result of [{code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:'secret'},{code:'CAPTCHA_FETCH_ERROR',deliveryState:'not_sent',exceptionType:'secret'},{code:'secret',deliveryState:'not_sent'},{ok:true,verified:true,deliveryState:'unknown'}])assert.ok(!describeVerificationResult(result).includes('secret'));});
test('verification diagnostic is isolated from email endpoint and main navigation, with identical deployed source',async()=>{const source=await readFile(new URL('../src/verification-client.mjs',import.meta.url),'utf8');assert.equal(source,await readFile(new URL('../dist/verification-check.js',import.meta.url),'utf8'));assert.ok(!source.includes("fetch('/api/contact',"));const html=await readFile(new URL('../dist/verification-check.html',import.meta.url),'utf8');assert.match(html,/noindex,nofollow/);assert.ok(!/<input\b/.test(html));assert.ok(!(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).includes('verification-check'));});

test('HTTP provider classification is allowlisted and never displays raw error data',()=>{
  assert.match(describeVerificationResult({ok:false,code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:400,providerCategory:'configuration'}),/HTTP 400.*category: configuration/);
  assert.ok(!describeVerificationResult({ok:false,code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:400,providerCategory:'sensitive value'}).includes('sensitive'));
});

test('provider error code is chosen from the fixed documented allowlist only',()=>{
 assert.match(describeVerificationResult({code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',upstreamStatus:400,providerCode:'invalid-input-secret'}),/provider: invalid-input-secret/);
 assert.ok(!describeVerificationResult({code:'CAPTCHA_HTTP_ERROR',deliveryState:'not_sent',providerCode:'sensitive value'}).includes('sensitive'));
});
