'use client';

import React from 'react';

interface ShimmerBarProps {
  progress?: number; // 0 to 100, if omitted -> indeterminate mode
  label?: string;
  height?: number;
  color?: 'cyan' | 'emerald' | 'amber' | 'purple';
}

export const ShimmerBar: React.FC<ShimmerBarProps> = ({
  progress,
  label,
  height = 8,
  color = 'cyan',
}) => {
  const isIndeterminate = progress === undefined;

  const colorStyles = {
    cyan: 'from-cyan-500 via-sky-400 to-blue-500 shadow-[0_0_12px_rgba(56,189,248,0.5)]',
    emerald: 'from-emerald-500 via-teal-400 to-green-500 shadow-[0_0_12px_rgba(52,211,153,0.5)]',
    amber: 'from-amber-500 via-yellow-400 to-orange-500 shadow-[0_0_12px_rgba(251,191,36,0.5)]',
    purple: 'from-purple-500 via-fuchsia-400 to-indigo-500 shadow-[0_0_12px_rgba(168,85,247,0.5)]',
  }[color];

  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-slate-300">{label}</span>
          {!isIndeterminate && (
            <span className="text-slate-400 font-bold">{Math.round(progress)}%</span>
          )}
        </div>
      )}

      <div
        className="w-full bg-slate-900/80 border border-slate-800 rounded-full overflow-hidden relative"
        style={{ height }}
      >
        {isIndeterminate ? (
          <div
            className={`h-full w-1/3 rounded-full bg-gradient-to-r ${colorStyles} animate-shimmer absolute left-0`}
            style={{
              animation: 'shimmer 1.8s infinite linear',
            }}
          />
        ) : (
          <div
            className={`h-full rounded-full bg-gradient-to-r ${colorStyles} transition-all duration-500 ease-out`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        )}
      </div>
    </div>
  );
};
