// Cloudflare Pages Function for /api/*: the account proxy (see server/auth-proxy.ts).
import { handleAuthProxy, type ProxyEnv } from '../../server/auth-proxy';

export const onRequest = (context: { request: Request; env: ProxyEnv }) =>
  handleAuthProxy(context.request, context.env);
