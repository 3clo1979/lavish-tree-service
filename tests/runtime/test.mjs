import worker from './contact-worker.mjs';
export default {
  async test() {
    // Prove the portability hazard in the actual Worker runtime without network.
    let unsupported;
    try { new Request('https://example.com', { redirect: 'error' }); } catch (error) { unsupported = error; }
    if (!(unsupported instanceof TypeError)) throw new Error('Expected workerd to reject redirect:error');
    const origin = 'https://lavish-tree-service.3clo1979.workers.dev';
    const request = new Request(`${origin}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '192.0.2.1' },
      body: JSON.stringify({ name: 'Local runtime test', phone: '202-555-0123', email: 'test@example.com', service: 'Not sure yet', address: 'Fictional location', message: 'Local isolated runtime test only', website: '', turnstileToken: 'mock-token', submissionId: '2fa342f7-a4e4-4d02-9ed0-2aa0704e4489' })
    });
    const response = await worker.fetch(request, {
      CONTACT_FORM_ENABLED: 'true', CONTACT_FROM: 'webforms@notify.lavishtreeservice.com',
      RESEND_API_KEY: 'mock-resend', TURNSTILE_SECRET_KEY: 'mock-turnstile', TURNSTILE_SITE_KEY: 'mock-public',
      CONTACT_RATE_LIMITER: { async limit() { return { success: true }; } }
    });
    const result = await response.json();
    if (response.status !== 202 || result.requestId !== 'local-runtime-mock-receipt') throw new Error(`Native Worker integration failed: ${response.status} ${result.code || 'invalid receipt'}`);
    console.log('PASS: actual native Worker fetch, verification, parsing, and email adapter with isolated local mocks; no real email sent');
  }
};
