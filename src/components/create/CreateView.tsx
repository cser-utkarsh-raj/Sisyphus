import React, { useState } from 'react';
import { Sparkles, Play, Clock, Palette, Radio, Globe, AlertTriangle, RefreshCw } from 'lucide-react';
import type { TargetPlatform, VideoStyle, VoiceId } from '../../types/pipeline.ts';

interface CreateViewProps {
  defaultVoiceId: VoiceId;
  onJobCreated: (jobId: string) => void;
}

const TEMPLATES = [
  {
    title: 'The Dead Internet Theory',
    prompt: 'Explore the provocative hypothesis that automated bots and synthetic content now dominate the majority of internet activity.',
    category: 'Existential Tech',
    duration: 38,
  },
  {
    title: 'Why Brains Hallucinate Memories',
    prompt: 'Examine false memory creation in neuroscience and why eyewitness confidence frequently contradicts reality.',
    category: 'Cognitive Science',
    duration: 32,
  },
  {
    title: 'Quantum Immortality Paradox',
    prompt: 'Break down the many-worlds interpretation thought experiment regarding subjective observer survival.',
    category: 'Physics & Philosophy',
    duration: 45,
  },
  {
    title: 'The Dark History of the Potato',
    prompt: 'How a humble Andean tuber sparked geopolitical empires, population explosions, and historical collapses.',
    category: 'Absurd History',
    duration: 28,
  },
];

export const CreateView: React.FC<CreateViewProps> = ({ defaultVoiceId, onJobCreated }) => {
  const [topic, setTopic] = useState('');
  const [creativePrompt, setCreativePrompt] = useState('');
  const [style, setStyle] = useState<VideoStyle>('cyber_brutalist_pink');
  const [targetDurationSec, setTargetDurationSec] = useState(35);
  const [voiceId, setVoiceId] = useState<VoiceId>(defaultVoiceId);
  const [targetPlatforms, setTargetPlatforms] = useState<TargetPlatform[]>(['youtube', 'instagram']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePlatform = (p: TargetPlatform) => {
    if (targetPlatforms.includes(p)) {
      setTargetPlatforms(targetPlatforms.filter((x) => x !== p));
    } else {
      setTargetPlatforms([...targetPlatforms, p]);
    }
  };

  const handleApplyTemplate = (tmpl: (typeof TEMPLATES)[0]) => {
    setTopic(tmpl.title);
    setCreativePrompt(tmpl.prompt);
    setTargetDurationSec(tmpl.duration);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setError('Please provide a video topic or question.');
      return;
    }

    if (targetDurationSec >= 60 || targetDurationSec < 15) {
      setError('Duration must be strictly under 60 seconds (15s to 59s).');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          creativePrompt,
          style,
          targetDurationSec,
          voiceId,
          targetPlatforms,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to start video production job');
      }

      const job = await res.json();
      onJobCreated(job.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Page Title */}
      <div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ff2a85]/20 border border-[#ff2a85] text-[#ff2a85] text-xs font-mono font-bold tracking-wider uppercase mb-2">
          <Sparkles className="w-3.5 h-3.5" />
          Automated Pipeline
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
          Create Short-Form Video
        </h1>
        <p className="text-sm text-pink-200/70 mt-1">
          Generate an educational, code-driven 9:16 infographic video under 60 seconds with synchronized karaoke subtitles.
        </p>
      </div>

      {/* Quick Starter Templates */}
      <div className="space-y-3">
        <div className="text-xs font-mono uppercase tracking-wider text-zinc-400">
          Inspiration Templates:
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.title}
              type="button"
              onClick={() => handleApplyTemplate(tmpl)}
              className="text-left p-3.5 rounded-xl bg-[#12111b] border-2 border-zinc-800 hover:border-[#ff2a85] transition-all hover:shadow-brutal-pink-sm group"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-[#ff2a85] font-bold uppercase">
                  {tmpl.category}
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  {tmpl.duration}s
                </span>
              </div>
              <div className="text-sm font-bold text-white group-hover:text-pink-200 mt-1">
                {tmpl.title}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Creation Form */}
      <form onSubmit={handleSubmit} className="space-y-6 bg-[#12111c] border-2 border-black p-6 md:p-8 rounded-2xl shadow-brutal-black">
        {error && (
          <div className="p-3 bg-red-950/60 border-2 border-red-500 rounded-lg text-xs font-mono text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Topic Input */}
        <div>
          <label htmlFor="video-topic" className="block text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold mb-2">
            1. Topic or Question <span className="text-[#ff2a85]">*</span>
          </label>
          <input
            id="video-topic"
            type="text"
            required
            placeholder="e.g. Why Light Takes 100,000 Years to Escape the Sun"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none transition-colors"
          />
        </div>

        {/* Creative Direction Prompt */}
        <div>
          <label htmlFor="creative-direction" className="block text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold mb-2">
            2. Creative Direction & Tone (Optional)
          </label>
          <textarea
            id="creative-direction"
            rows={2}
            placeholder="Focus on the counter-intuitive physics, keep pacing fast, use dark humor..."
            value={creativePrompt}
            onChange={(e) => setCreativePrompt(e.target.value)}
            className="w-full bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none transition-colors"
          />
        </div>

        {/* Target Duration & Pacing Slider */}
        <div className="p-4 rounded-xl bg-[#0c0c13] border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="target-duration" className="text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#ff2a85]" />
              Target Duration: <span className="text-[#ff2a85] text-sm">{targetDurationSec}s</span>
            </label>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-pink-300 font-bold">
              STRICTLY &lt; 60 SECONDS
            </span>
          </div>
          <input
            id="target-duration"
            type="range"
            min={20}
            max={58}
            step={1}
            value={targetDurationSec}
            onChange={(e) => setTargetDurationSec(Number(e.target.value))}
            className="w-full accent-[#ff2a85] h-2 bg-zinc-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] font-mono text-zinc-500">
            <span>20s (Fast Bite)</span>
            <span>35s (Optimal Pacing)</span>
            <span>58s (Max Short Limit)</span>
          </div>
        </div>

        {/* Voice Selection & Style Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="narration-voice" className="block text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold mb-2 flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-[#ff2a85]" />
              Narration Voice Profile
            </label>
            <select
              id="narration-voice"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value as VoiceId)}
              className="w-full bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none capitalize font-mono"
            >
              <option value="zephyr">Zephyr — Existential & Melancholic (Default)</option>
              <option value="puck">Puck — Witty & Energetic Science</option>
              <option value="kore">Kore — Authoritative & Academic</option>
              <option value="fenrir">Fenrir — Dramatic & Dark Humor</option>
            </select>
          </div>

          <div>
            <label htmlFor="visual-theme" className="block text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold mb-2 flex items-center gap-1.5">
              <Palette className="w-4 h-4 text-[#ff2a85]" />
              Procedural Visual Theme
            </label>
            <select
              id="visual-theme"
              value={style}
              onChange={(e) => setStyle(e.target.value as VideoStyle)}
              className="w-full bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none font-mono"
            >
              <option value="cyber_brutalist_pink">Cyber Brutalist Pink</option>
              <option value="neo_vector_infographic">Neo-Vector Infographic (Cyan)</option>
              <option value="dark_noir_science">Dark Noir Science (Amber)</option>
              <option value="retro_blueprint">Retro Technical Blueprint (Green)</option>
            </select>
          </div>
        </div>

        {/* Target Platforms Checkboxes */}
        <div>
          <div id="target-platforms-label" className="block text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold mb-2 flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-[#ff2a85]" />
            Target Social Channels
          </div>
          <div role="group" aria-labelledby="target-platforms-label" className="grid grid-cols-3 gap-3">
            {[
              { id: 'youtube', label: 'YouTube Shorts' },
              { id: 'instagram', label: 'Instagram Reels' },
              { id: 'facebook', label: 'Facebook Reels' },
            ].map((p) => {
              const checked = targetPlatforms.includes(p.id as TargetPlatform);
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => togglePlatform(p.id as TargetPlatform)}
                  className={`p-3 rounded-xl border-2 text-xs font-mono font-bold transition-all text-center ${
                    checked
                      ? 'border-[#ff2a85] bg-[#ff2a85]/15 text-white shadow-brutal-pink-sm'
                      : 'border-zinc-800 bg-[#0a0a0f] text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Submit Chunky Brutalist Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 rounded-xl bg-[#ff2a85] text-black font-extrabold text-base tracking-wider uppercase border-2 border-black shadow-brutal-black enabled:hover:bg-[#ff4e99] enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none disabled:opacity-70 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
                <span>Initiating Production Pipeline...</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-black" />
                Launch Sisyphus Video Pipeline
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
