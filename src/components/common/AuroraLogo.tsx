import React from 'react';

interface AuroraLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const AuroraLogo: React.FC<AuroraLogoProps> = ({
  size = 'md',
  showSubtitle = true,
}) => {
  const iconSizes = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-12 h-12',
  };

  const titleSizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-2xl',
  };

  return (
    <div className="flex items-center gap-2.5 select-none group">
      {/* Dynamic Aurora Wave & AI Prism Emblem */}
      <div
        className={`${iconSizes[size]} rounded-xl bg-gradient-to-br from-[#ff2a85] via-[#38bdf8] to-[#22c55e] p-[2px] shadow-brutal-pink-sm transition-transform duration-200 group-hover:scale-105 shrink-0`}
      >
        <div className="w-full h-full bg-[#070a14] rounded-[10px] flex items-center justify-center p-1 relative overflow-hidden">
          <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
            <defs>
              <linearGradient id="auroraRibbon" x1="4" y1="44" x2="44" y2="4" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ff2a85" />
                <stop offset="50%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#22c55e" />
              </linearGradient>
            </defs>

            {/* Aurora flowing wave */}
            <path
              d="M6 35 C 14 20, 20 38, 30 24 C 36 15, 40 20, 44 11"
              stroke="url(#auroraRibbon)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Soft pink second wave */}
            <path
              d="M8 40 C 16 26, 24 35, 34 19 C 39 12, 42 16, 45 9"
              stroke="#ff2a85"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.8"
            />

            {/* Radiant Northern Star / AI Diamond */}
            <path
              d="M30 8 L32 14 L38 16 L32 18 L30 24 L28 18 L22 16 L28 14 Z"
              fill="#fde047"
            />
            <circle cx="30" cy="16" r="1.5" fill="#ffffff" />

            {/* Harmonic particle nodes */}
            <circle cx="12" cy="28" r="2" fill="#38bdf8" />
            <circle cx="22" cy="32" r="1.5" fill="#ff2a85" />
            <circle cx="36" cy="18" r="1.5" fill="#22c55e" />
          </svg>
        </div>
      </div>

      {/* Brand Name & .ai Pill Tag */}
      <div>
        <div className="flex items-center gap-1.5">
          <span
            className={`font-black tracking-tight text-white font-sans ${titleSizes[size]}`}
          >
            AURORA
          </span>
          <span className="px-1.5 py-0.5 rounded-md bg-gradient-to-r from-[#ff2a85] to-[#38bdf8] text-black text-[9px] font-mono font-black uppercase tracking-wider shadow-sm">
            .AI
          </span>
        </div>
        {showSubtitle && (
          <div className="text-[10px] font-mono text-zinc-400 -mt-0.5 tracking-tight">
            Automated Short-Form Video Pipeline
          </div>
        )}
      </div>
    </div>
  );
};
