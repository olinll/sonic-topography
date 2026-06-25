// Minimal Fetcher shape so we don't have to depend on @cloudflare/workers-types.
// Wrangler bundles the real one at deploy time; this just satisfies tsc locally.
interface Fetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  NETEASE_REFERER?: string;
  NETEASE_USER_AGENT?: string;
}

export interface NeteaseSong {
  id: unknown;
  name: string;
  artist: string;
  album: string;
  duration: number;
  fee: unknown;
}

export interface Playlist {
  id: string;
  name: string;
  songs: Array<Record<string, unknown>>;
}

export interface NeteaseAccount {
  valid: boolean;
  userId: unknown;
  nickname: string;
}