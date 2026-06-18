import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Upload, Volume2, SkipForward, SkipBack, Palette } from 'lucide-react';
import { engine } from '../../lib/AudioEngine';
import { themes } from '../../lib/themes';
import { LyricsDisplay } from './LyricsDisplay';
import { extractAudioMetadata, extractLyricsFromAudio } from '../../lib/metadata';

interface UIProps {
  theme: string;
  onThemeChange: (theme: string) => void;
}

export function UI({ theme, onThemeChange }: UIProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const demoAudioUrl = '/demo.mp3';
  const demoLyricsUrl = '/demo.lrc';
  const [isPlaying, setIsPlaying] = useState(false);
  const [trackName, setTrackName] = useState<string>('No track selected');
  const [lyricsText, setLyricsText] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showFreqPanel, setShowFreqPanel] = useState(false);
  
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
      <div className="absolute left-0 top-0 h-full w-[20px] z-[60] group hover:w-[60px] transition-all pointer-events-auto">
        <aside className="absolute left-0 top-0 w-[60px] h-full border-r border-white/5 flex flex-col items-center py-6 pointer-events-auto -translate-x-full group-hover:translate-x-0 transition-transform duration-300" style={{ background: 'rgba(2,4,10,0.8)' }}>
          <button className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-100 transition-opacity cursor-pointer" style={{ writingMode: 'vertical-rl', color: accentHex }}>Visualizer</button>
          <button onClick={() => setShowFreqPanel(true)} className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-40 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center gap-2" style={{ writingMode: 'vertical-rl' }}>
            Trigger
          </button>
          
          <div className="mt-auto flex flex-col items-center gap-10">
            <button 
              onClick={loadDemo}
              className="uppercase tracking-[0.2em] text-[10px] opacity-40 hover:opacity-100 transition-opacity cursor-pointer font-bold"
              style={{ writingMode: 'vertical-rl' }}
            >
              Demo
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
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
      <div className="absolute top-[40px] left-[100px] font-black text-[24px] tracking-[-1px] text-white z-50 select-none">
        AJIN.
      </div>

      {/* Player Panel */}
      {trackName !== 'No track selected' && (
        <div className="absolute top-[40px] right-[40px] w-[300px] p-6 rounded-sm z-50 pointer-events-auto backdrop-blur-[20px] border border-white/10" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="flex justify-between items-start mb-1">
            <div className="text-[18px] font-light tracking-[0.05em] text-white truncate" title={trackName}>
              {trackName}
            </div>
            <button 
              onClick={() => {
                const keys = Object.keys(themes);
                const nextIndex = (keys.indexOf(theme) + 1) % keys.length;
                onThemeChange(keys[nextIndex]);
              }}
              className="text-white/40 hover:text-white transition-colors"
              title="Change Theme"
            >
              <Palette size={16} />
            </button>
          </div>
          <div className="text-[12px] opacity-50 uppercase mb-6 tracking-wider">
             {isCapturing ? 'System Audio Capture' : 'Local Audio'}
             <span className="ml-2 text-[#3b82f6] text-[10px]">&bull; {themes[theme]?.name}</span>
          </div>

          {/* Progress bar */}
          <div className={`h-[20px] mb-5 relative flex items-end group ${isCapturing ? 'opacity-30 pointer-events-none' : ''}`}>
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

          <div className={`flex justify-between items-center text-[10px] uppercase tracking-[0.1em] opacity-80 ${isCapturing ? 'opacity-30 pointer-events-none' : ''}`}>
             <span className="w-8">{formatTime(currentTime)}</span>
             <div className="flex items-center gap-4">
                <button className="hover:text-white transition-colors"><SkipBack size={14} /></button>
                <button onClick={togglePlay} className="hover:text-white transition-colors">
                  {isPlaying ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
                </button>
                <button className="hover:text-white transition-colors"><SkipForward size={14} /></button>
             </div>
             
             <div className="flex items-center gap-2 group w-20 justify-end">
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
             <span className="w-8 text-right">{formatTime(duration)}</span>
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
                No Lyrics • Click to upload .lrc
             </div>
          )}
          <StatsPanel accentHex={accentHex} />
        </div>
      )}

      <div className="absolute bottom-[40px] right-[40px] text-[10px] uppercase tracking-[0.1em] opacity-30 select-none">
        Drag to orbit • Click to pulse
      </div>
      {/* Frequency Trigger Panel */}
      {showFreqPanel && (
        <FreqTriggerPanelWrapper onClose={() => setShowFreqPanel(false)} accentHex={accentHex} />
      )}
    </div>
  );
}

import { TriggerPreset } from '../../lib/AudioEngine';

function FreqTriggerPanelWrapper({ onClose, accentHex }: { onClose: () => void, accentHex: string }) {
  const [action, setAction] = useState<'Pulse' | 'Meteor'>('Meteor');
  return (
    <FreqTriggerPanel key={action} action={action} setAction={setAction} onClose={onClose} accentHex={accentHex} />
  );
}

function FreqTriggerPanel({ action, setAction, onClose, accentHex }: { action: 'Pulse' | 'Meteor', setAction: (a: 'Pulse' | 'Meteor') => void, onClose: () => void, accentHex: string }) {
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
  }, [isEnabled, mode, sensitivity, cooldown, pulseStrength, bandStart, bandEnd, triggerPoint]);

  const handleModeChange = (newMode: TriggerPreset) => {
    setMode(newMode);
  };

  const presets: TriggerPreset[] = ['Auto Beat', 'Advanced'];

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
    <div className="absolute inset-0 z-[100] backdrop-blur-md bg-black/50 flex flex-col items-center justify-center pointer-events-auto">
       <div className="w-[80vw] max-w-[800px] border border-white/10 rounded-xl p-8 transform transition-all shadow-2xl" style={{ background: 'rgba(5, 10, 15, 0.95)' }}>
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center gap-6">
               <h2 className="text-xl font-light tracking-widest text-white">FREQUENCY TRIGGER</h2>
               <div className="flex items-center gap-4">
                 <label className="flex items-center gap-2 cursor-pointer">
                   <input 
                     type="checkbox" 
                     checked={isEnabled} 
                     onChange={(e) => setIsEnabled(e.target.checked)}
                     className="w-4 h-4 rounded-sm border-white/20 bg-black/50"
                     style={{ accentColor: accentHex }}
                   />
                   <span className="text-[10px] uppercase tracking-widest text-white/50">Enable</span>
                 </label>
                 
                 {isEnabled && (
                   <div className="flex items-center rounded overflow-hidden border border-white/10 text-[10px] uppercase tracking-widest">
                     <button 
                       onClick={() => setAction('Pulse')}
                       className={`px-3 py-1 transition-colors ${action === 'Pulse' ? 'text-black' : 'text-white/50 hover:bg-white/5'}`}
                       style={{ backgroundColor: action === 'Pulse' ? accentHex : 'transparent' }}
                     >
                       Pulse
                     </button>
                     <button 
                       onClick={() => setAction('Meteor')}
                       className={`px-3 py-1 transition-colors ${action === 'Meteor' ? 'text-black' : 'text-white/50 hover:bg-white/5'}`}
                       style={{ backgroundColor: action === 'Meteor' ? accentHex : 'transparent' }}
                     >
                       Meteor
                     </button>
                   </div>
                 )}
               </div>
             </div>
             <button onClick={onClose} className="text-white/50 hover:text-white uppercase tracking-widest text-[10px]">Close</button>
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
                  {p}
               </button>
            ))}
          </div>

          <p className="text-[11px] text-white/40 mb-6 font-mono h-10 leading-relaxed">
            {mode === 'Advanced' 
              ? "Drag the crosshair to set the target frequency (X) and threshold (Y).\nWhen the spectrum exceeds this threshold, a visual pulse is triggered."
              : `Dynamic ${mode} detection enabled. Pulses trigger when instantaneous energy significantly exceeds the rolling average of this specific frequency band.`}
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
                    <span>Sensitivity</span>
                    <span style={{ color: accentHex }}>{sensitivity.toFixed(2)}</span>
                 </div>
                 <input type="range" min="0" max="1" step="0.05" value={sensitivity} onChange={e => setSensitivity(parseFloat(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>Cooldown (frames)</span>
                    <span style={{ color: accentHex }}>{cooldown}</span>
                 </div>
                 <input type="range" min="0" max="300" step="1" value={cooldown} onChange={e => setCooldown(parseInt(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>Freq Band ({bandStart} - {bandEnd})</span>
                 </div>
                 <div className="flex gap-2">
                   <input type="range" min="0" max="250" step="1" value={bandStart} onChange={e => setBandStart(Math.min(parseInt(e.target.value), bandEnd - 1))} className="w-1/2 accent-current h-1" style={{ accentColor: accentHex }}/>
                   <input type="range" min="2" max="256" step="1" value={bandEnd} onChange={e => setBandEnd(Math.max(parseInt(e.target.value), bandStart + 1))} className="w-1/2 accent-current h-1" style={{ accentColor: accentHex }}/>
                 </div>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>Pulse Strength</span>
                    <span style={{ color: accentHex }}>{pulseStrength.toFixed(2)}</span>
                 </div>
                 <input type="range" min="0" max="5" step="0.1" value={pulseStrength} onChange={e => setPulseStrength(parseFloat(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
            </div>
          )}
       </div>
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
