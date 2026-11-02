// Cloudflare Worker for readserene.site (see wrangler.jsonc).
//
// The built site in dist/ is served as static assets. Requests under /api/*
// (the account proxy) and /download/* (app builds) run code first; everything
// else goes straight to the assets.
import { handleAuthProxy, type ProxyEnv } from './auth-proxy';
import { handleDownload } from './downloads';

interface Env extends ProxyEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleAuthProxy(request, env);
    if (pathname.startsWith('/download/')) return handleDownload(request);
    return env.ASSETS.fetch(request);
  },
};
