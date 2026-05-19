// src/components/analytics/view/tabs/OverviewTab.tsx
import React from 'react';
import { Activity, DollarSign, MessageSquare, Layers } from 'lucide-react';

import MetricCard from '../../components/MetricCard';
import TrendChart from '../../charts/TrendChart';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import type { OverviewResponse, RangePreset } from '../../types';
import { fmtInt, fmtTokens, fmtUsd } from '../../utils/format';

interface OverviewTabProps {
  range: RangePreset;
  fromIso?: string;
  toIso?: string;
}

export default function OverviewTab({ range, fromIso, toIso }: OverviewTabProps) {
  const { data, isLoading, error } = useAnalyticsData<OverviewResponse>('overview', range, fromIso, toIso);

  if (error) return <div className="rounded border border-destructive p-4 text-destructive">{error}</div>;

  const totalTokens = (data?.tokensInput ?? 0) + (data?.tokensOutput ?? 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Sessions"        value={fmtInt(data?.sessions ?? 0)}        icon={<Layers size={16} />}     loading={isLoading} />
        <MetricCard label="Messages"        value={fmtInt(data?.messages ?? 0)}        icon={<MessageSquare size={16} />} loading={isLoading} />
        <MetricCard label="Tokens"          value={fmtTokens(totalTokens)}             icon={<Activity size={16} />}   loading={isLoading} hint={`${fmtTokens(data?.tokensInput ?? 0)} in · ${fmtTokens(data?.tokensOutput ?? 0)} out`} />
        <MetricCard label="Estimated cost"  value={fmtUsd(data?.estimatedCostUsd ?? 0)} icon={<DollarSign size={16} />} loading={isLoading} hint={`cache: ${fmtTokens(data?.tokensCacheRead ?? 0)} read · ${fmtTokens(data?.tokensCacheCreate ?? 0)} create`} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 text-sm font-medium">Activity over time</div>
        {isLoading || !data ? (
          <div className="h-60 animate-pulse rounded bg-muted" />
        ) : (
          <div className="text-primary">
            <TrendChart data={data.sparkline} metric="messages" />
          </div>
        )}
      </div>
    </div>
  );
}
