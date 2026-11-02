// Cloudflare Pages Function for /download/*: app builds served from this origin (see server/downloads.ts).
import { handleDownload } from '../../server/downloads';

export const onRequest = (context: { request: Request }) => handleDownload(context.request);
