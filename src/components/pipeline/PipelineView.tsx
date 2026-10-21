import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  Terminal,
  FileText,
  Volume2,
  Video,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import type { Job, PipelineStageId, StageStatus } from '../../types/pipeline.ts';
import { PIPELINE_STAGE_DEFINITIONS, canRetryStage } from '../../utils/pipelineSteps.ts';

interface PipelineViewProps {
  activeJobId?: string | null;
  onSelectJob?: (jobId: string) => void;
}

export const PipelineView: React.FC<PipelineViewProps> = ({ activeJobId, onSelectJob }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(activeJobId || null);
  const [loading, setLoading] = useState(false);
  const [retryingStage, setRetryingStage] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeJobId) {
      setSelectedJobId(activeJobId);
    }
  }, [activeJobId]);

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data: Job[] = await res.json();
        setJobs(data);
        // Use the latest state rather than the effect's initial closure; polling must not
        // snap the user's selected job back to the first item every 2.5 seconds.
        setSelectedJobId((current) =>
          current && data.some((job) => job.id === current) ? current : (data[0]?.id ?? null)
        );
      }
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  };

  const currentJob = jobs.find((j) => j.id === selectedJobId) || jobs[0];

  const handleRetryStage = async (stageId: PipelineStageId) => {
    if (!currentJob) return;
    setRetryingStage(stageId);
    setRetryError(null);
    try {
      const res = await fetch(`/api/jobs/${currentJob.id}/retry/${stageId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Retry failed (HTTP ${res.status}).`);
      }
      await fetchJobs();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Stage retry failed.');
    } finally {
      setRetryingStage(null);
    }
  };

  const getStatusBadge = (status: StageStatus) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/80 text-emerald-300 text-[11px] font-mono font-bold">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> COMPLETED
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#ff2a85]/20 border border-[#ff2a85] text-[#ff2a85] text-[11px] font-mono font-bold animate-pulse">
            <Clock className="w-3 h-3 animate-spin" /> RUNNING
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-500 text-rose-300 text-[11px] font-mono font-bold">
            <AlertTriangle className="w-3 h-3 text-rose-400" /> FAILED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 text-[11px] font-mono">
            PENDING
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header with Job Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#12111c] border-2 border-black p-5 rounded-xl shadow-brutal-black">
        <div>
          <div className="text-xs font-mono text-[#ff2a85] font-bold uppercase tracking-wider mb-1">
            Production Stage Monitor
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Pipeline Orchestrator
          </h1>
        </div>

        {/* Job Dropdown */}
        {jobs.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-zinc-400">Job:</span>
            <select
              value={selectedJobId || ''}
              onChange={(e) => {
                setSelectedJobId(e.target.value);
                onSelectJob?.(e.target.value);
              }}
              className="bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.topic.substring(0, 32)}... ({j.status.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {retryError && (
        <div role="alert" className="rounded-xl border border-rose-500/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {retryError}
        </div>
      )}

      {!currentJob ? (
        <div className="text-center py-16 bg-[#12111c] border-2 border-zinc-800 rounded-xl space-y-3">
          <Terminal className="w-12 h-12 text-[#ff2a85] mx-auto opacity-70" />
          <h3 className="text-base font-bold text-white">No Active Generation Jobs</h3>
          <p className="text-xs text-zinc-400">
            Head to the "Create" tab to start your first short-form video production pipeline.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: 11-Stage Pipeline Stepper */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between px-2 text-xs font-mono text-zinc-400">
              <span>PIPELINE STAGES ({currentJob.progress}% COMPLETED)</span>
              <span>JOB ID: {currentJob.id}</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-[#12111c] border border-zinc-800 h-2.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#ff2a85] transition-all duration-500 rounded-full"
                style={{ width: `${currentJob.progress}%` }}
              />
            </div>

            {/* Stage Cards */}
            <div className="space-y-2.5 pt-2">
              {PIPELINE_STAGE_DEFINITIONS.map((def, idx) => {
                const stage = currentJob.stages[def.id] || {
                  id: def.id,
                  name: def.name,
                  description: def.description,
                  status: 'pending',
                  logs: [],
                };
                const canRetry = canRetryStage(currentJob.stages, def.id);

                return (
                  <div
                    key={def.id}
                    className={`p-4 rounded-xl border-2 transition-all bg-[#12111c] ${
                      stage.status === 'running'
                        ? 'border-[#ff2a85] shadow-brutal-pink-sm'
                        : stage.status === 'failed'
                        ? 'border-rose-500/80 bg-rose-950/20'
                        : 'border-zinc-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-md bg-[#0a0a0f] border border-zinc-700 flex items-center justify-center text-xs font-mono font-bold text-zinc-300 shrink-0">
                          {idx + 1}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-white tracking-wide">
                              {def.name}
                            </h4>
                            {getStatusBadge(stage.status)}
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">{def.description}</p>
                        </div>
                      </div>

                      {/* Retry Action */}
                      {(stage.status === 'failed' || (stage.status === 'completed' && canRetry)) && (
                        <button
                          type="button"
                          onClick={() => handleRetryStage(def.id)}
                          disabled={retryingStage === def.id}
                          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-[#ff2a85] text-zinc-300 hover:text-black text-xs font-mono font-bold border border-black flex items-center gap-1 transition-colors"
                          title="Retry this stage independently"
                        >
                          <RotateCcw className={`w-3 h-3 ${retryingStage === def.id ? 'animate-spin' : ''}`} />
                          Retry
                        </button>
                      )}
                    </div>

                    {/* Logs Snippet */}
                    {stage.logs && stage.logs.length > 0 && (
                      <div className="mt-3 p-2.5 rounded bg-[#0a0a0f] border border-zinc-800/80 text-[11px] font-mono text-zinc-300 space-y-1 overflow-x-auto">
                        {stage.logs.map((log, lIdx) => (
                          <div key={lIdx} className="leading-tight text-pink-200/80">
                            &gt; {log}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Active Job Summary & Artifact Inspector */}
          <div className="space-y-4">
            <div className="bg-[#12111c] border-2 border-black p-5 rounded-xl shadow-brutal-black space-y-4">
              <h3 className="text-sm font-black font-mono text-white uppercase tracking-wider border-b border-zinc-800 pb-2">
                Execution Artifacts
              </h3>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-zinc-500 font-mono">Topic:</span>
                  <div className="font-bold text-white mt-0.5">{currentJob.topic}</div>
                </div>

                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div>
                    <span className="text-zinc-500">Voice:</span>{' '}
                    <span className="text-[#ff2a85] font-bold uppercase">{currentJob.voiceId}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Style:</span>{' '}
                    <span className="text-zinc-300">{currentJob.style}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Duration:</span>{' '}
                    <span className="text-zinc-300">{currentJob.targetDurationSec}s</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Platforms:</span>{' '}
                    <span className="text-zinc-300">{currentJob.targetPlatforms.join(', ')}</span>
                  </div>
                </div>

                {/* Subtitle Sync Stats */}
                {currentJob.subtitles && (
                  <div className="p-3 bg-[#0a0a0f] rounded-lg border border-zinc-800 space-y-1 text-xs">
                    <div className="font-mono text-[#ff2a85] font-bold">
                      Karaoke Subtitles Synced:
                    </div>
                    <div className="text-zinc-400">
                      {currentJob.subtitles.length} lines •{' '}
                      {currentJob.subtitles.reduce((acc, l) => acc + l.words.length, 0)} word timestamps
                    </div>
                  </div>
                )}

                {/* Video Output Stats */}
                {currentJob.videoMetadata && (
                  <div className="p-3 bg-[#ff2a85]/10 rounded-lg border border-[#ff2a85] space-y-1 text-xs">
                    <div className="font-mono text-[#ff2a85] font-bold flex items-center gap-1.5">
                      <Video className="w-4 h-4" /> MP4 Render Validated:
                    </div>
                    <div className="text-zinc-300 font-mono text-[11px]">
                      {currentJob.videoMetadata.width}×{currentJob.videoMetadata.height} (9:16) •{' '}
                      {currentJob.videoMetadata.fps} FPS • {currentJob.videoMetadata.durationSec}s
                    </div>
                    <div className="text-emerald-400 font-mono text-[10px]">
                      ✓ STRICTLY &lt; 60 SECONDS ENFORCED
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
