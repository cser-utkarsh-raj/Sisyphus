import React from 'react';
import {
  PlaySquare,
  Workflow,
  Film,
  Mic,
  Share2,
  Settings,
} from 'lucide-react';
import { AuroraLogo } from '../common/AuroraLogo.tsx';

export type NavTab = 'create' | 'pipeline' | 'library' | 'voices' | 'connections' | 'settings';

interface NavbarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeJobsCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  activeJobsCount = 0,
}) => {
  const tabs = [
    { id: 'create' as NavTab, label: 'Create', icon: PlaySquare },
    { id: 'pipeline' as NavTab, label: 'Pipeline', icon: Workflow, badge: activeJobsCount > 0 ? `${activeJobsCount}` : undefined },
    { id: 'library' as NavTab, label: 'Library', icon: Film },
    { id: 'voices' as NavTab, label: 'Voices', icon: Mic, highlight: true },
    { id: 'connections' as NavTab, label: 'Connections', icon: Share2 },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
  ];

  return (
    <header className="border-b-2 border-black bg-[#0d0c14] sticky top-0 z-50 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Logo & Brand with Aurora.ai Emblem */}
          <div
            onClick={() => onTabChange('voices')}
            className="cursor-pointer"
          >
            <AuroraLogo size="md" showSubtitle={true} />
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 sm:gap-2 overflow-x-auto py-2 no-scrollbar">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all duration-150 border-2 shrink-0 ${
                    isActive
                      ? 'bg-[#ff2a85] text-black border-black shadow-brutal-black'
                      : tab.highlight
                      ? 'bg-[#181625] text-pink-300 border-[#ff2a85]/50 hover:border-[#ff2a85]'
                      : 'bg-transparent text-zinc-400 border-transparent hover:text-white hover:bg-zinc-800/60'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-black' : tab.highlight ? 'text-[#ff2a85]' : 'text-zinc-400'}`} />
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span className="w-4 h-4 rounded-full bg-black text-[#ff2a85] text-[9px] flex items-center justify-center font-bold">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Engine Status Pill */}
          <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-zinc-800 text-[11px] font-mono text-zinc-400">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-zinc-300 font-bold">1080×1920 • 30 FPS READY</span>
          </div>
        </div>
      </div>
    </header>
  );
};
