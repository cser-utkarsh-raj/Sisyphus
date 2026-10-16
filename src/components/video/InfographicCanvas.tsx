import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  ShieldAlert,
  Download,
  Camera,
  Music,
  Maximize2,
  FastForward,
  Rewind,
  Sparkles,
} from 'lucide-react';
import type { Job, SubtitleLine } from '../../types/pipeline.ts';

interface InfographicCanvasProps {
  job?: Job;
  showSafeMarginGuides?: boolean;
}

const DURATION = 38.0;
const FPS = 30;
const TOTAL_FRAMES = Math.round(DURATION * FPS); // 1140 frames
const W = 1080;
const H = 1920;

// Deterministic Math & Seeded Random Functions
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutCubic(x: number): number {
  const t = clamp(x, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(x: number): number {
  const t = clamp(x, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Pre-computed Deterministic Background Stars (220 stars)
const STARS = Array.from({ length: 220 }, (_, i) => ({
  x: seededRandom(i * 3.1 + 1) * W,
  y: seededRandom(i * 7.3 + 2) * (H * 0.85),
  r: 1.0 + seededRandom(i * 11.7 + 3) * 2.6,
  twinkleSpeed: 1.2 + seededRandom(i * 5.9 + 4) * 3.0,
  phase: seededRandom(i * 17.1 + 5) * Math.PI * 2,
  hue: seededRandom(i * 19.3) > 0.75 ? '#FBBF24' : seededRandom(i * 23.1) > 0.4 ? '#38BDF8' : '#FFFFFF',
}));

// Scene 1 Memory Orbs (44 orbs)
const S1_ORBS = Array.from({ length: 44 }, (_, i) => {
  const ring = i < 12 ? 0 : i < 28 ? 1 : 2;
  const radiusBase = ring === 0 ? 190 : ring === 1 ? 315 : 440;
  const angle = i * 2.39996 + seededRandom(i * 13) * 0.35;
  const dist = radiusBase + (seededRandom(i * 29) - 0.5) * 55;
  const fadeStart = i === 0 ? 5.45 : 1.4 + seededRandom(i * 41 + 9) * 3.5;
  return {
    id: i,
    angle,
    dist,
    size: i === 0 ? 14 : 6 + seededRandom(i * 31) * 7,
    color: i === 0 ? '#FBBF24' : i % 3 === 0 ? '#FF2A85' : i % 2 === 0 ? '#38BDF8' : '#FBBF24',
    fadeStart,
    fadeDuration: 0.65,
    orbitSpeed: (seededRandom(i * 53) - 0.5) * 0.14,
  };
});

// Scene 3 Network Constellation Nodes (110 nodes)
const S3_NODES = Array.from({ length: 110 }, (_, i) => {
  if (i === 0) {
    return { id: 0, x: 0, y: 0, r: 16, vanishTime: 22.8, tier: 0, color: '#FBBF24' };
  }
  const tier = i < 14 ? 1 : i < 45 ? 2 : 3;
  const maxRad = tier === 1 ? 150 : tier === 2 ? 295 : 440;
  const minRad = tier === 1 ? 65 : tier === 2 ? 155 : 295;
  const angle = i * 2.399963 + seededRandom(i * 71) * 0.2;
  const rad = minRad + seededRandom(i * 83) * (maxRad - minRad);
  const baseVanish =
    tier === 3
      ? 15.6 + seededRandom(i * 97) * 2.1
      : tier === 2
      ? 17.7 + seededRandom(i * 101) * 2.0
      : 19.7 + seededRandom(i * 107) * 1.9;
  return {
    id: i,
    x: Math.cos(angle) * rad,
    y: Math.sin(angle) * rad,
    r: tier === 1 ? 9.5 : tier === 2 ? 7 : 5,
    vanishTime: baseVanish,
    tier,
    color: tier === 1 ? '#FBBF24' : tier === 2 ? '#38BDF8' : '#FF2A85',
  };
});

const S3_EDGES: { a: number; b: number }[] = [];
for (let i = 1; i < S3_NODES.length; i++) {
  const n1 = S3_NODES[i];
  let bestTarget = 0;
  let bestDist = Infinity;
  for (let j = 0; j < i; j++) {
    const n2 = S3_NODES[j];
    const d = Math.hypot(n1.x - n2.x, n1.y - n2.y);
    if (d < bestDist && n2.tier <= n1.tier) {
      bestDist = d;
      bestTarget = j;
    }
  }
  S3_EDGES.push({ a: i, b: bestTarget });
  if (i > 3 && seededRandom(i * 113) > 0.35) {
    const alt = Math.max(0, i - 2 - Math.floor(seededRandom(i * 127) * 5));
    if (alt !== bestTarget) S3_EDGES.push({ a: i, b: alt });
  }
}

export const InfographicCanvas: React.FC<InfographicCanvasProps> = ({
  job,
  showSafeMarginGuides = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Audio Context refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const padGainRef = useRef<GainNode | null>(null);
  const padOscsRef = useRef<OscillatorNode[]>([]);

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0.0);
  const [isMuted, setIsMuted] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [safeMargins, setSafeMargins] = useState(showSafeMarginGuides);
  const [activeSceneName, setActiveSceneName] = useState('THE LAST MEMORY');
  const [activeSceneNum, setActiveSceneNum] = useState(1);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const lastRafTimeRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  currentTimeRef.current = currentTime;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Web Audio Synth Initialization
  const ensureAudioRunning = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    if (!padGainRef.current) {
      const padGain = ctx.createGain();
      padGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      padGain.connect(ctx.destination);
      padGainRef.current = padGain;

      const freqs = [146.83, 220.0, 293.66, 329.63];
      padOscsRef.current = freqs.map((f, i) => {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        osc.type = i % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(f, ctx.currentTime);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(540, ctx.currentTime);
        osc.connect(filter);
        filter.connect(padGain);
        osc.start();
        return osc;
      });
    }
  }, []);

  const updatePadSound = useCallback(
    (t: number) => {
      const gainNode = padGainRef.current;
      const ctx = audioCtxRef.current;
      if (!gainNode || !ctx) return;
      const now = ctx.currentTime;

      // Intentional dramatic silence between 30.8s and 32.4s before the twist!
      const inSilenceGap = t >= 30.8 && t < 32.4;
      if (!isPlaying || isMuted || inSilenceGap || t >= DURATION) {
        gainNode.gain.setTargetAtTime(0.0001, now, 0.12);
        return;
      }
      gainNode.gain.setTargetAtTime(0.08 * masterVolume, now, 0.25);

      let chord = [146.83, 220.0, 261.63, 329.63]; // S1 Dm9
      if (t >= 6.5 && t < 14.5) chord = [116.54, 174.61, 220.0, 293.66]; // S2 Bbmaj7
      else if (t >= 14.5 && t < 23.0) chord = [98.0, 146.83, 196.0, 261.63]; // S3 Gm11
      else if (t >= 23.0 && t < 30.8) chord = [110.0, 164.81, 220.0, 246.94]; // S4 A7sus4
      else if (t >= 32.4) chord = [146.83, 220.0, 277.18, 329.63]; // S5 Dmaj9 Warm Gold

      padOscsRef.current.forEach((osc, i) => {
        if (chord[i]) osc.frequency.setTargetAtTime(chord[i], now, 0.35);
      });
    },
    [isPlaying, isMuted, masterVolume]
  );

  const playChimeNote = (freq: number, amp: number, decay: number) => {
    if (!audioCtxRef.current || isMuted) return;
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(Math.max(0.001, amp * masterVolume), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + decay + 0.04);
  };

  // Offline WAV Exporter
  const handleExportWav = async () => {
    showToast('Synthesizing 38.0s stereo soundtrack via OfflineAudioContext...');
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * DURATION, sampleRate);

    // Schedule pad chords
    const playOfflinePad = (start: number, dur: number, freqs: number[], peakGain: number) => {
      freqs.forEach((f, idx) => {
        const osc = offlineCtx.createOscillator();
        const filter = offlineCtx.createBiquadFilter();
        const gain = offlineCtx.createGain();
        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(f, start);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(620, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peakGain / freqs.length, start + Math.min(1.2, dur * 0.3));
        gain.gain.setValueAtTime(peakGain / freqs.length, start + Math.max(0, dur - 1.2));
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.05);
      });
    };

    // Harmonic chords
    playOfflinePad(0.0, 6.6, [146.83, 220.0, 261.63, 329.63], 0.16);
    playOfflinePad(6.4, 8.2, [116.54, 174.61, 220.0, 293.66], 0.17);
    playOfflinePad(14.4, 8.6, [98.0, 146.83, 196.0, 261.63], 0.16);
    playOfflinePad(22.9, 7.8, [110.0, 164.81, 220.0, 246.94], 0.15);
    // Silence 30.8s to 32.4s
    playOfflinePad(32.4, 5.5, [146.83, 220.0, 277.18, 329.63, 440.0], 0.2);

    const rendered = await offlineCtx.startRendering();
    // Convert to WAV Blob
    const numOfChan = rendered.numberOfChannels;
    const length = rendered.length * numOfChan * 2 + 44;
    const out = new ArrayBuffer(length);
    const view = new DataView(out);
    const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
    let offset = 0;
    let pos = 0;

    const set16 = (d: number) => {
      view.setUint16(pos, d, true);
      pos += 2;
    };
    const set32 = (d: number) => {
      view.setUint32(pos, d, true);
      pos += 4;
    };

    set32(0x46464952); // RIFF
    set32(length - 8);
    set32(0x45564157); // WAVE
    set32(0x20746d66); // fmt
    set32(16);
    set16(1); // PCM
    set16(numOfChan);
    set32(rendered.sampleRate);
    set32(rendered.sampleRate * 2 * numOfChan);
    set16(numOfChan * 2);
    set16(16);
    set32(0x61746164); // data
    set32(length - pos - 4);

    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        const sample = Math.max(-1, Math.min(1, channels[i][offset]));
        const intSample = sample < 0 ? sample * 32768 : sample * 32767;
        view.setInt16(pos, intSample, true);
        pos += 2;
      }
      offset++;
    }

    const blob = new Blob([out], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aurora_soundtrack_38s.wav';
    a.click();
    showToast('Downloaded aurora_soundtrack_38s.wav (44.1kHz Stereo PCM)!');
  };

  // Export Current 1080x1920 Frame as PNG
  const handleDownloadFramePng = () => {
    if (!canvasRef.current) return;
    const fNum = Math.round(currentTime * FPS);
    const link = document.createElement('a');
    link.download = `aurora_1080x1920_frame_${String(fNum).padStart(4, '0')}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
    showToast(`Downloaded 1080×1920 PNG frame #${fNum}!`);
  };

  // Playback Control Handlers
  const togglePlay = () => {
    ensureAudioRunning();
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (currentTime >= DURATION - 0.05) {
        setCurrentTime(0);
      }
      setIsPlaying(true);
      lastRafTimeRef.current = performance.now();
    }
  };

  const handleSeek = (newT: number) => {
    const clamped = clamp(newT, 0, DURATION);
    setCurrentTime(clamped);
    renderAtTime(clamped);
  };

  const stepFrame = (deltaFrames: number) => {
    setIsPlaying(false);
    const currF = Math.round(currentTime * FPS);
    const nextF = clamp(currF + deltaFrames, 0, TOTAL_FRAMES);
    handleSeek(nextF / FPS);
  };

  // Master Procedural Vector Drawing Function
  const renderAtTime = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const clampedT = clamp(t, 0, DURATION);

      // 1. Sky & Nebula Background
      const s5Darkness = smoothstep(30.8, 32.3, clampedT);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      if (s5Darkness > 0.01) {
        grad.addColorStop(0, '#020308');
        grad.addColorStop(0.6, '#050711');
        grad.addColorStop(1, '#080B1A');
      } else {
        grad.addColorStop(0, '#050816');
        grad.addColorStop(0.55, '#0B1026');
        grad.addColorStop(1, '#151030');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Atmospheric Nebula Glow
      const nebulaAlpha = (1 - s5Darkness * 0.85) * 0.22;
      if (nebulaAlpha > 0.01) {
        const nebGrad = ctx.createRadialGradient(W * 0.5, H * 0.38, 40, W * 0.5, H * 0.38, 680);
        nebGrad.addColorStop(0, `rgba(56, 189, 248, ${nebulaAlpha})`);
        nebGrad.addColorStop(0.5, `rgba(255, 42, 133, ${nebulaAlpha * 0.6})`);
        nebGrad.addColorStop(1, 'rgba(7, 11, 25, 0)');
        ctx.fillStyle = nebGrad;
        ctx.fillRect(0, 0, W, H);
      }

      // Background Twinkling Stars
      const s4StarTrail = clampedT >= 23.0 && clampedT < 31.8 ? smoothstep(23.2, 25.0, clampedT) * (1 - smoothstep(30.8, 31.8, clampedT)) : 0;
      ctx.save();
      for (let i = 0; i < STARS.length; i++) {
        const st = STARS[i];
        const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clampedT * st.twinkleSpeed + st.phase));
        const alpha = twinkle * (1 - s5Darkness * 0.85);
        if (alpha <= 0.02) continue;

        if (s4StarTrail > 0.05) {
          const cx = W * 0.5;
          const cy = H * 0.25;
          const rad = Math.hypot(st.x - cx, st.y - cy);
          const baseAng = Math.atan2(st.y - cy, st.x - cx) + (clampedT - 23.0) * 0.18;
          const arcLen = s4StarTrail * 0.45;
          ctx.strokeStyle = st.hue;
          ctx.globalAlpha = alpha * 0.55;
          ctx.lineWidth = st.r * 0.9;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, baseAng, baseAng + arcLen);
          ctx.stroke();
        } else {
          ctx.fillStyle = st.hue;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(st.x, (st.y - (clampedT * 4)) % (H * 0.85), st.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // ==========================================
      // SCENE 1: THE LAST MEMORY (0.0s - 6.5s)
      // ==========================================
      if (clampedT <= 6.6) {
        const localT = clampedT;
        const enter = easeOutCubic(localT / 1.1);
        const exit = 1 - smoothstep(5.8, 6.5, clampedT);
        const alpha = enter * exit;

        ctx.save();
        ctx.globalAlpha = alpha;
        const centerX = W * 0.5;
        const personY = H * 0.62;

        // Concentric Orbital Rings
        [190, 315, 440].forEach((rad, idx) => {
          ctx.save();
          ctx.strokeStyle = idx === 0 ? 'rgba(251, 191, 36, 0.16)' : 'rgba(56, 189, 248, 0.12)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 12]);
          ctx.beginPath();
          ctx.arc(centerX, personY - 40, rad * easeOutCubic(localT / 1.4), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        });

        let activeCount = 0;
        S1_ORBS.forEach((orb) => {
          const appear = smoothstep(0.15 + (orb.id % 10) * 0.06, 0.8 + (orb.id % 10) * 0.06, localT);
          const fadeProgress = clamp((localT - orb.fadeStart) / orb.fadeDuration, 0, 1);
          const orbLife = appear * (1 - fadeProgress);

          const currAngle = orb.angle + localT * orb.orbitSpeed;
          const ox = centerX + Math.cos(currAngle) * orb.dist;
          const oy = personY - 40 + Math.sin(currAngle) * orb.dist * 0.78;

          if (orbLife > 0.05) activeCount++;

          if (orbLife > 0.01) {
            ctx.strokeStyle = orb.id === 0 ? 'rgba(251, 191, 36, 0.45)' : 'rgba(56, 189, 248, 0.22)';
            ctx.globalAlpha = alpha * orbLife * 0.65;
            ctx.lineWidth = orb.id === 0 ? 3 : 1.5;
            ctx.beginPath();
            ctx.moveTo(centerX, personY - 42);
            ctx.lineTo(ox, oy);
            ctx.stroke();

            const glowR = orb.size * 3.2;
            const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, glowR);
            g.addColorStop(0, orb.color);
            g.addColorStop(1, 'rgba(56, 189, 248, 0)');
            ctx.fillStyle = g;
            ctx.globalAlpha = alpha * orbLife * 0.75;
            ctx.beginPath();
            ctx.arc(ox, oy, glowR, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.globalAlpha = alpha * orbLife;
            ctx.beginPath();
            ctx.arc(ox, oy, orb.size * 0.55, 0, Math.PI * 2);
            ctx.fill();

            if (orb.id === 0 && localT > 3.8) {
              const pulse = (localT * 2.2) % 1;
              ctx.strokeStyle = '#FBBF24';
              ctx.lineWidth = 3;
              ctx.globalAlpha = alpha * (1 - pulse) * orbLife;
              ctx.beginPath();
              ctx.arc(ox, oy, orb.size + pulse * 48, 0, Math.PI * 2);
              ctx.stroke();

              if (localT > 4.2) {
                ctx.globalAlpha = alpha * smoothstep(4.2, 4.6, localT) * orbLife;
                ctx.font = '600 22px "JetBrains Mono", monospace';
                ctx.fillStyle = '#FBBF24';
                ctx.textAlign = 'left';
                ctx.fillText('← THE FINAL MEMORY', ox + 26, oy + 7);
              }
            }
          }
        });

        // Curved Horizon Hill
        const hillGrad = ctx.createLinearGradient(0, personY + 35, 0, H);
        hillGrad.addColorStop(0, '#111936');
        hillGrad.addColorStop(1, '#050813');
        ctx.fillStyle = hillGrad;
        ctx.beginPath();
        ctx.arc(centerX, personY + 990, 950, Math.PI * 1.18, Math.PI * 1.82);
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fill();

        // Lone Silhouette on hill
        ctx.fillStyle = '#F8FAFC';
        ctx.beginPath();
        ctx.arc(centerX, personY - 58, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1E293B';
        ctx.beginPath();
        ctx.roundRect(centerX - 18, personY - 36, 36, 48, 16);
        ctx.fill();

        // Header
        drawSceneHeader(ctx, 'THE LAST MEMORY', 'CONCEPTUAL REMEMBRANCE HORIZON', localT, alpha, `ACTIVE MEMORIES: ${activeCount}`);
        ctx.restore();
      }

      // ==========================================
      // SCENE 2: THE GENERATIONS (6.5s - 14.5s)
      // ==========================================
      if (clampedT >= 6.4 && clampedT <= 14.6) {
        const localT = clampedT - 6.5;
        const enter = smoothstep(0.0, 0.8, localT);
        const exit = 1 - smoothstep(13.7, 14.5, clampedT);
        const alpha = enter * exit;

        ctx.save();
        ctx.globalAlpha = alpha;
        const spineX = W * 0.5;

        // Ancestral Timeline Spine
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 14]);
        ctx.beginPath();
        ctx.moveTo(spineX, 340);
        ctx.lineTo(spineX, 1380);
        ctx.stroke();
        ctx.setLineDash([]);

        const baseBottomY = 1290;
        const levelHeight = 142;
        const maxLevels = 6;

        for (let lvl = 0; lvl <= maxLevels; lvl++) {
          const lvlAppear = smoothstep(lvl * 0.65, lvl * 0.65 + 0.9, localT);
          if (lvlAppear <= 0.01) continue;

          const count = Math.pow(2, lvl);
          const y = baseBottomY - lvl * levelHeight;
          const spreadWidth = Math.min(880, 180 + lvl * 138);

          for (let i = 0; i < count; i++) {
            const normX = count === 1 ? 0 : i / (count - 1) - 0.5;
            const x = spineX + normX * spreadWidth;

            if (lvl > 0) {
              const parentIdx = Math.floor(i / 2);
              const parentCount = Math.pow(2, lvl - 1);
              const parentNormX = parentCount === 1 ? 0 : parentIdx / (parentCount - 1) - 0.5;
              const parentSpread = Math.min(880, 180 + (lvl - 1) * 138);
              const px = spineX + parentNormX * parentSpread;
              const py = baseBottomY - (lvl - 1) * levelHeight;

              ctx.strokeStyle = lvl <= 2 ? 'rgba(56, 189, 248, 0.55)' : lvl <= 4 ? 'rgba(255, 42, 133, 0.38)' : 'rgba(251, 191, 36, 0.25)';
              ctx.lineWidth = Math.max(1.2, 5 - lvl * 0.7);
              ctx.globalAlpha = alpha * lvlAppear;
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.bezierCurveTo(px, (py + y) * 0.5, x, (py + y) * 0.5, x, y);
              ctx.stroke();
            }

            // Node
            ctx.globalAlpha = alpha * lvlAppear;
            if (lvl <= 1) {
              const r = lvl === 0 ? 34 : 26;
              ctx.fillStyle = lvl === 0 ? '#FBBF24' : '#38BDF8';
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();
            } else if (lvl <= 3) {
              const r = lvl === 2 ? 16 : 11;
              ctx.fillStyle = lvl === 2 ? '#38BDF8' : '#FF2A85';
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.fillStyle = lvl === 4 ? '#FF2A85' : '#FBBF24';
              ctx.beginPath();
              ctx.arc(x, y, 4, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        // Badges
        const badges = [
          { label: 'ONE GENERATION', sub: 'DIRECT LIVING MEMORY', y: 1185, showAt: 0.5 },
          { label: 'TEN GENERATIONS', sub: '1,024 ANCESTORS • SILHOUETTES', y: 760, showAt: 2.5 },
          { label: 'A HUNDRED GENERATIONS', sub: 'CONTINUUM • NAMES VANISH INTO HISTORY', y: 390, showAt: 4.5 },
        ];

        badges.forEach((b, idx) => {
          const bAlpha = smoothstep(b.showAt, b.showAt + 0.65, localT);
          if (bAlpha > 0.01) {
            ctx.save();
            ctx.globalAlpha = alpha * bAlpha;
            const boxW = 790;
            const boxH = 76;
            const bx = (W - boxW) * 0.5;
            const by = b.y - boxH * 0.5;

            ctx.fillStyle = 'rgba(7, 11, 25, 0.9)';
            ctx.strokeStyle = idx === 2 ? '#FBBF24' : idx === 1 ? '#FF2A85' : '#38BDF8';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.roundRect(bx, by, boxW, boxH, 16);
            ctx.fill();
            ctx.stroke();

            ctx.font = '700 28px "Space Grotesk", sans-serif';
            ctx.fillStyle = idx === 2 ? '#FBBF24' : '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.fillText(b.label, W * 0.5, by + 34);

            ctx.font = '500 16px "JetBrains Mono", monospace';
            ctx.fillStyle = '#94A3B8';
            ctx.fillText(b.sub, W * 0.5, by + 60);
            ctx.restore();
          }
        });

        drawSceneHeader(ctx, 'THE GENERATIONS', 'EXPONENTIAL BRANCHING (2^N)', localT, alpha, 'DEPTH: 100+ GENERATIONS');
        ctx.restore();
      }

      // ==========================================
      // SCENE 3: MEMORY IS A NETWORK (14.5s - 23.0s)
      // ==========================================
      if (clampedT >= 14.4 && clampedT <= 23.1) {
        const localT = clampedT - 14.5;
        const enter = smoothstep(0.0, 0.8, localT);
        const exit = 1 - smoothstep(22.3, 23.0, clampedT);
        const alpha = enter * exit;

        ctx.save();
        ctx.globalAlpha = alpha;
        const cx = W * 0.5;
        const cy = H * 0.49;

        // Radar grid rings
        [150, 295, 440].forEach((r) => {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.09)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        });

        let activeLinks = 0;
        S3_EDGES.forEach((edge) => {
          const nA = S3_NODES[edge.a];
          const nB = S3_NODES[edge.b];
          const vanishT = Math.min(nA.vanishTime, nB.vanishTime);
          const edgeLife = 1 - smoothstep(vanishT - 0.45, vanishT, clampedT);
          if (edgeLife <= 0.01) return;

          activeLinks++;
          ctx.strokeStyle = nA.tier === 1 ? 'rgba(251, 191, 36, 0.55)' : 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = nA.tier === 1 ? 2.8 : 1.6;
          ctx.globalAlpha = alpha * edgeLife;
          ctx.beginPath();
          ctx.moveTo(cx + nA.x, cy + nA.y);
          ctx.lineTo(cx + nB.x, cy + nB.y);
          ctx.stroke();
        });

        let activeNodes = 0;
        S3_NODES.forEach((node) => {
          const nodeLife = 1 - smoothstep(node.vanishTime - 0.4, node.vanishTime, clampedT);
          const nx = cx + node.x;
          const ny = cy + node.y;

          if (nodeLife > 0.05) activeNodes++;

          if (nodeLife > 0.01) {
            const glowR = node.r * 3.0;
            const g = ctx.createRadialGradient(nx, ny, 1, nx, ny, glowR);
            g.addColorStop(0, node.color);
            g.addColorStop(1, 'rgba(56, 189, 248, 0)');
            ctx.fillStyle = g;
            ctx.globalAlpha = alpha * nodeLife * 0.8;
            ctx.beginPath();
            ctx.arc(nx, ny, glowR, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.globalAlpha = alpha * nodeLife;
            ctx.beginPath();
            ctx.arc(nx, ny, node.r * 0.65, 0, Math.PI * 2);
            ctx.fill();
          }
        });

        // Telemetry Card
        const cardY = 1255;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(11, 16, 35, 0.9)';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(110, cardY, W - 220, 130, 18);
        ctx.fill();
        ctx.stroke();

        ctx.font = '700 24px "Space Grotesk", sans-serif';
        ctx.fillStyle = activeNodes <= 2 ? '#FBBF24' : '#38BDF8';
        ctx.textAlign = 'center';
        ctx.fillText(activeNodes < 12 ? 'ISOLATED FRAGMENTS' : 'LIVING CONSTELLATION', W * 0.5, cardY + 48);

        ctx.font = '500 20px "JetBrains Mono", monospace';
        ctx.fillStyle = '#E2E8F0';
        ctx.fillText(`NODES: ${activeNodes}   |   FILAMENTS: ${activeLinks}`, W * 0.5, cardY + 92);

        drawSceneHeader(ctx, 'MEMORY IS A NETWORK', 'SHARED TOPOLOGY MODEL', localT, alpha, 'DECAY RATE SIMULATION');
        ctx.restore();
      }

      // ==========================================
      // SCENE 4: THE SCALE OF TIME (23.0s - 31.8s)
      // ==========================================
      if (clampedT >= 22.9 && clampedT <= 31.9) {
        const localT = clampedT - 23.0;
        const enter = smoothstep(0.0, 0.8, localT);
        const exit = 1 - smoothstep(30.9, 31.8, clampedT);
        const alpha = enter * exit;

        ctx.save();
        ctx.globalAlpha = alpha;
        const timeProgress = easeInOutCubic(clamp(localT / 7.5, 0, 1));
        const years = Math.round(timeProgress * 1000);
        const horizonY = 1050;

        // Evolving Scripts
        ctx.font = '600 24px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(125, 211, 252, 0.35)';
        ctx.fillText(years < 350 ? 'MEMORIA • REMEMBRANCE • STORY' : 'ΜΝΗΜΗ • 記憶 • स्मृति • זיכרון', W * 0.5, 395);

        // Ground Horizon
        ctx.fillStyle = '#090E22';
        ctx.fillRect(0, horizonY, W, 360);
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(80, horizonY);
        ctx.lineTo(W - 80, horizonY);
        ctx.stroke();

        // Moving Year Marker
        const markerX = lerp(140, W - 140, timeProgress);
        ctx.fillStyle = '#FBBF24';
        ctx.beginPath();
        ctx.arc(markerX, horizonY, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '700 30px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FBBF24';
        ctx.textAlign = 'center';
        ctx.fillText(`+${years} YEARS`, clamp(markerX, 240, W - 240), horizonY + 54);

        // Fading Polaroid Frame
        const photoFade = 1 - smoothstep(0.15, 0.88, timeProgress) * 0.82;
        const frameW = 280;
        const frameH = 340;
        ctx.save();
        ctx.translate(W * 0.5, 685);
        ctx.globalAlpha = alpha * photoFade;
        ctx.fillStyle = '#1E293B';
        ctx.strokeStyle = '#FBBF24';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(-frameW * 0.5, -frameH * 0.5, frameW, frameH, 20);
        ctx.fill();
        ctx.stroke();

        // Silhouette inside portrait
        ctx.fillStyle = '#F8FAFC';
        ctx.beginPath();
        ctx.arc(0, -30, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        drawSceneHeader(ctx, 'THE SCALE OF TIME', 'CENTURY COMPRESSION', localT, alpha, `+${years} YRS`);
        ctx.restore();
      }

      // ==========================================
      // SCENE 5: THE TWIST ("THAT COUNTS") (31.8s - 38.0s)
      // ==========================================
      if (clampedT >= 31.7) {
        const localT = clampedT - 31.8;
        const lanternBloom = easeOutCubic(clamp((clampedT - 32.35) / 1.4, 0, 1));
        const finalCardAppear = smoothstep(34.6, 35.8, clampedT);

        ctx.save();
        const cx = W * 0.5;
        const cy = H * 0.54;

        if (lanternBloom > 0.01) {
          // Expanding concentric ripples of golden warmth
          for (let rIdx = 0; rIdx < 4; rIdx++) {
            const rippleProg = (localT * 0.38 + rIdx * 0.25) % 1;
            const rad = 90 + rippleProg * 540 * lanternBloom;
            ctx.strokeStyle = '#FBBF24';
            ctx.lineWidth = 2.5;
            ctx.globalAlpha = (1 - rippleProg) * 0.38 * lanternBloom;
            ctx.beginPath();
            ctx.arc(cx, cy - 30, rad, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Warm golden radial lantern glow
          const maxGlowRad = 520 * lanternBloom;
          const glow = ctx.createRadialGradient(cx, cy - 30, 10, cx, cy - 30, maxGlowRad);
          glow.addColorStop(0, 'rgba(251, 191, 36, 0.55)');
          glow.addColorStop(0.45, 'rgba(245, 158, 11, 0.18)');
          glow.addColorStop(1, 'rgba(7, 11, 25, 0)');
          ctx.fillStyle = glow;
          ctx.globalAlpha = lanternBloom;
          ctx.beginPath();
          ctx.arc(cx, cy - 30, maxGlowRad, 0, Math.PI * 2);
          ctx.fill();

          // Park Bench
          ctx.fillStyle = '#1E293B';
          ctx.strokeStyle = '#FBBF24';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.roundRect(cx - 170, cy + 44, 340, 14, 7);
          ctx.fill();
          ctx.stroke();

          // Two figures sharing a warm connection
          const p1X = cx - 54;
          const p2X = cx + 54;
          // Figure 1
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(p1X, cy - 40, 16, 0, Math.PI * 2);
          ctx.fill();
          // Figure 2
          ctx.fillStyle = '#FBBF24';
          ctx.beginPath();
          ctx.arc(p2X, cy - 40, 16, 0, Math.PI * 2);
          ctx.fill();

          // Hands meeting
          const handMeet = smoothstep(32.8, 33.9, clampedT);
          ctx.strokeStyle = '#F8FAFC';
          ctx.lineWidth = 8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p1X + 14, cy - 14);
          ctx.lineTo(lerp(p1X + 24, cx, handMeet), cy - 8);
          ctx.moveTo(p2X - 14, cy - 14);
          ctx.lineTo(lerp(p2X - 24, cx, handMeet), cy - 8);
          ctx.stroke();

          if (handMeet > 0.5) {
            ctx.fillStyle = '#FBBF24';
            ctx.beginPath();
            ctx.arc(cx, cy - 10, 9 * handMeet, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Final Monumental Card
        if (finalCardAppear > 0.01) {
          ctx.save();
          ctx.globalAlpha = finalCardAppear;
          ctx.textAlign = 'center';

          ctx.font = '700 66px "Space Grotesk", sans-serif';
          ctx.fillStyle = '#FFFFFF';
          ctx.shadowColor = 'rgba(251, 191, 36, 0.5)';
          ctx.shadowBlur = 28;
          ctx.fillText('YOU WERE HERE.', W * 0.5, 420);

          ctx.font = '700 72px "Space Grotesk", sans-serif';
          ctx.fillStyle = '#FBBF24';
          ctx.fillText('THAT COUNTS.', W * 0.5, 512);

          ctx.shadowBlur = 0;
          ctx.font = '600 22px "JetBrains Mono", monospace';
          ctx.fillStyle = '#38BDF8';
          ctx.fillText('MEANING DOES NOT REQUIRE ETERNITY', W * 0.5, 575);
          ctx.restore();
        }

        ctx.restore();
      }

      // 4. Synchronized Subtitles
      drawKaraokeSubtitles(ctx, clampedT, job?.subtitles);

      // 5. Video Progress Bar & Safe Margins
      drawProgressAndSafeGuides(ctx, clampedT, safeMargins);

      // Update Scene State
      if (clampedT < 6.5) {
        setActiveSceneNum(1);
        setActiveSceneName('THE LAST MEMORY');
      } else if (clampedT < 14.5) {
        setActiveSceneNum(2);
        setActiveSceneName('THE GENERATIONS');
      } else if (clampedT < 23.0) {
        setActiveSceneNum(3);
        setActiveSceneName('MEMORY IS A NETWORK');
      } else if (clampedT < 31.8) {
        setActiveSceneNum(4);
        setActiveSceneName('THE SCALE OF TIME');
      } else {
        setActiveSceneNum(5);
        setActiveSceneName('YOU WERE HERE. THAT COUNTS.');
      }
    },
    [job?.subtitles, safeMargins]
  );

  // Helper: Draw Kinetic Top Header
  const drawSceneHeader = (
    ctx: CanvasRenderingContext2D,
    title: string,
    metaLabel: string,
    localT: number,
    alpha: number,
    rightInfo: string
  ) => {
    const slide = easeOutCubic(clamp(localT / 0.7, 0, 1));
    ctx.save();
    ctx.globalAlpha = alpha * slide;
    ctx.translate(0, (1 - slide) * -28);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(74, 96, W - 148, 54, 12);
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 18px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38BDF8';
    ctx.textAlign = 'left';
    ctx.fillText(metaLabel, 98, 130);

    ctx.fillStyle = '#FBBF24';
    ctx.textAlign = 'right';
    ctx.fillText(rightInfo, W - 98, 130);

    ctx.textAlign = 'center';
    ctx.font = '700 64px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(255, 42, 133, 0.35)';
    ctx.shadowBlur = 20;
    ctx.fillText(title, W * 0.5, 248);
    ctx.shadowBlur = 0;

    const lineW = 240 * slide;
    const grad = ctx.createLinearGradient(W * 0.5 - lineW, 0, W * 0.5 + lineW, 0);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
    grad.addColorStop(0.5, '#FF2A85');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(W * 0.5 - lineW, 276);
    ctx.lineTo(W * 0.5 + lineW, 276);
    ctx.stroke();
    ctx.restore();
  };

  // Helper: Draw Synchronized Karaoke Subtitles
  const drawKaraokeSubtitles = (
    ctx: CanvasRenderingContext2D,
    t: number,
    subtitlesList?: SubtitleLine[]
  ) => {
    const defaultLines = [
      { start: 0.4, end: 5.9, text: "One day, someone will remember you for the last time. They just won't know it's the last time." },
      { start: 7.0, end: 13.8, text: "Your grandparents remember people you've never met. Their grandparents remembered people whose names have vanished." },
      { start: 15.0, end: 22.3, text: "Memories depend on other people carrying them forward. When connections disappear, stories become harder to recover." },
      { start: 23.5, end: 30.8, text: "A hundred years from now, most strangers won't know you existed. A thousand years from now, even your world may feel like another planet." },
      { start: 32.4, end: 37.2, text: "But you don't have to be remembered forever to matter. Someone's world was different because you were in it." },
    ];

    const activeCue = defaultLines.find((l) => t >= l.start && t <= l.end);
    if (!activeCue) return;

    const cueDur = Math.max(0.1, activeCue.end - activeCue.start);
    const cueProg = clamp((t - activeCue.start) / cueDur, 0, 1);
    const alpha = smoothstep(0, 0.08, cueProg) * (1 - smoothstep(0.92, 1.0, cueProg));

    const words = activeCue.text.split(/\s+/);
    const activeWordIdx = Math.floor(cueProg * words.length);

    ctx.save();
    ctx.globalAlpha = alpha;

    const fontSize = 42;
    ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", sans-serif`;

    const maxWidth = 860;
    const lines: { word: string; idx: number }[][] = [];
    let currentLine: { word: string; idx: number }[] = [];
    let wordGlobalIdx = 0;

    words.forEach((word) => {
      const testLine = [...currentLine.map((item) => item.word), word].join(' ');
      const m = ctx.measureText(testLine).width;
      if (m > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = [{ word, idx: wordGlobalIdx }];
      } else {
        currentLine.push({ word, idx: wordGlobalIdx });
      }
      wordGlobalIdx++;
    });
    if (currentLine.length > 0) lines.push(currentLine);

    const lineHeight = fontSize * 1.38;
    const boxH = lines.length * lineHeight + 60;
    const boxW = 940;
    const boxX = (W - boxW) * 0.5;
    const boxY = 1560 - boxH * 0.5;

    // Dark Frosted Glass Box with Pink/Gold Border
    ctx.fillStyle = 'rgba(7, 11, 25, 0.9)';
    ctx.strokeStyle = '#FF2A85';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 24);
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = 'middle';
    lines.forEach((lineArr, lineIdx) => {
      const lineStr = lineArr.map((w) => w.word).join(' ');
      const totalLineW = ctx.measureText(lineStr).width;
      let cursorX = (W - totalLineW) * 0.5;
      const y = boxY + 30 + (lineIdx + 0.5) * lineHeight;

      lineArr.forEach((item) => {
        const isSpoken = item.idx <= activeWordIdx;
        const isCurrent = item.idx === activeWordIdx;

        if (isCurrent) {
          ctx.fillStyle = '#FBBF24'; // Vivid Amber Highlight
        } else if (isSpoken) {
          ctx.fillStyle = '#FFFFFF';
        } else {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
        }
        ctx.textAlign = 'left';
        ctx.fillText(item.word, cursorX, y);
        cursorX += ctx.measureText(item.word + ' ').width;
      });
    });

    ctx.restore();
  };

  // Helper: Progress Bar & Safe Guides
  const drawProgressAndSafeGuides = (
    ctx: CanvasRenderingContext2D,
    t: number,
    guidesOn: boolean
  ) => {
    // Bottom Progress Bar
    const prog = clamp(t / DURATION, 0, 1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, H - 10, W, 10);
    const barGrad = ctx.createLinearGradient(0, 0, W, 0);
    barGrad.addColorStop(0, '#38BDF8');
    barGrad.addColorStop(0.5, '#FF2A85');
    barGrad.addColorStop(1, '#FBBF24');
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, H - 10, W * prog, 10);

    // Safe Guides Overlay
    if (guidesOn) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 42, 133, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([12, 12]);
      ctx.strokeRect(70, 90, W - 140, H - 180);

      // Action button safe strip on right
      ctx.fillStyle = 'rgba(255, 42, 133, 0.08)';
      ctx.fillRect(W - 160, 0, 160, H);
      ctx.strokeRect(W - 160, 0, 160, H);

      // Bottom sound drawer
      ctx.fillRect(0, H - 280, W, 280);
      ctx.strokeRect(0, H - 280, W, 280);
      ctx.setLineDash([]);

      ctx.font = '600 20px "JetBrains Mono", monospace';
      ctx.fillStyle = '#FF2A85';
      ctx.textAlign = 'right';
      ctx.fillText('9:16 TITLE & ACTION SAFE ZONES', W - 180, 130);
      ctx.restore();
    }
  };

  // Animation Loop
  useEffect(() => {
    let animId: number;

    const loop = (timestamp: DOMHighResTimeStamp) => {
      if (isPlaying) {
        if (!lastRafTimeRef.current) lastRafTimeRef.current = timestamp;
        const dt = Math.min(0.1, (timestamp - lastRafTimeRef.current) / 1000);
        lastRafTimeRef.current = timestamp;

        setCurrentTime((prev) => {
          const next = prev + dt;
          if (next >= DURATION) {
            setIsPlaying(false);
            return DURATION;
          }
          return next;
        });
      }

      renderAtTime(currentTimeRef.current);
      updatePadSound(currentTimeRef.current);
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, renderAtTime, updatePadSound]);

  // Initial Draw
  useEffect(() => {
    renderAtTime(0);
  }, [renderAtTime]);

  const formatTimecode = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const cs = Math.floor((sec - Math.floor(sec)) * 100);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 rounded-xl bg-[#12111c] border-2 border-[#ff2a85] text-white text-xs font-mono shadow-brutal-pink flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#ff2a85]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Scene Header Readout */}
      <div className="w-full max-w-[360px] sm:max-w-[400px] flex items-center justify-between text-xs font-mono px-1">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-[#ff2a85] text-black font-extrabold text-[10px]">
            SCENE {activeSceneNum} / 5
          </span>
          <span className="text-white font-bold tracking-tight text-xs truncate max-w-[190px]">
            {activeSceneName}
          </span>
        </div>
        <div className="text-emerald-400 font-bold text-[11px]">
          30 FPS • 1080×1920
        </div>
      </div>

      {/* 9:16 Canvas Frame */}
      <div
        ref={containerRef}
        className="relative border-4 border-black rounded-2xl overflow-hidden shadow-brutal-pink bg-[#070b19] max-w-[320px] sm:max-w-[380px] aspect-[9/16] w-full group cursor-pointer"
        onClick={togglePlay}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="w-full h-full block object-contain"
        />

        {/* Big Play Overlay when paused at beginning */}
        {!isPlaying && currentTime < 0.2 && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 transition-opacity">
            <div className="w-16 h-16 rounded-full bg-[#ff2a85] text-black flex items-center justify-center shadow-brutal-black hover:scale-105 transition-transform">
              <Play className="w-8 h-8 fill-black ml-1" />
            </div>
            <span className="text-xs font-mono font-bold bg-black/80 px-3 py-1 rounded-full text-pink-200 border border-[#ff2a85]/40">
              Click to Play 38s Vector Infographic
            </span>
          </div>
        )}
      </div>

      {/* Transport Bar & Scrubber */}
      <div className="w-full max-w-[380px] sm:max-w-[420px] bg-[#12111c] border-2 border-black p-3.5 rounded-2xl shadow-brutal-black space-y-3">
        {/* Timeline Scrubber */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-mono text-zinc-400 select-none">
            <button onClick={() => handleSeek(0)} className="hover:text-[#ff2a85]">0.0s S1</button>
            <button onClick={() => handleSeek(6.5)} className="hover:text-[#ff2a85]">6.5s S2</button>
            <button onClick={() => handleSeek(14.5)} className="hover:text-[#ff2a85]">14.5s S3</button>
            <button onClick={() => handleSeek(23.0)} className="hover:text-[#ff2a85]">23.0s S4</button>
            <button onClick={() => handleSeek(31.8)} className="hover:text-[#fde047]">31.8s S5</button>
          </div>
          <input
            type="range"
            min={0}
            max={DURATION}
            step={0.033333}
            value={currentTime}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="w-full accent-[#ff2a85] h-2 bg-zinc-800 rounded-lg cursor-pointer"
          />
        </div>

        {/* Playback Controls & Frame Stepper */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              className="p-2.5 rounded-lg bg-[#ff2a85] text-black font-bold border-2 border-black hover:bg-[#ff4e99] active:translate-x-[1px] active:translate-y-[1px] shadow-brutal-black"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-black" /> : <Play className="w-4 h-4 fill-black ml-0.5" />}
            </button>
            <button
              type="button"
              onClick={() => handleSeek(0)}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:text-white"
              title="Restart"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stepFrame(-1)}
              className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px] font-mono hover:text-white"
              title="Step -1 Frame (-1/30s)"
            >
              -1F
            </button>
            <button
              type="button"
              onClick={() => stepFrame(1)}
              className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px] font-mono hover:text-white"
              title="Step +1 Frame (+1/30s)"
            >
              +1F
            </button>
          </div>

          {/* Timecode & Frame Readout */}
          <div className="bg-[#0a0a0f] border border-zinc-800 px-2.5 py-1 rounded text-[11px] font-mono text-zinc-300">
            <span className="text-[#ff2a85] font-bold">{formatTimecode(currentTime)}</span>
            <span className="text-zinc-600"> / </span>
            <span>00:38.00</span>
          </div>

          {/* Audio & Safe Guides */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:text-white"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-[#ff2a85]" />}
            </button>
            <button
              type="button"
              onClick={() => setSafeMargins(!safeMargins)}
              className={`p-2 rounded-lg border text-xs font-mono ${
                safeMargins
                  ? 'bg-[#ff2a85] text-black border-black font-bold'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
              }`}
              title="Toggle Safe Margins Guide"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Action Strip: Export 1080x1920 Frame PNG and Master 38s WAV */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-zinc-800/80">
          <button
            type="button"
            onClick={handleDownloadFramePng}
            className="py-1.5 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono border border-zinc-700 flex items-center justify-center gap-1.5 transition-colors"
          >
            <Camera className="w-3.5 h-3.5 text-[#fde047]" />
            <span>1080×1920 PNG</span>
          </button>
          <button
            type="button"
            onClick={handleExportWav}
            className="py-1.5 px-2 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-mono border border-indigo-500 flex items-center justify-center gap-1.5 transition-colors"
          >
            <Music className="w-3.5 h-3.5 text-pink-200" />
            <span>38s WAV Score</span>
          </button>
        </div>
      </div>
    </div>
  );
};
