import { err, json } from './shared';
import type { Env, Playlist } from './types';

const PLAYLISTS_KEY = 'playlists:v1';

function defaultPlaylists(): Playlist[] {
  return [
    { id: 'favorites', name: 'Favorites', songs: [] },
    { id: 'visual-set', name: 'Visual Set', songs: [] },
  ];
}

function normalizePlaylists(value: unknown): Playlist[] {
  if (!Array.isArray(value) || value.length === 0) return defaultPlaylists();
  return value.map((p: any) => ({
    id: String(p?.id || `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    name: String(p?.name || 'Playlist'),
    songs: Array.isArray(p?.songs) ? p.songs : [],
  }));
}

async function readPlaylists(env: Env): Promise<Playlist[]> {
  try {
    const raw = await env.SONIC_KV.get(PLAYLISTS_KEY);
    if (!raw) return defaultPlaylists();
    return normalizePlaylists(JSON.parse(raw));
  } catch {
    return defaultPlaylists();
  }
}

async function writePlaylists(env: Env, playlists: Playlist[]): Promise<Playlist[]> {
  const normalized = normalizePlaylists(playlists);
  await env.SONIC_KV.put(PLAYLISTS_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function handlePlaylists(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === 'GET') {
    const playlists = await readPlaylists(env);
    return json({ playlists });
  }
  if (method === 'PUT') {
    try {
      const body = (await request.json()) as { playlists?: Playlist[] };
      const playlists = await writePlaylists(env, body?.playlists ?? []);
      return json({ playlists });
    } catch {
      return err('Unable to save playlists', 500);
    }
  }
  return err('Method not allowed', 405);
}