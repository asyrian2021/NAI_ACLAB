declare global {
  interface Window {
    __NAI_ACLAB_TOKEN__?: string;
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": window.__NAI_ACLAB_TOKEN__ || "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response
    .json()
    .catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload as T;
}
