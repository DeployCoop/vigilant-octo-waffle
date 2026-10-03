'use client';

import React from 'react';

interface OrbitalSpinnerProps {
  size?: number;
  label?: string;
  sublabel?: string;
  color?: string;
}

export const OrbitalSpinner: React.FC<OrbitalSpinnerProps> = ({
  size = 64,
  label,
  sublabel,
  color = '#38bdf8', // Cyan
}) => {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Outer Orbit Ring (Clockwise) */}
        <div
          className="absolute inset-0 rounded-full border-2 border-dashed animate-orbit-cw opacity-80"
          style={{ borderColor: color }}
        />

        {/* Inner Counter-Orbit Ring (Counter-Clockwise) */}
        <div
          className="absolute inset-2 rounded-full border border-dotted animate-orbit-ccw opacity-70"
          style={{ borderColor: '#a855f7' }} // Purple accent
        />

        {/* Pulsing Core */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-3 h-3 rounded-full animate-ping opacity-60"
            style={{ backgroundColor: color }}
          />
          <div
            className="absolute w-2 h-2 rounded-full shadow-[0_0_10px_currentColor]"
            style={{ backgroundColor: color, color }}
          />
        </div>
      </div>

      {(label || sublabel) && (
        <div className="flex flex-col items-center text-center">
          {label && (
            <span className="text-xs font-mono font-medium text-slate-200 tracking-wide uppercase">
              {label}
            </span>
          )}
          {sublabel && (
            <span className="text-[10px] font-mono text-slate-400 mt-0.5">
              {sublabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
