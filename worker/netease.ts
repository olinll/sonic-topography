import { TTLCache } from './cache';
import {
  err,
  json,
  NETEASE_COOKIE_HEADER,
  normalizeNeteaseCookie,
  readRequestCookie,
} from './shared';
import type { Env, NeteaseAccount, NeteaseSong } from './types';

// ---------- Config & per-isolate caches ----------

const PLAYABLE_TTL_MS = 1000 * 60 * 10; // 10 minutes
const SEARCH_TTL_MS = 1000 * 60 * 5; // 5 minutes

// Per-isolate caches; cleared on cookie changes within this isolate.
const playableUrlCache = new TTLCache<string | null>(PLAYABLE_TTL_MS);
const searchCache = new TTLCache<{ songs: NeteaseSong[]; rawCount: number; filteredCount: number }>(SEARCH_TTL_MS);

// ---------- Netease upstream helpers ----------

function baseNeteaseHeaders(env: Env): Record<string, string> {
  return {
    Referer: env.NETEASE_REFERER || 'https://music.163.com/',
    'User-Agent': env.NETEASE_USER_AGENT || 'Mozilla/5.0',
    Accept: 'application/json, text/plain, */*',
    Connection: 'close',
  };
}

function createNeteaseHeaders(
  env: Env,
  cookie: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const normalized = normalizeNeteaseCookie(cookie);
  return {
    ...baseNeteaseHeaders(env),
    ...(normalized ? { Cookie: normalized } : {}),
    ...extra,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
): Promise<any> {
  let lastData: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, options);
    const data = await response.json();
    lastData = data;
    if (response.ok && data?.code !== 400) return data;
    if (attempt < retries) await wait(180 * (attempt + 1));
  }
  return lastData || {};
}

function mapNeteaseSong(song: any): NeteaseSong {
  const artists = song.artists || song.ar || [];
  const album = song.album || song.al || {};
  return {
    id: song.id,
    name: song.name,
    artist: artists.map((a: any) => a?.name).filter(Boolean).join(' / '),
    album: album?.name || '',
    duration: song.duration || song.dt || 0,
    fee: song.fee,
  };
}

async function getPlayableUrl(
  id: string,
  cookie: string,
  env: Env,
): Promise<string | null> {
  const normalized = normalizeNeteaseCookie(cookie);
  const cacheKey = `${id}::${normalized}`;
  const cached = playableUrlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url =
    `https://music.163.com/api/song/enhance/player/url?id=${encodeURIComponent(id)}` +
    `&ids=%5B${encodeURIComponent(id)}%5D&br=320000`;
  const data = await fetchJsonWithRetry(url, {
    headers: createNeteaseHeaders(env, normalized),
  });
  const playableUrl = data?.data?.[0]?.url || null;
  playableUrlCache.set(cacheKey, playableUrl);
  return playableUrl;
}

async function fetchNeteaseSearchSongs(
  keywords: string,
  resultLimit: number,
  cookie: string,
  env: Env,
) {
  const upstreamLimit = Math.min(resultLimit * 5, 80);
  const body = new URLSearchParams({
    s: keywords,
    type: '1',
    offset: '0',
    total: 'true',
    limit: String(upstreamLimit),
    _: String(Date.now()),
  });

  const data = await fetchJsonWithRetry(
    'https://music.163.com/api/search/get/web',
    {
      method: 'POST',
      headers: createNeteaseHeaders(env, cookie, {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body,
    },
  );
  const primarySongs = data?.result?.songs || [];

  const fallbackUrl = new URL('https://music.163.com/api/cloudsearch/pc');
  fallbackUrl.searchParams.set('s', keywords);
  fallbackUrl.searchParams.set('type', '1');
  fallbackUrl.searchParams.set('offset', '0');
  fallbackUrl.searchParams.set('total', 'true');
  fallbackUrl.searchParams.set('limit', String(upstreamLimit));
  fallbackUrl.searchParams.set('_', String(Date.now()));
  const fallbackData = await fetchJsonWithRetry(fallbackUrl.toString(), {
    headers: createNeteaseHeaders(env, cookie),
  });
  const fallbackSongs = fallbackData?.result?.songs || [];

  const songsById = new Map<string, any>();
  for (const song of [...primarySongs, ...fallbackSongs]) {
    if (song?.id && !songsById.has(String(song.id))) songsById.set(String(song.id), song);
  }
  return {
    songs: [...songsById.values()],
    debug: {
      primaryCode: data?.code,
      primaryCount: primarySongs.length,
      fallbackCode: fallbackData?.code,
      fallbackCount: fallbackSongs.length,
    },
  };
}

async function fetchAnonymousSearchSongs(
  keywords: string,
  resultLimit: number,
  env: Env,
): Promise<any[]> {
  const body = new URLSearchParams({
    s: keywords,
    type: '1',
    offset: '0',
    total: 'true',
    limit: String(Math.min(resultLimit * 3, 60)),
  });
  const response = await fetch('https://music.163.com/api/search/get/web', {
    method: 'POST',
    headers: {
      ...baseNeteaseHeaders(env),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = (await response.json()) as any;
  return data?.result?.songs || [];
}

async function getNeteaseAccount(cookie: string, env: Env): Promise<NeteaseAccount> {
  const normalized = normalizeNeteaseCookie(cookie);
  if (!normalized) return { valid: false, userId: null, nickname: '' };

  const response = await fetch('https://music.163.com/api/nuser/account/get', {
    headers: createNeteaseHeaders(env, normalized),
  });
  const data = (await response.json()) as any;
  const userId = data?.profile?.userId || data?.account?.id || null;
  return {
    valid: Boolean(userId),
    userId,
    nickname: data?.profile?.nickname || '',
  };
}

async function filterPlayableSongs(
  rawSongs: NeteaseSong[],
  resultLimit: number,
  cookie: string,
  env: Env,
): Promise<NeteaseSong[]> {
  const playable: NeteaseSong[] = [];
  const batchSize = 8;
  for (let i = 0; i < rawSongs.length && playable.length < resultLimit; i += batchSize) {
    const batch = rawSongs.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (song) => ({
        song,
        playableUrl: await getPlayableUrl(String(song.id), cookie, env),
      })),
    );
    for (const result of results) {
      if (result.playableUrl) playable.push(result.song);
      if (playable.length >= resultLimit) break;
    }
  }
  return playable;
}

async function getDailyRecommendSongs(cookie: string, resultLimit: number, env: Env) {
  const normalized = normalizeNeteaseCookie(cookie);
  if (!normalized) return { valid: false, songs: [] };
  const account = await getNeteaseAccount(normalized, env);
  if (!account.valid) return { valid: false, songs: [] };

  const response = await fetch(
    'https://music.163.com/api/v3/discovery/recommend/songs',
    { headers: createNeteaseHeaders(env, normalized) },
  );
  const data = (await response.json()) as any;
  const rawSongs = (data?.data?.dailySongs || data?.recommend || []).map(mapNeteaseSong);
  const songs = await filterPlayableSongs(rawSongs, resultLimit, normalized, env);
  return { valid: Boolean(data?.data?.dailySongs || data?.recommend), songs };
}

async function getUserPlaylists(cookie: string, env: Env) {
  const account = await getNeteaseAccount(cookie, env);
  if (!account.valid || !account.userId) {
    return { valid: false, playlists: [] };
  }
  const response = await fetch(
    `https://music.163.com/api/user/playlist?uid=${encodeURIComponent(String(account.userId))}&limit=100&offset=0`,
    { headers: createNeteaseHeaders(env, cookie) },
  );
  const data = (await response.json()) as any;
  const playlists = (data?.playlist || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    trackCount: p.trackCount || 0,
  }));
  return { valid: true, playlists };
}

async function getPlaylistPlayableSongs(
  playlistId: string,
  cookie: string,
  resultLimit: number,
  env: Env,
): Promise<NeteaseSong[]> {
  const response = await fetch(
    `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(playlistId)}&n=${resultLimit * 2}`,
    { headers: createNeteaseHeaders(env, cookie) },
  );
  const data = (await response.json()) as any;
  const tracks = data?.playlist?.tracks || [];
  return filterPlayableSongs(tracks.map(mapNeteaseSong), resultLimit, cookie, env);
}

// ---------- Cookie endpoints ----------
// Without server-side storage, the cookie only lives in the browser's
// localStorage and travels with every request via the x-netease-cookie
// header. The endpoints below only validate and surface account info.

function handleCookieGet(): Response {
  // No stored cookie on the server; the frontend should send its own.
  return json({
    hasCookie: false,
    valid: false,
    userId: null,
    nickname: '',
  });
}

async function handleCookiePut(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { cookie?: string };
    const cookie = normalizeNeteaseCookie(body?.cookie);
    // Invalidate caches when cookie changes within this isolate.
    playableUrlCache.clear();
    searchCache.clear();
    const account = await getNeteaseAccount(cookie, env);
    return json({
      hasCookie: Boolean(cookie),
      valid: account.valid,
      userId: account.userId,
      nickname: account.nickname,
    });
  } catch {
    return err('Unable to validate Netease cookie', 500);
  }
}

function handleCookie(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === 'GET') return Promise.resolve(handleCookieGet());
  if (method === 'PUT') return handleCookiePut(request, env);
  return Promise.resolve(err('Method not allowed', 405));
}

// ---------- Search ----------

async function handleSearch(url: URL, request: Request, env: Env): Promise<Response> {
  const keywords = String(url.searchParams.get('keywords') || '').trim();
  const requestedLimit = Number(url.searchParams.get('limit') || '30');
  const includeDebug = url.searchParams.get('debug') === '1';

  if (!keywords) return err('Missing keywords', 400);

  const cookie = readRequestCookie(request, '');
  const normalizedCookie = normalizeNeteaseCookie(cookie);
  const hasCookie = Boolean(normalizedCookie);
  const resultLimit = hasCookie
    ? (Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 40)) : 30)
    : (Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 20)) : 12);

  const searchMode = hasCookie ? `cookie::${normalizedCookie}` : 'anonymous-baseline';
  const cacheKey = `${keywords.toLowerCase()}::${resultLimit}::${searchMode}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return json({ ...cached, cached: true });
  }

  const searchResult: any = hasCookie
    ? await fetchNeteaseSearchSongs(keywords, resultLimit, normalizedCookie, env)
    : {
        songs: await fetchAnonymousSearchSongs(keywords, resultLimit, env),
        debug: { mode: 'anonymous-github' },
      };
  const rawSongs = searchResult.songs.map(mapNeteaseSong);
  const songs = await filterPlayableSongs(rawSongs, resultLimit, normalizedCookie, env);
  const payload = { songs, rawCount: rawSongs.length, filteredCount: songs.length };
  if (rawSongs.length > 0 || songs.length > 0) {
    searchCache.set(cacheKey, payload);
  }
  return json(includeDebug ? { ...payload, debug: searchResult.debug } : payload);
}

// ---------- Liked / playlists / playlist / daily-recommend ----------

async function handleLiked(url: URL, request: Request, env: Env): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get('limit') || '50');
  const resultLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 80))
    : 50;
  const cookie = readRequestCookie(request, '');
  const userPlaylists = await getUserPlaylists(cookie, env);

  if (!userPlaylists.valid || userPlaylists.playlists.length === 0) {
    return err('Netease cookie is invalid or expired', 401);
  }

  const likedPlaylist = userPlaylists.playlists[0];
  const songs = await getPlaylistPlayableSongs(
    String(likedPlaylist.id),
    cookie,
    resultLimit,
    env,
  );
  return json({ songs, playlist: likedPlaylist });
}

async function handleUserPlaylists(request: Request, env: Env): Promise<Response> {
  const cookie = readRequestCookie(request, '');
  const userPlaylists = await getUserPlaylists(cookie, env);
  if (!userPlaylists.valid) {
    return err('Netease cookie is invalid or expired', 401);
  }
  // Drop the first (which is the "liked songs" implicit playlist) like the Node server.
  return json({ playlists: userPlaylists.playlists.slice(1) });
}

async function handlePlaylist(url: URL, request: Request, env: Env): Promise<Response> {
  const id = String(url.searchParams.get('id') || '');
  const requestedLimit = Number(url.searchParams.get('limit') || '50');
  const resultLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 80))
    : 50;
  const cookie = readRequestCookie(request, '');

  if (!id) return err('Missing id', 400);

  const account = await getNeteaseAccount(cookie, env);
  if (!account.valid) return err('Netease cookie is invalid or expired', 401);

  const songs = await getPlaylistPlayableSongs(id, cookie, resultLimit, env);
  return json({ songs });
}

async function handleDailyRecommend(url: URL, request: Request, env: Env): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get('limit') || '30');
  const resultLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 50))
    : 30;
  const cookie = readRequestCookie(request, '');
  const result = await getDailyRecommendSongs(cookie, resultLimit, env);
  if (!result.valid) return err('Netease cookie is invalid or expired', 401);
  return json({ songs: result.songs });
}

// ---------- Lyric / URL ----------

async function handleLyric(url: URL, request: Request, env: Env): Promise<Response> {
  const id = String(url.searchParams.get('id') || '');
  const cookie = readRequestCookie(request, '');
  if (!id) return err('Missing id', 400);

  const response = await fetch(
    `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`,
    { headers: createNeteaseHeaders(env, cookie) },
  );
  const data = (await response.json()) as any;
  return json({
    lyric: data?.lrc?.lyric || '',
    translatedLyric: data?.tlyric?.lyric || '',
  });
}

async function handleUrl(url: URL, request: Request, env: Env): Promise<Response> {
  const id = String(url.searchParams.get('id') || '');
  const cookie = readRequestCookie(request, '');
  if (!id) return err('Missing id', 400);
  const playableUrl = await getPlayableUrl(id, cookie, env);
  return json({ url: playableUrl });
}

// ---------- Audio proxy (streaming) ----------

async function handleAudio(request: Request, url: URL, env: Env): Promise<Response> {
  const id = String(url.searchParams.get('id') || '');
  const cookie = readRequestCookie(request, '');
  if (!id) return err('Missing id', 400);

  const playableUrl = await getPlayableUrl(id, cookie, env);
  if (!playableUrl) return err('No playable url for this song', 404);

  const upstreamHeaders = createNeteaseHeaders(env, cookie);
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

  const upstream = await fetch(playableUrl, { headers: upstreamHeaders });

  // Forward headers needed by the <audio> element for seeking and progress events.
  const responseHeaders = new Headers();
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) responseHeaders.set(h, v);
  }
  if (!responseHeaders.has('Content-Type')) {
    responseHeaders.set('Content-Type', 'audio/mpeg');
  }
  // Allow the frontend on tools.olinl.com to seek across the stream.
  responseHeaders.set('Accept-Ranges', 'bytes');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// ---------- Top-level router ----------

export async function handleNetease(request: Request, env: Env, path: string): Promise<Response> {
  // path looks like '/api/netease/cookie', '/api/netease/audio', etc.
  const sub = path.slice('/api/netease/'.length);
  const url = new URL(request.url);

  switch (sub) {
    case 'cookie':
      return handleCookie(request, env);
    case 'search':
      return handleSearch(url, request, env);
    case 'liked':
      return handleLiked(url, request, env);
    case 'playlists':
      return handleUserPlaylists(request, env);
    case 'playlist':
      return handlePlaylist(url, request, env);
    case 'daily-recommend':
      return handleDailyRecommend(url, request, env);
    case 'lyric':
      return handleLyric(url, request, env);
    case 'url':
      return handleUrl(url, request, env);
    case 'audio':
      return handleAudio(request, url, env);
    default:
      return err('Not found', 404);
  }
}

// Re-export for tests / external callers.
export { NETEASE_COOKIE_HEADER };