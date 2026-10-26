# Readserene website

The marketing site for Readserene: a single page (`index.html`) plus `privacy.html` and `terms.html`. It's built with Astro as a static site with plain CSS and a few small vanilla scripts (platform detection, mobile menu, pricing toggle and reading demo).

## Develop

You need Node 22.12 or later.

```bash
npm install
```

```bash
npm run dev
```

The dev server runs at http://localhost:4321.

```bash
npm run build
```

`npm run build` writes the static site to `dist/`. To check the production build locally, run `npm run preview`.

The share image (`public/og.png`) and PNG favicons are committed. If you change the product name or `public/favicon.svg`, regenerate them on a Mac with `npm run assets` and commit the result. They are not rebuilt during deploys because Linux build machines draw the text with different fonts.

## Launch check

```bash
npm run check:launch
```

This lists every placeholder that would ship: `example.com` links and emails, values marked `// TODO`, `pricingIsPlaceholder: true`, and the template notices on the privacy and terms pages. It exits with an error until the list is empty. Links for platforms marked `available: false` are skipped, because those buttons aren't shown yet. CI runs it on every website change and prints the list without failing.

## Deploy to Cloudflare Pages

```bash
npm run deploy
```

`npm run deploy` runs the launch check, builds, and uploads `dist/` with `npx wrangler pages deploy dist --project-name readserene`. The first deploy asks you to sign in to Cloudflare and creates the `readserene` project. To change the project name, edit the `deploy` script in `package.json`.

To deploy from Git instead, connect the repository in the Cloudflare dashboard with the build command `npm run build` and output directory `dist`. The `.nvmrc` file tells Pages to build with Node 22. A Git deploy doesn't run the launch check, so run it yourself first.

After the first deploy, add your custom domain under the project's Custom domains tab, and set the same domain as `url` in `src/site.config.ts`.

`public/_headers` sets long cache lifetimes for fonts and hashed assets, and security headers (HSTS, no framing, a restrictive Permissions-Policy). Each page also carries a hash-based Content-Security-Policy that Astro generates, so the site loads nothing from other origins. If you add an external script, style or image, add its origin to `security.csp` in `astro.config.ts`. Cloudflare Pages serves `privacy.html` at `/privacy` and uses `404.html` for unknown paths.

## Accounts and sign-in

The site signs people in to the same accounts as the apps. Accounts live on the sync server (`server/` in the reader-android repository). The pages are `/signin`, `/signup`, `/reset`, `/account` and `/auth/google` (the Google callback).

The sync server sends no CORS headers and issues bearer tokens, so the browser never talks to it directly. Requests go to `/api/*` on the site's own origin:

- **In production**, `functions/api/[[path]].ts` (a Cloudflare Pages Function) handles `/api/*`.
- **In development**, `astro dev` and `astro preview` serve the same code from `server/auth-proxy.ts`.

The proxy:

- forwards only the account routes the site needs (sign-up, email codes, sign-in, password reset, Google, providers, `me`, sign-out);
- keeps the session token in an HttpOnly, `SameSite=Strict` cookie that page scripts can't read;
- sets a readable `rs_auth=1` cookie so pages can show "Account" without a request;
- rejects POSTs from other origins and non-JSON bodies.

Signing out ends the session on the server too.

The sync server's address is `auth.apiOrigin` in `src/site.config.ts`. To point a deployment somewhere else, set the `SYNC_API_ORIGIN` environment variable in the Pages project settings.

To develop against a local sync server, run it from the reader-android repository (`cd server && npm start`), then start this site with:

```bash
SYNC_API_ORIGIN=http://127.0.0.1:8787 npm run dev
```

What the pages offer follows the server's settings, read from `GET /v1/auth/providers`:

- **`EMAIL_CODES` off** (the deployed server's default): sign-up signs in at once, and "Forgot password?" is hidden. `/reset` asks people to email you instead.
- **`EMAIL_CODES = "1"`**: sign-up and unconfirmed sign-ins ask for the emailed 6-digit code, and password reset works.

### Google sign-in

The "Continue with Google" button stays hidden until both the site and the sync server know your Google client ID. It uses Google's standard OpenID Connect redirect, not Google's button script, because that script needs inline styles the site's Content-Security-Policy blocks. Google sends people back to `/auth/google` with an ID token. That page checks a `state` and a `nonce` it stored before leaving, then sends the token to the sync server, which verifies Google's signature, the audience and the expiry.

To turn it on:

1. In Google Cloud Console, go to APIs & Services → Credentials, and create an OAuth client ID of type **Web application**.
2. Under **Authorized redirect URIs**, add `https://<your domain>/auth/google` and, for local testing, `http://localhost:4321/auth/google`. The flow doesn't use JavaScript origins.
3. Put the client ID in `auth.googleClientId` in `src/site.config.ts`.
4. Add the same client ID to `GOOGLE_CLIENT_IDS` in the sync server's `wrangler.toml` (comma-separated, next to the apps' IDs), and redeploy the server.

## Change links, prices and text

Everything you're likely to change is in `src/site.config.ts`. Values that still need confirming are marked `// TODO`.

- **Name, tagline, contact email, GitHub link and domain:** `name`, `tagline`, `contactEmail`, `githubUrl` and `url`. `url` is used for canonical links, Open Graph tags, the sitemap and `robots.txt`.
- **Platforms:** each entry in `platforms` has `available`, `url`, `label`, `minOS`, `version`, `size` and an optional `notifyUrl`, `note` or `alt` link. When Windows or iPhone ships, set `available: true` and fill in `url` and `label`. The hero button, the download card and the structured data all update from that.
- **Prices:** `pricing.free.price`, `pricing.sync.monthly` and `pricing.sync.yearly`. The yearly saving is calculated from these. While `pricingIsPlaceholder` is `true`, the page shows a "Prices are placeholders" note under the cards; set it to `false` once prices are final.
- **FAQ:** edit the `faq` list. Answers are plain text.

The privacy and terms text is in `src/pages/privacy.astro` and `src/pages/terms.astro`. Both are templates and need review before launch.

## Structure

```
src/site.config.ts       product facts, links, prices, FAQ
src/layouts/Base.astro   <head>, SEO tags, platform detection, scroll reveal
src/components/          Header, Hero, SyncStrip, Features, ReadingDemo, Pricing, Download, Faq, Footer
src/pages/               index, privacy, terms, 404, account pages, sitemap.xml, robots.txt
src/scripts/auth.ts      client side of the account pages
server/auth-proxy.ts     /api proxy to the sync server (used by the Pages Function and dev server)
functions/api/           Cloudflare Pages Function for /api/*
src/styles/global.css    design tokens and shared styles
public/fonts/            self-hosted Inter and Literata (latin subset)
scripts/generate-images.mjs  og.png and favicon PNGs
```
