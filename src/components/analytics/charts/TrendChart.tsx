// src/components/analytics/charts/TrendChart.tsx
import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { OverviewSparkPoint } from '../types';

interface TrendChartProps {
  data: OverviewSparkPoint[];
  metric: 'messages' | 'tokens' | 'cost';
  height?: number;
}

const FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export default function TrendChart({ data, metric, height = 240 }: TrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.4} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="ts" tickFormatter={(v) => FORMATTER.format(new Date(v))} fontSize={11} />
        <YAxis fontSize={11} />
        <Tooltip
          labelFormatter={(v) => FORMATTER.format(new Date(Number(v)))}
          formatter={(value) => [String(value), metric]}
        />
        <Area type="monotone" dataKey={metric} stroke="currentColor" fill="url(#trend-fill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
