import {WorkerEntrypoint} from 'cloudflare:workers';
import worker from './worker.mjs';
import {makeSession} from './auth.mjs';

// Only a configured service binding can reach this entry point. The caller
// verifies its own family session first; no public request header grants access.
export class FamilyGo extends WorkerEntrypoint {
  async fetch(request) {
    const headers = new Headers(request.headers);
    const profiles = (headers.get('Cookie') || '').split(';').map(value=>value.trim()).filter(value=>/^go_profile=/.test(value));
    for (const name of [...headers.keys()]) if (/^(cookie|authorization|proxy-authorization|x-family-|x-learning-|x-go-|x-forwarded-)/i.test(name)) headers.delete(name);
    const token = await makeSession(this.env,60_000);
    headers.set('Cookie', `go_session=${encodeURIComponent(token)}${profiles.length===1?'; '+profiles[0]:''}`);
    const response = await worker.fetch(new Request(request,{headers}),this.env,this.ctx);
    const out = new Headers(response.headers);
    const cookies = response.headers.getSetCookie?.() || (response.headers.get('Set-Cookie')?[response.headers.get('Set-Cookie')]:[]);
    out.delete('Set-Cookie');
    // Per-device learner choice must survive. Internal authentication never escapes.
    for (const cookie of cookies) if (/^go_profile=/.test(cookie)) out.append('Set-Cookie',cookie);
    out.set('Cache-Control','private, no-store');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers:out});
  }
}

export default worker;
