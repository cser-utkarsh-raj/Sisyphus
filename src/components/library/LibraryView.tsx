import React, { useState, useEffect } from 'react';
import {
  Download,
  Share2,
  ExternalLink,
  Film,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileCode,
  Send,
  Layers,
} from 'lucide-react';
import type { Job, TargetPlatform } from '../../types/pipeline.ts';
import { exportToSrt } from '../../utils/subtitles.ts';
import { InfographicCanvas } from '../video/InfographicCanvas.tsx';

export const LibraryView: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [publishingPlatform, setPublishingPlatform] = useState<string | null>(null);
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data: Job[] = await res.json();
        setJobs(data);
        if (data.length > 0 && !selectedJob) {
          setSelectedJob(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load library:', err);
    }
  };

  const handleDownloadSrt = () => {
    if (!selectedJob?.subtitles) return;
    const srtContent = exportToSrt(selectedJob.subtitles);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedJob.id}-subtitles.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePublishNow = async (platform: TargetPlatform) => {
    if (!selectedJob) return;
    setPublishingPlatform(platform);
    setPublishFeedback(null);

    try {
      const res = await fetch(`/api/jobs/${selectedJob.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });

      const result = await res.json();
      if (result.status === 'published') {
        setPublishFeedback(`Successfully published to ${platform.toUpperCase()}! Link: ${result.publicationUrl}`);
      } else {
        setPublishFeedback(`Publish failed: ${result.error}`);
      }
      await fetchJobs();
    } catch (err: unknown) {
      setPublishFeedback(`Publish request error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPublishingPlatform(null);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#12111c] border-2 border-black p-5 rounded-xl shadow-brutal-black">
        <div>
          <div className="text-xs font-mono text-[#ff2a85] font-bold uppercase tracking-wider mb-1">
            Finished Artifacts & Archive
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Video Production Library
          </h1>
        </div>

        <div className="text-xs font-mono text-zinc-400">
          Total Generated: <span className="text-[#ff2a85] font-bold">{jobs.length}</span>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-20 bg-[#12111c] border-2 border-zinc-800 rounded-xl space-y-3">
          <Film className="w-12 h-12 text-[#ff2a85] mx-auto opacity-70" />
          <h3 className="text-base font-bold text-white">No Videos Generated Yet</h3>
          <p className="text-xs text-zinc-400">
            Create a topic in the "Create" section to render your first 9:16 short-form video.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: 9:16 Interactive Video Player Preview */}
          <div className="lg:col-span-5 flex flex-col items-center">
            {selectedJob && (
              <div className="w-full flex flex-col items-center">
                <InfographicCanvas job={selectedJob} showSafeMarginGuides={false} />
              </div>
            )}
          </div>

          {/* Right: Video Metadata, Script Storyboard, and Social Publishing */}
          <div className="lg:col-span-7 space-y-5">
            {selectedJob && (
              <>
                {/* Active Video Info Card */}
                <div className="bg-[#12111c] border-2 border-black p-6 rounded-xl shadow-brutal-black space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="px-2 py-0.5 rounded bg-[#ff2a85]/20 border border-[#ff2a85] text-[#ff2a85] text-[10px] font-mono font-bold uppercase">
                        {selectedJob.style}
                      </span>
                      <h2 className="text-xl font-black text-white mt-1.5 leading-snug">
                        {selectedJob.script?.title || selectedJob.topic}
                      </h2>
                    </div>

                    {/* Actions: Download MP4 and Subtitles */}
                    <div className="flex items-center gap-2">
                      {selectedJob.videoUrl && (
                        <a
                          href={selectedJob.videoUrl}
                          download={`${selectedJob.id}.mp4`}
                          className="px-3 py-1.5 rounded-lg bg-[#ff2a85] text-black font-bold text-xs uppercase font-mono border border-black hover:bg-[#ff4e99] flex items-center gap-1.5"
                          title="Download final MP4"
                        >
                          <Download className="w-3.5 h-3.5" /> MP4
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={handleDownloadSrt}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 font-bold text-xs uppercase font-mono border border-black hover:bg-zinc-700 flex items-center gap-1.5"
                        title="Download word-synchronized SRT file"
                      >
                        <FileCode className="w-3.5 h-3.5" /> SRT
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-300 font-sans leading-relaxed">
                    {selectedJob.script?.description || 'No description generated.'}
                  </p>

                  {/* Hashtags */}
                  {selectedJob.script?.hashtags && (
                    <div className="flex flex-wrap gap-1.5 text-xs font-mono text-[#ff2a85]">
                      {selectedJob.script.hashtags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded bg-[#1c1a29] border border-zinc-800">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Social Publication Dispatcher */}
                <div className="bg-[#12111c] border-2 border-black p-6 rounded-xl shadow-brutal-black space-y-4">
                  <h3 className="text-sm font-black font-mono text-white uppercase tracking-wider flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-[#ff2a85]" />
                    Social Platform Publications
                  </h3>

                  {publishFeedback && (
                    <div className="p-3 bg-[#ff2a85]/15 border border-[#ff2a85] rounded-lg text-xs font-mono text-pink-100">
                      {publishFeedback}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(['youtube', 'instagram', 'facebook'] as TargetPlatform[]).map((p) => {
                      const pub = selectedJob.publications?.[p];
                      const isPublished = pub?.status === 'published';
                      const isUploading = publishingPlatform === p;

                      return (
                        <div
                          key={p}
                          className="p-3.5 rounded-lg bg-[#0c0c13] border border-zinc-800 flex flex-col justify-between space-y-3"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-mono font-bold text-white uppercase">
                                {p === 'youtube' ? 'Shorts' : p === 'instagram' ? 'Reels (IG)' : 'Reels (FB)'}
                              </span>
                              {isPublished ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <span className="text-[10px] font-mono text-zinc-500 uppercase">
                                  {pub?.status || 'Pending'}
                                </span>
                              )}
                            </div>

                            {pub?.publicationUrl && (
                              <a
                                href={pub.publicationUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-mono text-[#ff2a85] hover:underline flex items-center gap-1 mt-1 truncate"
                              >
                                View Post <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={isUploading}
                            onClick={() => handlePublishNow(p)}
                            className={`w-full py-1.5 rounded text-xs font-mono font-bold uppercase transition-all border border-black ${
                              isPublished
                                ? 'bg-zinc-800 text-zinc-400 hover:text-white'
                                : 'bg-[#ff2a85] text-black hover:bg-[#ff4e99]'
                            }`}
                          >
                            {isUploading ? 'Publishing...' : isPublished ? 'Re-Publish' : 'Publish'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Storyboard Scenes List */}
                {selectedJob.script?.scenes && (
                  <div className="bg-[#12111c] border-2 border-black p-6 rounded-xl shadow-brutal-black space-y-3">
                    <h3 className="text-sm font-black font-mono text-white uppercase tracking-wider flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#ff2a85]" />
                      Storyboard Scene Breakdown ({selectedJob.script.scenes.length} Scenes)
                    </h3>
                    <div className="space-y-2">
                      {selectedJob.script.scenes.map((scene) => (
                        <div
                          key={scene.id}
                          className="p-3 rounded-lg bg-[#0a0a0f] border border-zinc-800 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[#ff2a85] font-bold">
                              Scene #{scene.sceneNumber}: {scene.title}
                            </span>
                            <span className="font-mono text-zinc-500 text-[11px]">
                              {(scene.startMs / 1000).toFixed(1)}s - {(scene.endMs / 1000).toFixed(1)}s [
                              {scene.visualType}]
                            </span>
                          </div>
                          <p className="text-zinc-300 italic font-sans">"{scene.narration}"</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
