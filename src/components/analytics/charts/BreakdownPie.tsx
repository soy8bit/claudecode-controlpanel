// src/components/analytics/charts/BreakdownPie.tsx
import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

interface Slice { name: string; value: number }
interface Props { data: Slice[]; height?: number }

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7'];

export default function BreakdownPie({ data, height = 220 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={80} label={(d: any) => d.name}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
      </PieChart>
    </ResponsiveContainer>
  );
}
