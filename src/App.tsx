import React, { useState, useEffect } from 'react';
import { Navbar, type NavTab } from './components/layout/Navbar.tsx';
import { VoicesView } from './components/voices/VoicesView.tsx';
import { CreateView } from './components/create/CreateView.tsx';
import { PipelineView } from './components/pipeline/PipelineView.tsx';
import { LibraryView } from './components/library/LibraryView.tsx';
import { ConnectionsView } from './components/connections/ConnectionsView.tsx';
import { SettingsView } from './components/settings/SettingsView.tsx';
import type { Job, VoiceId } from './types/pipeline.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('voices');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [defaultVoiceId, setDefaultVoiceId] = useState<VoiceId>('zephyr');
  const [activeJobsCount, setActiveJobsCount] = useState(0);

  // Poll for active jobs count for Navbar badge
  useEffect(() => {
    fetchActiveJobsCount();
    const interval = setInterval(fetchActiveJobsCount, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchActiveJobsCount = async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const jobs: Job[] = await res.json();
        const running = jobs.filter((j) => j.status === 'running').length;
        setActiveJobsCount(running);
      }
    } catch {
      // Quiet fail
    }
  };

  const handleJobCreated = (jobId: string) => {
    setActiveJobId(jobId);
    setActiveTab('pipeline');
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-pink-50 flex flex-col font-sans selection:bg-[#ff2a85] selection:text-black">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeJobsCount={activeJobsCount}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'voices' && (
          <VoicesView
            onDefaultVoiceChanged={(newVoiceId) => {
              setDefaultVoiceId(newVoiceId);
            }}
          />
        )}

        {activeTab === 'create' && (
          <CreateView
            defaultVoiceId={defaultVoiceId}
            onJobCreated={handleJobCreated}
          />
        )}

        {activeTab === 'pipeline' && (
          <PipelineView
            activeJobId={activeJobId}
            onSelectJob={(id) => setActiveJobId(id)}
          />
        )}

        {activeTab === 'library' && <LibraryView />}

        {activeTab === 'connections' && <ConnectionsView />}

        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Bottom Footer */}
      <footer className="border-t-2 border-black bg-[#0d0c14] py-6 text-xs text-zinc-500 font-mono mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#ff2a85]" />
            <span className="text-zinc-300 font-bold">AURORA.AI</span> — Automated Short-Form Video Production Pipeline
          </div>
          <div className="flex items-center gap-4 text-zinc-400">
            <span>9:16 Vertical (1080×1920)</span>
            <span>•</span>
            <span>Strictly &lt; 60s Duration</span>
            <span>•</span>
            <span>Karaoke Word Timing Sync</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
