import type { NextFunction, Request, Response } from 'express';

/**
 * The backend domain should look like there is nothing there. Anything outside the paths the
 * apps use, any unknown /api route, and any API URL opened straight in a browser tab gets the
 * same bare "404 Not Found" page as an empty web server — no framework name, no JSON, no hints.
 */
export const DECOY_404_HTML =
  '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n' +
  '<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';

export function sendDecoy404(res: Response) {
  res.status(404).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).send(DECOY_404_HTML);
}

/** Paths the apps actually use. Everything else on this host is a decoy 404. */
const APP_PREFIXES = ['/api/', '/uploads/', '/hls-seg/', '/socket.io/']; // socket.io namespaces share /socket.io/

/**
 * API URLs a browser tab legitimately opens directly: files and video (images, PDFs, stream
 * playlists), certificate downloads, the Google OAuth redirect, and the local R2 test page.
 */
const BROWSER_OPENABLE = ['/api/r2/', '/api/media/', '/api/secure-media/', '/api/certificates/', '/api/auth/google'];

export function decoy404() {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (!APP_PREFIXES.some((x) => p.startsWith(x))) return sendDecoy404(res);
    // Typed into the address bar / clicked as a link: the apps never navigate to JSON endpoints.
    const navigation = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (navigation && p.startsWith('/api/') && !BROWSER_OPENABLE.some((x) => p.startsWith(x))) return sendDecoy404(res);
    next();
  };
}

/** True for Nest's own "no such route" error ("Cannot GET /api/xyz"), not a handler's 404. */
export const isRouteNotFound = (message: unknown) => typeof message === 'string' && /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//.test(message);
