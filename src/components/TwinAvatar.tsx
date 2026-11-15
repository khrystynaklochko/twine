import React from 'react';
import type { RunMode } from '../types/twin';

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const MODE_PALETTE: Record<RunMode, { stroke: string; accent: string; label: string }> = {
  twin: { stroke: '#1E3A8A', accent: '#3B82F6', label: 'Twin Mode (Read & Dialogue)' },
  shadow: { stroke: '#92400E', accent: '#D97706', label: 'Shadow Mode (Simulated Plan)' },
  supervised_agent: { stroke: '#065F46', accent: '#10B981', label: 'Supervised Agent Mode' },
  paused: { stroke: '#991B1B', accent: '#EF4444', label: 'Paused / Halted' },
};

export const TwinAvatar: React.FC<{
  ownerId: string;
  mode: RunMode;
  size?: number;
}> = ({ ownerId, mode, size = 56 }) => {
  const seed = hashSeed(ownerId || 'individual');
  const palette = MODE_PALETTE[mode];
  const angle1 = (seed % 360);
  const angle2 = ((seed >> 4) % 360);
  const innerRadius = 11 + (seed % 6);

  return (
    <div
      className="inline-flex items-center justify-center shrink-0 rounded-lg border border-slate-200 bg-white"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Personal digital twin geometric mark — ${palette.label}`}
    >
      <svg
        width={size - 10}
        height={size - 10}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="32" cy="32" r="24" stroke="#E2E8F0" strokeWidth="1.5" />
        <g transform={`rotate(${angle1} 32 32)`}>
          <rect
            x="16"
            y="16"
            width="32"
            height="32"
            rx="6"
            stroke={palette.stroke}
            strokeWidth="1.75"
          />
        </g>
        <g transform={`rotate(${angle2} 32 32)`}>
          <polygon
            points="32,12 49,42 15,42"
            stroke={palette.accent}
            strokeWidth="1.5"
            fill="none"
          />
        </g>
        <circle cx="32" cy="32" r={innerRadius * 0.45} fill={palette.stroke} />
      </svg>
    </div>
  );
};
