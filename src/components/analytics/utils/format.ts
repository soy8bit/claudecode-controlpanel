// src/components/analytics/utils/format.ts
export const fmtInt = (n: number) => n.toLocaleString('en-US');

export const fmtTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
