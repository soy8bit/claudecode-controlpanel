// src/components/analytics/view/tabs/ToolsTab.tsx
import React from 'react';

import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import type { ToolsResponse, RangePreset } from '../../types';
import { fmtInt } from '../../utils/format';

interface Props { range: RangePreset; }

export default function ToolsTab({ range }: Props) {
  const { data, isLoading, error } = useAnalyticsData<ToolsResponse>('tools', range);
  if (error)     return <div className="p-4 text-destructive">{error}</div>;
  if (isLoading || !data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  if (data.tools.length === 0) return <div className="p-4 text-muted-foreground">No tool activity in this range.</div>;

  const max = data.tools.reduce((m, t) => Math.max(m, t.calls), 1);

  return (
    <div className="p-4">
      <ul className="space-y-2">
        {data.tools.map(t => (
          <li key={t.tool_name} className="flex items-center gap-3">
            <span className="w-32 truncate text-sm font-medium">{t.tool_name}</span>
            <div className="flex-1 rounded bg-muted">
              <div
                className="h-2 rounded bg-primary"
                style={{ width: `${(t.calls / max) * 100}%` }}
              />
            </div>
            <span className="w-16 text-right text-xs tabular-nums">{fmtInt(t.calls)}</span>
            <span className="w-20 text-right text-xs tabular-nums text-destructive">
              {t.errors ? `${fmtInt(t.errors)} err` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
