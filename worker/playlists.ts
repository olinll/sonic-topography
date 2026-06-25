import { err, json } from './shared';
import type { Playlist } from './types';

function defaultPlaylists(): Playlist[] {
  return [
    { id: 'favorites', name: 'Favorites', songs: [] },
    { id: 'visual-set', name: 'Visual Set', songs: [] },
  ];
}

// Without server-side persistence, both GET and PUT echo back the
// submitted/defaulted playlist data so the frontend's existing logic
// keeps working. Real persistence lives in the browser's localStorage;
// see PLAYLIST_STORAGE_KEY in src/components/UI/UI.tsx.
export async function handlePlaylists(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === 'GET') {
    return json({ playlists: defaultPlaylists() });
  }
  if (method === 'PUT') {
    try {
      const body = (await request.json()) as { playlists?: Playlist[] };
      // Stateless: accept the payload and return it as-is. No KV/file to write to.
      return json({ playlists: Array.isArray(body?.playlists) ? body.playlists : defaultPlaylists() });
    } catch {
      return err('Unable to parse playlists payload', 400);
    }
  }
  return err('Method not allowed', 405);
}