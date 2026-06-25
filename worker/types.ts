export interface Env {
  SONIC_KV: KVNamespace;
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