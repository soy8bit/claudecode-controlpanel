// src/components/analytics/hooks/useAnalyticsData.ts
import { useCallback, useEffect, useState } from 'react';

const tokenFromStorage = (): string | null => {
  try { return localStorage.getItem('auth-token'); } catch { return null; }
};

export interface UseAnalyticsDataState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAnalyticsData<T>(endpoint: string, range: string, fromIso?: string, toIso?: string): UseAnalyticsDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({ range });
    if (range === 'custom' && fromIso) params.set('from', fromIso);
    if (range === 'custom' && toIso)   params.set('to', toIso);

    const token = tokenFromStorage();
    fetch(`/api/analytics/${endpoint}?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(json => { if (!cancelled) setData(json.data as T); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [endpoint, range, fromIso, toIso, tick]);

  return { data, isLoading, error, refresh };
}
