// src/components/analytics/view/AnalyticsView.tsx
import React, { useState } from 'react';
import { X } from 'lucide-react';

import DateRangePicker from '../components/DateRangePicker';
import OverviewTab from './tabs/OverviewTab';
import type { AnalyticsTab, RangePreset } from '../types';

interface Props {
  onClose: () => void;
}

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects' },
  { id: 'agents',   label: 'Agents' },
  { id: 'costs',    label: 'Costs' },
  { id: 'tools',    label: 'Tools' },
];

export default function AnalyticsView({ onClose }: Props) {
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  const [range, setRange] = useState<RangePreset>('7d');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Analytics</h2>
          <nav className="flex items-center gap-1">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                disabled={t.id !== 'overview'}
                onClick={() => setTab(t.id)}
                className={
                  'rounded px-3 py-1 text-sm transition-colors ' +
                  (tab === t.id
                    ? 'bg-muted font-medium'
                    : t.id === 'overview'
                      ? 'text-muted-foreground hover:bg-muted'
                      : 'text-muted-foreground/40 cursor-not-allowed')
                }
                title={t.id === 'overview' ? '' : 'Coming in next milestone'}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        {tab === 'overview' && <OverviewTab range={range} />}
      </div>
    </div>
  );
}
