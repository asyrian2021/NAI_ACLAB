import type {
  Campaign,
  CampaignSummary,
  Gene,
  PlanEntry,
  RoundResult,
} from "./types";

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

type CampaignReply = { campaign: Campaign };

/** Search-campaign endpoints (`/api/explore/...`). */
export const exploreApi = {
  list: () => api<{ campaigns: CampaignSummary[] }>("explore"),
  get: (id: string) => api<CampaignReply>("explore/" + encodeURIComponent(id)),
  baseline: (plan: PlanEntry[], start_genes?: unknown[]) =>
    api<{ frozen: Record<string, Gene[]> }>("explore/baseline", {
      plan,
      start_genes,
    }),
  create: (body: {
    name: string;
    plan: PlanEntry[];
    preset: string;
    image_size?: string;
    frozen?: Record<string, Gene[]>;
    start_genes?: unknown[];
    params?: Record<string, unknown>;
  }) => api<CampaignReply>("explore/create", body),
  run: (id: string) =>
    api<CampaignReply & { job_id: string }>("explore/run", { id }),
  pick: (id: string, generation: number, picks: string[], force = false) =>
    api<CampaignReply>("explore/pick", { id, generation, picks, force }),
  extend: (id: string) => api<CampaignReply>("explore/extend", { id }),
  label: (id: string, trial_id: string, failures: string[]) =>
    api<CampaignReply>("explore/label", { id, trial_id, failures }),
  closeRound: (id: string, force = false) =>
    api<CampaignReply & { round: RoundResult }>("explore/close-round", {
      id,
      force,
    }),
  advance: (id: string, champion_id: string, skip_next = false) =>
    api<CampaignReply & { stage: string }>("explore/advance", {
      id,
      champion_id,
      skip_next,
    }),
  reopen: (id: string, stage: string) =>
    api<CampaignReply>("explore/reopen", { id, stage }),
  genome: (id: string, genome_id: string, action: "eliminate" | "revive") =>
    api<CampaignReply>("explore/genome", { id, genome_id, action }),
  remove: (id: string) => api<{ ok: boolean }>("explore/delete", { id }),
};
