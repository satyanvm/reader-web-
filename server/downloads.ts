// App downloads served from the website's own origin.
//
// The builds live on GitHub Releases, but linking there sends phones to
// github.com, where some browsers stall the download or never hand the APK to
// the installer. This handler (a Cloudflare Pages Function in production, a
// Vite middleware in development) fetches the latest release asset server-side
// and streams it back as /download/<file>, so the visitor never leaves the site.

interface Download {
  /** GitHub "latest release" asset URL; follows each new release. */
  source: string;
  contentType: string;
}

const DOWNLOADS = new Map<string, Download>([
  [
    'Readserene-android.apk',
    {
      source: 'https://github.com/satyanvm/reader-android/releases/latest/download/Readserene-android.apk',
      contentType: 'application/vnd.android.package-archive',
    },
  ],
  [
    'Readserene-mac.dmg',
    {
      source: 'https://github.com/satyanvm/reader-mac/releases/latest/download/Readserene-mac.dmg',
      contentType: 'application/x-apple-diskimage',
    },
  ],
]);

export async function handleDownload(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const file = decodeURIComponent(new URL(request.url).pathname.split('/').pop() ?? '');
  const download = DOWNLOADS.get(file);
  if (!download) return new Response('Not found', { status: 404 });

  const upstream = await fetch(download.source, { method: request.method, redirect: 'follow' });
  if (!upstream.ok) return new Response('Download unavailable, please try again shortly.', { status: 502 });

  const headers = new Headers({
    'Content-Type': download.contentType,
    'Content-Disposition': `attachment; filename="${file}"`,
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
}
