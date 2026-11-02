import { useEffect, useState } from "react";
import { api } from "../api";

const QUOTA_POLL_MS = 60000;

/** Anlas balance, refreshed on mount, every minute, and on demand. */
export function useQuota() {
  const [quota, setQuota] = useState<Record<string, unknown> | null>(null);
  async function refreshQuota() {
    try {
      const r = await api<{ quota: Record<string, unknown> }>("quota");
      setQuota(r.quota);
    } catch {
      setQuota({ reason: "할당량을 확인하지 못했습니다." });
    }
  }
  useEffect(() => {
    void refreshQuota();
    const timer = setInterval(refreshQuota, QUOTA_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return { quota, refreshQuota };
}
