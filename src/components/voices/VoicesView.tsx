import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  Star,
  CheckCircle2,
  Sparkles,
  Info,
  Radio,
  RefreshCw,
  Send,
  Sliders,
  Flame,
} from 'lucide-react';
import type { VoiceProfile, VoiceId } from '../../types/pipeline.ts';

interface VoicesViewProps {
  onDefaultVoiceChanged?: (newDefaultVoiceId: VoiceId) => void;
}

export const VoicesView: React.FC<VoicesViewProps> = ({ onDefaultVoiceChanged }) => {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [defaultVoiceId, setDefaultVoiceId] = useState<VoiceId>('zephyr');
  const [loading, setLoading] = useState(true);
  const [savingDefault, setSavingDefault] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Audio preview states
  const [playingVoiceId, setPlayingVoiceId] = useState<VoiceId | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [customTestingText, setCustomTestingText] = useState<{ [key in VoiceId]?: string }>({});
  const [isSynthesizing, setIsSynthesizing] = useState<VoiceId | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synthTimerRef = useRef<number | null>(null);

  useEffect(() => {
    fetchVoices();
    return () => {
      stopAudio();
    };
  }, []);

  const fetchVoices = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/voices');
      if (res.ok) {
        const data = await res.json();
        setVoices(data.voices || []);
        if (data.defaultVoiceId) {
          setDefaultVoiceId(data.defaultVoiceId);
        }
      }
    } catch (err) {
      console.error('Failed to fetch voices:', err);
    } finally {
      setLoading(false);
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (synthTimerRef.current) {
      window.clearInterval(synthTimerRef.current);
      synthTimerRef.current = null;
    }
    setPlayingVoiceId(null);
    setPlaybackTime(0);
  };

  const handleTogglePlay = async (voice: VoiceProfile, customText?: string) => {
    // If currently playing this voice, stop it
    if (playingVoiceId === voice.id) {
      stopAudio();
      return;
    }

    stopAudio();
    setIsSynthesizing(voice.id);

    try {
      const textToSpeak = customText?.trim() || voice.sampleText;
      const sampleUrl = `/api/voices/${voice.id}/sample?text=${encodeURIComponent(textToSpeak)}`;

      const audio = new Audio(sampleUrl);
      audioRef.current = audio;

      audio.oncanplay = () => {
        setIsSynthesizing(null);
        setPlayingVoiceId(voice.id);
        audio.play().catch((err) => {
          console.warn('Playback error or blocked by autoplay:', err);
          // Fallback to browser Web Speech API for immediate audio preview if server audio blocked
          fallbackWebSpeech(textToSpeak, voice);
        });
      };

      audio.ontimeupdate = () => {
        setPlaybackTime(Math.round(audio.currentTime * 10) / 10);
      };

      audio.onended = () => {
        stopAudio();
      };

      audio.onerror = () => {
        console.warn('Server audio sample error, falling back to Web Speech API preview');
        fallbackWebSpeech(textToSpeak, voice);
      };
    } catch (err) {
      console.warn('Audio synthesis failed, using speech synthesis fallback:', err);
      fallbackWebSpeech(customText || voice.sampleText, voice);
    }
  };

  const fallbackWebSpeech = (text: string, voice: VoiceProfile) => {
    setIsSynthesizing(null);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = voice.id === 'puck' ? 1.15 : voice.id === 'zephyr' ? 0.92 : 1.0;
      utterance.pitch = voice.id === 'fenrir' ? 0.75 : voice.id === 'kore' ? 1.05 : 0.95;

      utterance.onstart = () => {
        setPlayingVoiceId(voice.id);
      };
      utterance.onend = () => {
        stopAudio();
      };
      window.speechSynthesis.speak(utterance);
    } else {
      stopAudio();
    }
  };

  const handleSetDefaultVoice = async (voiceId: VoiceId) => {
    setSavingDefault(true);
    try {
      const res = await fetch('/api/voices/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId }),
      });

      if (res.ok) {
        setDefaultVoiceId(voiceId);
        onDefaultVoiceChanged?.(voiceId);
        const voiceName = voices.find((v) => v.id === voiceId)?.name || voiceId;
        setSuccessMessage(`"${voiceName}" is now saved as the default voice for all generations!`);
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    } catch (err) {
      console.error('Failed to set default voice:', err);
    } finally {
      setSavingDefault(false);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Cute Brutalist Banner Header */}
      <div className="bg-[#12111c] border-2 border-[#ff2a85] rounded-xl p-6 shadow-brutal-pink relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#ff2a85]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff2a85]/20 border border-[#ff2a85] text-[#ff2a85] text-xs font-mono font-bold tracking-wider uppercase mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              Persistent Voice Profiles
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white flex items-center gap-3">
              Narration Voice Engine
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#ff2a85] text-black font-bold">
                4 PROFILES
              </span>
            </h1>
            <p className="text-sm text-pink-200/70 mt-1 max-w-2xl">
              Select and preview the official voice profiles powered by{' '}
              <span className="text-white font-semibold underline decoration-[#ff2a85]">
                Gemini 3.8 Flash Lite TTS
              </span>
              . The chosen default voice will be persistently applied to all short-form videos.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-[#181625] border-2 border-black p-3 rounded-lg shadow-brutal-black">
            <Radio className="w-5 h-5 text-[#ff2a85] animate-pulse" />
            <div>
              <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                Current Default
              </div>
              <div className="text-base font-bold text-white uppercase tracking-wide">
                {voices.find((v) => v.id === defaultVoiceId)?.name || defaultVoiceId}
              </div>
            </div>
          </div>
        </div>

        {/* Success Alert Banner */}
        {successMessage && (
          <div className="mt-4 p-3 bg-[#ff2a85]/15 border-2 border-[#ff2a85] rounded-lg text-sm text-pink-100 flex items-center gap-2 font-mono animate-in fade-in slide-in-from-top-2 duration-300">
            <CheckCircle2 className="w-4 h-4 text-[#ff2a85] shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}
      </div>

      {/* Voice Profiles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {voices.map((voice) => {
          const isDefault = defaultVoiceId === voice.id;
          const isPlaying = playingVoiceId === voice.id;
          const isSynthesizingThis = isSynthesizing === voice.id;
          const customText = customTestingText[voice.id] || '';

          return (
            <div
              key={voice.id}
              className={`relative rounded-xl border-2 transition-all duration-200 bg-[#12111b] overflow-hidden flex flex-col justify-between ${
                isDefault
                  ? 'border-[#ff2a85] shadow-brutal-pink'
                  : 'border-zinc-800 hover:border-pink-500/50 hover:shadow-brutal-pink-sm'
              }`}
            >
              {/* Top Accent Strip */}
              <div
                className="h-2 w-full"
                style={{
                  backgroundColor: isDefault ? '#ff2a85' : voice.accentColor || '#38bdf8',
                }}
              />

              <div className="p-6 space-y-4">
                {/* Header Row: Name, Default Badge, Tone */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-2xl font-black tracking-tight text-white">
                        {voice.name}
                      </h3>
                      {isDefault && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#ff2a85] text-black text-xs font-bold font-mono">
                          <Star className="w-3 h-3 fill-black" />
                          DEFAULT
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-[#ff2a85] font-semibold mt-1">
                      {voice.tone}
                    </div>
                  </div>

                  {/* Provider Pill */}
                  <div className="text-right">
                    <span className="inline-block px-2 py-1 rounded bg-[#1c1a29] border border-zinc-700/80 text-[11px] font-mono text-zinc-300">
                      {voice.voiceIdentifier} • {voice.language}
                    </span>
                  </div>
                </div>

                {/* Personality Description */}
                <p className="text-xs text-zinc-300 leading-relaxed font-sans">
                  {voice.personality}
                </p>

                {/* Provider Configuration Specs Table */}
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-[#0c0c13] border border-zinc-800 text-[11px] font-mono">
                  <div>
                    <span className="text-zinc-500">Provider:</span>{' '}
                    <span className="text-pink-300 font-semibold">{voice.provider}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Model:</span>{' '}
                    <span className="text-zinc-300">gemini-3.8-flash-lite-tts</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Output:</span>{' '}
                    <span className="text-zinc-300">24kHz 16-bit WAV</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Format:</span>{' '}
                    <span className="text-zinc-300">Mono RIFF PCM</span>
                  </div>
                </div>

                {/* Sample Text Audio Player Card */}
                <div className="p-3.5 rounded-lg bg-[#181624] border-2 border-black space-y-3">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span className="font-mono flex items-center gap-1.5 text-zinc-300">
                      <Volume2 className="w-3.5 h-3.5 text-[#ff2a85]" />
                      Sample Script Track:
                    </span>
                    {isPlaying && (
                      <span className="font-mono text-[#ff2a85] font-bold text-xs">
                        {playbackTime.toFixed(1)}s
                      </span>
                    )}
                  </div>

                  <blockquote className="text-xs text-pink-100/90 italic border-l-2 border-[#ff2a85] pl-3 py-0.5">
                    "{voice.sampleText}"
                  </blockquote>

                  {/* Audio Visualizer & Play Controls */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      aria-label={isPlaying ? `Pause sample for ${voice.name}` : `Preview voice sample for ${voice.name}`}
                      onClick={() => handleTogglePlay(voice, customText)}
                      disabled={isSynthesizingThis}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-150 border-2 border-black ${
                        isPlaying
                          ? 'bg-amber-400 text-black shadow-brutal-black'
                          : 'bg-[#ff2a85] text-black hover:bg-[#ff4797] shadow-brutal-black active:translate-x-[1px] active:translate-y-[1px]'
                      }`}
                    >
                      {isSynthesizingThis ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Synthesizing...
                        </>
                      ) : isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-black" />
                          Pause Clip
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-black" />
                          Preview Voice
                        </>
                      )}
                    </button>

                    {/* Equalizer animation when playing */}
                    {isPlaying ? (
                      <div className="flex items-end gap-1 h-6 px-2">
                        <div className="w-1 bg-[#ff2a85] rounded-full animate-wave-1" />
                        <div className="w-1 bg-[#ff69b4] rounded-full animate-wave-2" />
                        <div className="w-1 bg-yellow-400 rounded-full animate-wave-3" />
                        <div className="w-1 bg-[#ff2a85] rounded-full animate-wave-4" />
                        <div className="w-1 bg-sky-400 rounded-full animate-wave-5" />
                      </div>
                    ) : (
                      <span className="text-[11px] font-mono text-zinc-500">
                        Ready to preview
                      </span>
                    )}
                  </div>
                </div>

                {/* Interactive Speech Playground for this Voice */}
                <div className="pt-1">
                  <label
                    htmlFor={`test-input-${voice.id}`}
                    className="block text-[11px] font-mono text-zinc-400 mb-1"
                  >
                    Custom Line Tester:
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={`test-input-${voice.id}`}
                      type="text"
                      placeholder="Type custom words to preview cadence..."
                      value={customText}
                      onChange={(e) =>
                        setCustomTestingText({
                          ...customTestingText,
                          [voice.id]: e.target.value,
                        })
                      }
                      className="flex-1 bg-[#0a0a0f] border border-zinc-700/80 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#ff2a85] font-sans"
                    />
                    <button
                      type="button"
                      aria-label={`Test custom speech for ${voice.name}`}
                      onClick={() => handleTogglePlay(voice, customText)}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-[#ff2a85] text-zinc-200 hover:text-black text-xs font-mono transition-colors"
                      title="Speak custom line"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Bottom Card Footer: Set Default Action */}
              <div className="p-4 bg-[#0d0c14] border-t-2 border-black flex items-center justify-between gap-3">
                <div className="text-[11px] font-mono text-zinc-400">
                  {isDefault ? (
                    <span className="text-[#ff2a85] font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Active in Generation Pipeline
                    </span>
                  ) : (
                    <span>Available for selection</span>
                  )}
                </div>

                <button
                  type="button"
                  aria-label={isDefault ? `${voice.name} is default voice` : `Set ${voice.name} as default voice`}
                  disabled={isDefault || savingDefault}
                  onClick={() => handleSetDefaultVoice(voice.id)}
                  className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-150 border-2 border-black flex items-center gap-1.5 ${
                    isDefault
                      ? 'bg-zinc-800 text-zinc-400 cursor-default'
                      : 'bg-white text-black hover:bg-[#ff2a85] hover:text-black shadow-brutal-black active:translate-x-[1px] active:translate-y-[1px]'
                  }`}
                >
                  <Star
                    className={`w-3.5 h-3.5 ${
                      isDefault ? 'fill-[#ff2a85] text-[#ff2a85]' : 'fill-none'
                    }`}
                  />
                  {isDefault ? 'Current Default' : 'Set as Default'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Voice Architecture & Forced Alignment Explainer */}
      <div className="bg-[#100f1a] border-2 border-zinc-800 rounded-xl p-5 text-xs text-zinc-300 space-y-3 font-mono">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Info className="w-4 h-4 text-[#ff2a85]" />
          VOICE SYNTHESIS & KARAOKE ALIGNMENT SPECIFICATION
        </div>
        <p className="leading-relaxed text-zinc-400 font-sans">
          Each short-form video generated by Aurora.ai strictly enforces a single persistent voice throughout all scenes. 
          When a generation pipeline starts, narration text is synthesized via the selected voice adapter. The audio waveform duration 
          is measured, and millisecond word-level timing offsets are derived to synchronize the live karaoke highlight subtitles directly 
          onto the rendered MP4 file.
        </p>
        <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1 text-pink-300">
            <span className="w-2 h-2 rounded-full bg-[#ff2a85]" /> Stable Voice Identifiers
          </span>
          <span className="flex items-center gap-1 text-pink-300">
            <span className="w-2 h-2 rounded-full bg-sky-400" /> Monotonic Timestamp Verification
          </span>
          <span className="flex items-center gap-1 text-pink-300">
            <span className="w-2 h-2 rounded-full bg-yellow-400" /> Safe From Voice Drift
          </span>
        </div>
      </div>
    </div>
  );
};
