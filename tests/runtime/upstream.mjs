// All native fetch calls terminate in this local service. No Internet binding.
export default {
  async fetch(request) {
    const body = await request.json();
    if (request.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      if (body.secret !== 'mock-turnstile' || body.response !== 'mock-token') throw new Error('Unexpected mock verification');
      return Response.json({ success: true, hostname: 'lavish-tree-service.3clo1979.workers.dev', action: 'contact' });
    }
    if (request.url === 'https://api.resend.com/emails') {
      if (request.headers.get('authorization') !== 'Bearer mock-resend') throw new Error('Unexpected mock credential');
      if (body.to.join(',') !== 'sales@lavishtreeservice.com') throw new Error('Unexpected recipient');
      if (!request.headers.get('idempotency-key')?.startsWith('lavish-contact/')) throw new Error('Missing idempotency key');
      return Response.json({ id: 'local-runtime-mock-receipt' });
    }
    throw new Error('Unexpected outbound URL');
  }
};
