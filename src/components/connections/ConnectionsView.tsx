import React, { useState, useEffect } from 'react';
import {
  Globe,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  Key,
  RefreshCw,
  HelpCircle,
  Copy,
} from 'lucide-react';
import type { ConnectionConfig } from '../../types/pipeline.ts';

export const ConnectionsView: React.FC = () => {
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
    try {
      const res = await fetch('/api/connections');
      if (res.ok) {
        const data = await res.json();
        setConnections(data);
      }
    } catch (err) {
      console.error('Failed to load connections:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleConnect = async (platform: string, currentConnected: boolean) => {
    setTestingPlatform(platform);
    try {
      const res = await fetch(`/api/connections/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connected: !currentConnected,
          accountName: !currentConnected ? `@Aurora_${platform.toUpperCase()}` : undefined,
          accountId: !currentConnected ? `${platform}_aurora_channel` : undefined,
        }),
      });

      if (res.ok) {
        await fetchConnections();
      }
    } catch (err) {
      console.error('Failed to toggle connection:', err);
    } finally {
      setTestingPlatform(null);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="bg-[#12111c] border-2 border-black p-6 rounded-xl shadow-brutal-black">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ff2a85]/20 border border-[#ff2a85] text-[#ff2a85] text-xs font-mono font-bold tracking-wider uppercase mb-2">
          <ShieldCheck className="w-3.5 h-3.5" />
          Official Social APIs
        </div>
        <h1 className="text-3xl font-black text-white tracking-tight">
          Social Platform Connections
        </h1>
        <p className="text-sm text-pink-200/70 mt-1 max-w-2xl font-sans">
          Aurora.ai publishes exclusively via official platform APIs: YouTube Data API v3, Instagram Graph API (for Professional Accounts), and Facebook Pages Reels API.
        </p>
      </div>

      {/* Cards Grid */}
      <div className="space-y-6">
        {connections.map((conn) => {
          const isConnected = conn.connected;
          const isTesting = testingPlatform === conn.platform;

          return (
            <div
              key={conn.platform}
              className={`p-6 rounded-2xl border-2 transition-all bg-[#12111c] ${
                isConnected
                  ? 'border-emerald-500 shadow-[4px_4px_0px_0px_#10b981]'
                  : 'border-zinc-800 shadow-brutal-black'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-black text-white tracking-tight">
                      {conn.displayName}
                    </h2>
                    {isConnected ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs font-mono font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        CONNECTED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-950/80 border border-amber-500 text-amber-300 text-xs font-mono font-bold">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        SETUP REQUIRED
                      </span>
                    )}
                  </div>
                  {conn.accountName && (
                    <div className="text-xs font-mono text-[#ff2a85] mt-1">
                      Account: {conn.accountName}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <a
                    href={conn.instructions.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white text-xs font-mono border border-zinc-700 flex items-center gap-1.5"
                  >
                    Official Docs <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    disabled={isTesting}
                    onClick={() => handleToggleConnect(conn.platform, isConnected)}
                    className={`px-4 py-2 rounded-lg font-bold text-xs uppercase font-mono tracking-wider border-2 border-black transition-all ${
                      isConnected
                        ? 'bg-zinc-800 text-rose-300 hover:bg-rose-950/50'
                        : 'bg-[#ff2a85] text-black hover:bg-[#ff4e99] shadow-brutal-black active:translate-x-[1px] active:translate-y-[1px]'
                    }`}
                  >
                    {isTesting ? (
                      <span className="flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying...
                      </span>
                    ) : isConnected ? (
                      'Disconnect'
                    ) : (
                      'Simulate / Connect'
                    )}
                  </button>
                </div>
              </div>

              {/* Scopes Required */}
              <div className="py-4 space-y-2">
                <div className="text-xs font-mono text-zinc-400 font-bold uppercase tracking-wider">
                  Required Scopes:
                </div>
                <div className="flex flex-wrap gap-2">
                  {conn.requiredScopes.map((scope) => (
                    <span
                      key={scope}
                      className="px-2.5 py-1 rounded bg-[#0a0a0f] border border-zinc-800 text-xs font-mono text-pink-200/90"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actionable Setup Steps Accordion */}
              <div className="p-4 rounded-xl bg-[#0c0c13] border border-zinc-800/80 space-y-2 text-xs">
                <div className="font-mono text-white font-bold flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-[#ff2a85]" />
                  {conn.instructions.title}
                </div>
                <ol className="list-decimal list-inside space-y-1 text-zinc-400 font-sans leading-relaxed">
                  {conn.instructions.steps.map((st, sIdx) => (
                    <li key={sIdx}>{st}</li>
                  ))}
                </ol>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
