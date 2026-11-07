import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  Play,
  RotateCcw,
  SkipForward,
  Trophy,
  X,
} from "lucide-react";
import { exploreApi } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ZoomableImage } from "../../components/ZoomSurface";
import type { AppState, GenomeStats, Trial } from "../../types";
import { GeneChanges } from "./EvolveView";
import type { ExploreActions } from "./ExplorePage";
import { needsSceneWarning, SceneWarningDialog } from "./SceneWarning";
import {
  candidateLetters,
  cellKey,
  currentRound,
  failureCodes,
  ignoreKey,
  pct,
  reasonsText,
  FAILURE_NAMES,
  groupGenes,
  statsText,
  trialMap,
} from "./lib";

/** Success-rate interval as a bar: the band is the 90% interval, the tick the observed rate, the line the pass rate. */
function IntervalBar({ s, pass }: { s?: GenomeStats; pass?: number }) {
  const line = pass !== undefined && (
    <span className="pass-line" style={{ left: pct(pass) }} />
  );
  if (!s || !s.n)
    return (
      <div className="interval-bar no-data" aria-hidden="true">
        {line}
      </div>
    );
  return (
    <div className="interval-bar" aria-hidden="true">
      <span
        className="band"
        style={{ left: pct(s.low), width: pct(s.high - s.low) }}
      />
      <span className="tick" style={{ left: pct(s.rate) }} />
      {line}
    </div>
  );
}

type Cell = { gid: string; scene: string; seed: number; si: number };

/** Images marked as looked at, kept per round so a reload resumes where it was. */
function useReviewed(storageKey: string) {
  const [reviewed, setReviewed] = useState<Set<string>>(() => read());
  function read() {
    try {
      return new Set<string>(
        JSON.parse(localStorage.getItem(storageKey) || "[]"),
      );
    } catch {
      return new Set<string>();
    }
  }
  useEffect(() => setReviewed(read()), [storageKey]);
  function mark(key: string) {
    setReviewed((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev).add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* Storage full or blocked: the session still remembers. */
      }
      return next;
    });
  }
  return [reviewed, mark] as const;
}

export function RoundView({
  campaign: c,
  setCampaign,
  run,
  task,
  busy,
  running,
  setMessage,
}: ExploreActions & { state: AppState }) {
  const r = currentRound(c)!;
  const stage = c.stage;
  const group = c.info.stage.group;
  const confirmStage = stage === "confirm";
  const letters = candidateLetters(c, stage);
  const trials = trialMap(c, stage, r.index);
  const stats = c.info.stats[stage] || {};
  const codes = failureCodes(c.info.stage);
  const passRate = c.info.pass_rate ?? 0.7;
  const level = (r.level ?? -1) >= 0 ? r.level! : r.index;
  const attempt = r.attempt || 0;
  const columns = r.scenes.flatMap((scene) =>
    r.seeds.map((seed, si) => ({ scene, seed, si })),
  );
  const rows = r.genome_ids;
  const [ask, setAsk] = useState<"" | "force" | "skip" | "scenes" | "early">(
    "",
  );
  const [chosen, setChosen] = useState("");
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const latestLabel = useRef(0);
  const latest = useRef(c);
  latest.current = c;
  const [reviewed, markReviewed] = useReviewed(
    `explore-reviewed:${c.id}:${stage}:${r.index}`,
  );

  const total =
    columns.length * rows.filter((g) => !r.eliminated.includes(g)).length;
  const pending = c.info.pending;
  const done = r.status === "done";
  const finalists = r.result.finalists || [];
  const name = (gid: string) =>
    confirmStage ? "최종 조합" : `후보 ${letters.get(gid) || "?"}`;

  /** Even if every image still to come succeeds, this candidate stays under the pass rate. */
  function doomed(gid: string) {
    if (confirmStage) return false;
    // Counted from the trials, so a label just set counts before the server replies.
    const mine = c.trials.filter(
      (t) => t.stage === stage && t.genome_id === gid && !t.error,
    );
    const s = {
      s: mine.filter((t) => !t.failures.length).length,
      n: mine.length,
    };
    const missing = columns.filter((col) => {
      const t = trials.get(cellKey(gid, col.seed, col.scene));
      return !t || !!t.error;
    }).length;
    const n = s.n + missing;
    return n > 0 && (s.s + missing) / n < passRate - 1e-9;
  }
  const cells: Cell[] = useMemo(
    () => rows.flatMap((gid) => columns.map((col) => ({ gid, ...col }))),
    [rows.join(","), columns.map((x) => x.scene + x.seed).join(",")],
  );
  const inQueue = (cell: Cell) =>
    !r.eliminated.includes(cell.gid) && !doomed(cell.gid);
  const queue = cells.filter(inQueue);
  const keyOf = (cell: Cell) => cellKey(cell.gid, cell.seed, cell.scene);
  const [current, setCurrent] = useState("");
  // A dropped candidate's image opened from the full grid stays shown.
  const [peek, setPeek] = useState("");
  const position = cells.findIndex((cell) => keyOf(cell) === current);
  // Open at the first image not looked at; when the shown candidate drops out,
  // move on to the very next image still in play (never past one).
  const focusCell =
    position < 0
      ? (queue.find((cell) => !reviewed.has(keyOf(cell))) ??
        queue.at(-1) ??
        cells[0])
      : inQueue(cells[position]) || current === peek
        ? cells[position]
        : (cells.slice(position).find(inQueue) ??
          cells.slice(0, position).reverse().find(inQueue) ??
          cells[position]);
  const focusKey = focusCell ? keyOf(focusCell) : "";
  const focused = focusCell ? trials.get(focusKey) : undefined;
  const focusGid = focusCell?.gid;
  const focusOut = !!focusCell && !inQueue(focusCell);
  function show(key: string, keep = false) {
    setCurrent(key);
    setPeek(keep ? key : "");
  }
  const checked = queue.filter((cell) => reviewed.has(keyOf(cell))).length;
  const allChecked = queue.length > 0 && checked === queue.length && !pending;
  const skipped = rows.filter(
    (gid) => !r.eliminated.includes(gid) && doomed(gid),
  );

  /** ← →: the previous / next image in order; moving on marks this one as seen. */
  function step(delta: 1 | -1) {
    if (!focusCell) return;
    if (delta === 1) markReviewed(focusKey);
    const at = cells.indexOf(focusCell);
    const list =
      delta === 1 ? cells.slice(at + 1) : cells.slice(0, at).reverse();
    const next = list.find(inQueue);
    if (next) show(keyOf(next));
  }

  /** ↑ ↓: the same scene and seed of the previous / next candidate still in play. */
  function stepCandidate(delta: 1 | -1) {
    if (!focusCell) return;
    const at = rows.indexOf(focusCell.gid);
    const list = delta === 1 ? rows.slice(at + 1) : rows.slice(0, at).reverse();
    const gid = list.find((g) => !r.eliminated.includes(g) && !doomed(g));
    if (gid) show(cellKey(gid, focusCell.seed, focusCell.scene));
  }

  function toggleLabel(trial: Trial | undefined, code: string) {
    if (!trial || trial.error || done) return;
    const key = cellKey(trial.genome_id, trial.seed, trial.scene);
    markReviewed(key);
    // A label set while looking at a dropped candidate keeps that image shown.
    show(key, key === peek);
    const failures = trial.failures.includes(code)
      ? trial.failures.filter((f) => f !== code)
      : [...trial.failures, code];
    // Show the change at once; requests go one at a time and only the newest reply is applied.
    setCampaign({
      ...latest.current,
      trials: latest.current.trials.map((t) =>
        t.id === trial.id ? { ...t, failures } : t,
      ),
    });
    const n = ++latestLabel.current;
    const operation = saving.current
      .catch(() => {})
      .then(() => exploreApi.label(c.id, trial.id, failures))
      .then((reply) => {
        if (n === latestLabel.current) setCampaign(reply.campaign);
      });
    saving.current = operation;
    void task(() => operation);
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (ignoreKey(event)) return;
      if (
        event.key === "ArrowRight" ||
        event.key === " " ||
        event.key === "Enter"
      )
        step(1);
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowDown") stepCandidate(1);
      else if (event.key === "ArrowUp") stepCandidate(-1);
      else {
        const code = codes.find((f) => f.key === event.key);
        if (!code) return;
        toggleLabel(focused, code.code);
      }
      event.preventDefault();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  function closeRound(force = false) {
    if (pending && !force) {
      setAsk("force");
      return;
    }
    void task(async () => {
      await saving.current;
      const reply = await exploreApi.closeRound(c.id, force);
      setCampaign(reply.campaign);
      setCurrent("");
      const res = reply.round;
      if (confirmStage) setMessage("최종 확인을 마쳤습니다.");
      else if (res.retry !== undefined)
        setMessage(
          `통과 기준 ${pct(passRate)}을 넘은 후보가 없습니다(최고 ${pct(res.best_rate || 0)}). 가장 나았던 후보의 변형과 새 조합으로 R1을 다시 시작합니다.`,
        );
      else if (res.next_round !== undefined)
        setMessage(
          `R${res.next_round}을 마감했습니다. ${pct(passRate)} 이상인 후보로 R${res.next_round + 1}을 시작하세요.`,
        );
      else setMessage("마지막 라운드를 마감했습니다. 우승 조합을 고르세요.");
    });
  }
  function advance(champion: string, checkedScenes = false, skipNext = false) {
    if (!checkedScenes && needsSceneWarning(c)) {
      setChosen(champion);
      setAsk("scenes");
      return;
    }
    void task(async () => {
      const reply = await exploreApi.advance(c.id, champion, skipNext);
      setCampaign(reply.campaign);
      setMessage(`다음 단계: ${reply.campaign.info.stage_name}`);
    });
  }
  function setGenome(gid: string, action: "eliminate" | "revive") {
    void task(async () =>
      setCampaign((await exploreApi.genome(c.id, gid, action)).campaign),
    );
  }

  const stageCandidates = [...letters.keys()];
  const roundTitle = confirmStage
    ? "최종 확인"
    : `R${level + 1} / ${c.info.round_count}` +
      (attempt ? ` · 재도전 ${attempt}회차` : "");
  const candidateCells = focusGid
    ? queue.filter((cell) => cell.gid === focusGid)
    : [];
  const candidateIndex = focusCell ? candidateCells.indexOf(focusCell) : -1;

  return (
    <div className="round">
      <div className="evolve-bar">
        <div className="evolve-status" aria-live="polite">
          <strong>{roundTitle}</strong>
          <span>
            후보 {rows.length - r.eliminated.length}개 · 장면 {r.scenes.length}
            개 × 시드 {r.seeds.length}개
          </span>
          {!confirmStage && (
            <span className="badge">통과 기준 {pct(passRate)}</span>
          )}
        </div>
        <div className="row">
          {running ? (
            <span className="micro">
              <LoaderCircle size={14} className="spin" /> 생성 중{" "}
              {total - pending}/{total}
            </span>
          ) : (
            pending > 0 &&
            !done && (
              <button
                className={pending === total ? "primary" : "outline"}
                disabled={busy}
                onClick={() => void task(run)}
              >
                <Play size={15} />
                {pending === total
                  ? `${total}장 생성`
                  : `남은 ${pending}장 생성`}
              </button>
            )
          )}
          {!done && (
            <>
              <button
                className="outline"
                disabled={busy || !pending}
                onClick={() => closeRound(true)}
              >
                있는 것만으로 진행
              </button>
              <button
                className={"primary" + (allChecked ? " finish-suggested" : "")}
                disabled={busy || !!pending}
                onClick={() => closeRound()}
              >
                {confirmStage ? "확인 완료" : "라운드 마감"}
              </button>
            </>
          )}
          <button
            className="outline"
            disabled={busy}
            onClick={() => setAsk("skip")}
          >
            <SkipForward size={15} />
            건너뛰기
          </button>
        </div>
      </div>
      <div className="round-layout">
        <section className="round-stage" aria-label="선택한 이미지">
          <div className="round-focus">
            <div className="round-stage-head">
              <strong>{focusGid && name(focusGid)}</strong>
              {focusOut && focusGid && (
                <span className="badge danger">
                  {r.eliminated.includes(focusGid)
                    ? "탈락한 후보"
                    : "기준 미달 후보"}
                </span>
              )}
              <span className="micro">
                {focusCell &&
                  `${focusCell.scene} · 시드 ${focusCell.si + 1}` +
                    (candidateIndex >= 0
                      ? ` · 이 후보 ${candidateIndex + 1}/${candidateCells.length}`
                      : "")}
              </span>
              <span className="micro review-progress" role="status">
                확인 {checked}/{queue.length}
                {skipped.length > 0 &&
                  ` · 기준 미달로 건너뜀: ${skipped.map(name).join(", ")}`}
              </span>
            </div>
            {allChecked && !done && (
              <div className="notice" role="status">
                <Check size={14} /> 남은 이미지를 모두 확인했습니다. 라운드를
                마감하세요.
              </div>
            )}
            {focused && !focused.error ? (
              <ZoomableImage
                className="round-stage-image"
                src={focused.image_url}
                alt={`${focusGid ? name(focusGid) : ""} 결과`}
              />
            ) : (
              <div className="round-stage-image">
                <div className="sweep-viewer-empty" role="status">
                  {focused?.error
                    ? `생성하지 못했습니다. ${focused.error}`
                    : running
                      ? "생성 대기 중"
                      : "아직 생성되지 않았습니다."}
                </div>
              </div>
            )}
            <div className="label-buttons" role="group" aria-label="실패 라벨">
              <button
                className="outline"
                aria-label="이전 이미지"
                disabled={!focusCell}
                onClick={() => step(-1)}
              >
                <ArrowLeft size={15} />
              </button>
              {codes.map((f) => (
                <button
                  key={f.code}
                  className={
                    "label-toggle" +
                    (focused?.failures.includes(f.code) ? " on" : "")
                  }
                  aria-pressed={!!focused?.failures.includes(f.code)}
                  disabled={!focused || !!focused.error || done}
                  onClick={() => toggleLabel(focused, f.code)}
                >
                  <kbd>{f.key}</kbd>
                  {f.label}
                </button>
              ))}
              <button
                className="primary"
                disabled={!focusCell}
                onClick={() => step(1)}
              >
                {focused?.failures.length ? "다음" : "괜찮음 · 다음"}
                <ArrowRight size={15} />
              </button>
            </div>
            <p className="micro">
              한 장씩 봅니다. 실패만 숫자 키로 표시하고 <kbd>Space</kbd>·
              <kbd>→</kbd>로 넘기세요(표시하지 않은 이미지는 성공). <kbd>←</kbd>{" "}
              이전 · <kbd>↑</kbd>
              <kbd>↓</kbd> 같은 장면의 다른 후보. 남은 이미지가 다 성공해도{" "}
              {pct(passRate)}에 못 미치는 후보는 자동으로 건너뜁니다.
            </p>
          </div>
          <details className="round-grid-wrap">
            <summary>전체 이미지 보기 ({total}장)</summary>
            <div
              className="round-grid"
              role="grid"
              aria-label={`${roundTitle} 결과`}
              style={{
                // The whole grid fits at once: columns share the panel width
                // but stay short enough that every row fits in ~60% of the window
                // (never below the old 84px thumbnails; past that the panel scrolls).
                gridTemplateColumns: `92px repeat(${columns.length}, max(84px, min(calc((100% - ${92 + 4 * columns.length}px) / ${columns.length}), calc(${(60 / Math.max(1, rows.length)).toFixed(2)}vh * 832 / 1216))))`,
              }}
            >
              <div role="presentation" />
              {r.scenes.map((scene) => (
                <div
                  key={scene}
                  className="round-scene-head"
                  style={{ gridColumn: `span ${r.seeds.length}` }}
                  title={scene}
                >
                  {scene}
                </div>
              ))}
              {rows.map((gid) => {
                const out = r.eliminated.includes(gid) || doomed(gid);
                return (
                  <div
                    className={"round-row" + (out ? " out" : "")}
                    role="row"
                    key={gid}
                  >
                    <div className="round-row-label" role="rowheader">
                      {name(gid)}
                    </div>
                    {columns.map((col, ci) => {
                      const key = cellKey(gid, col.seed, col.scene);
                      const t = trials.get(key);
                      const isFocus = key === focusKey;
                      return (
                        <button
                          key={ci}
                          tabIndex={-1}
                          role="gridcell"
                          aria-selected={isFocus}
                          aria-label={`${name(gid)} · ${col.scene} · 시드 ${col.si + 1}${t?.failures.length ? " · 실패" : ""}`}
                          className={
                            "round-cell" +
                            (isFocus ? " focused" : "") +
                            (t?.failures.length ? " failed" : "") +
                            (t?.error ? " void" : "")
                          }
                          // A click only moves the highlight; it keeps no keyboard focus that
                          // would stay outlined once the arrow keys move on.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => show(key, out)}
                        >
                          {t && !t.error ? (
                            <img
                              src={t.image_url}
                              alt=""
                              draggable={false}
                              loading="lazy"
                            />
                          ) : (
                            <span>{t?.error ? "오류" : ""}</span>
                          )}
                          {!!t?.failures.length && (
                            <span className="fail-tags">
                              {t.failures
                                .map((code) => FAILURE_NAMES[code]?.short)
                                .join("·")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </details>
        </section>
        <aside className="round-summary" aria-label="후보별 성공률">
          <h3>후보별 성공률</h3>
          <ul>
            {stageCandidates.map((gid) => {
              const s = stats[gid];
              const inRound = rows.includes(gid);
              const out = !inRound || r.eliminated.includes(gid);
              const below = inRound && !out && doomed(gid);
              const genome = c.genomes[gid];
              return (
                <li
                  key={gid}
                  className={
                    "candidate" +
                    (out ? " out" : "") +
                    (below ? " below" : "") +
                    (finalists.includes(gid) ? " finalist" : "")
                  }
                >
                  <div className="row candidate-head">
                    <strong>{name(gid)}</strong>
                    {genome.origin === "seed" &&
                      gid ===
                        c.rounds.find((x) => x.stage === stage)
                          ?.genome_ids[0] &&
                      !confirmStage && <span className="badge">기준</span>}
                    {below && <span className="badge danger">기준 미달</span>}
                    {!confirmStage &&
                      !done &&
                      (out ? (
                        inRound && (
                          <button
                            className="text-button"
                            onClick={() => setGenome(gid, "revive")}
                          >
                            <RotateCcw size={13} />
                            되살리기
                          </button>
                        )
                      ) : (
                        <button
                          className="text-button"
                          aria-label={`${name(gid)} 탈락`}
                          onClick={() => setGenome(gid, "eliminate")}
                        >
                          <X size={13} />
                          탈락
                        </button>
                      ))}
                  </div>
                  <span className="candidate-rate">{statsText(s)}</span>
                  <IntervalBar
                    s={s}
                    pass={confirmStage ? undefined : passRate}
                  />
                  {reasonsText(s) && (
                    <span className="micro">{reasonsText(s)}</span>
                  )}
                  {!confirmStage && !done && !out && (
                    <button
                      className="text-button candidate-confirm"
                      aria-label={`${name(gid)}로 바로 확정`}
                      disabled={busy}
                      onClick={() => {
                        setChosen(gid);
                        setAsk("early");
                      }}
                    >
                      <Trophy size={13} />
                      바로 확정
                    </button>
                  )}
                  {!out && (
                    <details>
                      <summary>작가 · 장면별</summary>
                      {group && (
                        <GeneChanges genes={groupGenes(genome, group)} />
                      )}
                      {confirmStage && (
                        <ul className="gene-changes">
                          {genome.genes.map((g) => (
                            <li key={g.tag}>
                              <span className="gene-tag">
                                {g.tag.replace(/^artist:/, "")}
                              </span>
                              <span className="gene-weight">
                                {g.weight.toFixed(2)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <ul className="scene-rates">
                        {Object.entries(s?.scenes || {}).map(([scene, v]) => (
                          <li key={scene}>
                            {scene}: {v.s}/{v.n} · {pct(v.s / Math.max(1, v.n))}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
      {done && finalists.length > 0 && !confirmStage && (
        <section className="round-final" aria-label="우승 조합 고르기">
          <h2>
            <Trophy size={18} /> 우승 조합 고르기
          </h2>
          <p className="micro">
            {finalists.length < 2
              ? `${pct(passRate)} 기준을 끝까지 통과한 후보입니다.`
              : r.result.overlap
                ? "두 후보의 90% 구간이 겹쳐 통계적으로 구분되지 않습니다. 취향으로 고르세요."
                : "구간이 겹치지 않아 상위 후보를 추천합니다."}
          </p>
          <div className="round-final-options">
            {finalists.map((gid) => (
              <div
                key={gid}
                className={
                  "finish-option" +
                  (r.result.recommended === gid ? " chosen" : "")
                }
              >
                <strong>
                  {name(gid)}{" "}
                  {r.result.recommended === gid && (
                    <span className="badge">추천</span>
                  )}
                </strong>
                <span>{statsText(stats[gid])}</span>
                <IntervalBar s={stats[gid]} pass={passRate} />
                {group && (
                  <GeneChanges genes={groupGenes(c.genomes[gid], group)} />
                )}
                <button
                  className={
                    r.result.recommended === gid ? "primary" : "outline"
                  }
                  disabled={busy}
                  onClick={() => advance(gid)}
                >
                  이 조합으로 확정
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {ask === "force" && (
        <ConfirmDialog
          title="있는 것만으로 진행할까요?"
          confirmLabel="있는 것만으로 진행"
          cancel={() => setAsk("")}
          confirm={() => {
            setAsk("");
            closeRound(true);
          }}
        >
          아직 {pending}장이 생성되지 않았습니다. 진행하면 남은 생성은 중지되고
          지금까지의 결과로 탈락을 계산합니다.
        </ConfirmDialog>
      )}
      {ask === "skip" && (
        <ConfirmDialog
          title={
            confirmStage ? "최종 확인을 건너뛸까요?" : "이 단계를 건너뛸까요?"
          }
          confirmLabel="건너뛰기"
          cancel={() => setAsk("")}
          confirm={() => {
            setAsk("");
            advance("");
          }}
        >
          {confirmStage
            ? "확인 없이 최종 조합으로 마칩니다."
            : "이 그룹은 기준 세트를 그대로 유지하고 다음 단계로 넘어갑니다."}
        </ConfirmDialog>
      )}
      {ask === "early" && (
        <ConfirmDialog
          title={`${name(chosen)}로 확정할까요?`}
          confirmLabel="이 후보로 확정"
          cancel={() => setAsk("")}
          confirm={() => {
            setAsk("");
            advance(chosen);
          }}
        >
          지금까지 결과: {statsText(stats[chosen])}.{" "}
          {level + 1 < c.info.round_count
            ? "남은 라운드를 건너뛰고 "
            : "라운드를 마감하지 않고 "}
          이 후보를 우승 조합으로 정한 뒤 다음 단계로 넘어갑니다.
          {running && " 진행 중인 생성은 중지됩니다."} 나중에 이 단계로 돌아오면
          지금 라운드부터 이어서 할 수 있습니다.
        </ConfirmDialog>
      )}
      {ask === "scenes" && (
        <SceneWarningDialog
          c={c}
          cancel={() => setAsk("")}
          proceed={(skipNext) => {
            setAsk("");
            advance(chosen, true, skipNext);
          }}
        />
      )}
    </div>
  );
}
