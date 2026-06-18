# Sonic Topography Code Map

This file is the project index for future code lookup, edits, tests, and reviews. It is organized by change target.

Last full verification commit: `unknown`

## Start Here

| Goal | Main files | Tests | Verification |
| --- | --- | --- | --- |
| Change player, Demo, upload, or lyrics display | `src/components/UI/UI.tsx` | No automated tests yet | `npm run lint`; `npm run build` |
| Change audio playback, analysis, or triggers | `src/lib/AudioEngine.ts` | No automated tests yet | `npm run lint`; browser playback QA |
| Change LRC parsing | `src/lib/lyrics.ts`; `src/components/UI/LyricsDisplay.tsx` | No automated tests yet | `npm run lint`; QA with an `.lrc` file |
| Change audio metadata reading | `src/lib/metadata.ts` | No automated tests yet | `npm run lint`; QA with audio containing ID3 title/artist/lyrics |
| Change 3D visualizer scene | `src/components/AudioVisualizer/MapScene.tsx`; `src/components/AudioVisualizer/CustomShaderMaterial.ts` | No automated tests yet | `npm run build`; browser visual QA |

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

## Code Map

### Player, Demo, And Lyrics Entry

`src/components/UI/UI.tsx`

Owns the left control rail, Demo button, upload and drag/drop files, player panel, theme switch, lyrics status, and frequency trigger panel. Demo defaults to `public/demo.mp3` and `public/demo.lrc`.

`src/lib/metadata.ts`

Uses `music-metadata-browser` to read title, artist, and embedded lyrics from an audio Blob/File. Falls back to the file name when metadata is unavailable.

`src/lib/lyrics.ts`

Parses standard `[mm:ss.xx]` or `[mm:ss.xxx]` LRC timestamps and sorts lyric lines.

`src/components/UI/LyricsDisplay.tsx`

Highlights lyric lines from the current playback time.

### Audio Engine

`src/lib/AudioEngine.ts`

Wraps `HTMLAudioElement`, Web Audio API, spectrum analysis, system audio capture, auto beat detection, and advanced band triggers.

### 3D Visualizer

`src/components/AudioVisualizer/MapScene.tsx`

Connects the audio engine to the Three.js scene, driving ripples, meteors, and camera interaction.

`src/components/AudioVisualizer/CustomShaderMaterial.ts`

Defines terrain vertex/fragment shaders and changes height and color from audio bands and trigger waves.

## Test Index

| Test file | Covers |
| --- | --- |
| None yet | This project currently has no automated test files |

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

## Local Verification Commands

```powershell
npm run lint
npm run build
npm run dev
```

## Search Shortcuts

```powershell
rg -n "loadDemo|processFiles|lyricsText|extractAudioMetadata" src
rg -n "loadUrl|loadFile|getAudioData|onFreqTrigger" src/lib src/components
```

## Known Runtime Notes

- Static assets live in `public/` and are served from the root path, for example `public/demo.mp3` is `/demo.mp3`.
- `package.json` has a `clean` script containing `rm -rf`; do not run it.
- Browser autoplay and Web Audio initialization depend on user interaction. Click Demo, Play, or Upload before expecting audio.
- System audio capture depends on browser permission. Permission cancelation should return silently to regular playback state.
