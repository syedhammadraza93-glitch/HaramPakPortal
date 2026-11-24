import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../utils/api";

/** Loads `path` (re-loads when path or query changes). Pass null to skip. */
export function useApi<T>(path: string | null, query?: Record<string, string | number | undefined>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const key = JSON.stringify(query ?? {});
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const call = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<T>(path, JSON.parse(key));
      if (call === latest.current) setData(result);
    } catch (e) {
      if (call === latest.current) setError(errorMessage(e));
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, [path, key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
