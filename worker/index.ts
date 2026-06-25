import { handlePlaylists } from './playlists';
import { handleNetease } from './netease';
import { stripMount } from './shared';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = stripMount(url.pathname);

    // API routes — handled by the Worker regardless of asset matches.
    if (path === '/api/playlists' || path === '/api/playlists/') {
      return handlePlaylists(request, env);
    }
    if (path.startsWith('/api/netease/')) {
      return handleNetease(request, env, path);
    }

    // Everything else: forward to the static assets binding.
    // not_found_handling = "single-page-application" in wrangler.toml makes
    // deep links (e.g. /music/some/path) return dist/index.html automatically.
    const assetUrl = new URL(path + url.search, url);
    return env.ASSETS.fetch(new Request(assetUrl, request));
  },
};