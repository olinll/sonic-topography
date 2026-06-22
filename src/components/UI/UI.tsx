import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, SkipForward, SkipBack, Palette, Plus, ListMusic, Shuffle, Repeat, Trash2, Menu, X } from 'lucide-react';
import { engine } from '../../lib/AudioEngine';
import { themes } from '../../lib/themes';
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
  onThemeChange: (theme: string) => void;
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
type OptionsTab = 'Pulse' | 'Meteor' | 'Cookie';
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

export function UI({ theme, onThemeChange }: UIProps) {
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
  const [isMobileSideNavOpen, setIsMobileSideNavOpen] = useState(false);
  const hasLoadedPlaylistsRef = useRef(false);

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

  const syncNeteaseCookie = async (cookie: string) => {
    try {
      const response = await fetch('/api/netease/cookie', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie }),
      });
      const data = await response.json();
      const valid = Boolean(data.valid);
      setIsNeteaseCookieValid(valid);
      setCookieStatus(cookie.trim() ? (valid ? 'Cookie 可用，已开启网易云' : 'Cookie 已保存，但校验失败') : 'Cookie 已清除');
    } catch (error) {
      console.warn('Unable to sync Netease cookie:', error);
      setIsNeteaseCookieValid(false);
      setCookieStatus('已保存到浏览器，但同步到本地代理失败');
    }
  };

  useEffect(() => {
    const savedCookie = readNeteaseCookieStorage();
    if (savedCookie) syncNeteaseCookie(savedCookie);
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

  const ensureNeteaseCookieReady = () => {
    if (!isNeteaseCookieValid) {
      setNeteaseCloudStatus('璇峰厛鍦ㄨ缃噷淇濆瓨鍙敤鐨勭綉鏄撲簯 Cookie');
      setShowOptionsPanel(true);
      return false;
    }

    return true;
  };

  const fetchNeteaseSongs = async (url: string, emptyMessage: string) => {
    if (!ensureNeteaseCookieReady()) return;

    setIsLoadingNeteaseCloud(true);
    setNeteaseCloudStatus('姝ｅ湪鍔犺浇...');

    try {
      const response = await fetch(url, {
        headers: createNeteaseCookieHeaders(neteaseCookie),
      });
      const data = await response.json();

      if (!response.ok) {
        setIsNeteaseCookieValid(false);
        setNeteaseCloudStatus('网易云 Cookie 失效了，请重新保存');
        setShowOptionsPanel(true);
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
      setNeteaseCloudStatus('鍔犺浇澶辫触');
    } finally {
      setIsLoadingNeteaseCloud(false);
    }
  };

  const loadDailyRecommendations = async () => {
    setNeteaseCloudTab('daily');
    setActiveNeteasePlaylistId(null);
    await fetchNeteaseSongs('/api/netease/daily-recommend?limit=50', '姣忔棩鎺ㄨ崘閲屾殏鏃舵病鏈夊彲鎾斁姝屾洸');
  };

  const loadLikedSongs = async () => {
    setNeteaseCloudTab('liked');
    setActiveNeteasePlaylistId(null);
    await fetchNeteaseSongs('/api/netease/liked?limit=50', '鍠滄鍒楄〃閲屾殏鏃舵病鏈夊彲鎾斁姝屾洸');
  };

  const loadNeteasePlaylists = async () => {
    setNeteaseCloudTab('playlists');
    setNeteaseCloudSongs([]);
    setActiveNeteasePlaylistId(null);
    if (!ensureNeteaseCookieReady()) return;

    setIsLoadingNeteaseCloud(true);
    setNeteaseCloudStatus('姝ｅ湪鍔犺浇姝屽崟...');

    try {
      const response = await fetch('/api/netease/playlists', {
        headers: createNeteaseCookieHeaders(neteaseCookie),
      });
      const data = await response.json();

      if (!response.ok) {
        setIsNeteaseCookieValid(false);
        setNeteaseCloudStatus('网易云 Cookie 失效了，请重新保存');
        setShowOptionsPanel(true);
        return;
      }

      const cloudPlaylists = Array.isArray(data.playlists) ? data.playlists : [];
      setNeteaseCloudPlaylists(cloudPlaylists);
      setNeteaseCloudStatus(cloudPlaylists.length ? '请选择一个歌单' : '没有找到网易云歌单');
    } catch (error) {
      console.warn('Unable to load Netease playlists:', error);
      setNeteaseCloudStatus('姝屽崟鍔犺浇澶辫触');
    } finally {
      setIsLoadingNeteaseCloud(false);
    }
  };

  const loadNeteasePlaylistSongs = async (playlist: NeteasePlaylistSummary) => {
    setActiveNeteasePlaylistId(playlist.id);
    await fetchNeteaseSongs(`/api/netease/playlist?id=${playlist.id}&limit=50`, '杩欎釜姝屽崟閲屾殏鏃舵病鏈夊彲鎾斁姝屾洸');
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

    setIsSearching(true);
    setSearchStatus('Searching...');
    setSearchResults([]);

    try {
      const response = await fetch(`/api/netease/search?keywords=${encodeURIComponent(keywords)}&limit=30`, {
        headers: createNeteaseCookieHeaders(neteaseCookie),
      });
      if (!response.ok) throw new Error('Search request failed');

      const data = await response.json();
      setSearchResults(data.songs || []);
      setSearchStatus(data.songs?.length ? '' : 'No playable songs found');
    } catch (error) {
      console.warn('Netease search failed:', error);
      setSearchStatus('Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const loadNeteaseSong = async (song: NeteaseSong, queue?: NeteaseSong[]) => {
    if (queue) setPlayQueue(queue);
    setCurrentSongId(song.id);
    setTrackName(`${song.artist ? `${song.artist} - ` : ''}${song.name}`);
    setLyricsText('');
    setSearchStatus('Loading song...');

    try {
      const [urlResponse, lyricResponse] = await Promise.all([
        fetch(`/api/netease/url?id=${song.id}`, {
          headers: createNeteaseCookieHeaders(neteaseCookie),
        }),
        fetch(`/api/netease/lyric?id=${song.id}`, {
          headers: createNeteaseCookieHeaders(neteaseCookie),
        }),
      ]);

      const urlData = await urlResponse.json();
      const lyricData = await lyricResponse.json();
      const lyric = lyricData.lyric || lyricData.translatedLyric || '';
      setLyricsText(lyric);

      if (!urlData.url) {
        setSearchStatus('Song unavailable, skipping...');
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
      setSearchStatus('Load failed, skipping...');
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
    setSearchStatus(`Added to ${playlistName}`);
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
    setSearchStatus(`Added to ${name}`);
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

 
  const t = themes[theme] || themes['nocturnal'];
  const accentHex = `#${t.uRippleColor.getHexString()}`;

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
      
      {/* Sidebar Left */}
      <div className={`side-nav-trigger absolute left-0 top-0 h-full w-[20px] z-[60] group hover:w-[60px] transition-all pointer-events-auto ${isMobileSideNavOpen ? 'is-mobile-open' : ''}`}>
        <aside className={`side-nav-panel absolute left-0 top-0 w-[60px] h-full border-r border-white/5 flex flex-col items-center py-6 pointer-events-auto ${isMobileSideNavOpen ? 'translate-x-0' : '-translate-x-full'} group-hover:translate-x-0 transition-transform duration-300`} style={{ background: 'rgba(2,4,10,0.8)' }}>
          <button className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-100 transition-opacity cursor-pointer" style={{ writingMode: 'vertical-rl', color: accentHex }}>Visualizer</button>
          <button onClick={() => { setShowOptionsPanel(true); setIsMobileSideNavOpen(false); }} className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2" style={{ writingMode: 'vertical-rl' }}>
            璁剧疆
          </button>
          <button onClick={() => { setShowSearchPanel(true); setIsMobileSideNavOpen(false); }} className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2" style={{ writingMode: 'vertical-rl' }}>
            Search
          </button>
          {isNeteaseCookieValid && (
            <button
              onClick={() => {
                setShowNeteasePanel(true);
                loadDailyRecommendations();
                setIsMobileSideNavOpen(false);
              }}
              className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2"
              style={{ writingMode: 'vertical-rl' }}
            >
              缃戞槗浜?            </button>
          )}
          <button onClick={() => { setShowPlaylistPanel(true); setIsMobileSideNavOpen(false); }} className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2" style={{ writingMode: 'vertical-rl' }}>
            Playlist
          </button>
          
          <div className="side-nav-bottom mt-auto flex flex-col items-center gap-10">
            <button 
              onClick={() => { loadDemo(); setIsMobileSideNavOpen(false); }}
              className="uppercase tracking-[0.2em] text-[10px] opacity-40 hover:opacity-100 transition-opacity cursor-pointer font-bold"
              style={{ writingMode: 'vertical-rl' }}
            >
              Demo
            </button>
            <button 
              onClick={() => { fileInputRef.current?.click(); setIsMobileSideNavOpen(false); }}
              className="uppercase tracking-[0.2em] text-[10px] opacity-40 hover:opacity-100 transition-opacity cursor-pointer"
              style={{ writingMode: 'vertical-rl' }}
            >
              Upload
            </button>
            <button 
              onClick={() => {
                if (engine.isCapturing) {
                  engine.stopCapture();
                  setTrackName('No track selected');
                } else {
                  engine.startCapture().then(() => {
                      if (engine.isCapturing) setTrackName('System Audio Capture');
                  });
                }
                setIsMobileSideNavOpen(false);
              }}
              className={`uppercase tracking-[0.2em] text-[10px] transition-opacity cursor-pointer ${isCapturing ? 'opacity-100 text-[#ef4444]' : 'opacity-40 hover:opacity-100'}`}
              style={{ writingMode: 'vertical-rl' }}
            >
              {isCapturing ? 'Stop' : 'Capture'}
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
        className="mobile-side-nav-toggle pointer-events-auto"
        aria-label={isMobileSideNavOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isMobileSideNavOpen}
        onClick={() => setIsMobileSideNavOpen((open) => !open)}
        style={{ color: isMobileSideNavOpen ? accentHex : undefined }}
      >
        {isMobileSideNavOpen ? <X size={16} /> : <Menu size={16} />}
      </button>
      <div className="absolute top-[40px] left-[100px] font-black text-[24px] tracking-[-1px] text-white z-50 select-none">
        AJIN.
      </div>

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
                <div className="mt-1 text-[11px] text-white/45 truncate">{song.artist || 'Unknown artist'} 路 {song.album || 'Unknown album'}</div>
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
              <button onClick={() => setShowNeteasePanel(false)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">鍏抽棴</button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={loadLikedSongs}
                className={`px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.12em] transition-colors ${neteaseCloudTab === 'liked' ? 'text-black border-transparent' : 'text-white/45 border-white/10 hover:text-white'}`}
                style={{ backgroundColor: neteaseCloudTab === 'liked' ? accentHex : 'transparent' }}
              >
                鍠滄
              </button>
              <button
                onClick={loadNeteasePlaylists}
                className={`px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.12em] transition-colors ${neteaseCloudTab === 'playlists' ? 'text-black border-transparent' : 'text-white/45 border-white/10 hover:text-white'}`}
                style={{ backgroundColor: neteaseCloudTab === 'playlists' ? accentHex : 'transparent' }}
              >
                姝屽崟
              </button>
              <button
                onClick={loadDailyRecommendations}
                className={`px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.12em] transition-colors ${neteaseCloudTab === 'daily' ? 'text-black border-transparent' : 'text-white/45 border-white/10 hover:text-white'}`}
                style={{ backgroundColor: neteaseCloudTab === 'daily' ? accentHex : 'transparent' }}
              >
                姣忔棩鎺ㄨ崘
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
                <div className="px-3 py-4 text-[12px] text-white/40">{isLoadingNeteaseCloud ? '姝ｅ湪鍔犺浇姝屽崟...' : '鐐瑰嚮鈥滄瓕鍗曗€濆姞杞戒綘鐨勭綉鏄撲簯姝屽崟'}</div>
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
            emptyText={isLoadingNeteaseCloud ? '姝ｅ湪鍔犺浇...' : '杩欓噷浼氭樉绀哄彲鎾斁姝屾洸'}
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
      {trackName !== 'No track selected' && (
        <div className="player-panel absolute top-[40px] right-[40px] w-[300px] p-6 rounded-sm z-50 pointer-events-auto backdrop-blur-[20px] border border-white/10" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="player-panel-header flex justify-between items-start mb-1">
            <div className="player-panel-title text-[18px] font-light tracking-[0.05em] text-white truncate" title={trackName}>
              {trackName}
            </div>
            <button 
              onClick={() => {
                const keys = Object.keys(themes);
                const nextIndex = (keys.indexOf(theme) + 1) % keys.length;
                onThemeChange(keys[nextIndex]);
              }}
              className="player-panel-theme text-white/40 hover:text-white transition-colors"
              title="Change Theme"
            >
              <Palette size={16} />
            </button>
          </div>
          <div className="player-panel-meta text-[12px] opacity-50 uppercase mb-6 tracking-wider">
             {isCapturing ? 'System Audio Capture' : 'Local Audio'}
             <span className="ml-2 text-[#3b82f6] text-[10px]">&bull; {themes[theme]?.name}</span>
          </div>

          {/* Progress bar */}
          <div className={`player-panel-progress h-[20px] mb-5 relative flex items-end group ${isCapturing ? 'opacity-30 pointer-events-none' : ''}`}>
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
             <div className="player-panel-actions flex items-center gap-4">
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
      {trackName !== 'No track selected' && lyricsText && (
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
                No Lyrics 鈥?Click to upload .lrc
             </div>
          )}
          <div className="mobile-hide-aux-ui">
            <StatsPanel accentHex={accentHex} />
          </div>
        </div>
      )}

      <div className="mobile-hide-aux-ui absolute bottom-[40px] right-[40px] text-[10px] uppercase tracking-[0.1em] opacity-30 select-none">
        Drag to orbit 鈥?Click to pulse
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
            title="鍔犲叆鍠滄"
          >
            <Plus size={15} />
          </span>
          <div className="mt-1 text-[11px] text-white/45 truncate">{song.artist || '鏈煡姝屾墜'} - {song.album || '鏈煡涓撹緫'}</div>
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
}: {
  onClose: () => void;
  accentHex: string;
  neteaseCookie: string;
  setNeteaseCookie: (cookie: string) => void;
  onSaveCookie: () => void;
  onClearCookie: () => void;
  cookieStatus: string;
  isNeteaseCookieValid: boolean;
}) {
  const [activeTab, setActiveTab] = useState<OptionsTab>('Meteor');
  const tabs: OptionsTab[] = ['Pulse', 'Meteor', 'Cookie'];
  const tabLabels: Record<OptionsTab, string> = {
    Pulse: '鑴夊啿鐗规晥',
    Meteor: '娴佹槦鐗规晥',
    Cookie: '缃戞槗浜?Cookie',
  };

  return (
    <div className="absolute inset-0 z-[100] backdrop-blur-md bg-black/50 flex flex-col items-center justify-center pointer-events-auto">
       <div className="w-[80vw] max-w-[840px] max-h-[86vh] overflow-y-auto border border-white/10 rounded-sm p-8 transform transition-all shadow-2xl" style={{ background: 'rgba(5, 10, 15, 0.95)' }}>
          <div className="flex justify-between items-center mb-6">
             <div>
               <div className="text-xl font-light tracking-widest text-white">璁剧疆</div>
               <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-white/35">瑙嗚瑙﹀彂鍣ㄤ笌缃戞槗浜戠櫥褰?Cookie</div>
             </div>
             <button onClick={onClose} className="text-white/50 hover:text-white uppercase tracking-widest text-[10px]">鍏抽棴</button>
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

          {activeTab === 'Cookie' ? (
            <NeteaseCookiePanel
              accentHex={accentHex}
              neteaseCookie={neteaseCookie}
              setNeteaseCookie={setNeteaseCookie}
              onSaveCookie={onSaveCookie}
              onClearCookie={onClearCookie}
              cookieStatus={cookieStatus}
              isNeteaseCookieValid={isNeteaseCookieValid}
            />
          ) : (
            <FreqTriggerPanel key={activeTab} action={activeTab} accentHex={accentHex} />
          )}
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
}: {
  accentHex: string;
  neteaseCookie: string;
  setNeteaseCookie: (cookie: string) => void;
  onSaveCookie: () => void;
  onClearCookie: () => void;
  cookieStatus: string;
  isNeteaseCookieValid: boolean;
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
          {cookieStatus || (neteaseCookie.trim() ? (isNeteaseCookieValid ? 'Cookie 可用，网易云入口已开启' : '已从浏览器读取 Cookie，请点击保存进行校验') : '当前没有保存 Cookie')}
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
    'Auto Beat': '鑷姩鑺傛媿',
    Advanced: '楂樼骇妯″紡',
  };
  const actionLabel = action === 'Pulse' ? '鑴夊啿鐗规晥' : '娴佹槦鐗规晥';

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
               <span className="text-[10px] uppercase tracking-widest text-white/50">鍚敤</span>
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
                    <span>鍐峰嵈甯ф暟</span>
                    <span style={{ color: accentHex }}>{cooldown}</span>
                 </div>
                 <input type="range" min="0" max="300" step="1" value={cooldown} onChange={e => setCooldown(parseInt(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>瑙﹀彂棰戞 ({bandStart} - {bandEnd})</span>
                 </div>
                 <div className="flex gap-2">
                   <input type="range" min="0" max="250" step="1" value={bandStart} onChange={e => setBandStart(Math.min(parseInt(e.target.value), bandEnd - 1))} className="w-1/2 accent-current h-1" style={{ accentColor: accentHex }}/>
                   <input type="range" min="2" max="256" step="1" value={bandEnd} onChange={e => setBandEnd(Math.max(parseInt(e.target.value), bandStart + 1))} className="w-1/2 accent-current h-1" style={{ accentColor: accentHex }}/>
                 </div>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>鐗规晥寮哄害</span>
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




