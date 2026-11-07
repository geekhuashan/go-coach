import {DurableObject} from 'cloudflare:workers';

// One KataGo (b10) container on Cloudflare. The Worker reaches it only through this
// Durable Object; the container has no public port and no outbound internet.
export const ENGINE_PORT = 8080;
export const ENGINE_IDLE_MS = 10 * 60_000;
const WARM_ONLY_PROBE_MS = 1500;
const MAX_BUDGET_MS = 15_000;
const QUICK_FAILURE_MS = 1500;
const PATHS = new Set(['/move', '/review', '/analyze']);

const reply = (body, status) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export class KataGoContainer extends DurableObject {
  async token() {
    let value = await this.ctx.storage.get('bridge-token');
    if (!value) {
      value = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
      await this.ctx.storage.put('bridge-token', value);
    }
    return value;
  }

  async boot() {
    const container = this.ctx.container;
    if (!container) throw new Error('No container is configured for this Durable Object');
    const token = await this.token();
    if (!container.running) {
      try { container.start({env: {GO_COACH_ENGINE_TOKEN: token}, enableInternet: false}); }
      catch (error) { if (!container.running) throw error; }
    }
    await container.setInactivityTimeout?.(ENGINE_IDLE_MS);
    return token;
  }

  call(path, init, token, timeout) {
    return this.ctx.container.getTcpPort(ENGINE_PORT).fetch('http://engine' + path, {
      ...init,
      headers: {...init.headers, Authorization: 'Bearer ' + token},
      signal: AbortSignal.timeout(Math.max(50, timeout)),
    });
  }

  async health(token, deadline) {
    while (Date.now() < deadline) {
      try {
        const response = await this.call('/health', {method: 'GET', headers: {}}, token, Math.min(1000, deadline - Date.now()));
        if (response.status === 200) return await response.json();
        await response.arrayBuffer();
      } catch {}
      await pause(Math.min(250, Math.max(0, deadline - Date.now())));
    }
    return null;
  }

  async warm(token) {
    const status = await this.health(token, Date.now() + 60_000);
    if (!status || status.ready) return;
    try { await (await this.call('/warm', {method: 'POST', headers: {}}, token, 90_000)).arrayBuffer(); } catch {}
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || !PATHS.has(path)) return reply({error: 'Not found'}, 404);
    const budget = Math.min(MAX_BUDGET_MS, Math.max(100, Number(request.headers.get('x-engine-budget-ms')) || 8000));
    const deadline = Date.now() + budget;
    const warmOnly = request.headers.get('x-engine-warm-only') === '1';
    const wasRunning = !!this.ctx.container?.running;
    let token;
    try { token = await this.boot(); } catch { return reply({error: 'Container unavailable'}, 503); }
    // A live game must not wait for a cold start: answer "warming" at once so the
    // Worker can use the VPS, and let the next move find the model loaded.
    const status = warmOnly && !wasRunning ? null : await this.health(token, warmOnly ? Date.now() + Math.min(WARM_ONLY_PROBE_MS, budget) : deadline);
    if (!status || (warmOnly && !status.ready)) {
      const warming = this.warm(token);
      this.ctx.waitUntil?.(warming);
      return reply({error: 'Engine is warming up'}, 503);
    }
    const body = await request.text();
    // A dropped connection fails within milliseconds; KataGo only computes, so one
    // immediate retry is safe. A slow failure means the engine itself ran out of time.
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        const response = await this.call(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body}, token, deadline - Date.now());
        return new Response(response.body, {status: response.status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
      } catch {
        if (Date.now() - started > QUICK_FAILURE_MS || deadline - Date.now() < 1000) break;
      }
    }
    return reply({error: 'Engine timed out'}, 503);
  }
}
