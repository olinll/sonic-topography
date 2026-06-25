// Mount path must match wrangler.toml routes.
export const MOUNT_PATH = '/music';

// Strip /music prefix from pathname so the Worker can route by logical path.
// Examples:
//   /music            -> /
//   /music/api/x      -> /api/x
//   /music/assets/y   -> /assets/y
//   /elsewhere        -> /elsewhere  (untouched; useful for wrangler dev without routes)
export function stripMount(pathname: string): string {
  if (pathname === MOUNT_PATH) return '/';
  if (pathname.startsWith(MOUNT_PATH + '/')) return pathname.slice(MOUNT_PATH.length);
  return pathname;
}

export function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export function err(error: string, status = 500): Response {
  return json({ error }, status);
}

export function normalizeNeteaseCookie(value: unknown): string {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;+$/, ''))
    .filter(Boolean)
    .join('; ');
}

// Header the frontend uses to override the server-side cookie per request.
// Mirrors NETEASE_COOKIE_HEADER in src/lib/neteaseCookie.ts.
export const NETEASE_COOKIE_HEADER = 'x-netease-cookie';

export function readRequestCookie(request: Request, fallback: string): string {
  const raw = request.headers.get(NETEASE_COOKIE_HEADER);
  return normalizeNeteaseCookie(raw || fallback);
}