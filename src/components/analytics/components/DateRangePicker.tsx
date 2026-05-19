// src/components/analytics/components/DateRangePicker.tsx
import React from 'react';

import type { RangePreset } from '../types';

interface Props {
  value: RangePreset;
  onChange: (next: RangePreset) => void;
}

const OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d',    label: '7 days' },
  { value: '30d',   label: '30 days' },
];

export default function DateRangePicker({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            'rounded px-2.5 py-1 transition-colors ' +
            (value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
