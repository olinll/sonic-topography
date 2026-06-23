import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, SkipForward, SkipBack, Palette, Plus, ListMusic, Shuffle, Repeat, Trash2 } from 'lucide-react';
import { engine } from '../../lib/AudioEngine';
import { BUILT_IN_THEME_IDS, CUSTOM_THEME_ID, createCustomThemePreset, themes, type CustomThemeSettings, type ThemeColors, type ThemeRotationSettings } from '../../lib/themes';
import {
  DEFAULT_GROUND_EQ_VALUE,
  GROUND_EQ_POINT_COUNT,
  defaultGroundEqCurve,
  readGroundEqCurveValue,
  type StoredGroundEqSettings,
} from '../../lib/groundEqSettings';
import { LyricsDisplay } from './LyricsDisplay';
import { extractAudioMetadata, extractLyricsFromAudio } from '../../lib/metadata';
import {
  createNeteaseCookieHeaders,
  readNeteaseCookieStorage,
  writeNeteaseCookieStorage,
} from '../../lib/neteaseCookie';
import {
  readTriggerSettingsStorage,
  writeTriggerSettingsStorage,
  type StoredTriggerConfig,
} from '../../lib/triggerSettings';

interface UIProps {
  theme: string;
  resolvedTheme: ThemeColors;
  customThemes: CustomThemeSettings[];
  activeCustomThemeId: string;
  themeRotation: ThemeRotationSettings;
  groundEqSettings: StoredGroundEqSettings;
  showPlayerPanel: boolean;
  onThemeChange: (theme: string) => void;
  onCustomThemesChange: (settings: CustomThemeSettings[], activeId?: string) => void;
  onThemeRotationChange: (settings: ThemeRotationSettings) => void;
  onGroundEqSettingsChange: (settings: StoredGroundEqSettings) => void;
}

interface NeteaseSong {
  id: number;
  name: string;
  artist: string;
  album: string;
  duration: number;
  fee: number;
}

interface SavedPlaylist {
  id: string;
  name: string;
  songs: NeteaseSong[];
}

interface NeteasePlaylistSummary {
  id: number;
  name: string;
  trackCount: number;
}

type PlayMode = 'sequence' | 'shuffle';
type OptionsTab = 'Pulse' | 'Meteor' | 'GroundEq' | 'Color' | 'Cookie';
type NeteaseCloudTab = 'liked' | 'playlists' | 'daily';
type PendingDelete =
  | { type: 'song'; playlistId: string; songId: number; label: string }
  | { type: 'playlist'; playlistId: string; label: string };

const PLAYLIST_STORAGE_KEY = 'sonic-topography-playlists-v1';
const baseUrl = import.meta.env.BASE_URL || '/';

function createDefaultPlaylists(): SavedPlaylist[] {
  return [
    { id: 'favorites', name: 'Favorites', songs: [] },
    { id: 'visual-set', name: 'Visual Set', songs: [] },
  ];
}

function readSavedPlaylists(): SavedPlaylist[] {
  try {
    const raw = window.localStorage.getItem(PLAYLIST_STORAGE_KEY);
    if (!raw) return createDefaultPlaylists();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return createDefaultPlaylists();
    return parsed.map((playlist: SavedPlaylist) => ({
      id: playlist.id,
      name: playlist.name,
      songs: Array.isArray(playlist.songs) ? playlist.songs : [],
    }));
  } catch (error) {
    console.warn('Unable to read saved playlists:', error);
    return createDefaultPlaylists();
  }
}

function hasSavedSongs(playlists: SavedPlaylist[]): boolean {
  return playlists.some((playlist) => playlist.songs.length > 0);
}

function applyStoredTriggerConfig(config: typeof engine.pulseTrigger, stored?: Partial<StoredTriggerConfig>) {
  if (!stored) return;
  if (typeof stored.enabled === 'boolean') config.enabled = stored.enabled;
  if (stored.mode === 'Auto Beat' || stored.mode === 'Advanced') config.mode = stored.mode;
  if (Number.isFinite(stored.freqIndex)) config.freqIndex = Number(stored.freqIndex);
  if (Number.isFinite(stored.threshold)) config.threshold = Number(stored.threshold);
  if (Number.isFinite(stored.sensitivity)) config.sensitivity = Number(stored.sensitivity);
  if (Number.isFinite(stored.cooldown)) config.cooldown = Number(stored.cooldown);
  if (Number.isFinite(stored.bandStart)) config.bandStart = Number(stored.bandStart);
  if (Number.isFinite(stored.bandEnd)) config.bandEnd = Number(stored.bandEnd);
  if (Number.isFinite(stored.pulseStrength)) config.pulseStrength = Number(stored.pulseStrength);
}

function snapshotTriggerConfig(config: typeof engine.pulseTrigger): StoredTriggerConfig {
  return {
    enabled: config.enabled,
    mode: config.mode,
    freqIndex: config.freqIndex,
    threshold: config.threshold,
    sensitivity: config.sensitivity,
    cooldown: config.cooldown,
    bandStart: config.bandStart,
    bandEnd: config.bandEnd,
    pulseStrength: config.pulseStrength,
  };
}

function loadStoredTriggerSettings() {
  const settings = readTriggerSettingsStorage();
  applyStoredTriggerConfig(engine.pulseTrigger, settings.Pulse);
  applyStoredTriggerConfig(engine.meteorTrigger, settings.Meteor);
}

loadStoredTriggerSettings();

export function UI({ theme, resolvedTheme, customThemes, activeCustomThemeId, themeRotation, groundEqSettings, showPlayerPanel, onThemeChange, onCustomThemesChange, onThemeRotationChange, onGroundEqSettingsChange }: UIProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const demoAudioUrl = `${baseUrl}demo.mp3`;
  const demoLyricsUrl = `${baseUrl}demo.lrc`;
  const [isPlaying, setIsPlaying] = useState(false);
  const [trackName, setTrackName] = useState<string>('No track selected');
  const [lyricsText, setLyricsText] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showOptionsPanel, setShowOptionsPanel] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [showNeteasePanel, setShowNeteasePanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NeteaseSong[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [neteaseCloudTab, setNeteaseCloudTab] = useState<NeteaseCloudTab>('daily');
  const [neteaseCloudSongs, setNeteaseCloudSongs] = useState<NeteaseSong[]>([]);
  const [neteaseCloudPlaylists, setNeteaseCloudPlaylists] = useState<NeteasePlaylistSummary[]>([]);
  const [activeNeteasePlaylistId, setActiveNeteasePlaylistId] = useState<number | null>(null);
  const [neteaseCloudStatus, setNeteaseCloudStatus] = useState('');
  const [isLoadingNeteaseCloud, setIsLoadingNeteaseCloud] = useState(false);
  const [showPlaylistPanel, setShowPlaylistPanel] = useState(false);
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>(readSavedPlaylists);
  const [activePlaylistId, setActivePlaylistId] = useState('favorites');
  const [songToAdd, setSongToAdd] = useState<NeteaseSong | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [playMode, setPlayMode] = useState<PlayMode>('sequence');
  const [playQueue, setPlayQueue] = useState<NeteaseSong[]>([]);
  const [currentSongId, setCurrentSongId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [neteaseCookie, setNeteaseCookie] = useState(readNeteaseCookieStorage);
  const [cookieStatus, setCookieStatus] = useState('');
  const [isNeteaseCookieValid, setIsNeteaseCookieValid] = useState(false);
  const [isSyncingNeteaseCookie, setIsSyncingNeteaseCookie] = useState(false);
  const [isMobileSideNavOpen, setIsMobileSideNavOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hasLoadedPlaylistsRef = useRef(false);

  const closeFloatingPanels = () => {
    setShowOptionsPanel(false);
    setShowSearchPanel(false);
    setShowNeteasePanel(false);
    setShowPlaylistPanel(false);
    setIsMobileSideNavOpen(false);
  };

  const openOptionsPanel = () => {
    setShowSearchPanel(false);
    setShowNeteasePanel(false);
    setShowPlaylistPanel(false);
    setShowOptionsPanel(true);
    setIsMobileSideNavOpen(false);
  };

  const openSearchPanel = () => {
    setShowOptionsPanel(false);
    setShowNeteasePanel(false);
    setShowPlaylistPanel(false);
    setShowSearchPanel(true);
    setIsMobileSideNavOpen(false);
  };

  const openNeteasePanel = () => {
    setShowOptionsPanel(false);
    setShowSearchPanel(false);
    setShowPlaylistPanel(false);
    setShowNeteasePanel(true);
    setIsMobileSideNavOpen(false);
  };

  const openPlaylistPanel = () => {
    setShowOptionsPanel(false);
    setShowSearchPanel(false);
    setShowNeteasePanel(false);
    setShowPlaylistPanel(true);
    setIsMobileSideNavOpen(false);
  };

  useEffect(() => {
    if (!hasLoadedPlaylistsRef.current) return;
    window.localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
    fetch('/api/playlists', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlists }),
    }).catch((error) => {
      console.warn('Unable to save playlists to local server:', error);
    });
  }, [playlists]);

  const syncNeteaseCookie = async (cookie: string, options: { silent?: boolean } = {}) => {
    const normalizedCookie = cookie.trim();
    if (normalizedCookie && !options.silent) {
      setCookieStatus('正在校验 Cookie...');
    }

    setIsSyncingNeteaseCookie(true);
    try {
      const response = await fetch('/api/netease/cookie', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie }),
      });
      const data = await response.json();
      const valid = Boolean(data.valid);
      setIsNeteaseCookieValid(valid);
      if (!options.silent) {
        setCookieStatus(normalizedCookie ? (valid ? 'Cookie 可用，已开启网易云' : 'Cookie 已保存，但校验失败') : 'Cookie 已清除');
      }
      if (normalizedCookie && !valid) {
        fetch('/api/netease/cookie', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookie: '' }),
        }).catch((error) => {
          console.warn('Unable to clear invalid Netease proxy cookie:', error);
        });
      }
      return valid;
    } catch (error) {
      console.warn('Unable to sync Netease cookie:', error);
      if (!options.silent) {
        setIsNeteaseCookieValid(false);
      }
      if (!options.silent) {
        setCookieStatus('已保存到浏览器，但同步到本地代理失败');
      }
      return options.silent && isNeteaseCookieValid;
    } finally {
      setIsSyncingNeteaseCookie(false);
    }
  };

  useEffect(() => {
    const savedCookie = readNeteaseCookieStorage();
    if (savedCookie) {
      setNeteaseCookie(savedCookie);
      syncNeteaseCookie(savedCookie);
    }
  }, []);


  const saveNeteaseCookie = () => {
    writeNeteaseCookieStorage(neteaseCookie);
    const normalizedCookie = readNeteaseCookieStorage();
    setNeteaseCookie(normalizedCookie);
    syncNeteaseCookie(normalizedCookie);
  };

  const clearNeteaseCookie = () => {
    writeNeteaseCookieStorage('');
    setNeteaseCookie('');
    setIsNeteaseCookieValid(false);
    syncNeteaseCookie('');
  };

  const ensureNeteaseCookieReady = async () => {
    const savedCookie = readNeteaseCookieStorage();
    if (!savedCookie.trim()) {
      setIsNeteaseCookieValid(false);
      setNeteaseCloudStatus('请先在设置里保存可用的网易云 Cookie');
      openOptionsPanel();
      return '';
    }

    setNeteaseCookie(savedCookie);
    const valid = await syncNeteaseCookie(savedCookie, { silent: isNeteaseCookieValid });
    if (!valid) {
      setNeteaseCloudStatus('Cookie 需要重新保存');
      openOptionsPanel();
      return '';
    }

    return savedCookie;
  };

  const fetchNeteaseSongs = async (url: string, emptyMessage: string) => {
    const readyCookie = await ensureNeteaseCookieReady();
    if (!readyCookie) return;

    setIsLoadingNeteaseCloud(true);
    setNeteaseCloudStatus('正在加载...');

    try {
      const response = await fetch(url, {
        headers: createNeteaseCookieHeaders(readyCookie),
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setIsNeteaseCookieValid(false);
          setNeteaseCloudStatus('网易云 Cookie 失效了，请重新保存');
          openOptionsPanel();
        } else {
          setNeteaseCloudStatus('网易云接口临时失败，请稍后再试');
        }
        return;
      }

      const songs = Array.isArray(data.songs) ? data.songs : [];
      if (songs.length === 0) {
        setNeteaseCloudSongs([]);
        setNeteaseCloudStatus(emptyMessage);
        return;
      }

      setNeteaseCloudSongs(songs);
      setNeteaseCloudStatus('');
    } catch (error) {
      console.warn('Unable to load Netease cloud songs:', error);
      setNeteaseCloudStatus('加载失败，请稍后再试');
    } finally {
      setIsLoadingNeteaseCloud(false);
    }
  };

  const loadDailyRecommendations = async () => {
    setNeteaseCloudTab('daily');
    setActiveNeteasePlaylistId(null);
    await fetchNeteaseSongs('/api/netease/daily-recommend?limit=50', '每日推荐里暂时没有可播放歌曲');
  };

  const loadLikedSongs = async () => {
    setNeteaseCloudTab('liked');
    setActiveNeteasePlaylistId(null);
    await fetchNeteaseSongs('/api/netease/liked?limit=50', '喜欢列表里暂时没有可播放歌曲');
  };

  const loadNeteasePlaylists = async () => {
    setNeteaseCloudTab('playlists');
    setNeteaseCloudSongs([]);
    setActiveNeteasePlaylistId(null);
    const readyCookie = await ensureNeteaseCookieReady();
    if (!readyCookie) return;

    setIsLoadingNeteaseCloud(true);
    setNeteaseCloudStatus('正在加载歌单...');

    try {
      const response = await fetch('/api/netease/playlists', {
        headers: createNeteaseCookieHeaders(readyCookie),
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setIsNeteaseCookieValid(false);
          setNeteaseCloudStatus('网易云 Cookie 失效了，请重新保存');
          openOptionsPanel();
        } else {
          setNeteaseCloudStatus('网易云接口临时失败，请稍后再试');
        }
        return;
      }

      const cloudPlaylists = Array.isArray(data.playlists) ? data.playlists : [];
      setNeteaseCloudPlaylists(cloudPlaylists);
      setNeteaseCloudStatus(cloudPlaylists.length ? '请选择一个歌单' : '没有找到网易云歌单');
    } catch (error) {
      console.warn('Unable to load Netease playlists:', error);
      setNeteaseCloudStatus('歌单加载失败，请稍后再试');
    } finally {
      setIsLoadingNeteaseCloud(false);
    }
  };

  const loadNeteasePlaylistSongs = async (playlist: NeteasePlaylistSummary) => {
    setActiveNeteasePlaylistId(playlist.id);
    await fetchNeteaseSongs(`/api/netease/playlist?id=${playlist.id}&limit=50`, '这个歌单里暂时没有可播放歌曲');
  };

  useEffect(() => {
    const loadPlaylists = async () => {
      try {
        const response = await fetch('/api/playlists');
        if (!response.ok) throw new Error('Playlist request failed');
        const data = await response.json();
        if (Array.isArray(data.playlists) && data.playlists.length > 0) {
          const serverPlaylists = data.playlists;
          const browserPlaylists = readSavedPlaylists();
          if (!hasSavedSongs(serverPlaylists) && hasSavedSongs(browserPlaylists)) {
            setPlaylists(browserPlaylists);
          } else {
            setPlaylists(serverPlaylists);
          }
        }
      } catch (error) {
        console.warn('Using browser playlist storage:', error);
      } finally {
        hasLoadedPlaylistsRef.current = true;
      }
    };

    loadPlaylists();
  }, []);
  
  // Audio state poller
  useEffect(() => {
    const initEngine = async () => {
       await engine.init(); 
    };
    initEngine();
    
    let animationFrameId: number;
    const poll = () => {
      setIsPlaying(engine.isPlaying);
      setCurrentTime(engine.audioElement.currentTime);
      setDuration(engine.audioElement.duration || 0);
      setVolume(engine.audioElement.volume);
      setIsCapturing(engine.isCapturing);
      animationFrameId = requestAnimationFrame(poll);
    };
    poll();
    
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.warn('Unable to toggle fullscreen:', error);
    } finally {
      setIsMobileSideNavOpen(false);
    }
  };

  const processFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    let audioFile: File | null = null;
    let lrcFile: File | null = null;
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav') || file.name.endsWith('.flac')) {
            audioFile = file;
        } else if (file.name.endsWith('.lrc')) {
            lrcFile = file;
        }
    }

    if (lrcFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            setLyricsText(text);
        };
        reader.readAsText(lrcFile);
    } else if (audioFile) {
        setLyricsText('');
        // Try extracting lyrics natively from the audio file
        const extractedLyrics = await extractLyricsFromAudio(audioFile);
        if (extractedLyrics) {
             setLyricsText(extractedLyrics);
        }
    } else {
        setLyricsText('');
    }

    if (audioFile) {
        setTrackName(audioFile.name);
        engine.init();
        engine.loadFile(audioFile);
        engine.play();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
    e.target.value = '';
  };

  const loadDemo = async () => {
    const audioName = demoAudioUrl.split('/').pop() || 'demo.mp3';

    setTrackName('Loading demo...');
    setLyricsText('');

    try {
      const audioResponse = await fetch(demoAudioUrl);
      if (!audioResponse.ok) {
        throw new Error(`Demo audio not found: ${demoAudioUrl}`);
      }

      const audioBlob = await audioResponse.blob();
      const metadata = await extractAudioMetadata(audioBlob, audioName);
      setTrackName(metadata.displayName);

      let demoLyrics = metadata.lyrics || '';
      try {
        const lyricsResponse = await fetch(demoLyricsUrl, { cache: 'no-store' });
        if (lyricsResponse.ok) {
          demoLyrics = await lyricsResponse.text();
        }
      } catch (error) {
        console.warn('Demo lyrics file is not available:', error);
      }

      setLyricsText(demoLyrics);
      engine.init();
      engine.loadUrl(demoAudioUrl);
      engine.play();
    } catch (error) {
      console.warn('Unable to load demo track:', error);
      setTrackName('No track selected');
      setLyricsText('');
    }
  };

  const togglePlay = () => {
    engine.init();
    engine.togglePlay();
  };

  const searchNetease = async () => {
    const keywords = searchQuery.trim();
    if (!keywords) return;
    const requestCookie = isNeteaseCookieValid ? neteaseCookie : '';

    setIsSearching(true);
    setSearchStatus('正在搜索可播放歌曲...');
    setSearchResults([]);

    try {
      const searchUrl = requestCookie
        ? `/api/netease/search?keywords=${encodeURIComponent(keywords)}&limit=30`
        : `/api/netease/search?keywords=${encodeURIComponent(keywords)}`;
      const response = await fetch(searchUrl, {
        headers: createNeteaseCookieHeaders(requestCookie),
      });
      if (!response.ok) throw new Error('Search request failed');

      const data = await response.json();
      const songs = Array.isArray(data.songs) ? data.songs : [];
      const rawCount = Number(data.rawCount || 0);
      setSearchResults(songs);
      setSearchStatus(songs.length ? '' : (rawCount > 0
        ? (requestCookie
          ? `搜到 ${rawCount} 首，但当前账号没有可播放版本，可能受版权、会员或地区限制。`
          : `搜到 ${rawCount} 首，但未登录只能显示可播放歌曲；保存网易云 Cookie 后可能会显示更多。`)
        : '没有搜到歌曲，请换个关键词试试。'));
    } catch (error) {
      console.warn('Netease search failed:', error);
      setSearchStatus('搜索失败，请稍后再试');
    } finally {
      setIsSearching(false);
    }
  };

  const loadNeteaseSong = async (song: NeteaseSong, queue?: NeteaseSong[]) => {
    if (queue) setPlayQueue(queue);
    setCurrentSongId(song.id);
    setTrackName(`${song.artist ? `${song.artist} - ` : ''}${song.name}`);
    setLyricsText('');
    setSearchStatus('正在加载歌曲...');
    const requestCookie = isNeteaseCookieValid ? neteaseCookie : '';

    try {
      const [urlResponse, lyricResponse] = await Promise.all([
        fetch(`/api/netease/url?id=${song.id}`, {
          headers: createNeteaseCookieHeaders(requestCookie),
        }),
        fetch(`/api/netease/lyric?id=${song.id}`, {
          headers: createNeteaseCookieHeaders(requestCookie),
        }),
      ]);

      const urlData = await urlResponse.json();
      const lyricData = await lyricResponse.json();
      const lyric = lyricData.lyric || lyricData.translatedLyric || '';
      setLyricsText(lyric);

      if (!urlData.url) {
        setSearchStatus('这首歌可能需要 Cookie、会员或地区权限，正在尝试下一首...');
        playFromQueue(1, song.id);
        return;
      }

      engine.init();
      engine.loadUrl(`/api/netease/audio?id=${song.id}`);
      engine.play();
      setSearchStatus('');
      setShowSearchPanel(false);
    } catch (error) {
      console.warn('Unable to load Netease song:', error);
      setSearchStatus('加载失败，正在尝试下一首...');
      playFromQueue(1, song.id);
    }
  };

  const getCurrentQueue = () => playQueue.length > 0 ? playQueue : activePlaylist?.songs || [];

  const playFromQueue = (direction: 1 | -1, fromSongId = currentSongId) => {
    const queue = getCurrentQueue();
    if (queue.length === 0) return;

    let nextIndex = 0;
    const currentIndex = queue.findIndex((song) => song.id === fromSongId);

    if (playMode === 'shuffle' && queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * queue.length);
      } while (nextIndex === currentIndex);
    } else {
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      nextIndex = (baseIndex + direction + queue.length) % queue.length;
    }

    loadNeteaseSong(queue[nextIndex], queue);
  };

  useEffect(() => {
    const handleEnded = () => {
      const queue = getCurrentQueue();
      if (queue.length > 1) playFromQueue(1);
    };

    engine.audioElement.addEventListener('ended', handleEnded);
    return () => engine.audioElement.removeEventListener('ended', handleEnded);
  }, [playQueue, currentSongId, playMode, activePlaylistId, playlists]);

  const addSongToPlaylist = (playlistId: string, song: NeteaseSong) => {
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const exists = playlist.songs.some((savedSong) => savedSong.id === song.id);
      if (exists) return playlist;
      return { ...playlist, songs: [...playlist.songs, song] };
    }));
    const playlistName = playlists.find((playlist) => playlist.id === playlistId)?.name || 'playlist';
    setSearchStatus(`已加入 ${playlistName}`);
    setSongToAdd(null);
  };

  const addSongToFavorites = (song: NeteaseSong) => {
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== 'favorites') return playlist;
      const exists = playlist.songs.some((savedSong) => savedSong.id === song.id);
      if (exists) return playlist;
      return { ...playlist, songs: [...playlist.songs, song] };
    }));
    setSearchStatus('已加入喜欢');
    setNeteaseCloudStatus('已加入喜欢');
  };

  const createPlaylistAndAddSong = () => {
    const name = newPlaylistName.trim();
    if (!name || !songToAdd) return;

    const id = `playlist-${Date.now()}`;
    setPlaylists((current) => [...current, { id, name, songs: [songToAdd] }]);
    setActivePlaylistId(id);
    setSearchStatus(`已加入 ${name}`);
    setSongToAdd(null);
    setNewPlaylistName('');
  };

  const deleteSongFromPlaylist = (playlistId: string, songId: number) => {
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      return { ...playlist, songs: playlist.songs.filter((song) => song.id !== songId) };
    }));

    setPlayQueue((queue) => queue.filter((song) => song.id !== songId));
    if (currentSongId === songId) {
      setCurrentSongId(null);
    }
  };

  const deletePlaylist = (playlistId: string) => {
    if (playlists.length <= 1) return;

    const nextPlaylists = playlists.filter((playlist) => playlist.id !== playlistId);
    setPlaylists(nextPlaylists);

    if (activePlaylistId === playlistId) {
      setActivePlaylistId(nextPlaylists[0]?.id || 'favorites');
    }

    const deletedPlaylist = playlists.find((playlist) => playlist.id === playlistId);
    if (deletedPlaylist?.songs.some((song) => song.id === currentSongId)) {
      setPlayQueue([]);
      setCurrentSongId(null);
    }
  };

  const confirmPendingDelete = () => {
    if (!pendingDelete) return;

    if (pendingDelete.type === 'song') {
      deleteSongFromPlaylist(pendingDelete.playlistId, pendingDelete.songId);
    } else {
      deletePlaylist(pendingDelete.playlistId);
    }

    setPendingDelete(null);
  };

  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId) || playlists[0];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        // Since togglePlay doesn't depend on states directly, we can call it. Wait, actually we can call engine.init() and engine.togglePlay() directly
        engine.init();
        engine.togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  const formatTime = (time: number) => {
     if(isNaN(time)) return "0:00";
     const min = Math.floor(time / 60);
     const sec = Math.floor(time % 60);
     return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  // Drag and drop global listeners
  useEffect(() => {
    const handleDragOverGlobal = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };
    const handleDragLeaveGlobal = (e: DragEvent) => {
      e.preventDefault();
      if (e.clientX === 0 || e.clientY === 0) {
        setIsDragging(false);
      }
    };
    const handleDropGlobal = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      processFiles(e.dataTransfer?.files || null);
    };

    window.addEventListener('dragover', handleDragOverGlobal);
    window.addEventListener('dragleave', handleDragLeaveGlobal);
    window.addEventListener('drop', handleDropGlobal);

    return () => {
      window.removeEventListener('dragover', handleDragOverGlobal);
      window.removeEventListener('dragleave', handleDragLeaveGlobal);
      window.removeEventListener('drop', handleDropGlobal);
    };
  }, []);

 
  const accentHex = `#${resolvedTheme.uRippleColor.getHexString()}`;

  return (
    <div 
      className="absolute inset-0 pointer-events-none z-10 flex w-full h-full" 
      style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", color: '#94a3b8' }}
    >
      {isDragging && (
        <div 
          className="absolute inset-0 z-[60] backdrop-blur-sm border-2 border-dashed m-4 rounded-xl flex items-center justify-center font-mono text-2xl tracking-widest pointer-events-none"
          style={{ backgroundColor: `${accentHex}1a`, borderColor: accentHex, color: accentHex }}
        >
          DROP AUDIO FILE TO PLAY
        </div>
      )}
      
      {isMobileSideNavOpen && (
        <button
          type="button"
          aria-label="关闭侧边栏"
          className="absolute inset-0 z-[55] cursor-default pointer-events-auto"
          onClick={() => setIsMobileSideNavOpen(false)}
        />
      )}

      {/* Sidebar Left */}
      <div
        className={`side-nav-trigger absolute left-0 top-0 h-full z-[60] transition-all pointer-events-auto ${isMobileSideNavOpen ? 'is-mobile-open' : ''}`}
        onMouseEnter={() => setIsMobileSideNavOpen(true)}
      >
        <aside className={`side-nav-panel absolute left-0 top-0 h-full border-r border-white/5 flex flex-col pointer-events-auto ${isMobileSideNavOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300`} style={{ background: 'rgba(2,4,10,0.8)' }}>
          <button onClick={closeFloatingPanels} className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-100 transition-opacity cursor-pointer" style={{ writingMode: 'vertical-rl', color: accentHex }}>可视化</button>
          <button onClick={openOptionsPanel} className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2" style={{ writingMode: 'vertical-rl' }}>
            设置
          </button>
          <button onClick={openSearchPanel} className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2" style={{ writingMode: 'vertical-rl' }}>
            搜索
          </button>
          {isNeteaseCookieValid && (
            <button
              onClick={() => {
                openNeteasePanel();
                loadDailyRecommendations();
              }}
              className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2"
              style={{ writingMode: 'vertical-rl' }}
            >
              网易云
            </button>
          )}
          <button onClick={openPlaylistPanel} className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2" style={{ writingMode: 'vertical-rl' }}>
            歌单
          </button>
          
          <div className="side-nav-bottom mt-auto flex flex-col items-center gap-10">
            <button 
              onClick={() => { loadDemo(); setIsMobileSideNavOpen(false); }}
              className="uppercase tracking-[0.2em] text-[10px] opacity-40 hover:opacity-100 transition-opacity cursor-pointer font-bold"
              style={{ writingMode: 'vertical-rl' }}
            >
              示例
            </button>
            <button 
              onClick={() => { fileInputRef.current?.click(); setIsMobileSideNavOpen(false); }}
              className="uppercase tracking-[0.2em] text-[10px] opacity-40 hover:opacity-100 transition-opacity cursor-pointer"
              style={{ writingMode: 'vertical-rl' }}
            >
              上传
            </button>
            <button 
              onClick={() => {
                if (engine.isCapturing) {
                  engine.stopCapture();
                  setTrackName('No track selected');
                  setLyricsText('');
                } else {
                  setLyricsText('');
                  engine.startCapture().then(() => {
                      if (engine.isCapturing) setTrackName('System Audio Capture');
                  });
                }
                setIsMobileSideNavOpen(false);
              }}
              className={`uppercase tracking-[0.2em] text-[10px] transition-opacity cursor-pointer ${isCapturing ? 'opacity-100 text-[#ef4444]' : 'opacity-40 hover:opacity-100'}`}
              style={{ writingMode: 'vertical-rl' }}
            >
              {isCapturing ? '停止' : '采集'}
            </button>
            <button
              onClick={toggleFullscreen}
              className={`uppercase tracking-[0.2em] text-[10px] transition-opacity cursor-pointer ${isFullscreen ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}
              style={{ writingMode: 'vertical-rl' }}
            >
              {isFullscreen ? '退出' : '全屏'}
            </button>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            accept="audio/*,.lrc" 
            multiple
            className="hidden" 
            onChange={handleFileChange}
          />
        </aside>
      </div>

      {/* Brand Mark */}
      <button
        type="button"
        className="brand-mark absolute top-[38px] left-[56px] font-black text-[24px] leading-[40px] tracking-[-1px] text-white z-50 select-none pointer-events-auto cursor-pointer transition-opacity hover:opacity-80"
        aria-label={isMobileSideNavOpen ? '关闭侧边栏' : '打开侧边栏'}
        aria-expanded={isMobileSideNavOpen}
        onClick={() => setIsMobileSideNavOpen((open) => !open)}
        style={{ color: isMobileSideNavOpen ? accentHex : undefined }}
      >
        AJIN.
      </button>

      {/* Player Panel */}
      {showSearchPanel && (
        <div className="absolute top-[40px] left-[100px] w-[360px] max-h-[70vh] z-50 pointer-events-auto backdrop-blur-[20px] border border-white/10 rounded-sm overflow-hidden" style={{ background: 'rgba(5,10,15,0.88)' }}>
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[12px] uppercase tracking-[0.2em] text-white/70">Netease Search</div>
              <button onClick={() => setShowSearchPanel(false)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">Close</button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                searchNetease();
              }}
            >
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Song or artist"
                className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded-sm px-3 py-2 text-[12px] text-white outline-none focus:border-white/30"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-black rounded-sm disabled:opacity-50"
                style={{ backgroundColor: accentHex }}
              >
                Go
              </button>
            </form>
            {searchStatus && <div className="mt-3 text-[11px] text-white/45">{searchStatus}</div>}
          </div>
          <div className="max-h-[48vh] overflow-y-auto">
            {searchResults.map((song) => (
              <button
                key={song.id}
                onClick={() => loadNeteaseSong(song, searchResults)}
                className="relative w-full text-left px-5 py-4 pr-16 border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <div className={`text-[13px] truncate ${currentSongId === song.id ? 'text-white' : 'text-white/80'}`}>{song.name}</div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSongToAdd(song);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setSongToAdd(song);
                    }
                  }}
                  className="absolute right-5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-sm border border-white/10 text-white/55 hover:text-black hover:border-transparent transition-colors flex items-center justify-center"
                  title="Add to playlist"
                >
                  <Plus size={15} />
                </span>
                <div className="mt-1 text-[11px] text-white/45 truncate">{song.artist || 'Unknown artist'} - {song.album || 'Unknown album'}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {songToAdd && (
        <div className="absolute top-[120px] left-[480px] w-[280px] z-[70] pointer-events-auto backdrop-blur-[20px] border border-white/10 rounded-sm overflow-hidden" style={{ background: 'rgba(5,10,15,0.94)' }}>
          <div className="p-5 border-b border-white/10">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/45 mb-2">Add To Playlist</div>
                <div className="text-[13px] text-white truncate" title={songToAdd.name}>{songToAdd.name}</div>
              </div>
              <button onClick={() => setSongToAdd(null)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">Close</button>
            </div>
          </div>
          <div className="p-3 border-b border-white/10">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                onClick={() => addSongToPlaylist(playlist.id, songToAdd)}
                className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/5 rounded-sm transition-colors"
              >
                <span className="min-w-0 text-[12px] text-white truncate">{playlist.name}</span>
                <span className="text-[10px] text-white/35">{playlist.songs.length}</span>
              </button>
            ))}
          </div>
          <form
            className="p-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              createPlaylistAndAddSong();
            }}
          >
            <input
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist"
              className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded-sm px-3 py-2 text-[12px] text-white outline-none focus:border-white/30"
            />
            <button
              type="submit"
              className="h-9 w-9 flex-shrink-0 rounded-sm text-black flex items-center justify-center disabled:opacity-50"
              style={{ backgroundColor: accentHex }}
              disabled={!newPlaylistName.trim()}
              title="Create playlist"
            >
              <Plus size={15} />
            </button>
          </form>
        </div>
      )}

      {showPlaylistPanel && (
        <div className="absolute top-[40px] left-[100px] w-[420px] max-h-[74vh] z-[65] pointer-events-auto backdrop-blur-[20px] border border-white/10 rounded-sm overflow-hidden" style={{ background: 'rgba(5,10,15,0.9)' }}>
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-[12px] uppercase tracking-[0.2em] text-white/70">
                <ListMusic size={15} />
                Playlists
              </div>
              <button onClick={() => setShowPlaylistPanel(false)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">Close</button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => setActivePlaylistId(playlist.id)}
                  className={`flex-shrink-0 px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.12em] transition-colors ${activePlaylist?.id === playlist.id ? 'text-black border-transparent' : 'text-white/45 border-white/10 hover:text-white'}`}
                  style={{ backgroundColor: activePlaylist?.id === playlist.id ? accentHex : 'transparent' }}
                >
                  {playlist.name}
                </button>
              ))}
              </div>
              <button
                onClick={() => activePlaylist && setPendingDelete({ type: 'playlist', playlistId: activePlaylist.id, label: activePlaylist.name })}
                disabled={!activePlaylist || playlists.length <= 1}
                className="h-8 w-8 flex-shrink-0 rounded-sm border border-white/10 text-white/45 hover:text-[#ef4444] disabled:opacity-20 disabled:hover:text-white/45 flex items-center justify-center"
                title="Delete playlist"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="max-h-[52vh] overflow-y-auto">
            {activePlaylist && activePlaylist.songs.length > 0 ? activePlaylist.songs.map((song) => (
              <button
                key={song.id}
                onClick={() => loadNeteaseSong(song, activePlaylist.songs)}
                className="relative w-full text-left px-5 py-4 pr-16 border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <div className="text-[13px] text-white truncate">{song.name}</div>
                <div className="mt-1 text-[11px] text-white/45 truncate">{song.artist || 'Unknown artist'} - {song.album || 'Unknown album'}</div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete({ type: 'song', playlistId: activePlaylist.id, songId: song.id, label: song.name });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingDelete({ type: 'song', playlistId: activePlaylist.id, songId: song.id, label: song.name });
                    }
                  }}
                  className="absolute right-5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-sm border border-white/10 text-white/45 hover:text-[#ef4444] transition-colors flex items-center justify-center"
                  title="Remove from playlist"
                >
                  <Trash2 size={14} />
                </span>
              </button>
            )) : (
              <div className="px-5 py-8 text-[12px] text-white/40">No songs in this playlist yet</div>
            )}
          </div>
        </div>
      )}

      {showNeteasePanel && (
        <div className="absolute top-[40px] left-[100px] w-[460px] max-h-[76vh] z-[66] pointer-events-auto backdrop-blur-[20px] border border-white/10 rounded-sm overflow-hidden" style={{ background: 'rgba(5,10,15,0.92)' }}>
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[12px] uppercase tracking-[0.2em] text-white/70">网易云</div>
              <button onClick={() => setShowNeteasePanel(false)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">关闭</button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={loadLikedSongs}
                className={`px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.12em] transition-colors ${neteaseCloudTab === 'liked' ? 'text-black border-transparent' : 'text-white/45 border-white/10 hover:text-white'}`}
                style={{ backgroundColor: neteaseCloudTab === 'liked' ? accentHex : 'transparent' }}
              >
                喜欢
              </button>
              <button
                onClick={loadNeteasePlaylists}
                className={`px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.12em] transition-colors ${neteaseCloudTab === 'playlists' ? 'text-black border-transparent' : 'text-white/45 border-white/10 hover:text-white'}`}
                style={{ backgroundColor: neteaseCloudTab === 'playlists' ? accentHex : 'transparent' }}
              >
                歌单
              </button>
              <button
                onClick={loadDailyRecommendations}
                className={`px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.12em] transition-colors ${neteaseCloudTab === 'daily' ? 'text-black border-transparent' : 'text-white/45 border-white/10 hover:text-white'}`}
                style={{ backgroundColor: neteaseCloudTab === 'daily' ? accentHex : 'transparent' }}
              >
                每日推荐
              </button>
            </div>
          </div>

          {neteaseCloudTab === 'playlists' && (
            <div className="p-3 border-b border-white/10 max-h-[140px] overflow-y-auto">
              {neteaseCloudPlaylists.length > 0 ? neteaseCloudPlaylists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => loadNeteasePlaylistSongs(playlist)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/5 rounded-sm transition-colors ${activeNeteasePlaylistId === playlist.id ? 'bg-white/5' : ''}`}
                >
                  <span className="min-w-0 text-[12px] text-white truncate">{playlist.name}</span>
                  <span className="text-[10px] text-white/35">{playlist.trackCount}</span>
                </button>
              )) : (
                <div className="px-3 py-4 text-[12px] text-white/40">{isLoadingNeteaseCloud ? '正在加载歌单...' : '点击“歌单”加载你的网易云歌单'}</div>
              )}
            </div>
          )}

          {neteaseCloudStatus && <div className="px-5 py-3 border-b border-white/5 text-[11px] text-white/45">{neteaseCloudStatus}</div>}
          <NeteaseSongList
            songs={neteaseCloudSongs}
            currentSongId={currentSongId}
            queue={neteaseCloudSongs}
            onPlay={loadNeteaseSong}
            onFavorite={addSongToFavorites}
            emptyText={isLoadingNeteaseCloud ? '正在加载...' : '这里会显示可播放歌曲'}
          />
        </div>
      )}

      {pendingDelete && (
        <div className="absolute inset-0 z-[120] pointer-events-auto flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-[320px] border border-white/10 rounded-sm p-5" style={{ background: 'rgba(5,10,15,0.96)' }}>
            <div className="text-[12px] uppercase tracking-[0.2em] text-white/70 mb-3">
              Confirm Delete
            </div>
            <div className="text-[13px] text-white/80 leading-relaxed mb-5">
              Delete {pendingDelete.type === 'playlist' ? 'playlist' : 'song'} <span className="text-white">{pendingDelete.label}</span>?
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-3 py-2 rounded-sm border border-white/10 text-[10px] uppercase tracking-[0.15em] text-white/45 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={confirmPendingDelete}
                className="px-3 py-2 rounded-sm border border-[#ef4444]/40 text-[10px] uppercase tracking-[0.15em] text-[#ef4444] hover:bg-[#ef4444] hover:text-black"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Player Panel */}
      {showPlayerPanel && trackName !== 'No track selected' && (
        <div className="player-panel absolute top-[30px] right-[30px] w-[280px] px-5 py-4 rounded-sm z-50 pointer-events-auto backdrop-blur-[20px] border border-white/10" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="player-panel-header flex justify-between items-start">
            <div className="player-panel-title text-[17px] leading-6 font-light tracking-[0.05em] text-white truncate" title={trackName}>
              {trackName}
            </div>
            <button 
              onClick={() => {
                const keys = Object.keys(themes);
                const themeKeys = [...keys, CUSTOM_THEME_ID];
                const currentIndex = themeKeys.indexOf(theme);
                const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % themeKeys.length : 0;
                onThemeChange(themeKeys[nextIndex]);
              }}
              className="player-panel-theme text-white/40 hover:text-white transition-colors"
              title="切换主题"
            >
              <Palette size={16} />
            </button>
          </div>
          <div className="player-panel-meta text-[11px] leading-4 opacity-50 uppercase mb-3 tracking-wider">
             {isCapturing ? 'System Audio Capture' : 'Local Audio'}
             <span className="ml-2 text-[#3b82f6] text-[10px]">&bull; {resolvedTheme.name}</span>
          </div>

          {/* Progress bar */}
          <div className={`player-panel-progress h-[14px] mb-3 relative flex items-end group ${isCapturing ? 'opacity-30 pointer-events-none' : ''}`}>
             <div className="w-full relative h-[2px] bg-white/10 group-hover:h-[4px] transition-all">
                <div 
                   className="absolute top-0 left-0 h-full"
                   style={{ backgroundColor: accentHex, width: `${duration ? (currentTime / duration) * 100 : 0}%`, boxShadow: `0 0 10px ${accentHex}88` }}
                 />
             </div>
             <input 
               type="range"
               min={0}
               max={duration || 100}
               step="0.01"
               value={currentTime}
               onChange={(e) => {
                 if (engine.audioElement) {
                   const newTime = parseFloat(e.target.value);
                   engine.audioElement.currentTime = newTime;
                   setCurrentTime(newTime);
                 }
               }}
               className="absolute bottom-0 left-0 w-full opacity-0 cursor-pointer h-full"
             />
          </div>

          <div className={`player-panel-controls flex justify-between items-center text-[10px] uppercase tracking-[0.1em] opacity-80 ${isCapturing ? 'opacity-30 pointer-events-none' : ''}`}>
             <span className="player-panel-time w-8">{formatTime(currentTime)}</span>
             <div className="player-panel-actions flex items-center gap-3">
                <button
                  onClick={() => playFromQueue(-1)}
                  className="hover:text-white transition-colors disabled:opacity-25 disabled:hover:text-inherit"
                  disabled={getCurrentQueue().length === 0}
                  title="Previous track"
                >
                  <SkipBack size={14} />
                </button>
                <button onClick={togglePlay} className="hover:text-white transition-colors">
                  {isPlaying ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
                </button>
                <button
                  onClick={() => playFromQueue(1)}
                  className="hover:text-white transition-colors disabled:opacity-25 disabled:hover:text-inherit"
                  disabled={getCurrentQueue().length === 0}
                  title="Next track"
                >
                  <SkipForward size={14} />
                </button>
                <button
                  onClick={() => setPlayMode((mode) => mode === 'sequence' ? 'shuffle' : 'sequence')}
                  className="hover:text-white transition-colors"
                  title={playMode === 'sequence' ? 'Sequence play' : 'Shuffle play'}
                  style={{ color: playMode === 'shuffle' ? accentHex : undefined }}
                >
                  {playMode === 'sequence' ? <Repeat size={14} /> : <Shuffle size={14} />}
                </button>
             </div>
             
             <div className="player-panel-volume flex items-center gap-2 group w-20 justify-end">
                <input 
                  type="range"
                  min={0} max={1} step={0.01}
                  value={volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    engine.audioElement.volume = val;
                    setVolume(val);
                  }}
                  className="w-12 h-1 accent-current opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer aspect-auto bg-white/20 appearance-none rounded-full"
                  style={{ accentColor: accentHex }}
                />
                <Volume2 
                  size={12} 
                  className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer flex-shrink-0" 
                  onClick={() => {
                    const val = volume > 0 ? 0 : 1;
                    engine.audioElement.volume = val;
                    setVolume(val);
                  }} 
                />
             </div>
             <span className="player-panel-time w-8 text-right">{formatTime(duration)}</span>
          </div>
        </div>
      )}

      {/* Lyrics Display */}
      {trackName !== 'No track selected' && !isCapturing && lyricsText && (
        <LyricsDisplay lrcText={lyricsText} currentTime={currentTime} accentHex={accentHex} isPlaying={isPlaying} />
      )}

      {/* Stats Panel & Lyrics Status */}
      {trackName !== 'No track selected' && (
        <div className="absolute bottom-[40px] left-[100px] z-50 pointer-events-none flex flex-col gap-6">
          {!lyricsText && (
             <div 
                className="text-[10px] text-white/40 uppercase tracking-[0.2em] flex items-center gap-2 pointer-events-auto cursor-pointer hover:text-white/80 transition-colors w-fit"
                onClick={() => fileInputRef.current?.click()}
                title="Upload .lrc file"
             >
                <div className="w-1.5 h-1.5 rounded-full bg-red-500/50"></div>
                No Lyrics - Click to upload .lrc
             </div>
          )}
          <div className="mobile-hide-aux-ui">
            <StatsPanel accentHex={accentHex} />
          </div>
        </div>
      )}

      <div className="mobile-hide-aux-ui absolute bottom-[40px] right-[40px] text-[10px] uppercase tracking-[0.1em] opacity-30 select-none">
        Drag to orbit - Click to pulse
      </div>
      {/* Options Panel */}
      {showOptionsPanel && (
        <OptionsPanel
          onClose={() => setShowOptionsPanel(false)}
          accentHex={accentHex}
          neteaseCookie={neteaseCookie}
          setNeteaseCookie={setNeteaseCookie}
          onSaveCookie={saveNeteaseCookie}
          onClearCookie={clearNeteaseCookie}
          cookieStatus={cookieStatus}
          isNeteaseCookieValid={isNeteaseCookieValid}
          isSyncingNeteaseCookie={isSyncingNeteaseCookie}
          theme={theme}
          customThemes={customThemes}
          activeCustomThemeId={activeCustomThemeId}
          themeRotation={themeRotation}
          groundEqSettings={groundEqSettings}
          onThemeChange={onThemeChange}
          onCustomThemesChange={onCustomThemesChange}
          onThemeRotationChange={onThemeRotationChange}
          onGroundEqSettingsChange={onGroundEqSettingsChange}
        />
      )}
    </div>
  );
}

import { TriggerPreset } from '../../lib/AudioEngine';

function NeteaseSongList({
  songs,
  currentSongId,
  queue,
  onPlay,
  onFavorite,
  emptyText,
}: {
  songs: NeteaseSong[];
  currentSongId: number | null;
  queue: NeteaseSong[];
  onPlay: (song: NeteaseSong, queue?: NeteaseSong[]) => void;
  onFavorite: (song: NeteaseSong) => void;
  emptyText: string;
}) {
  return (
    <div className="max-h-[44vh] overflow-y-auto">
      {songs.length > 0 ? songs.map((song) => (
        <button
          key={song.id}
          onClick={() => onPlay(song, queue)}
          className="relative w-full text-left px-5 py-4 pr-16 border-b border-white/5 hover:bg-white/5 transition-colors"
        >
          <div className={`text-[13px] truncate ${currentSongId === song.id ? 'text-white' : 'text-white/80'}`}>{song.name}</div>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onFavorite(song);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onFavorite(song);
              }
            }}
            className="absolute right-5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-sm border border-white/10 text-white/55 hover:text-black hover:border-transparent transition-colors flex items-center justify-center"
            title="加入喜欢"
          >
            <Plus size={15} />
          </span>
          <div className="mt-1 text-[11px] text-white/45 truncate">{song.artist || '未知歌手'} - {song.album || '未知专辑'}</div>
        </button>
      )) : (
        <div className="px-5 py-8 text-[12px] text-white/40">{emptyText}</div>
      )}
    </div>
  );
}

function OptionsPanel({
  onClose,
  accentHex,
  neteaseCookie,
  setNeteaseCookie,
  onSaveCookie,
  onClearCookie,
  cookieStatus,
  isNeteaseCookieValid,
  isSyncingNeteaseCookie,
  theme,
  customThemes,
  activeCustomThemeId,
  themeRotation,
  groundEqSettings,
  onThemeChange,
  onCustomThemesChange,
  onThemeRotationChange,
  onGroundEqSettingsChange,
}: {
  onClose: () => void;
  accentHex: string;
  neteaseCookie: string;
  setNeteaseCookie: (cookie: string) => void;
  onSaveCookie: () => void;
  onClearCookie: () => void;
  cookieStatus: string;
  isNeteaseCookieValid: boolean;
  isSyncingNeteaseCookie: boolean;
  theme: string;
  customThemes: CustomThemeSettings[];
  activeCustomThemeId: string;
  themeRotation: ThemeRotationSettings;
  groundEqSettings: StoredGroundEqSettings;
  onThemeChange: (theme: string) => void;
  onCustomThemesChange: (settings: CustomThemeSettings[], activeId?: string) => void;
  onThemeRotationChange: (settings: ThemeRotationSettings) => void;
  onGroundEqSettingsChange: (settings: StoredGroundEqSettings) => void;
}) {
  const [activeTab, setActiveTab] = useState<OptionsTab>('Meteor');
  const tabs: OptionsTab[] = ['Pulse', 'Meteor', 'GroundEq', 'Color', 'Cookie'];
  const tabLabels: Record<OptionsTab, string> = {
    Pulse: '脉冲特效',
    Meteor: '流星特效',
    GroundEq: '地面 EQ',
    Color: '自定义主题',
    Cookie: '网易云 Cookie',
  };

  return (
    <div className="absolute top-[40px] left-[100px] z-[100] pointer-events-auto">
       <div
         className="w-[min(840px,calc(100vw-140px))] max-h-[86vh] overflow-y-auto border border-white/10 rounded-sm p-8 transform transition-all shadow-2xl"
         style={{
           background: 'rgba(5,10,15,0.94)',
           boxShadow: '0 24px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
         }}
       >
          <div className="flex justify-between items-center mb-6">
             <div>
               <div className="text-xl font-light tracking-widest text-white">设置</div>
               <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-white/35">视觉触发器、颜色与网易云 Cookie</div>
             </div>
             <button onClick={onClose} className="text-white/50 hover:text-white uppercase tracking-widest text-[10px]">关闭</button>
          </div>

          <div className="flex gap-2 mb-6">
            {tabs.map((tab) => (
               <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-[10px] uppercase tracking-widest rounded-sm border transition-colors ${
                     activeTab === tab ? 'text-black border-transparent' : 'border-white/10 text-white/45 hover:text-white hover:bg-white/5'
                  }`}
                  style={{ backgroundColor: activeTab === tab ? accentHex : 'transparent' }}
               >
                  {tabLabels[tab]}
               </button>
            ))}
          </div>

          {activeTab === 'GroundEq' ? (
            <GroundEqPanel
              accentHex={accentHex}
              groundEqSettings={groundEqSettings}
              onGroundEqSettingsChange={onGroundEqSettingsChange}
            />
          ) : activeTab === 'Color' ? (
            <CustomColorPanel
              accentHex={accentHex}
              theme={theme}
              customThemes={customThemes}
              activeCustomThemeId={activeCustomThemeId}
              themeRotation={themeRotation}
              onThemeChange={onThemeChange}
              onCustomThemesChange={onCustomThemesChange}
              onThemeRotationChange={onThemeRotationChange}
            />
          ) : activeTab === 'Cookie' ? (
            <NeteaseCookiePanel
              accentHex={accentHex}
              neteaseCookie={neteaseCookie}
              setNeteaseCookie={setNeteaseCookie}
              onSaveCookie={onSaveCookie}
              onClearCookie={onClearCookie}
              cookieStatus={cookieStatus}
              isNeteaseCookieValid={isNeteaseCookieValid}
              isSyncingNeteaseCookie={isSyncingNeteaseCookie}
            />
          ) : (
            <FreqTriggerPanel key={activeTab} action={activeTab} accentHex={accentHex} />
          )}
       </div>
    </div>
  );
}

function GroundEqPanel({
  accentHex,
  groundEqSettings,
  onGroundEqSettingsChange,
}: {
  accentHex: string;
  groundEqSettings: StoredGroundEqSettings;
  onGroundEqSettingsChange: (settings: StoredGroundEqSettings) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const draftCurve = useRef<number[]>(groundEqSettings.curve);
  const [curve, setCurve] = useState(groundEqSettings.curve);

  useEffect(() => {
    draftCurve.current = groundEqSettings.curve;
    setCurve(groundEqSettings.curve);
  }, [groundEqSettings.curve]);

  const commitCurve = (nextCurve: number[]) => {
    draftCurve.current = nextCurve;
    setCurve(nextCurve);
    onGroundEqSettingsChange({ curve: nextCurve });
  };

  const resetCurve = () => {
    commitCurve([...defaultGroundEqCurve]);
  };

  const updateCurveFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const targetIndex = Math.round(x * (GROUND_EQ_POINT_COUNT - 1));
    const nextValue = Math.round((1 - y) * 100);
    const nextCurve = draftCurve.current.map((value, index) => (
      index === targetIndex ? nextValue : value
    ));
    commitCurve(nextCurve);
  };

  const bandNotes = [
    { unit: 0.00, marker: '1', short: '超低', color: '#6ee7ff', label: '超低频 / Sub Bass', target: '拖第 1 段', text: '影响中心最大块的抬升，鼓点、低沉冲击越明显，地面中间越会顶起来。' },
    { unit: 0.12, marker: '2', short: '低频', color: '#5eead4', label: '低频 / Bass', target: '拖第 2 段', text: '影响中心附近的厚重起伏，低音线和底鼓会让地面更有重量。' },
    { unit: 0.28, marker: '3', short: '低中', color: '#a7f3d0', label: '低中频 / Low Mid', target: '拖第 3 段', text: '影响大范围慢波浪，适合控制整片地形是不是跟着音乐慢慢流动。' },
    { unit: 0.42, marker: '4', short: '中频', color: '#fde68a', label: '中频 / Mid', target: '拖第 4 段', text: '影响斜向流动和地面方向感，人声、吉他、旋律主体常在这里。' },
    { unit: 0.58, marker: '5', short: '高中', color: '#fbbf24', label: '高中频 / High Mid', target: '拖第 5 段', text: '影响外围散点尖峰。想让中高频更清楚，就主要调图上的第 5 段。' },
    { unit: 0.72, marker: '6', short: '存在', color: '#fb7185', label: '存在感 / Presence', target: '拖第 6 段', text: '影响局部闪光触发感，镲片、齿音、清脆敲击会更容易冒亮点。' },
    { unit: 0.86, marker: '7', short: '亮度', color: '#c084fc', label: '亮度 / Brilliance', target: '拖第 7 段', text: '影响边缘微闪和细碎高亮，拉高会让画面边缘更亮、更碎。' },
    { unit: 1.00, marker: '8', short: '空气', color: '#93c5fd', label: '空气感 / Air', target: '拖第 8 段', text: '影响最细的高频闪烁和轻微发光颗粒，主要是最右侧的尾端。' },
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;

    const bandBounds = bandNotes.map((note, index) => {
      const previousUnit = index === 0 ? 0 : (bandNotes[index - 1].unit + note.unit) / 2;
      const nextUnit = index === bandNotes.length - 1 ? 1 : (note.unit + bandNotes[index + 1].unit) / 2;
      return { ...note, start: previousUnit, end: nextUnit };
    });

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const targetWidth = Math.max(1, Math.floor(rect.width * ratio));
      const targetHeight = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(0, 0, width, height);

      bandBounds.forEach((band) => {
        const startX = band.start * width;
        const bandWidth = Math.max(1, (band.end - band.start) * width);
        ctx.fillStyle = `${band.color}14`;
        ctx.fillRect(startX, 0, bandWidth, height);
        ctx.strokeStyle = `${band.color}44`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX, height);
        ctx.stroke();

        const centerX = band.unit * width;
        ctx.fillStyle = `${band.color}dd`;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${band.marker} ${band.short}`, centerX, 8);
      });

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const spectrum = engine.getRawFrequencyData();
      const binCount = spectrum.length || 1;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 2) {
        const unit = width <= 0 ? 0 : x / width;
        const bin = Math.min(binCount - 1, Math.floor(unit * unit * (binCount - 1)));
        const value = spectrum[bin] / 255;
        const y = height - Math.pow(value, 0.72) * height * 0.84;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = `${accentHex}24`;
      ctx.fill();

      ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const unit = width <= 0 ? 0 : x / width;
        const bin = Math.min(binCount - 1, Math.floor(unit * unit * (binCount - 1)));
        const value = spectrum[bin] / 255;
        const y = height - Math.pow(value, 0.72) * height * 0.84;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `${accentHex}70`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const midY = height * 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.26)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      const points = draftCurve.current.map((value, index) => ({
        x: (index / (GROUND_EQ_POINT_COUNT - 1)) * width,
        y: height - (value / 100) * height,
      }));

      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();

      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();

      points.forEach((point, index) => {
        const unit = index / (GROUND_EQ_POINT_COUNT - 1);
        const band = bandBounds.find((item) => unit >= item.start && unit <= item.end) || bandBounds[bandBounds.length - 1];
        ctx.beginPath();
        ctx.fillStyle = band.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.lineWidth = 2;
        ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    };

    draw();
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [accentHex]);

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-4 border border-white/10 bg-white/[0.03] rounded-sm p-4">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-white/70 mb-2">地面 EQ 曲线</div>
          <div className="text-[11px] leading-relaxed text-white/45">中线默认，上拖更敏感，下拖更钝。它只控制地面动效，不改变音乐声音。</div>
        </div>
        <button
          onClick={resetCurve}
          className="shrink-0 px-3 py-2 rounded-sm border border-white/10 text-[10px] uppercase tracking-[0.15em] text-white/55 hover:text-white transition-colors"
        >
          恢复中线
        </button>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.15em] text-white/35">
          <span>更敏感</span>
          <span>实时频谱在底层，EQ 曲线在上层</span>
        </div>
        <canvas
          ref={canvasRef}
          className="h-[220px] w-full rounded-sm border border-white/10 bg-black/30 cursor-crosshair touch-none"
          onPointerDown={(event) => {
            isDragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateCurveFromEvent(event);
          }}
          onPointerMove={(event) => {
            if (!isDragging.current) return;
            updateCurveFromEvent(event);
          }}
          onPointerUp={(event) => {
            isDragging.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            isDragging.current = false;
          }}
        />
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.15em] text-white/35">
          <span>更钝</span>
          <span>左低频 → 右高频 · 当前均值 {Math.round(curve.reduce((sum, value) => sum + value, 0) / curve.length)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {bandNotes.map((note) => (
          <div key={note.label} className="rounded-sm border border-white/10 bg-black/20 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-[10px] font-medium text-black" style={{ backgroundColor: note.color }}>
                  {note.marker}
                </span>
                <div className="truncate text-[12px] text-white/75">{note.label}</div>
              </div>
              <div className="text-[11px]" style={{ color: accentHex }}>{Math.round(readGroundEqCurveValue(curve, note.unit))}</div>
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-white/45">
              <span style={{ color: note.color }}>{note.target}</span>
              <span className="text-white/25"> · 曲线位置 {Math.round(note.unit * 100)}%</span>
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-white/35">{note.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomColorPanel({
  accentHex,
  theme,
  customThemes,
  activeCustomThemeId,
  themeRotation,
  onThemeChange,
  onCustomThemesChange,
  onThemeRotationChange,
}: {
  accentHex: string;
  theme: string;
  customThemes: CustomThemeSettings[];
  activeCustomThemeId: string;
  themeRotation: ThemeRotationSettings;
  onThemeChange: (theme: string) => void;
  onCustomThemesChange: (settings: CustomThemeSettings[], activeId?: string) => void;
  onThemeRotationChange: (settings: ThemeRotationSettings) => void;
}) {
  const activePreset = customThemes.find((preset) => preset.id === activeCustomThemeId) || customThemes[0] || createCustomThemePreset();
  const rotationItems = [
    ...BUILT_IN_THEME_IDS.map((id) => ({
      id,
      name: themes[id]?.name || id,
      colors: [
        `#${themes[id].uBaseColor1.getHexString()}`,
        `#${themes[id].uCoolCore.getHexString()}`,
        `#${themes[id].uWarmCore.getHexString()}`,
        `#${themes[id].uRippleColor.getHexString()}`,
      ],
    })),
    ...customThemes.map((preset) => ({
      id: preset.id,
      name: preset.name,
      colors: [preset.background, preset.cool, preset.warm, preset.accent],
    })),
  ];

  const savePresets = (nextPresets: CustomThemeSettings[], nextActiveId = activePreset.id) => {
    onCustomThemesChange(nextPresets, nextActiveId);
  };

  const updateRotation = (patch: Partial<ThemeRotationSettings>) => {
    onThemeRotationChange({ ...themeRotation, ...patch });
  };

  const toggleRotationTheme = (themeId: string) => {
    const isSelected = themeRotation.themeIds.includes(themeId);
    const nextIds = isSelected
      ? themeRotation.themeIds.filter((id) => id !== themeId)
      : [...themeRotation.themeIds, themeId];
    updateRotation({ themeIds: nextIds });
  };

  const updateCustomTheme = (patch: Partial<CustomThemeSettings>) => {
    const nextPresets = customThemes.map((preset) => (
      preset.id === activePreset.id ? { ...preset, ...patch } : preset
    ));
    savePresets(nextPresets, activePreset.id);
  };

  const useCustomTheme = (presetId: string) => {
    savePresets(customThemes, presetId);
    onThemeChange(CUSTOM_THEME_ID);
  };

  const addCustomTheme = () => {
    const nextPreset = createCustomThemePreset({
      ...activePreset,
      id: undefined,
      name: `自定义主题 ${customThemes.length + 1}`,
    });
    savePresets([...customThemes, nextPreset], nextPreset.id);
  };

  const deleteCustomTheme = (presetId: string) => {
    if (customThemes.length <= 1) return;
    const nextPresets = customThemes.filter((preset) => preset.id !== presetId);
    const nextActiveId = activePreset.id === presetId ? nextPresets[0].id : activePreset.id;
    savePresets(nextPresets, nextActiveId);
  };

  const colorControls: Array<{ key: keyof Pick<CustomThemeSettings, 'background' | 'cool' | 'warm' | 'accent'>; label: string; hint: string }> = [
    { key: 'background', label: '背景色', hint: '控制页面背景、雾色和地形暗部' },
    { key: 'cool', label: '冷色', hint: '控制亮部、冷调和高频地形发光' },
    { key: 'warm', label: '暖色', hint: '控制暖调地形发光，也会影响流星颜色' },
    { key: 'accent', label: '强调色', hint: '控制按钮、歌词、进度条、脉冲波纹和设置滑块' },
  ];

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-4 border border-white/10 bg-white/[0.03] rounded-sm p-4">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-white/70 mb-2">自定义主题</div>
          <div className="text-[11px] leading-relaxed text-white/45">
            四个内置主题保持原样。这里可以提前保存多个自定义主题，点击“使用”后才会切换。
          </div>
        </div>
        <button
          onClick={addCustomTheme}
          className="shrink-0 px-3 py-2 rounded-sm border border-white/10 text-[10px] uppercase tracking-[0.15em] text-white/55 hover:text-white transition-colors"
        >
          新建主题
        </button>
      </div>

      <div className="rounded-sm border border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] text-white/75">旋转速度</div>
            <div className="mt-1 text-[10px] text-white/35">控制地面镜头自动旋转，调到 0 就停止自动旋转</div>
          </div>
          <div className="text-[12px]" style={{ color: accentHex }}>{activePreset.rotationSpeed.toFixed(2)}</div>
        </div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={activePreset.rotationSpeed}
          onChange={(event) => updateCustomTheme({ rotationSpeed: Number(event.target.value) })}
          className="mt-3 w-full accent-current h-1"
          style={{ accentColor: accentHex }}
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-sm border border-white/10 bg-black/20 px-4 py-3">
        <div>
          <div className="text-[12px] text-white/75">显示播放器卡片</div>
          <div className="mt-1 text-[10px] text-white/35">控制右上角播放卡片、歌名、进度和切歌按钮是否显示</div>
        </div>
        <button
          onClick={() => updateCustomTheme({ showPlayerPanel: !activePreset.showPlayerPanel })}
          className={`shrink-0 px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.15em] transition-colors ${
            activePreset.showPlayerPanel ? 'text-black border-transparent' : 'border-white/10 text-white/45 hover:text-white'
          }`}
          style={{ backgroundColor: activePreset.showPlayerPanel ? accentHex : 'transparent' }}
        >
          {activePreset.showPlayerPanel ? '显示' : '隐藏'}
        </button>
      </div>

      <div className="grid gap-4 rounded-sm border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[12px] uppercase tracking-[0.18em] text-white/70 mb-2">自动轮换主题</div>
            <div className="text-[11px] leading-relaxed text-white/45">选择参与轮换的默认主题和自定义主题，并设置切换间隔。</div>
          </div>
          <button
            onClick={() => updateRotation({ enabled: !themeRotation.enabled })}
            className={`px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.15em] transition-colors ${
              themeRotation.enabled ? 'text-black border-transparent' : 'border-white/10 text-white/45 hover:text-white'
            }`}
            style={{ backgroundColor: themeRotation.enabled ? accentHex : 'transparent' }}
          >
            {themeRotation.enabled ? '已开启' : '开启轮换'}
          </button>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-white/75">轮换时间</div>
            <div className="text-[12px]" style={{ color: accentHex }}>{themeRotation.intervalSeconds} 秒</div>
          </div>
          <input
            type="range"
            min="3"
            max="120"
            step="1"
            value={themeRotation.intervalSeconds}
            onChange={(event) => updateRotation({ intervalSeconds: Number(event.target.value) })}
            className="w-full accent-current h-1"
            style={{ accentColor: accentHex }}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => updateRotation({ themeIds: rotationItems.map((item) => item.id) })}
            className="px-3 py-1.5 rounded-sm border border-white/10 text-[10px] uppercase tracking-[0.15em] text-white/45 hover:text-white transition-colors"
          >
            全选
          </button>
          <button
            onClick={() => updateRotation({ themeIds: [] })}
            className="px-3 py-1.5 rounded-sm border border-white/10 text-[10px] uppercase tracking-[0.15em] text-white/45 hover:text-white transition-colors"
          >
            清空
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rotationItems.map((item) => {
            const isSelected = themeRotation.themeIds.includes(item.id);
            return (
              <button
                key={item.id}
                onClick={() => toggleRotationTheme(item.id)}
                className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2 text-left transition-colors ${
                  isSelected ? 'border-white/35 bg-white/10' : 'border-white/10 bg-black/20 hover:bg-white/5'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-[11px] text-white/75 truncate">{item.name}</span>
                  <span className="mt-2 flex gap-1">
                    {item.colors.map((color) => (
                      <span key={`${item.id}-${color}`} className="h-2.5 w-5 rounded-[1px]" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                </span>
                <span
                  className="h-4 w-4 shrink-0 rounded-sm border"
                  style={{ borderColor: isSelected ? accentHex : 'rgba(255,255,255,0.18)', backgroundColor: isSelected ? accentHex : 'transparent' }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {customThemes.map((preset) => {
          const isActivePreset = preset.id === activePreset.id;
          const isUsingPreset = theme === CUSTOM_THEME_ID && preset.id === activeCustomThemeId;
          return (
            <button
              key={preset.id}
              onClick={() => savePresets(customThemes, preset.id)}
              className={`shrink-0 min-w-[120px] px-3 py-2 rounded-sm border text-left transition-colors ${
                isActivePreset ? 'border-white/35 bg-white/10' : 'border-white/10 bg-black/20 hover:bg-white/5'
              }`}
            >
              <span className="block text-[11px] text-white/75 truncate">{preset.name}</span>
              <span className="mt-2 flex gap-1">
                {[preset.background, preset.cool, preset.warm, preset.accent].map((color) => (
                  <span key={color} className="h-2.5 w-5 rounded-[1px]" style={{ backgroundColor: color }} />
                ))}
              </span>
              <span className="mt-2 block text-[9px] uppercase tracking-[0.14em]" style={{ color: isUsingPreset ? accentHex : 'rgba(255,255,255,0.35)' }}>
                {isUsingPreset ? '正在使用' : '已保存'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-2">
        <label className="text-[10px] uppercase tracking-[0.18em] text-white/45">主题名称</label>
        <input
          value={activePreset.name}
          onChange={(event) => updateCustomTheme({ name: event.target.value })}
          className="bg-black/30 border border-white/10 rounded-sm px-3 py-2 text-[12px] text-white outline-none focus:border-white/30"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {colorControls.map((control) => (
          <label key={control.key} className="flex items-center gap-3 rounded-sm border border-white/10 bg-black/20 px-3 py-3">
            <input
              type="color"
              value={activePreset[control.key]}
              onChange={(event) => updateCustomTheme({ [control.key]: event.target.value } as Partial<CustomThemeSettings>)}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-sm border border-white/10 bg-transparent p-0"
              title={control.label}
            />
            <span className="min-w-0">
              <span className="block text-[12px] text-white/75">{control.label}</span>
              <span className="block mt-1 text-[10px] leading-relaxed text-white/35">{control.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="rounded-sm border border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] text-white/75">发光强度</div>
            <div className="mt-1 text-[10px] text-white/35">控制地形整体发光亮度</div>
          </div>
          <div className="text-[12px]" style={{ color: accentHex }}>{activePreset.glowIntensity.toFixed(2)}</div>
        </div>
        <input
          type="range"
          min="0.4"
          max="2.2"
          step="0.05"
          value={activePreset.glowIntensity}
          onChange={(event) => updateCustomTheme({ glowIntensity: Number(event.target.value) })}
          className="mt-3 w-full accent-current h-1"
          style={{ accentColor: accentHex }}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => deleteCustomTheme(activePreset.id)}
          disabled={customThemes.length <= 1}
          className="px-3 py-2 rounded-sm border border-white/10 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white disabled:opacity-25 disabled:hover:text-white/35 transition-colors"
        >
          删除当前
        </button>
        <button
          onClick={() => useCustomTheme(activePreset.id)}
          className="px-3 py-2 rounded-sm text-[10px] uppercase tracking-[0.15em] text-black"
          style={{ backgroundColor: accentHex }}
        >
          使用这个主题
        </button>
      </div>
    </div>
  );
}

function NeteaseCookiePanel({
  accentHex,
  neteaseCookie,
  setNeteaseCookie,
  onSaveCookie,
  onClearCookie,
  cookieStatus,
  isNeteaseCookieValid,
  isSyncingNeteaseCookie,
}: {
  accentHex: string;
  neteaseCookie: string;
  setNeteaseCookie: (cookie: string) => void;
  onSaveCookie: () => void;
  onClearCookie: () => void;
  cookieStatus: string;
  isNeteaseCookieValid: boolean;
  isSyncingNeteaseCookie: boolean;
}) {
  return (
    <div className="grid gap-5">
      <div className="border border-white/10 bg-white/[0.03] rounded-sm p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="text-[12px] uppercase tracking-[0.18em] text-white/70 mb-2">手动 Cookie 登录</div>
            <div className="text-[11px] leading-relaxed text-white/45">
              先在网易云官网正常登录，再从浏览器复制 Cookie。本项目不会自动读取官网 Cookie。
            </div>
          </div>
          <button
            onClick={() => window.open('https://music.163.com/', '_blank', 'noopener,noreferrer')}
            className="shrink-0 px-3 py-2 rounded-sm text-[10px] uppercase tracking-[0.15em] text-black"
            style={{ backgroundColor: accentHex }}
          >
            打开官网
          </button>
        </div>
        <ol className="grid gap-2 text-[12px] leading-relaxed text-white/55 list-decimal list-inside">
          <li>用电脑 Chrome 或 Edge 打开 music.163.com，先登录网易云账号。</li>
          <li>按 F12 打开开发者工具；如果没有反应，试试 Fn + F12 或 Ctrl + Shift + I。</li>
          <li>点顶部的 Network/网络，刷新网易云页面或播放、搜索一首歌。</li>
          <li>在过滤输入框里搜 weapi；搜不到就改搜 music.163.com。</li>
          <li>点任意请求，在 Headers/标头里搜索 cookie。</li>
          <li>复制 Cookie: 后面的整段内容，粘贴到下面输入框，点保存 Cookie。</li>
        </ol>
        <div className="mt-3 text-[11px] leading-relaxed text-white/35">
          手机浏览器通常没有 F12/Network，复制 Cookie 建议用电脑。Cookie 只保存在当前浏览器，不能绕过版权、会员或地区限制。
        </div>
      </div>
      <div className="grid gap-2">
        <label className="text-[10px] uppercase tracking-[0.18em] text-white/45">网易云 Cookie</label>
        <textarea
          value={neteaseCookie}
          onChange={(e) => setNeteaseCookie(e.target.value)}
          spellCheck={false}
          placeholder="MUSIC_U=...; __csrf=...; NMTID=..."
          className="min-h-[180px] resize-y bg-black/40 border border-white/10 rounded-sm px-3 py-3 text-[12px] leading-relaxed text-white outline-none focus:border-white/30 font-mono"
        />
      </div>
      <div className="text-[11px] leading-relaxed text-white/45">
        可以直接粘贴多行 Cookie，保存时会自动整理成网易云接口能用的格式。
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-white/45">
          {isSyncingNeteaseCookie ? '正在校验 Cookie...' : (cookieStatus || (neteaseCookie.trim() ? (isNeteaseCookieValid ? 'Cookie 可用，网易云入口已开启' : '已从浏览器读取 Cookie，请点击保存进行校验') : '当前没有保存 Cookie'))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClearCookie}
            className="px-3 py-2 rounded-sm border border-white/10 text-[10px] uppercase tracking-[0.15em] text-white/45 hover:text-white"
          >
            清除
          </button>
          <button
            onClick={onSaveCookie}
            className="px-3 py-2 rounded-sm text-[10px] uppercase tracking-[0.15em] text-black"
            style={{ backgroundColor: accentHex }}
          >
            保存 Cookie
          </button>
        </div>
      </div>
    </div>
  );
}
function FreqTriggerPanel({ action, accentHex }: { action: 'Pulse' | 'Meteor', accentHex: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const getConfig = () => action === 'Pulse' ? engine.pulseTrigger : engine.meteorTrigger;
  
  const [triggerPoint, setTriggerPoint] = useState({ 
    x: getConfig().freqIndex >= 0 ? getConfig().freqIndex / 512 : 0.5, 
    y: getConfig().threshold 
  });
  const [isEnabled, setIsEnabled] = useState(getConfig().enabled);
  const [mode, setMode] = useState<TriggerPreset>(getConfig().mode);
  const [sensitivity, setSensitivity] = useState(getConfig().sensitivity);
  const [cooldown, setCooldown] = useState(getConfig().cooldown);
  const [pulseStrength, setPulseStrength] = useState(getConfig().pulseStrength);
  const [bandStart, setBandStart] = useState(getConfig().bandStart);
  const [bandEnd, setBandEnd] = useState(getConfig().bandEnd);
  const isDragging = useRef(false);

  // Sync state TO engine when parameters change
  useEffect(() => {
     const c = getConfig();
     c.enabled = isEnabled;
     c.mode = mode;
     c.sensitivity = sensitivity;
     c.cooldown = cooldown;
     c.pulseStrength = pulseStrength;
     c.bandStart = bandStart;
     c.bandEnd = bandEnd;
     
     if (mode === 'Advanced') {
         c.freqIndex = Math.floor(triggerPoint.x * 512);
         c.threshold = triggerPoint.y;
     } else {
         c.freqIndex = -1;
     }

     writeTriggerSettingsStorage({
       Pulse: snapshotTriggerConfig(engine.pulseTrigger),
       Meteor: snapshotTriggerConfig(engine.meteorTrigger),
     });
  }, [isEnabled, mode, sensitivity, cooldown, pulseStrength, bandStart, bandEnd, triggerPoint]);

  const handleModeChange = (newMode: TriggerPreset) => {
    setMode(newMode);
  };

  const presets: TriggerPreset[] = ['Auto Beat', 'Advanced'];
  const modeLabels: Record<TriggerPreset, string> = {
    'Auto Beat': '自动节拍',
    Advanced: '高级模式',
  };
  const actionLabel = action === 'Pulse' ? '脉冲特效' : '流星特效';

  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);
      
      // Draw grid
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      for(let i=1; i<10; i++) {
         ctx.moveTo(0, height * i / 10);
         ctx.lineTo(width, height * i / 10);
         ctx.moveTo(width * i / 10, 0);
         ctx.lineTo(width * i / 10, height);
      }
      ctx.stroke();

      const data = engine.getRawFrequencyData();
      const binCount = data.length || 512;

      // Draw highlighted band
      const [startBin, endBin] = getConfig().getTriggerRange();
      const startX = (startBin / binCount) * width;
      const endX = (endBin / binCount) * width;
      
      ctx.fillStyle = mode === 'Advanced' ? 'rgba(255,255,255,0.02)' : `${accentHex}20`;
      ctx.fillRect(startX, 0, Math.max(1, endX - startX), height);
      
      if (mode !== 'Advanced') {
         ctx.strokeStyle = accentHex + '80';
         ctx.lineWidth = 1;
         ctx.beginPath();
         ctx.moveTo(endX, 0);
         ctx.lineTo(endX, height);
         ctx.stroke();
      }

      // Draw spectrum
      ctx.fillStyle = accentHex + '40'; // opacity
      ctx.beginPath();
      ctx.moveTo(0, height);
      
      for(let i = 0; i < binCount; i++) {
         const x = (i / binCount) * width;
         const val = data[i] / 255.0;
         const y = height - (val * height);
         ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      if (mode === 'Advanced') {
          // Draw drag point
          const tx = triggerPoint.x * width;
          const ty = height - (triggerPoint.y * height);
          
          ctx.beginPath();
          ctx.moveTo(tx, 0);
          ctx.lineTo(tx, height);
          ctx.moveTo(0, ty);
          ctx.lineTo(width, ty);
          ctx.strokeStyle = accentHex;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(tx, ty, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
      } else {
          // Draw dynamic threshold line
          const evE = getConfig().lastEvalEnergy;
          const evThresh = getConfig().lastEvalThresh;
          
          const eY = height - (evE * height);
          const tY = height - (evThresh * height);
          
          ctx.beginPath();
          ctx.setLineDash([5, 5]);
          ctx.moveTo(0, tY);
          ctx.lineTo(width, tY);
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Current energy dot
          const cx = (startX + endX) / 2;
          ctx.beginPath();
          ctx.arc(cx, eY, 6, 0, Math.PI * 2);
          ctx.fillStyle = evE > evThresh ? accentHex : 'rgba(255,255,255,0.5)';
          ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [accentHex, triggerPoint, mode]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (mode !== 'Advanced') return;
    isDragging.current = true;
    updateTriggerFromEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || mode !== 'Advanced') return;
    updateTriggerFromEvent(e);
  };

  const handlePointerUp = () => {
    isDragging.current = false;
  };

  const updateTriggerFromEvent = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    
    setTriggerPoint({ x, y });
    const config = action === 'Meteor' ? engine.meteorTrigger : engine.pulseTrigger;
    config.freqIndex = Math.floor(x * 512); // assuming binCount max 512
    config.threshold = y;
  };

  return (
    <div>
          <div className="flex items-center justify-between mb-6">
             <div className="text-[12px] uppercase tracking-[0.2em] text-white/70">{actionLabel}</div>
             <label className="flex items-center gap-2 cursor-pointer">
               <input 
                 type="checkbox" 
                 checked={isEnabled} 
                 onChange={(e) => setIsEnabled(e.target.checked)}
                 className="w-4 h-4 rounded-sm border-white/20 bg-black/50"
                 style={{ accentColor: accentHex }}
               />
               <span className="text-[10px] uppercase tracking-widest text-white/50">启用</span>
             </label>
          </div>
          
          <div className="flex gap-2 mb-4">
            {presets.map(p => (
               <button
                  key={p}
                  onClick={() => handleModeChange(p)}
                  className={`px-3 py-1.5 text-[10px] uppercase tracking-widest rounded-sm border transition-colors ${
                     mode === p ? 'bg-white/10 text-white border-white/20' : 'border-transparent text-white/40 hover:text-white hover:bg-white/5'
                  }`}
               >
                  {modeLabels[p]}
               </button>
            ))}
          </div>

          <p className="text-[11px] text-white/40 mb-6 font-mono h-10 leading-relaxed">
            {mode === 'Advanced' 
              ? '拖动十字线设置目标频率和触发阈值。频谱超过阈值时，会触发当前视觉特效。'
              : '自动节拍会比较当前频段能量和滚动平均值，能量明显抬升时触发视觉特效。'}
          </p>
          <div className={`relative w-full aspect-[2/1] bg-black/50 border border-white/5 rounded overflow-hidden ${mode === 'Advanced' ? 'cursor-crosshair' : ''}`}>
            <canvas 
              ref={canvasRef}
              width={800} 
              height={400} 
              className="w-full h-full block"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>

          {mode === 'Auto Beat' && (
            <div className="mt-8 grid grid-cols-2 gap-6">
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>灵敏度</span>
                    <span style={{ color: accentHex }}>{sensitivity.toFixed(2)}</span>
                 </div>
                 <input type="range" min="0" max="1" step="0.05" value={sensitivity} onChange={e => setSensitivity(parseFloat(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>冷却帧数</span>
                    <span style={{ color: accentHex }}>{cooldown}</span>
                 </div>
                 <input type="range" min="0" max="300" step="1" value={cooldown} onChange={e => setCooldown(parseInt(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>触发频段 ({bandStart} - {bandEnd})</span>
                 </div>
                 <div className="flex gap-2">
                   <input type="range" min="0" max="250" step="1" value={bandStart} onChange={e => setBandStart(Math.min(parseInt(e.target.value), bandEnd - 1))} className="w-1/2 accent-current h-1" style={{ accentColor: accentHex }}/>
                   <input type="range" min="2" max="256" step="1" value={bandEnd} onChange={e => setBandEnd(Math.max(parseInt(e.target.value), bandStart + 1))} className="w-1/2 accent-current h-1" style={{ accentColor: accentHex }}/>
                 </div>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>特效强度</span>
                    <span style={{ color: accentHex }}>{pulseStrength.toFixed(2)}</span>
                 </div>
                 <input type="range" min="0" max="5" step="0.1" value={pulseStrength} onChange={e => setPulseStrength(parseFloat(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
            </div>
          )}
    </div>
  );
}

function StatsPanel({ accentHex }: { accentHex: string }) {
  const [data, setData] = useState({ bass: 0, mid: 0, treble: 0, energy: 0 });

  useEffect(() => {
    let animationFrameId: number;
    const poll = () => {
      setData(engine.getAudioData());
      animationFrameId = requestAnimationFrame(poll);
    };
    poll();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div className="flex gap-10">
      <StatBox label="Bass" value={data.bass} accentHex={accentHex} />
      <StatBox label="Mid" value={data.mid} accentHex={accentHex} />
      <StatBox label="Treble" value={data.treble} accentHex={accentHex} />
      <StatBox label="Energy" value={data.energy} accentHex={accentHex} />
    </div>
  );
}

function StatBox({ label, value, accentHex }: { label: string, value: number, accentHex: string }) {
  const displayValue = (value * 100).toFixed(1);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[9px] uppercase tracking-[0.15em] opacity-40">{label}</div>
      <div className="font-mono text-[14px]" style={{ color: accentHex }}>{displayValue}</div>
      <div className="w-[100px] h-[2px] relative bg-white/10">
        <div 
          className="absolute h-full transition-all duration-75"
          style={{ backgroundColor: accentHex, width: `${Math.min(100, value * 100)}%`, boxShadow: `0 0 8px ${accentHex}88` }} 
        />
      </div>
    </div>
  );
}




