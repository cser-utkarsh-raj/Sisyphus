import React, { useState, useEffect } from 'react';
import {
  Settings,
  Save,
  Clock,
  Radio,
  Palette,
  CheckCircle2,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import type { AppSettings, VideoStyle, VoiceId } from '../../types/pipeline.ts';

interface SettingsViewProps {
  onSettingsSaved?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onSettingsSaved }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        setSavedSuccess(true);
        onSettingsSaved?.();
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="text-center py-12 text-zinc-500 font-mono">Loading settings...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-[#12111c] border-2 border-black p-6 rounded-xl shadow-brutal-black">
        <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
          <Settings className="w-7 h-7 text-[#ff2a85]" />
          Production & Automation Settings
        </h1>
        <p className="text-xs text-pink-200/70 mt-1">
          Configure default voice profiles, encoding specifications, and unattended daily publishing schedules.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {savedSuccess && (
          <div className="p-3 bg-[#ff2a85]/20 border-2 border-[#ff2a85] rounded-xl text-xs font-mono text-pink-100 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#ff2a85]" />
            Settings successfully saved and persisted!
          </div>
        )}

        {/* Global Video Defaults */}
        <div className="bg-[#12111c] border-2 border-black p-6 rounded-xl shadow-brutal-black space-y-4">
          <h2 className="text-base font-bold text-white uppercase font-mono tracking-wider border-b border-zinc-800 pb-2">
            Generation Defaults
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase text-zinc-300 font-bold mb-1.5 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#ff2a85]" />
                Default Voice Profile
              </label>
              <select
                value={settings.defaultVoiceId}
                onChange={(e) =>
                  setSettings({ ...settings, defaultVoiceId: e.target.value as VoiceId })
                }
                className="w-full bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none"
              >
                <option value="zephyr">Zephyr (Existential & Melancholic)</option>
                <option value="puck">Puck (Witty & Energetic)</option>
                <option value="kore">Kore (Authoritative & Academic)</option>
                <option value="fenrir">Fenrir (Dramatic & Dark Humorous)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-zinc-300 font-bold mb-1.5 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-[#ff2a85]" />
                Default Visual Theme
              </label>
              <select
                value={settings.defaultStyle}
                onChange={(e) =>
                  setSettings({ ...settings, defaultStyle: e.target.value as VideoStyle })
                }
                className="w-full bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none"
              >
                <option value="cyber_brutalist_pink">Cyber Brutalist Pink</option>
                <option value="neo_vector_infographic">Neo-Vector Infographic (Cyan)</option>
                <option value="dark_noir_science">Dark Noir Science (Amber)</option>
                <option value="retro_blueprint">Retro Blueprint (Green)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Daily Automation Readiness Scheduler */}
        <div className="bg-[#12111c] border-2 border-black p-6 rounded-xl shadow-brutal-black space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <h2 className="text-base font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#ff2a85]" />
              Daily Unattended Scheduler
            </h2>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.dailySchedule?.enabled || false}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    dailySchedule: {
                      ...settings.dailySchedule,
                      enabled: e.target.checked,
                    },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#ff2a85]"></div>
            </label>
          </div>

          <p className="text-xs text-zinc-400 font-sans leading-relaxed">
            When enabled, Aurora.ai runs unattended at the configured UTC time, verifies duplicate topics, renders the code-driven video, and dispatches to enabled social channels.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-mono text-zinc-300 font-bold mb-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#ff2a85]" />
                Daily Publishing Time (UTC)
              </label>
              <input
                type="time"
                value={settings.dailySchedule?.timeOfDayUtc || '09:00'}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    dailySchedule: {
                      ...settings.dailySchedule,
                      timeOfDayUtc: e.target.value,
                    },
                  })
                }
                className="w-full bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-zinc-300 font-bold mb-1">
                Prompt Template / Topic Pool
              </label>
              <input
                type="text"
                value={settings.dailySchedule?.topicTemplate || ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    dailySchedule: {
                      ...settings.dailySchedule,
                      topicTemplate: e.target.value,
                    },
                  })
                }
                className="w-full bg-[#0a0a0f] border-2 border-zinc-800 focus:border-[#ff2a85] rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-[#ff2a85] text-black font-extrabold text-xs uppercase font-mono tracking-wider border-2 border-black shadow-brutal-black hover:bg-[#ff4e99] active:translate-x-[1px] active:translate-y-[1px] transition-all flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving Preferences...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
};
