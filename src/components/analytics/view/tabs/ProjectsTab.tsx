// src/components/analytics/view/tabs/ProjectsTab.tsx
import React from 'react';

import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import type { ProjectsResponse, RangePreset } from '../../types';
import { fmtInt, fmtTokens, fmtUsd } from '../../utils/format';

interface Props { range: RangePreset; }

export default function ProjectsTab({ range }: Props) {
  const { data, isLoading, error } = useAnalyticsData<ProjectsResponse>('projects', range);

  if (error)     return <div className="p-4 text-destructive">{error}</div>;
  if (isLoading) return <div className="p-4 text-muted-foreground">Loading…</div>;
  if (!data || data.projects.length === 0) return <div className="p-4 text-muted-foreground">No project activity in this range.</div>;

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.projects.map(p => (
        <div key={p.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="truncate text-sm font-semibold" title={p.path}>{p.name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground" title={p.path}>{p.path}</div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted-foreground">Sessions</dt><dd className="tabular-nums">{fmtInt(p.sessions)}</dd></div>
            <div><dt className="text-muted-foreground">Tokens</dt><dd className="tabular-nums">{fmtTokens(p.tokens)}</dd></div>
            <div><dt className="text-muted-foreground">Cost</dt><dd className="tabular-nums">{fmtUsd(p.cost)}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}
