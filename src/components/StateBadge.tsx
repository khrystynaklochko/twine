import React from 'react';
import { AlertCircle, CheckCircle2, Clock, Lock, Slash, Terminal } from 'lucide-react';
import type { UIStateTag } from '../types/twin';

const CONFIG: Record<UIStateTag, { label: string; colorClass: string; Icon: React.ComponentType<{ className?: string }> }> = {
  live: { label: 'Live', colorClass: 'text-emerald-700', Icon: CheckCircle2 },
  pending: { label: 'Pending', colorClass: 'text-amber-700', Icon: Clock },
  error: { label: 'Error', colorClass: 'text-red-700', Icon: AlertCircle },
  permission_required: { label: 'Permission Required', colorClass: 'text-blue-800', Icon: Lock },
  demo: { label: 'Demo Fixture', colorClass: 'text-slate-700', Icon: Terminal },
  disabled: { label: 'Disabled', colorClass: 'text-slate-500', Icon: Slash },
};

export const StateBadge: React.FC<{ state: UIStateTag; detail?: string }> = ({ state, detail }) => {
  const { label, colorClass, Icon } = CONFIG[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${colorClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{detail || label}</span>
    </span>
  );
};
