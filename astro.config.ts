import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig } from 'astro/config';
import type { Plugin } from 'vite';
import { handleAuthProxy } from './server/auth-proxy';
import { site } from './src/site.config';

// In production, functions/api/[[path]].ts serves /api/* on Cloudflare Pages.
// `astro dev` and `astro preview` don't run Pages Functions, so this plugin
// serves the same proxy from Vite. SYNC_API_ORIGIN picks the sync server
// (e.g. http://127.0.0.1:8787 for one running locally).
const devApi = (): Plugin => {
  // Connect strips the '/api' mount from req.url and keeps the full path in originalUrl.
  const middleware = async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    const request = new Request(`http://${req.headers.host}${req.originalUrl ?? req.url}`, {
      method: req.method,
      headers,
      body: chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined,
    });
    const response = await handleAuthProxy(request, { SYNC_API_ORIGIN: process.env.SYNC_API_ORIGIN });
    res.statusCode = response.status;
    response.headers.forEach((v, k) => {
      if (k !== 'set-cookie') res.setHeader(k, v);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: 'readserene-dev-api',
    configureServer(server) {
      server.middlewares.use('/api', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', middleware);
    },
  };
};

export default defineConfig({
  site: site.url,
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'file', inlineStylesheets: 'always' },
  markdown: { syntaxHighlight: false },
  vite: { plugins: [devApi()] },
  // Hash-based Content-Security-Policy <meta> for every page. Astro hashes the
  // scripts and styles it renders; nothing is loaded from other origins (Google
  // sign-in is a redirect, not a script).
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ],
    },
  },
});
