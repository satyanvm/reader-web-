// Cloudflare Workers entry point. Static files in dist/ are served straight from
// assets (see wrangler.jsonc); only /api/* runs this code, which is the same
// account proxy that functions/api/[[path]].ts serves on Cloudflare Pages.
import { handleAuthProxy, type ProxyEnv } from './auth-proxy';

export default {
  fetch: (request: Request, env: ProxyEnv) => handleAuthProxy(request, env),
};
