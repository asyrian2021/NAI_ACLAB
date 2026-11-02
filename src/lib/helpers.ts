import type { AppState, Job } from "../types";

export const imageSizes: Record<string, [number, number]> = {
  portrait: [832, 1216],
  landscape: [1216, 832],
  square: [1024, 1024],
};

export const jobStatusNames: Record<string, string> = {
  queued: "대기",
  running: "생성 중",
  cancelling: "중지 중",
  cancelled: "중지됨",
  done: "완료",
  failed: "오류",
};

export const isActiveJob = (j: Job) =>
  ["queued", "running", "cancelling"].includes(j.status);

export const historyLabel = (h: AppState["history"][number]) =>
  h.preset ||
  [h.base_preset, h.character_preset].filter(Boolean).join(" · ") ||
  "생성 기록";

/**
 * Mirrors the engine's `parse_artist_tags` for one chunk: strips a leading
 * `1.2::` weight and trailing `::`, and returns "" when there is no `artist:`.
 */
export function parseArtistTag(raw: string) {
  const item = raw.trim().replace(/^[+-]?\d+(?:\.\d+)?\s*::\s*/, "");
  const start = item.toLowerCase().indexOf("artist:");
  if (start < 0) return "";
  return item
    .slice(start)
    .trim()
    .replace(/\s*::\s*$/, "")
    .trim();
}

/** Splits pasted text the way the engine does (commas and line breaks). */
export function splitArtistText(text: string) {
  return text
    .split(/[,\r\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Number of distinct artists the engine will draw from (disabled ones excluded). */
export function artistCount(tags: string[], disabled: string[] = []) {
  const off = new Set(disabled.map(parseArtistTag));
  return new Set(
    splitArtistText(tags.join("\n"))
      .map(parseArtistTag)
      .filter((t) => t && !off.has(t)),
  ).size;
}

/** False when any numeric field in the draft is NaN/Infinity (an emptied input). */
export function finiteDraft(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object")
    return Object.values(value).every(finiteDraft);
  return true;
}
