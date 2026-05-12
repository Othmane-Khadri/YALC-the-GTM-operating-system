/**
 * Local webhook receiver for FullEnrich callbacks during development.
 *
 * Two modes:
 *   1. waitForCallback({ enrichmentId, port, timeoutMs }) — spins up a tiny
 *      HTTP server, returns a Promise<webhookPayload> when FullEnrich POSTs back.
 *      Pair with a tunnel (ngrok, cloudflared) so the public URL is reachable.
 *
 *   2. fetchFromWebhookSite(uuid, since) — convenience for tests using
 *      https://webhook.site (no tunnel required, just paste the public URL).
 *
 * No Express dependency; uses node:http only so the skill stays zero-deps.
 */

import http from 'node:http';

export function startReceiver({ port = 3737, path = '/fullenrich' } = {}) {
  const calls = [];
  const subscribers = [];

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith(path)) {
      res.statusCode = 404; return res.end();
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch { payload = body; }
      calls.push(payload);
      res.statusCode = 200; res.end('ok');
      subscribers.splice(0).forEach(fn => fn(payload));
    });
  });

  return new Promise(resolve => {
    server.listen(port, () => resolve({
      port,
      path,
      url: `http://localhost:${port}${path}`,
      calls,
      next: () => new Promise(r => subscribers.push(r)),
      stop: () => new Promise(r => server.close(r)),
    }));
  });
}

/**
 * Poll webhook.site for the FullEnrich callback. Useful for tests where a tunnel
 * isn't available.
 *
 * @param {string} uuid       webhook.site token UUID (the part after /token/)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=120000]
 * @param {number} [opts.intervalMs=5000]
 * @param {(p: any) => boolean} [opts.matches]  Only resolve when this returns true (e.g. payload.id === enrichmentId)
 */
export async function fetchFromWebhookSite(uuid, opts = {}) {
  const { timeoutMs = 120_000, intervalMs = 5000, matches } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`https://webhook.site/token/${uuid}/requests?sorting=newest&page=1&per_page=10`);
    const j = await r.json();
    for (const req of (j.data || [])) {
      let payload;
      try { payload = JSON.parse(req.content); } catch { continue; }
      if (!matches || matches(payload)) return payload;
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }
  throw new Error(`webhook.site: no matching callback within ${timeoutMs}ms`);
}

/**
 * Provision a fresh webhook.site URL on demand. Returns { uuid, url }.
 */
export async function createWebhookSiteToken() {
  const r = await fetch('https://webhook.site/token', { method: 'POST' });
  const j = await r.json();
  return { uuid: j.uuid, url: `https://webhook.site/${j.uuid}` };
}
