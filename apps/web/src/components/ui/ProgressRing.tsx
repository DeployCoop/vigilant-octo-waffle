'use client';

import React from 'react';

interface ProgressRingProps {
  value: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  label?: string;
  color?: string; // Hex or CSS color
  showPercentage?: boolean;
  children?: React.ReactNode;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  value,
  size = 100,
  strokeWidth = 8,
  label,
  color,
  showPercentage = true,
  children,
}) => {
  const clampedValue = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedValue / 100) * circumference;

  // Dynamic status color if none provided
  const ringColor =
    color ||
    (clampedValue >= 80
      ? '#10b981' // Emerald
      : clampedValue >= 50
      ? '#f59e0b' // Amber
      : '#ef4444'); // Red

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || 'Progress ring'}
    >
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Track Circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-800/80"
          fill="transparent"
        />

        {/* Progress Arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
          fill="transparent"
          style={{
            filter: `drop-shadow(0 0 6px ${ringColor}88)`,
          }}
        />
      </svg>

      {/* Center Label / Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children ? (
          children
        ) : showPercentage ? (
          <>
            <span className="text-sm font-mono font-bold text-slate-100">
              {Math.round(clampedValue)}%
            </span>
            {label && (
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                {label}
              </span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};
