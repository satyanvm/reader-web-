// Same-origin proxy between the website and the sync server's account API.
//
// The sync server sends no CORS headers and hands out bearer tokens. This
// proxy runs on the website's own origin (a Cloudflare Pages Function in
// production, a Vite middleware in development) and:
//   - forwards only the account routes the website needs;
//   - keeps the session token in an HttpOnly cookie, so page scripts never see it;
//   - sets a readable `rs_auth=1` hint cookie, so pages can show "Account"
//     instead of "Sign in" without a request;
//   - rejects cross-site POSTs (Origin must match, body must be JSON).
import { site } from '../src/site.config';

export interface ProxyEnv {
  SYNC_API_ORIGIN?: string;
}

type RouteKind = 'public' | 'session' | 'signout';

const ROUTES = new Map<string, RouteKind>([
  ['POST /v1/auth/signup', 'public'],
  ['POST /v1/auth/verify', 'public'],
  ['POST /v1/auth/resend', 'public'],
  ['POST /v1/auth/signin', 'public'],
  ['POST /v1/auth/password/forgot', 'public'],
  ['POST /v1/auth/password/reset', 'public'],
  ['POST /v1/auth/google', 'public'],
  ['GET /v1/auth/providers', 'public'],
  ['GET /v1/me', 'session'],
  ['POST /v1/auth/signout', 'signout'],
]);

const SESSION_COOKIE = 'rs_session';
const HINT_COOKIE = 'rs_auth';
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days
const MAX_BODY = 8 * 1024;

const json = (status: number, body: unknown, headers = new Headers()) => {
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
};

const readCookie = (request: Request, name: string) => {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
};

const cookie = (name: string, value: string, opts: { path: string; httpOnly: boolean; sameSite: string; maxAge: number; secure: boolean }) =>
  [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
    `SameSite=${opts.sameSite}`,
    opts.httpOnly ? 'HttpOnly' : '',
    opts.secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');

const setSession = (headers: Headers, token: string, secure: boolean) => {
  headers.append('set-cookie', cookie(SESSION_COOKIE, token, { path: '/api', httpOnly: true, sameSite: 'Strict', maxAge: MAX_AGE, secure }));
  headers.append('set-cookie', cookie(HINT_COOKIE, '1', { path: '/', httpOnly: false, sameSite: 'Lax', maxAge: MAX_AGE, secure }));
};

const clearSession = (headers: Headers, secure: boolean) => {
  headers.append('set-cookie', cookie(SESSION_COOKIE, '', { path: '/api', httpOnly: true, sameSite: 'Strict', maxAge: 0, secure }));
  headers.append('set-cookie', cookie(HINT_COOKIE, '', { path: '/', httpOnly: false, sameSite: 'Lax', maxAge: 0, secure }));
};

const upstreamOrigin = (env: ProxyEnv) => {
  const origin = new URL(env.SYNC_API_ORIGIN || site.auth.apiOrigin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !local) throw new Error('SYNC_API_ORIGIN must use https');
  return origin.origin;
};

export async function handleAuthProxy(request: Request, env: ProxyEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api(?=\/)/, '');
  const kind = ROUTES.get(`${request.method} ${path}`);
  if (!kind) return json(404, { error: 'Not found.', code: 'not_found' });

  const secure = url.protocol === 'https:';
  const headers = new Headers({ accept: 'application/json' });
  let body: string | undefined;

  if (request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) {
      return json(403, { error: 'Cross-site request blocked.', code: 'bad_origin' });
    }
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
      return json(415, { error: 'Send JSON.', code: 'unsupported_media_type' });
    }
    body = await request.text();
    if (body.length > MAX_BODY) return json(413, { error: 'Request too large.', code: 'too_large' });
    headers.set('content-type', 'application/json');
  }

  if (kind !== 'public') {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) {
      const out = new Headers();
      clearSession(out, secure);
      return kind === 'signout'
        ? json(200, { status: 'signed_out' }, out)
        : json(401, { error: 'You’re not signed in.', code: 'unauthorized' }, out);
    }
    headers.set('authorization', `Bearer ${token}`);
  }

  let upstream: Response;
  try {
    upstream = await fetch(new URL(path, upstreamOrigin(env)), { method: request.method, headers, body });
  } catch {
    const out = new Headers();
    if (kind === 'signout') {
      clearSession(out, secure);
      return json(200, { status: 'signed_out' }, out);
    }
    return json(502, { error: 'Couldn’t reach the account service. Try again in a moment.', code: 'upstream_unreachable' }, out);
  }

  let data: Record<string, unknown> | null = null;
  try {
    const parsed = await upstream.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch {
    // fall through to the generic error below
  }

  const out = new Headers();
  if (data && typeof data.token === 'string') {
    setSession(out, data.token, secure);
    delete data.token;
  }
  if (kind === 'signout' || (kind === 'session' && upstream.status === 401)) clearSession(out, secure);

  if (!data) {
    return json(502, { error: 'The account service sent an unexpected response.', code: 'bad_upstream' }, out);
  }
  return json(upstream.status, data, out);
}
