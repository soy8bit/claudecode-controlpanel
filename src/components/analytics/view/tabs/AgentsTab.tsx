// src/components/analytics/view/tabs/AgentsTab.tsx
import React from 'react';

import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import type { AgentsResponse, RangePreset } from '../../types';
import { fmtInt } from '../../utils/format';

interface Props { range: RangePreset; }

const fmtDuration = (ms: number) => {
  if (!ms) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
};

export default function AgentsTab({ range }: Props) {
  const { data, isLoading, error } = useAnalyticsData<AgentsResponse>('agents', range);

  if (error)     return <div className="p-4 text-destructive">{error}</div>;
  if (isLoading) return <div className="p-4 text-muted-foreground">Loading…</div>;
  if (!data || data.agents.length === 0) return <div className="p-4 text-muted-foreground">No sub-agent activity in this range.</div>;

  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-4">Sub-agent</th>
            <th className="py-2 pr-4 text-right">Invocations</th>
            <th className="py-2 pr-4 text-right">Avg duration</th>
            <th className="py-2 pr-4 text-right">Tool calls</th>
          </tr>
        </thead>
        <tbody>
          {data.agents.map(a => (
            <tr key={a.agent_name} className="border-t border-border">
              <td className="py-2 pr-4 font-medium">{a.agent_name}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtInt(a.invocations)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtDuration(a.avg_duration_ms)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtInt(a.tool_calls)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
