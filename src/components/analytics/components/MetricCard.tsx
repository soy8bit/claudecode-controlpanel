// src/components/analytics/components/MetricCard.tsx
import React from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  loading?: boolean;
}

export default function MetricCard({ label, value, hint, icon, loading }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {loading ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-muted" /> : value}
      </div>
      {hint && !loading && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
