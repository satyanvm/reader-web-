// Client side of the account pages. All requests go to the same-origin /api
// proxy, which keeps the session token in an HttpOnly cookie.
import { site } from '../site.config';

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T & { error?: string; code?: string };
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: 'You seem to be offline. Check your connection and try again.', code: 'network' } as ApiResult<T>['data'],
    };
  }
}

export interface Providers {
  google: boolean;
  emailCodes: boolean;
}

let providers: Promise<Providers> | null = null;
export const getProviders = () =>
  (providers ??= api<{ google?: boolean; emailCodes?: boolean }>('/v1/auth/providers').then((r) => ({
    google: Boolean(r.ok && r.data.google && site.auth.googleClientId),
    emailCodes: Boolean(r.ok && r.data.emailCodes),
  })));

/** A same-site path, or the account page: never another origin. */
export const safePath = (p: unknown) =>
  typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : '/account';

/** Where to go after signing in: ?next= when it's a same-site path. */
export const nextPath = () => safePath(new URLSearchParams(location.search).get('next'));

export const finishSignIn = () => location.assign(nextPath());

/** The email being confirmed or reset is kept in sessionStorage, never in the URL. */
export const pendingEmail = {
  get: () => {
    try {
      return sessionStorage.getItem('rs_pending_email') ?? '';
    } catch {
      return '';
    }
  },
  set: (email: string) => {
    try {
      sessionStorage.setItem('rs_pending_email', email);
    } catch {
      /* private mode: the form still has the email */
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem('rs_pending_email');
    } catch {
      /* ignore */
    }
  },
};

export function showError(form: HTMLElement, message: string | undefined) {
  const box = form.querySelector<HTMLElement>('.form-error');
  if (!box) return;
  box.textContent = message || 'Something went wrong. Try again.';
  box.hidden = false;
}

export function clearError(form: HTMLElement) {
  const box = form.querySelector<HTMLElement>('.form-error');
  if (box) box.hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}

export function markInvalid(input: HTMLInputElement | null) {
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

export async function busy<T>(button: HTMLButtonElement | null, work: () => Promise<T>): Promise<T> {
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    return await work();
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

/** Show/hide buttons next to password fields. */
export function wirePasswordToggles(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('.reveal-pw').forEach((btn) => {
    const input = btn.parentElement?.querySelector('input');
    if (!input) return;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  });
}

/** Moves between the steps of a page (e.g. password form → code form). */
export function showStep(root: ParentNode, name: string) {
  root.querySelectorAll<HTMLElement>('[data-step]').forEach((el) => {
    el.hidden = el.dataset.step !== name;
  });
  const step = root.querySelector<HTMLElement>(`[data-step="${name}"]`);
  const heading = step?.querySelector<HTMLElement>('h1, h2');
  (heading ?? step?.querySelector<HTMLElement>('input'))?.focus();
}

// Google sign-in uses Google's OpenID Connect redirect (response_type=id_token)
// rather than the Google Identity Services script, which needs inline styles
// that the site's Content-Security-Policy blocks. Google sends the visitor back
// to /auth/google with an ID token, which the sync server verifies.
const GOOGLE_STATE = 'rs_google';

const randomString = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const googleRedirectUri = () => `${location.origin}/auth/google`;

/** Shows the "Continue with Google" button when the server and site config both allow it. */
export async function mountGoogle(container: HTMLElement | null, onError: (msg: string) => void) {
  if (!container || !site.auth.googleClientId) return;
  if (!(await getProviders()).google) return;
  container.hidden = false;
  container.querySelector('button')?.addEventListener('click', () => {
    const state = randomString();
    const nonce = randomString();
    try {
      sessionStorage.setItem(GOOGLE_STATE, JSON.stringify({ state, nonce, next: nextPath() }));
    } catch {
      return onError('Your browser is blocking storage this page needs. Sign in with email instead, or allow site data.');
    }
    const params = new URLSearchParams({
      client_id: site.auth.googleClientId,
      redirect_uri: googleRedirectUri(),
      response_type: 'id_token',
      scope: 'openid email',
      nonce,
      state,
      prompt: 'select_account',
    });
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });
}

/** Reads (and forgets) what the Google button stored before leaving for Google. */
export function takeGoogleState(): { state: string; nonce: string; next: string } | null {
  try {
    const raw = sessionStorage.getItem(GOOGLE_STATE);
    sessionStorage.removeItem(GOOGLE_STATE);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.state === 'string' && typeof v.nonce === 'string' ? { ...v, next: safePath(v.next) } : null;
  } catch {
    return null;
  }
}

/** The `nonce` claim of an ID token (signature checks happen on the server). */
export function idTokenNonce(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).nonce ?? null;
  } catch {
    return null;
  }
}

/** Forwards ?next= to links between the account pages. */
export function keepNext(root: ParentNode = document) {
  const next = new URLSearchParams(location.search).get('next');
  if (!next) return;
  root.querySelectorAll<HTMLAnchorElement>('a[data-keep-next]').forEach((a) => {
    const u = new URL(a.href);
    u.searchParams.set('next', next);
    a.href = u.pathname + u.search;
  });
}

/**
 * The "check your email" step: confirm a new account with its 6-digit code.
 * `onBack` returns to the previous step.
 */
export function wireCodeStep(root: ParentNode, onBack: () => void) {
  const step = root.querySelector<HTMLElement>('[data-step="code"]');
  const form = step?.querySelector<HTMLFormElement>('form');
  if (!step || !form) return { open: (_email: string) => {} };
  const input = form.querySelector<HTMLInputElement>('input[name="code"]')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const resend = form.querySelector<HTMLButtonElement>('[data-resend]');
  const resent = form.querySelector<HTMLElement>('[data-resent]');
  let email = '';

  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(form);
    if (!/^\d{6}$/.test(input.value)) {
      showError(form, 'Enter the 6-digit code from the email.');
      return markInvalid(input);
    }
    const r = await busy(submit, () => api('/v1/auth/verify', { email, code: input.value }));
    if (r.ok) {
      pendingEmail.clear();
      return finishSignIn();
    }
    showError(form, r.data.error);
    markInvalid(input);
  });

  resend?.addEventListener('click', async () => {
    clearError(form);
    if (resent) resent.hidden = true;
    const r = await busy(resend, () => api('/v1/auth/resend', { email }));
    if (r.ok && resent) resent.hidden = false;
    else showError(form, r.data.error);
  });

  step.querySelector('[data-back]')?.addEventListener('click', onBack);

  return {
    open(forEmail: string) {
      email = forEmail;
      pendingEmail.set(email);
      step.querySelectorAll<HTMLElement>('[data-email-out]').forEach((el) => (el.textContent = email));
      input.value = '';
      clearError(form);
      if (resent) resent.hidden = true;
      showStep(root, 'code');
    },
  };
}
