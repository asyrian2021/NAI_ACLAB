import type {
  Artist,
  Campaign,
  Category,
  Gene,
  Generation,
  Genome,
  GenomeStats,
  PlanEntry,
  PlanMode,
  Round,
  StageInfo,
  Trial,
} from "../../types";
import { parseArtistTag } from "../../lib/helpers";

export const MODE_NAMES: Record<PlanMode, string> = {
  pick: "화풍 고르기",
  rate: "타율 검증",
  fixed: "고정",
  off: "사용 안 함",
};
export const MODE_HINTS: Record<PlanMode, string> = {
  pick: "같은 시드로 나란히 놓고 마음에 드는 조합을 고릅니다.",
  rate: "후보를 여러 장면에서 생성하고 실패 비율로 좁힙니다.",
  fixed: "한 번 정한 작가로 탐색 내내 고정합니다.",
  off: "탐색 이미지의 프롬프트에 넣지 않습니다.",
};

export const ORIGIN_NAMES: Record<string, string> = {
  seed: "시작",
  elite: "엘리트",
  crossover: "교차",
  random: "랜덤",
  revived: "보관",
  final: "최종",
};
export const originName = (origin: string) =>
  ORIGIN_NAMES[origin] || (origin.startsWith("mut_") ? "변이" : origin);

/** Failure labels a rate group can use; shortcut keys follow each stage's own label order. */
export const FAILURE_NAMES: Record<string, { label: string; short: string }> = {
  anatomy: { label: "신체 붕괴", short: "신체" },
  hands: { label: "손 붕괴", short: "손" },
  feet: { label: "발 붕괴", short: "발" },
  prompt: { label: "프롬프트 불일치", short: "프롬" },
  style: { label: "화풍 덮어씀", short: "화풍" },
  background: { label: "배경 붕괴", short: "배경" },
};
export const DEFAULT_LABELS = ["anatomy", "prompt", "style"];

export function failureCodes(stage: StageInfo) {
  return stage.labels.map((code, i) => ({
    code,
    key: String(i + 1),
    ...(FAILURE_NAMES[code] || { label: code, short: code }),
  }));
}

/** "1단계 · 메인 작가 고르기" → "1단계". */
export const stagePrefix = (stage: StageInfo) => stage.name.split(" · ")[0];

export const shortTag = (tag: string) => tag.replace(/^artist:/i, "");
export const weightText = (w: number) => w.toFixed(2);
export const pct = (v: number) => Math.round(v * 100) + "%";

export function statsText(s: GenomeStats | undefined) {
  if (!s || !s.n) return "아직 결과 없음";
  return `성공 ${s.s}/${s.n} · ${pct(s.rate)} (${pct(s.low).replace("%", "")}–${pct(s.high)})`;
}
export function reasonsText(s: GenomeStats | undefined) {
  if (!s) return "";
  return Object.entries(s.reasons)
    .filter(([, n]) => n > 0)
    .map(([code, n]) => `${FAILURE_NAMES[code]?.short || code} ${n}`)
    .join(" · ");
}

export function groupGenes(genome: Genome | undefined, group: string | null) {
  return genome && group ? genome.genes.filter((g) => g.group === group) : [];
}

export function genesToArtists(genes: Gene[]): Artist[] {
  return genes.map((g) => ({
    category: g.group,
    tag: g.tag,
    weight: g.weight,
    prompt: `${Number(g.weight.toFixed(3))}::${g.tag} ::`,
  }));
}

export type GeneChange = {
  tag: string;
  weight: number;
  /** "same" | "new" | "weight" (weight changed) | "moved" (position changed). */
  kind: "same" | "new" | "weight" | "moved";
  before?: number;
};

/** What a child changed against its parent: added tags, weight moves, order and dropped tags. */
export function diffGenes(parent: Gene[] | undefined, genes: Gene[]) {
  if (!parent)
    return {
      rows: genes.map((g) => ({ ...g, kind: "same" as const })),
      dropped: [],
    };
  const before = new Map(parent.map((g, i) => [g.tag, { w: g.weight, i }]));
  const shared = genes.filter((g) => before.has(g.tag)).map((g) => g.tag);
  const parentShared = parent
    .filter((g) => shared.includes(g.tag))
    .map((g) => g.tag);
  const rows: GeneChange[] = genes.map((g) => {
    const old = before.get(g.tag);
    if (!old) return { tag: g.tag, weight: g.weight, kind: "new" };
    if (Math.abs(old.w - g.weight) > 1e-9)
      return { tag: g.tag, weight: g.weight, kind: "weight", before: old.w };
    if (shared.indexOf(g.tag) !== parentShared.indexOf(g.tag))
      return { tag: g.tag, weight: g.weight, kind: "moved" };
    return { tag: g.tag, weight: g.weight, kind: "same" };
  });
  const tags = new Set(genes.map((g) => g.tag));
  return { rows, dropped: parent.filter((g) => !tags.has(g.tag)) };
}

export const cellKey = (genome: string, seed: number, scene: string) =>
  `${genome}|${seed}|${scene}`;

/** The newest image per (genome, seed, scene) of one batch; a success wins over a void attempt. */
export function trialMap(c: Campaign, stage: string, batch: number) {
  const map = new Map<string, Trial>();
  for (const t of c.trials) {
    if (t.stage !== stage || t.batch !== batch) continue;
    const key = cellKey(t.genome_id, t.seed, t.scene);
    const had = map.get(key);
    if (!had || had.error || !t.error) map.set(key, t);
  }
  return map;
}

export function currentGeneration(c: Campaign): Generation | undefined {
  return c.generations.filter((g) => g.stage === c.stage).at(-1);
}
export function currentRound(c: Campaign): Round | undefined {
  return c.rounds.filter((r) => r.stage === c.stage).at(-1);
}

/** Enabled artists of a category, as the engine draws them. */
export function categoryPool(category: Category | undefined) {
  if (!category) return [];
  const off = new Set((category.disabled_tags || []).map(parseArtistTag));
  return [
    ...new Set(
      category.tags.map(parseArtistTag).filter((t) => t && !off.has(t)),
    ),
  ];
}
export function weightGrid(category: Category | undefined) {
  if (!category) return [1];
  const out: number[] = [];
  const steps = Math.floor(
    (category.max_weight - category.min_weight) / category.granule + 1e-9,
  );
  for (let i = 0; i <= Math.max(0, steps); i++)
    out.push(Number((category.min_weight + i * category.granule).toFixed(3)));
  return out;
}

/**
 * A first guess at each group's mode from its name; the user changes it in the
 * form. Groups keep the artist menu's order as the starting search order.
 * Rate groups start on all scenes: scene tags are the user's own.
 */
export function guessPlan(categories: Category[]): PlanEntry[] {
  const stabilizer = /신체|안정|손|발|해부|body|anatomy|hand|feet|foot/i;
  const feet = /발|feet|foot/i;
  let picked = false;
  return categories.map((c): PlanEntry => {
    if (stabilizer.test(c.name))
      return feet.test(c.name)
        ? {
            group: c.name,
            mode: "rate",
            labels: [...DEFAULT_LABELS, "feet"],
            scene_tag: "",
          }
        : {
            group: c.name,
            mode: "rate",
            labels: [...DEFAULT_LABELS],
            scene_tag: "",
          };
    if (!picked) {
      picked = true;
      return { group: c.name, mode: "pick" };
    }
    return { group: c.name, mode: "fixed" };
  });
}

/** Candidate letters follow the R1 order so a combination keeps its name across rounds. */
export function candidateLetters(c: Campaign, stage: string) {
  const first = c.rounds.find((r) => r.stage === stage);
  const names = new Map<string, string>();
  (first?.genome_ids || []).forEach((id, i) =>
    names.set(id, String.fromCharCode(65 + (i % 26))),
  );
  c.rounds
    .filter((r) => r.stage === stage)
    .flatMap((r) => r.genome_ids)
    .forEach((id) => {
      if (!names.has(id)) names.set(id, String.fromCharCode(65 + names.size));
    });
  return names;
}

/** Keyboard shortcuts should not fire while typing or while a dialog is open. */
export function ignoreKey(event: KeyboardEvent) {
  return (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.defaultPrevented ||
    !!(event.target as HTMLElement | null)?.closest?.(
      "input,textarea,select,[contenteditable]",
    ) ||
    !!document.querySelector('[aria-modal="true"], dialog[open]')
  );
}
