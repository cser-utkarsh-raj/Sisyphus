import React from 'react';

interface SisyphusLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const SisyphusLogo: React.FC<SisyphusLogoProps> = ({
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
      {/* Dynamic Sisyphus Emblem */}
      <div
        className={`${iconSizes[size]} rounded-xl bg-gradient-to-br from-[#ff2a85] via-[#ff69b4] to-[#f59e0b] p-[2px] shadow-brutal-pink-sm transition-transform duration-200 group-hover:scale-105 shrink-0`}
      >
        <div className="w-full h-full bg-[#070a14] rounded-[10px] flex items-center justify-center p-1">
          <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
            {/* Incline slope */}
            <path
              d="M6 40 L42 16"
              stroke="#38bdf8"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* The Boulder */}
            <circle cx="28" cy="17" r="8" fill="#ff2a85" />
            <circle cx="28" cy="17" r="8" stroke="#ffffff" strokeWidth="1.5" />
            <circle cx="25" cy="14" r="2.5" fill="#fde047" />
            {/* Sisyphus Silhouette Figure */}
            <path
              d="M16 34 L21 26 L25 21"
              stroke="#f8fafc"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M16 34 L13 40"
              stroke="#f8fafc"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="20" cy="19" r="3" fill="#fde047" />
            {/* Energy sparks */}
            <path
              d="M36 10 L39 8"
              stroke="#fde047"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M32 7 L34 5"
              stroke="#38bdf8"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* Brand Name & Version Tag */}
      <div>
        <div className="flex items-center gap-2">
          <span
            className={`font-black tracking-tight text-white font-sans ${titleSizes[size]}`}
          >
            SISYPHUS
          </span>
          <span className="px-1.5 py-0.5 rounded bg-[#ff2a85] text-black text-[9px] font-mono font-black uppercase tracking-wider">
            v1.0
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
