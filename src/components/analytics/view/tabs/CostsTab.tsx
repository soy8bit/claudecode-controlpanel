// src/components/analytics/view/tabs/CostsTab.tsx
import React from 'react';

import MetricCard from '../../components/MetricCard';
import BreakdownPie from '../../charts/BreakdownPie';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import { MODEL_PRICING_CLIENT } from '../../utils/pricing-client';
import type { CostsResponse, RangePreset } from '../../types';
import { fmtTokens, fmtUsd } from '../../utils/format';

interface Props { range: RangePreset; }

export default function CostsTab({ range }: Props) {
  const { data, isLoading, error } = useAnalyticsData<CostsResponse>('costs', range);
  if (error)     return <div className="p-4 text-destructive">{error}</div>;
  if (isLoading || !data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  // Compute per-model cost client-side using the same pricing table.
  const slices = data.byModel.map(m => {
    const p = MODEL_PRICING_CLIENT[m.model] ?? Object.entries(MODEL_PRICING_CLIENT).find(([k]) => m.model.startsWith(k))?.[1];
    const cost = p
      ? (m.tokens_input * p.input + m.tokens_output * p.output + m.tokens_cache_read * p.cacheRead + m.tokens_cache_create * p.cacheCreate) / 1_000_000
      : 0;
    return { name: m.model, value: cost };
  }).filter(s => s.value > 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Total cost"        value={fmtUsd(data.totalCost)} />
        <MetricCard label="Cache reads"       value={fmtTokens(data.cacheReadTokens)} hint="tokens served from cache" />
        <MetricCard label="Models seen"       value={String(data.byModel.length)} />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 text-sm font-medium">Cost by model</div>
        {slices.length === 0 ? <div className="text-muted-foreground">No paid tokens in this range.</div> : <BreakdownPie data={slices} />}
      </div>
    </div>
  );
}
