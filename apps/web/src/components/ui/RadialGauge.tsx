'use client';

import React from 'react';

interface RadialGaugeProps {
  value: number;
  min?: number;
  max?: number;
  title: string;
  unit?: string;
  size?: number;
  colorScheme?: 'health' | 'speed' | 'latency';
}

export const RadialGauge: React.FC<RadialGaugeProps> = ({
  value,
  min = 0,
  max = 100,
  title,
  unit = '',
  size = 140,
  colorScheme = 'health',
}) => {
  const clamped = Math.min(max, Math.max(min, value));
  const percentage = (clamped - min) / (max - min);

  // 180 degree semi-circle: 180 to 360 deg (or PI to 2*PI radians)
  const radius = size * 0.4;
  const strokeWidth = size * 0.1;
  const center = size / 2;
  const arcLength = Math.PI * radius;
  const offset = arcLength * (1 - percentage);

  // Dynamic colors
  let activeColor = '#10b981'; // Emerald
  if (colorScheme === 'health') {
    if (percentage < 0.5) activeColor = '#ef4444';
    else if (percentage < 0.8) activeColor = '#f59e0b';
  } else if (colorScheme === 'latency') {
    // Lower latency is better
    if (percentage > 0.5) activeColor = '#ef4444';
    else if (percentage > 0.25) activeColor = '#f59e0b';
    else activeColor = '#10b981';
  } else {
    // Speed: cyan to emerald
    activeColor = '#38bdf8';
  }

  return (
    <div
      className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md"
      style={{ width: size, height: size * 0.85 }}
    >
      <svg width={size} height={size * 0.58} className="overflow-visible">
        {/* Background Arc */}
        <path
          d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
          fill="none"
          stroke="#1e293b"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Foreground Progress Arc */}
        <path
          d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
          fill="none"
          stroke={activeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={arcLength}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
          style={{ filter: `drop-shadow(0 0 8px ${activeColor}88)` }}
        />
      </svg>

      {/* Numerical readout */}
      <div className="flex flex-col items-center -mt-2">
        <span className="text-xl font-mono font-bold tracking-tight text-slate-100" style={{ color: activeColor }}>
          {typeof value === 'number' ? Math.round(value * 10) / 10 : value}
          <span className="text-xs font-mono font-normal text-slate-400 ml-0.5">{unit}</span>
        </span>
        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider text-center">
          {title}
        </span>
      </div>
    </div>
  );
};
