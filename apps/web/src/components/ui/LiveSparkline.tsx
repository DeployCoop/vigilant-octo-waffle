'use client';

import React from 'react';

interface LiveSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
}

export const LiveSparkline: React.FC<LiveSparklineProps> = ({
  data,
  width = 160,
  height = 40,
  color = '#38bdf8', // Cyan
  fillColor = 'rgba(56, 189, 248, 0.15)',
}) => {
  if (!data || data.length === 0) {
    return <div style={{ width, height }} className="bg-slate-900/40 rounded" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Build SVG points
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1 || 1)) * (width - 8) + 4;
    const y = height - 6 - ((val - min) / range) * (height - 12);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1]?.x} ${height} L ${points[0]?.x} ${height} Z`;
  const lastPoint = points[points.length - 1];

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Gradient Area */}
      <path d={areaPath} fill={fillColor} />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}
      />

      {/* Pulsing Endpoint Dot */}
      {lastPoint && (
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r={3}
          fill={color}
          className="animate-ping opacity-75"
        />
      )}
      {lastPoint && (
        <circle cx={lastPoint.x} cy={lastPoint.y} r={2.5} fill="#ffffff" />
      )}
    </svg>
  );
};
