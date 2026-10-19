import React, { useState, useEffect } from 'react';
import { Navbar, type NavTab } from './components/layout/Navbar.tsx';
import { DotFooter } from './components/layout/DotFooter.tsx';
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

      <DotFooter
        onLibraryClick={() => setActiveTab('library')}
        onCreateClick={() => setActiveTab('create')}
      />
    </div>
  );
}
