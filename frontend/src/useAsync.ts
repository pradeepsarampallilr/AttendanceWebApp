import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const silent = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!silent.current) setLoading(true);
    silent.current = false;
    setError(null);
    fn().then(
      (d) => !cancelled && (setData(d), setLoading(false)),
      (e: Error) => !cancelled && (setError(e.message), setLoading(false)),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const refresh = useCallback(() => {
    silent.current = true;
    setTick((t) => t + 1);
  }, []);
  return { data, error, loading, reload, refresh };
}
