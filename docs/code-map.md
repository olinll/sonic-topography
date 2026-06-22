# Sonic Topography Code Map

This file is the project index for future code lookup, edits, tests, and reviews. It is organized by change target.

Last full verification commit: `unknown`

## Start Here

| Goal | Main files | Tests | Verification |
| --- | --- | --- | --- |
| Change player, Demo, upload, or lyrics display | `src/components/UI/UI.tsx` | No automated tests yet | `npm run lint`; `npm run build` |
| Change Netease search/import, browser Cookie, cloud library, or daily recommendations | `src/components/UI/UI.tsx`; `src/lib/neteaseCookie.ts`; `vite.config.ts`; `local-server.mjs`; `package.json` | `src/lib/neteaseCookie.test.ts` | `npx tsx src/lib/neteaseCookie.test.ts`; `npm run lint`; `npm run build`; `/api/netease/cookie`, `/api/netease/search`, `/api/netease/liked`, `/api/netease/playlists`, and `/api/netease/daily-recommend` smoke tests |
| Change one-click packaged startup | `local-server.mjs`; `start-sonic-topography.bat`; `package.json` | No automated tests yet | `npm run build`; `npm start`; `http://127.0.0.1:4173` smoke test |
| Package Wallpaper Engine web wallpaper | `package.json`; `scripts/prepare-wallpaper.mjs`; `src/lib/AudioEngine.ts`; `src/components/UI/UI.tsx` | No automated tests yet | `npm run lint`; `npm run build:wallpaper`; import `dist-wallpaper/index.html` in Wallpaper Engine |
| Change saved playlists | `src/components/UI/UI.tsx`; `local-server.mjs`; `vite.config.ts` | No automated tests yet | `npm run lint`; playlist API persistence QA |
| Change playback queue or skip mode | `src/components/UI/UI.tsx` | No automated tests yet | `npm run lint`; browser playlist skip/shuffle QA |
| Change audio playback, analysis, or triggers | `src/lib/AudioEngine.ts` | No automated tests yet | `npm run lint`; browser playback QA |
| Change trigger settings persistence or meteor trigger spacing | `src/lib/AudioEngine.ts`; `src/lib/triggerSettings.ts`; `src/components/AudioVisualizer/MapScene.tsx`; `src/components/UI/UI.tsx` | `src/lib/triggerSettings.test.ts` | `npx tsx src/lib/triggerSettings.test.ts`; `npm run lint`; `npm run build`; browser Settings panel QA |
| Change LRC parsing | `src/lib/lyrics.ts`; `src/components/UI/LyricsDisplay.tsx` | No automated tests yet | `npm run lint`; QA with an `.lrc` file |
| Change audio metadata reading | `src/lib/metadata.ts` | No automated tests yet | `npm run lint`; QA with audio containing ID3 title/artist/lyrics |
| Change 3D visualizer scene | `src/components/AudioVisualizer/MapScene.tsx`; `src/components/AudioVisualizer/CustomShaderMaterial.ts` | No automated tests yet | `npm run build`; browser visual QA |
| Change Sonic City templates or admin editor | `sonic-city/src/AdminPage.tsx`; `sonic-city/src/templateStore.ts`; `sonic-city/src/TemplateCityScene.tsx`; `sonic-city/vite.config.ts` | No automated tests yet | `cd sonic-city; npm run lint`; `cd sonic-city; npm run build`; `/admin` save QA |

## End-To-End Flow

```text
src/main.tsx
-> src/App.tsx
-> UI upload or Demo click
-> src/components/UI/UI.tsx
-> src/lib/AudioEngine.ts loads audio and emits spectrum data
-> src/components/AudioVisualizer/MapScene.tsx reads spectrum and trigger events
-> src/components/AudioVisualizer/CustomShaderMaterial.ts renders terrain waves
```

Demo flow:

```text
public/demo.mp3 + public/demo.lrc
-> UI.loadDemo()
-> src/lib/metadata.ts reads audio title, artist, embedded lyrics
-> same-name LRC wins, otherwise embedded lyrics are used
-> AudioEngine.loadUrl('/demo.mp3')
```

Upload flow:

```text
input[type=file] or drag and drop
-> UI.processFiles()
-> detect audio/*, .mp3, .wav, .flac, and .lrc
-> FileReader reads LRC or metadata.ts tries embedded lyrics
-> AudioEngine.loadFile(file)
```

Netease search flow:

```text
Settings -> Netease Cookie -> open music.163.com and copy a browser Cookie manually
-> src/lib/neteaseCookie.ts normalizes and saves Cookie in browser localStorage
-> PUT /api/netease/cookie syncs Cookie to the local proxy memory for audio tag requests
-> UI Search button
-> UI.searchNetease()
-> request includes X-Netease-Cookie only after the browser Cookie validates
-> Vite middleware /api/netease/search
-> no Cookie: use the GitHub baseline anonymous search path from e3b8c83
-> anonymous path defaults to limit=12, caps resultLimit at 20, and calls only music.163.com/api/search/get/web with upstream limit min(resultLimit * 3, 60)
-> valid Cookie: use account-aware search with official Cookie, cloudsearch fallback, transient 400 retries, and upstream limit capped at 80
-> Vite checks each candidate with /api/song/enhance/player/url using the same anonymous/account permission context
-> playable URL cache avoids repeated candidate checks
-> unplayable candidates are filtered out
-> response includes rawCount and filteredCount so the UI can distinguish "no songs found" from "songs found but none playable"
-> rawCount=0 results are not cached, because anonymous upstream search can occasionally return empty responses
-> user selects a result
-> /api/netease/lyric loads LRC
-> /api/netease/url checks playback availability using anonymous mode when no validated Cookie is sent, or account mode when it is sent
-> /api/netease/audio proxies playable audio into AudioEngine.loadUrl() with the same permission context
```

Netease cloud library flow:

```text
Settings -> Netease Cookie -> save Cookie
-> PUT /api/netease/cookie validates Cookie with music.163.com account API
-> UI shows left-side Netease entry only when valid is true
-> click Netease
-> secondary menu offers Liked, Playlists, Daily Recommendations
-> Liked calls /api/netease/liked
-> Playlists calls /api/netease/playlists, then /api/netease/playlist?id=...
-> Daily Recommendations calls /api/netease/daily-recommend
-> proxy filters all song lists through playable URL checks
-> user clicks a playable song
-> loadNeteaseSong(song, currentCloudSongs) plays it with queue skip support
-> plus button adds the song to the local Favorites playlist
```

Saved playlist flow:

```text
Search result plus button
-> choose existing playlist or create a new playlist
-> UI state updates
-> PUT /api/playlists persists playlists to data/playlists.json
-> localStorage key sonic-topography-playlists-v1 is a browser fallback/migration source
-> Playlist side-rail entry opens saved playlists after reload/restart
-> selecting a saved song reuses loadNeteaseSong()
-> trash buttons remove songs or whole playlists from localStorage-backed state
```

Playback queue flow:

```text
Search result or playlist song click
-> loadNeteaseSong(song, queue)
-> playQueue/currentSongId update
-> SkipBack/SkipForward calls playFromQueue()
-> playMode sequence uses adjacent index; shuffle picks a different random index
-> audio ended event advances to next queued song
-> unavailable or failed songs skip to the next queued song
```

Trigger settings flow:

```text
src/components/UI/UI.tsx loads src/lib/triggerSettings.ts
-> browser localStorage key sonic-topography-trigger-settings-v1
-> saved Pulse/Meteor values apply to engine.pulseTrigger and engine.meteorTrigger on page load
-> Settings panel changes update engine trigger configs
-> UI snapshots both trigger configs back into browser localStorage
-> refresh keeps the same browser settings; a packaged copy opened by another user starts with that user's own browser storage
```

Wallpaper Engine flow:

```text
npm run build:wallpaper
-> Vite writes static files with relative asset paths into dist-wallpaper/
-> scripts/prepare-wallpaper.mjs writes dist-wallpaper/project.json and preview.png
-> Wallpaper Engine imports dist-wallpaper/index.html as a Web wallpaper
-> project.json enables supportsaudioprocessing
-> window.wallpaperRegisterAudioListener feeds system audio bands into AudioEngine
-> MapScene renders terrain, ripples, and meteors from Wallpaper Engine audio data
```

Sonic City template flow:

```text
sonic-city/src/App.tsx
-> /admin renders AdminPage for image upload and light-zone editing
-> saveTemplateLibrary() writes browser localStorage and PUT /api/sonic-city/templates
-> sonic-city/vite.config.ts persists sonic-city/data/templates.json
-> player route renders TemplateCityScene
-> loadTemplateLibrary() reads the default template
-> TemplateCityScene draws backgroundImage plus audio-driven canvas zones
```

## Code Map

### Player, Demo, And Lyrics Entry

`src/components/UI/UI.tsx`

Owns the left control rail, Demo button, Netease search panel, saved playlist panel, playback queue controls, upload and drag/drop files, player panel, theme switch, lyrics status, and Settings panel. Settings contains Pulse and Meteor trigger controls plus a Netease Cookie editor. Demo defaults to `public/demo.mp3` and `public/demo.lrc`. Saved playlists are loaded from `/api/playlists`, persisted to `data/playlists.json`, and backed up in browser `localStorage`.

`src/lib/neteaseCookie.ts`

Normalizes multiline copied Netease Cookie strings, defines the browser storage key and `X-Netease-Cookie` request header, and exposes helpers used by UI search/load requests.

`src/lib/triggerSettings.ts`

Normalizes and persists Pulse/Meteor trigger panel settings in browser `localStorage`. This keeps trigger preferences per browser/user without writing them into project config or packaged files.

`vite.config.ts`

Provides the Vite dev server middleware for `/api/netease/cookie`, `/api/netease/liked`, `/api/netease/playlists`, `/api/netease/playlist`, `/api/netease/daily-recommend`, `/api/netease/search`, `/api/netease/lyric`, `/api/netease/url`, and `/api/netease/audio`. This avoids browser CORS issues, validates the browser Cookie, filters cloud library, daily recommendation, and search results to playable candidates, caches playable URL/search checks per Cookie, and proxies playable audio when Netease returns a URL. `/api/netease/cookie` keeps a runtime memory copy because `HTMLAudioElement` cannot send custom headers to `/api/netease/audio`.

`local-server.mjs`

Production local server for the built `dist/` folder. It mirrors the Netease proxy endpoints from `vite.config.ts` so the packaged app keeps Search, cloud library, daily recommendations, lyrics, browser Cookie sync, and audio proxy support without running Vite. It also exposes `/api/playlists` for file-backed playlist persistence.

`start-sonic-topography.bat`

Windows one-click launcher. It installs dependencies if needed, builds `dist/` if missing, opens `http://127.0.0.1:4173`, and runs `local-server.mjs`.

`src/lib/metadata.ts`

Uses `music-metadata-browser` to read title, artist, and embedded lyrics from an audio Blob/File. Falls back to the file name when metadata is unavailable.

`src/lib/lyrics.ts`

Parses standard `[mm:ss.xx]` or `[mm:ss.xxx]` LRC timestamps and sorts lyric lines.

`src/components/UI/LyricsDisplay.tsx`

Highlights lyric lines from the current playback time.

### Audio Engine

`src/lib/AudioEngine.ts`

Wraps `HTMLAudioElement`, Web Audio API, spectrum analysis, Wallpaper Engine audio-listener input, system audio capture, auto beat detection, advanced band triggers, and the visual release tail used when pausing, closing capture, or switching tracks.

`scripts/prepare-wallpaper.mjs`

Creates Wallpaper Engine metadata in `dist-wallpaper/project.json`, enables `supportsaudioprocessing`, and copies the horizontal cover image to `dist-wallpaper/preview.png`.

### 3D Visualizer

`src/components/AudioVisualizer/MapScene.tsx`

Connects the audio engine to the Three.js scene, driving ripples, meteors, and camera interaction. Meteor spawn spacing is also gated here by `engine.meteorTrigger.cooldown / 60`, so `Cooldown (frames)` affects visible Meteor generation intervals.

`src/components/AudioVisualizer/CustomShaderMaterial.ts`

Defines terrain vertex/fragment shaders and changes height and color from audio bands and trigger waves.

### Sonic City Admin And Template Player

`sonic-city/src/AdminPage.tsx`

Owns the local template editor at `/admin`: city background upload, template create/rename/delete/default selection, rectangle and polygon zone drawing, Chinese parameter controls, per-edge polygon diffusion, and save status.

`sonic-city/src/templateStore.ts`

Defines the browser storage key, the built-in lights-off city sample template, normalization, default-template selection, and the two-step persistence path: `localStorage` first, then the local API.

`sonic-city/src/TemplateCityScene.tsx`

Loads the default template on the player route, displays the static city background, and draws each saved light zone on a canvas only while audio playback or system capture is active. Paused or stopped audio leaves all zones transparent.

`sonic-city/vite.config.ts`

Provides the local template API endpoints `GET /api/sonic-city/templates` and `PUT /api/sonic-city/templates`. The API stores runtime template data in `sonic-city/data/templates.json`.

`sonic-city/data/templates.json`

Runtime template file created by the local API. It is ignored by git as user-editable data, but it is the first source used by the running dev server when present.

## Test Index

| Test file | Covers |
| --- | --- |
| `src/lib/neteaseCookie.test.ts` | Cookie normalization and `X-Netease-Cookie` header creation |
| `src/lib/triggerSettings.test.ts` | Trigger setting normalization and bounds |

## Common Change Recipes

### Change Demo Track

1. Put audio at `public/demo.mp3`.
2. Put lyrics at `public/demo.lrc`.
3. If audio contains title/artist metadata, the player shows it; otherwise it shows `demo`.
4. Run `npm run lint` and `npm run build`.
5. Open `http://127.0.0.1:3000/`, click `Demo`, and verify song name, lyrics, and playback.

### Change Upload Lyrics Behavior

1. Modify `processFiles()` in `src/components/UI/UI.tsx`.
2. If the LRC format changes, update `src/lib/lyrics.ts`.
3. Run `npm run lint`.
4. Select audio and `.lrc` together, then verify lyric display and timing.

### Change Netease Search, Cloud Library, Daily Recommendation, Or Browser Cookie Behavior

1. Modify the UI states and handlers in `src/components/UI/UI.tsx`.
2. Update Cookie helpers in `src/lib/neteaseCookie.ts` if storage, normalization, or request-header behavior changes.
3. Modify the proxy endpoints in both `vite.config.ts` and `local-server.mjs`.
4. Run `npx tsx src/lib/neteaseCookie.test.ts`, `npm run lint`, and `npm run build`.
5. Restart `npm run dev` because Vite middleware changes require a server restart.
6. Smoke test `http://127.0.0.1:3000/api/netease/search?keywords=tyler` without a Cookie; behavior should match GitHub `e3b8c83`: anonymous search uses `search/get/web`, default limit 12, max resultLimit 20, upstream limit min(resultLimit * 3, 60), then filters by anonymous playable URLs.
7. Smoke test `PUT http://127.0.0.1:3000/api/netease/cookie`, then repeat the same `/api/netease/search` with a real valid Cookie; account/VIP playable songs may appear, but unplayable songs should still be filtered out. Repeat once to verify anonymous cache and Cookie cache do not mix.
8. With a real valid Cookie, smoke test `http://127.0.0.1:3000/api/netease/liked?limit=3`, `http://127.0.0.1:3000/api/netease/playlists`, and `http://127.0.0.1:3000/api/netease/daily-recommend?limit=3`.
9. In the browser, open Settings -> Netease Cookie, open the official website, copy/save a Cookie, verify the left-side Netease entry appears, open liked/playlists/daily recommendations, and verify each secondary menu lists playable songs.
10. Click a song in each secondary menu to verify playback and queue skip support. Click the plus button on a cloud song and verify it appears in the local Favorites playlist after reload.

### Change One-Click Startup

1. Modify shared proxy behavior in both `vite.config.ts` and `local-server.mjs`.
2. Modify launcher behavior in `start-sonic-topography.bat`.
3. Run `npm run lint` and `npm run build`.
4. Run `npm start` or double-click `start-sonic-topography.bat`.
5. Smoke test `http://127.0.0.1:4173` and `http://127.0.0.1:4173/api/netease/search?keywords=angel&limit=2`.

### Package Wallpaper Engine Web Wallpaper

1. Run `npm run lint`.
2. Run `npm run build:wallpaper`.
3. In Wallpaper Engine, create/import a Web wallpaper from `dist-wallpaper/index.html`.
4. Play system audio and verify the terrain responds without clicking system capture.
5. Click the built-in Demo if local playback should also be checked.
6. Do not import the repository root; import only `dist-wallpaper/` so `node_modules/`, source files, and runtime data are not copied into Wallpaper Engine.

### Change Saved Playlists

1. Modify playlist state and UI in `src/components/UI/UI.tsx`.
2. Modify `/api/playlists` in both `local-server.mjs` and `vite.config.ts`.
3. Keep `PLAYLIST_STORAGE_KEY` stable unless a migration is added.
4. Run `npm run lint` and `npm run build`.
5. Smoke test `GET/PUT http://127.0.0.1:4173/api/playlists`.
6. In the browser, search a song, click its plus button, add it to an existing or new playlist, restart the app, and verify the `Playlist` panel still contains it.
7. Delete a song and delete a playlist, then restart and verify they stay deleted.
8. Verify delete confirmation appears before removing a song or playlist.

### Change Playback Queue Or Skip Mode

1. Modify queue state and controls in `src/components/UI/UI.tsx`.
2. Keep search-result and playlist clicks passing a queue into `loadNeteaseSong()`.
3. Run `npm run lint` and `npm run build`.
4. In the browser, play from a playlist, test previous/next, toggle sequence/shuffle, and let a song end to verify auto-advance.
5. If a queued Netease song fails to load or becomes unavailable, verify playback attempts the next queued song.

### Change Trigger Settings Persistence Or Meteor Trigger Spacing

1. Modify trigger evaluation in `src/lib/AudioEngine.ts` if the audio event threshold changes.
2. Modify browser persistence in `src/lib/triggerSettings.ts` if saved setting schema changes.
3. Modify visible spawn gating in `src/components/AudioVisualizer/MapScene.tsx` if Meteor spacing feels wrong.
4. Modify panel controls in `src/components/UI/UI.tsx`.
5. Run `npx tsx src/lib/triggerSettings.test.ts`, `npm run lint`, and `npm run build`.
6. In the browser, open `Settings`, choose `Meteor`, set `Cooldown (frames)` to `300`, refresh, and verify the setting persists in the same browser.
7. Verify visible Meteors are spaced about five seconds apart.

### Change Sonic City Template Zones

1. Modify built-in defaults in `sonic-city/src/templateStore.ts` if new users should get the change.
2. Use `/admin` or `PUT /api/sonic-city/templates` if the current local runtime template should change immediately.
3. If zone schema, persistence, or API behavior changes, update `sonic-city/src/templateTypes.ts`, `sonic-city/src/templateStore.ts`, and `sonic-city/vite.config.ts` together.
4. Run `cd sonic-city; npm run lint` and `cd sonic-city; npm run build`.
5. Open `http://127.0.0.1:3100/admin`, verify zones appear over the city image and can be selected/edited/saved.
6. Open `http://127.0.0.1:3100/`, play Demo or upload audio, and verify lights are off while paused and frequency-bound zones light only during playback.

## Local Verification Commands

```powershell
npm run lint
npx tsx src/lib/neteaseCookie.test.ts
npx tsx src/lib/triggerSettings.test.ts
npm run build
npm run build:wallpaper
npm run dev
npm start
cd sonic-city; npm run lint
cd sonic-city; npm run build
cd sonic-city; npm run dev
```

## Search Shortcuts

```powershell
rg -n "loadDemo|processFiles|lyricsText|extractAudioMetadata" src
rg -n "searchNetease|loadNeteaseSong|neteaseCookie|/api/netease" src vite.config.ts local-server.mjs
rg -n "api/netease|local-server|start-sonic" vite.config.ts local-server.mjs package.json
rg -n "PLAYLIST_STORAGE_KEY|/api/playlists|playlists|songToAdd|showPlaylistPanel" src/components/UI/UI.tsx vite.config.ts local-server.mjs
rg -n "playQueue|currentSongId|playMode|playFromQueue" src/components/UI/UI.tsx
rg -n "meteorTrigger.cooldown|lastMeteorSpawnTime|addMeteor" src/components
rg -n "triggerSettings|TRIGGER_SETTINGS_STORAGE_KEY|pulseTrigger|meteorTrigger" src
rg -n "loadUrl|loadFile|getAudioData|onFreqTrigger" src/lib src/components
rg -n "TemplateCityScene|AdminPage|saveTemplateLibrary|sonic-city/templates" sonic-city/src sonic-city/vite.config.ts
```

## Known Runtime Notes

- Static assets live in `public/` and are served from the root path, for example `public/demo.mp3` is `/demo.mp3`.
- `package.json` has a `clean` script containing `rm -rf`; do not run it.
- Double-click startup uses `start-sonic-topography.bat`; production local server runs on `http://127.0.0.1:4173`.
- Browser autoplay and Web Audio initialization depend on user interaction. Click Demo, Play, or Upload before expecting audio.
- System audio capture depends on browser permission. Permission cancelation should return silently to regular playback state.
- Netease playback URLs can be unavailable because of copyright, membership, region, or login restrictions. Lyrics may still load when audio cannot play.
- Search filters out songs without playback URLs. The proxy checks candidates in small concurrent batches and caches search/playability results to keep repeat searches faster.
- Netease Cookie is stored in browser `localStorage` and synced to the local proxy runtime via `/api/netease/cookie`. Search/url/lyric/cloud/daily fetches can send `X-Netease-Cookie`, but audio playback relies on the server memory copy because the browser audio element cannot attach custom headers.
- Netease login is manual Cookie only. The Settings panel can open `music.163.com`, but browser security prevents this app from automatically reading official-site Cookies.
- The left-side Netease entry appears only after `/api/netease/cookie` validates the Cookie. Invalid, expired, or logged-out Cookies should hide the entry and direct the user back to Settings.
- Cloud song plus buttons add songs to the local `Favorites` playlist, not to the upstream Netease account.
- Pulse/Meteor trigger settings are browser-local via `sonic-topography-trigger-settings-v1`. They should persist across refreshes for the same browser but should not be written into packaged project files or shared with other users.
- Saved playlists are file-backed in `data/playlists.json`; `data/` is ignored by git because it is user runtime data. Browser `localStorage` is kept as a fallback/migration source.
- If the terrain snaps flat when stopping or switching audio, inspect `AudioEngine.beginVisualRelease()` and the non-playing branch in `getAudioData()` before changing shader code.
- Sonic City template data is also runtime data. `sonic-city/data/templates.json` may contain local edits from `/admin`; do not overwrite it unless the requested change is specifically about the current local template.
- Sonic City loads server templates before browser `localStorage`, so a successful API save will replace stale browser template data on refresh.
