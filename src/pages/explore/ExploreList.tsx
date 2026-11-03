import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Compass,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { exploreApi } from "../../api";
import { NumericInput } from "../../components/NumericInput";
import type { Task } from "../../lib/actions";
import { artistCount } from "../../lib/helpers";
import type {
  AppState,
  Campaign,
  CampaignSummary,
  ExploreEntry,
  Gene,
  PlanEntry,
  PlanMode,
} from "../../types";
import { GeneEditor } from "./GeneEditor";
import {
  DEFAULT_LABELS,
  FAILURE_NAMES,
  guessPlan,
  MODE_HINTS,
  MODE_NAMES,
  shortTag,
} from "./lib";

export function ExploreList({
  state,
  campaigns,
  busy,
  task,
  entry,
  clearEntry,
  open,
  start,
  loading,
}: {
  state: AppState;
  campaigns: CampaignSummary[] | null;
  busy: boolean;
  task: Task;
  entry: ExploreEntry | null;
  clearEntry: () => void;
  open: (id: string) => void;
  start: (c: Campaign) => Promise<void>;
  loading: boolean;
}) {
  const [creating, setCreating] = useState(!!entry);
  useEffect(() => {
    if (entry) setCreating(true);
  }, [entry]);

  return (
    <div className="explore explore-list-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMBINATION SEARCH</div>
          <h1>최적의 그림체 찾기</h1>
          <p>
            작가 그룹마다 화풍을 눈으로 고를지, 실패 비율로 좁힐지, 고정할지
            정합니다. 한 번에 한 그룹만 바꿉니다.
          </p>
        </div>
        {!creating && (
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />새 캠페인
          </button>
        )}
      </div>
      {creating && (
        <CreateForm
          state={state}
          entry={entry}
          busy={busy}
          task={task}
          cancel={() => {
            setCreating(false);
            clearEntry();
          }}
          created={async (c) => {
            clearEntry();
            await start(c);
          }}
        />
      )}
      {loading ? (
        <p className="micro">
          <LoaderCircle size={14} className="spin" /> 캠페인을 여는 중입니다.
        </p>
      ) : campaigns && !campaigns.length && !creating ? (
        <div className="empty">
          <Compass size={28} />
          <h1>아직 캠페인이 없습니다</h1>
          <p>
            새 캠페인을 만들거나, 작업실 이미지에서 "이 조합으로 탐색"을
            누르세요.
          </p>
        </div>
      ) : (
        <ul className="campaign-list" aria-label="캠페인 목록">
          {(campaigns || []).map((c) => (
            <li key={c.id}>
              <button onClick={() => open(c.id)}>
                <strong>{c.name}</strong>
                <span className={"badge" + (c.stage === "done" ? "" : " live")}>
                  {c.stage_name}
                  {c.progress && ` · ${c.progress}`}
                </span>
                <span className="micro">
                  이미지 {c.images}장 · 마지막 갱신 {c.updated_at}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Starting plan: the name-based guess, with groups absent from a source image switched off. */
function initialPlan(state: AppState, entry: ExploreEntry | null) {
  const plan = guessPlan(state.categories);
  if (!entry?.artists.length) return plan;
  const used = new Set(entry.artists.map((a) => a.category));
  const off = plan.map((p): PlanEntry =>
    used.has(p.group) ? p : { ...p, mode: "off" },
  );
  return off.some((p) => p.mode === "pick" || p.mode === "rate") ? off : plan;
}

/** Engine defaults that the form does not expose (see DEFAULT_PARAMS in explore.py). */
const ROUND_SEEDS = [2, 4, 8];
const RETUNE_GENERATIONS = 4;

/** Images a rate stage generates: each round keeps half the candidates and doubles the seeds per scene. */
function rateImages(candidates: number, scenes: number) {
  let total = 0,
    alive = candidates;
  for (const seeds of ROUND_SEEDS) {
    total += alive * scenes * seeds;
    const keep = Math.max(1, Math.floor(alive / 2));
    if (keep <= 1) break;
    alive = keep;
  }
  return total;
}

/** Stage names as the engine builds them, for the preview line. */
function stagePreview(plan: PlanEntry[]) {
  const searched = plan.filter((p) => p.mode === "pick" || p.mode === "rate");
  const names = searched.map(
    (p, i) =>
      `${i + 1}단계 ${p.group} ${p.mode === "pick" ? "고르기" : "타율"}`,
  );
  const firstPick = searched.findIndex((p) => p.mode === "pick");
  if (firstPick >= 0 && firstPick < searched.length - 1)
    names.push(`재조정 ${searched[firstPick].group}`);
  return [...names, "최종 확인"];
}

function CreateForm({
  state,
  entry,
  busy,
  task,
  cancel,
  created,
}: {
  state: AppState;
  entry: ExploreEntry | null;
  busy: boolean;
  task: Task;
  cancel: () => void;
  created: (c: Campaign) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<PlanEntry[]>(() =>
    initialPlan(state, entry),
  );
  const presetNames = state.prompt_presets.map((p) => p.name);
  // Nothing is preselected: the user has to choose the scene and size the
  // pick stages are judged on, so a hidden default cannot slip through.
  const [preset, setPreset] = useState("");
  const [imageSize, setImageSize] = useState("");
  const [frozen, setFrozen] = useState<Record<string, Gene[]>>({});
  const [params, setParams] = useState({
    pop_size: 6,
    seeds_per_gen: 2,
    max_generations: 12,
    round_candidates: 8,
    confirm_seeds: 4,
  });
  const [drawn, setDrawn] = useState(0);
  const used = plan.filter((p) => p.mode !== "off");
  const searched = used.filter((p) => p.mode !== "fixed");
  const sceneTags = state.scene_tags || [];
  const scenesFor = (tag?: string) =>
    new Set(
      state.batting_scenes
        .filter((s) => !tag || (s.tags || []).includes(tag))
        .map((s) => s.preset),
    ).size;
  const startFor = (group: string) =>
    (entry?.artists || []).filter((a) => a.category === group);
  const firstPick = searched[0]?.mode === "pick" ? searched[0].group : "";

  // The baseline depends only on which groups are used, how, and in what order.
  const shape = JSON.stringify(used.map((p) => [p.group, p.mode]));
  useEffect(() => {
    if (!searched.length) {
      setFrozen({});
      return;
    }
    void task(async () => {
      const r = await exploreApi.baseline(used, entry?.artists);
      setFrozen(r.frozen);
    });
  }, [shape, drawn]);

  function update(i: number, change: Partial<PlanEntry>) {
    setPlan((p) => p.map((x, j) => (j === i ? { ...x, ...change } : x)));
  }
  function move(i: number, delta: number) {
    setPlan((p) => {
      const next = [...p];
      const [item] = next.splice(i, 1);
      next.splice(i + delta, 0, item);
      return next;
    });
  }
  function setMode(i: number, mode: PlanMode) {
    const current = plan[i];
    update(i, {
      mode,
      labels:
        mode === "rate" ? current.labels || [...DEFAULT_LABELS] : undefined,
      scene_tag: mode === "rate" ? current.scene_tag || "" : undefined,
    });
  }
  function toggleLabel(i: number, code: string) {
    const labels = plan[i].labels || [];
    update(i, {
      labels: labels.includes(code)
        ? labels.filter((x) => x !== code)
        : Object.keys(FAILURE_NAMES).filter(
            (x) => x === code || labels.includes(x),
          ),
    });
  }

  // Image counts the current settings lead to, so the cost is visible before starting.
  const num = (v: number, fallback: number) =>
    Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
  const perGen = num(params.pop_size, 6) * num(params.seeds_per_gen, 2);
  const pickIndex = searched.findIndex((p) => p.mode === "pick");
  const estimates = [
    ...(pickIndex >= 0
      ? [
          `고르기: 한 세대 ${perGen}장 (조합 ${num(params.pop_size, 6)}개 × 시드 ${num(params.seeds_per_gen, 2)}개), 단계마다 최대 ${num(params.max_generations, 12)}세대`,
        ]
      : []),
    ...searched
      .filter((p) => p.mode === "rate")
      .map((p) => {
        const scenes = scenesFor(p.scene_tag);
        return `${p.group} 타율: 약 ${rateImages(num(params.round_candidates, 8), scenes)}장 (장면 ${scenes}개, 라운드 최대 3번)`;
      }),
    ...(pickIndex >= 0 && pickIndex < searched.length - 1
      ? [`재조정: 한 세대 ${perGen}장, 최대 ${RETUNE_GENERATIONS}세대`]
      : []),
    `최종 확인: ${Math.max(1, scenesFor()) * num(params.confirm_seeds, 4)}장 (장면 ${Math.max(1, scenesFor())}개 × 시드 ${num(params.confirm_seeds, 4)}개)`,
  ];

  const frozenGroups = used.filter((p) => frozen[p.group]);
  const hasPick = searched.some((p) => p.mode === "pick");
  const missing = hasPick
    ? [!preset && "프리셋", !imageSize && "이미지 크기"].filter(Boolean)
    : [];
  const valid =
    !missing.length &&
    searched.length > 0 &&
    frozenGroups.every(
      (p) =>
        frozen[p.group].length &&
        frozen[p.group].every((g) => Number.isFinite(g.weight)),
    ) &&
    searched.every((p) => p.mode !== "rate" || (p.labels || []).length > 0);

  return (
    <section className="explore-create" aria-label="새 캠페인">
      <div className="explore-create-head">
        <h2>새 캠페인</h2>
        <button aria-label="새 캠페인 닫기" onClick={cancel}>
          <X size={15} />
        </button>
      </div>
      <div className="explore-create-grid">
        <label>
          이름
          <input
            value={name}
            placeholder="예: 수채화 톤 찾기"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {hasPick && (
          <>
            <label>
              고르기 단계 프리셋
              <select
                className={preset ? "" : "needs-choice"}
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
              >
                <option value="" disabled>
                  선택하세요
                </option>
                {presetNames.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              고르기 단계 이미지 크기
              <select
                className={imageSize ? "" : "needs-choice"}
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value)}
              >
                <option value="" disabled>
                  선택하세요
                </option>
                <option value="portrait">세로</option>
                <option value="landscape">가로</option>
                <option value="square">정사각형</option>
              </select>
            </label>
          </>
        )}
      </div>

      <div className="plan-editor" aria-label="그룹별 탐색 방식">
        <div className="row plan-editor-head">
          <h3>그룹별 탐색 방식</h3>
          <span className="micro">
            위에서부터 한 그룹씩 탐색합니다. 프롬프트 순서는 작가 메뉴의 그룹
            순서를 따릅니다.
          </span>
        </div>
        {plan.map((p, i) => {
          const category = state.categories.find((c) => c.name === p.group);
          const count = category
            ? artistCount(category.tags, category.disabled_tags)
            : 0;
          return (
            <div key={p.group} className={"plan-row mode-" + p.mode}>
              <div className="plan-order">
                <button
                  aria-label={`${p.group} 위로`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  aria-label={`${p.group} 아래로`}
                  disabled={i === plan.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={13} />
                </button>
              </div>
              <div className="plan-group">
                <strong>{p.group}</strong>
                <span className="micro">작가 {count}명</span>
              </div>
              <select
                className="plan-mode"
                aria-label={`${p.group} 탐색 방식`}
                value={p.mode}
                onChange={(e) => setMode(i, e.target.value as PlanMode)}
              >
                {(Object.keys(MODE_NAMES) as PlanMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_NAMES[m]}
                  </option>
                ))}
              </select>
              <span className="micro plan-hint">{MODE_HINTS[p.mode]}</span>
              {p.mode === "rate" && (
                <div className="plan-rate">
                  <div
                    className="plan-labels"
                    role="group"
                    aria-label={`${p.group} 실패 라벨`}
                  >
                    {Object.entries(FAILURE_NAMES).map(([code, f]) => {
                      const on = (p.labels || []).includes(code);
                      return (
                        <button
                          key={code}
                          className={"scene-tag" + (on ? "" : " add")}
                          aria-pressed={on}
                          onClick={() => toggleLabel(i, code)}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                  <select
                    aria-label={`${p.group} 검증 장면`}
                    value={p.scene_tag || ""}
                    onChange={(e) => update(i, { scene_tag: e.target.value })}
                  >
                    <option value="">모든 장면 ({scenesFor()}개)</option>
                    {[...new Set([...sceneTags, p.scene_tag || ""])]
                      .filter(Boolean)
                      .map((tag) => (
                        <option key={tag} value={tag}>
                          '{tag}' 태그 장면 ({scenesFor(tag)}개)
                        </option>
                      ))}
                  </select>
                  {scenesFor(p.scene_tag) < 2 && (
                    <span className="micro error-text">
                      검증 장면이 {scenesFor(p.scene_tag)}개입니다. 타율 테스트
                      메뉴에서 장면이나 태그를 추가하세요.
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <p className="micro plan-preview">
          {searched.length
            ? stagePreview(plan).join(" → ")
            : "고르기 또는 타율로 탐색할 그룹을 하나 이상 고르세요."}
        </p>
      </div>

      {firstPick && startFor(firstPick).length > 0 && (
        <p className="micro">
          시작 조합 ({firstPick}):{" "}
          {startFor(firstPick)
            .map((a) => `${shortTag(a.tag)} ${a.weight}`)
            .join(", ")}
        </p>
      )}
      {frozenGroups.length > 0 && (
        <div className="explore-baseline">
          <div className="row">
            <h3>기준 세트</h3>
            <span className="micro">
              다른 그룹을 탐색하는 동안 쓰는 작가입니다. 고정 그룹은 끝까지
              유지됩니다.
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setDrawn((v) => v + 1)}
            >
              <RefreshCw size={13} />
              다시 추첨
            </button>
          </div>
          {frozenGroups.map((p) => (
            <div key={p.group} className="explore-baseline-group">
              <strong>
                {p.group} <span className="muted">· {MODE_NAMES[p.mode]}</span>
              </strong>
              <GeneEditor
                label={p.group}
                category={state.categories.find((c) => c.name === p.group)}
                genes={frozen[p.group] || []}
                onChange={(genes) =>
                  setFrozen((f) => ({ ...f, [p.group]: genes }))
                }
              />
            </div>
          ))}
        </div>
      )}
      <details className="explore-params">
        <summary>세부 설정</summary>
        <div className="explore-create-grid">
          {(
            [
              [
                "pop_size",
                "세대당 조합 수",
                2,
                8,
                "한 번에 나란히 비교할 조합 수입니다. 많을수록 다양하지만 고르기 어렵습니다.",
              ],
              [
                "seeds_per_gen",
                "세대당 공통 시드",
                1,
                4,
                "조합마다 같은 시드로 몇 장씩 만들지 정합니다. 많을수록 운의 영향이 줄어듭니다.",
              ],
              [
                "max_generations",
                "고르기 최대 세대",
                2,
                30,
                "고르기 단계마다 만들 수 있는 세대 수의 상한입니다. 보통 그 전에 수렴합니다.",
              ],
              [
                "round_candidates",
                "타율 후보 수",
                2,
                12,
                "타율 단계 첫 라운드의 후보 수입니다. 라운드마다 절반만 남습니다.",
              ],
              [
                "confirm_seeds",
                "최종 확인 시드",
                1,
                12,
                "최종 조합을 장면마다 몇 장씩 확인할지 정합니다.",
              ],
            ] as const
          ).map(([key, label, min, max, hint]) => (
            <label key={key} className="param-field">
              {label}
              <NumericInput
                type="number"
                min={min}
                max={max}
                value={params[key]}
                onChange={(e) =>
                  setParams((p) => ({ ...p, [key]: e.target.valueAsNumber }))
                }
              />
              <span className="micro">
                {hint} ({min}~{max})
              </span>
            </label>
          ))}
        </div>
        <ul className="param-estimate micro" aria-label="예상 생성 장수">
          {estimates.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <div className="row explore-create-actions">
        <button
          className="primary"
          disabled={busy || !valid}
          onClick={() =>
            void task(async () => {
              const clean = Object.fromEntries(
                Object.entries(params).map(([k, v]) => [
                  k,
                  Number.isFinite(v) ? Math.round(v) : undefined,
                ]),
              );
              const r = await exploreApi.create({
                name,
                plan: used,
                preset: hasPick ? preset : "",
                image_size: hasPick ? imageSize : "",
                frozen,
                start_genes: entry?.artists,
                params: clean,
              });
              await created(r.campaign);
            })
          }
        >
          <Play size={15} />
          시작하고 첫 단계 생성
        </button>
        {missing.length > 0 && (
          <span className="micro error-text" role="status">
            {missing.length === 2
              ? "고르기 단계의 프리셋과 이미지 크기를 선택하세요."
              : missing[0] === "프리셋"
                ? "고르기 단계의 프리셋을 선택하세요."
                : "고르기 단계의 이미지 크기를 선택하세요."}
          </span>
        )}
      </div>
    </section>
  );
}
