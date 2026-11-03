import { useEffect, useRef, useState } from "react";
import {
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

/** Success-rate interval as a bar: the band is the 90% interval, the tick the observed rate. */
function IntervalBar({ s }: { s?: GenomeStats }) {
  if (!s || !s.n)
    return <div className="interval-bar no-data" aria-hidden="true" />;
  return (
    <div className="interval-bar" aria-hidden="true">
      <span
        className="band"
        style={{ left: pct(s.low), width: pct(s.high - s.low) }}
      />
      <span className="tick" style={{ left: pct(s.rate) }} />
    </div>
  );
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
  const columns = r.scenes.flatMap((scene) =>
    r.seeds.map((seed, si) => ({ scene, seed, si })),
  );
  const rows = r.genome_ids;
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const [ask, setAsk] = useState<"" | "force" | "skip" | "scenes">("");
  const [chosen, setChosen] = useState("");
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const latestLabel = useRef(0);
  const latest = useRef(c);
  latest.current = c;
  const focusedCell = useRef<HTMLButtonElement>(null);

  const total =
    columns.length * rows.filter((g) => !r.eliminated.includes(g)).length;
  const pending = c.info.pending;
  const done = r.status === "done";
  const finalists = r.result.finalists || [];
  const name = (gid: string) =>
    confirmStage ? "최종 조합" : `후보 ${letters.get(gid) || "?"}`;
  const focusGid = rows[Math.min(focus.row, rows.length - 1)];
  const focusCol = columns[Math.min(focus.col, columns.length - 1)];
  const focused =
    focusCol && trials.get(cellKey(focusGid, focusCol.seed, focusCol.scene));

  // Browser focus follows the highlighted cell. Otherwise a cell (or button)
  // clicked earlier keeps its own focus ring once a key is pressed, and the
  // grid shows two cursors.
  const keyboardMove = useRef(false);
  function takeFocus() {
    const cell = focusedCell.current;
    if (cell && document.activeElement !== cell)
      cell.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (keyboardMove.current) takeFocus();
    keyboardMove.current = false;
    focusedCell.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [focus.row, focus.col]);

  function toggleLabel(trial: Trial | undefined, code: string) {
    if (!trial || trial.error || done) return;
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
      const lastRow = rows.length - 1,
        lastCol = columns.length - 1;
      if (event.key === "ArrowLeft")
        setFocus((f) => ({ ...f, col: Math.max(0, f.col - 1) }));
      else if (event.key === "ArrowRight")
        setFocus((f) => ({ ...f, col: Math.min(lastCol, f.col + 1) }));
      else if (event.key === "ArrowUp")
        setFocus((f) => ({ ...f, row: Math.max(0, f.row - 1) }));
      else if (event.key === "ArrowDown")
        setFocus((f) => ({ ...f, row: Math.min(lastRow, f.row + 1) }));
      else if (event.key === " ")
        setFocus((f) =>
          f.col < lastCol
            ? { ...f, col: f.col + 1 }
            : {
                row: Math.min(lastRow, f.row + 1),
                col: f.row < lastRow ? 0 : f.col,
              },
        );
      else {
        const code = codes.find((f) => f.key === event.key);
        if (!code) return;
        toggleLabel(focused, code.code);
      }
      event.preventDefault();
      // Same cell (edge of the grid, or a label key): the effect will not run.
      takeFocus();
      keyboardMove.current = true;
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
      setFocus({ row: 0, col: 0 });
      if (confirmStage) setMessage("최종 확인을 마쳤습니다.");
      else if (reply.round.next_round !== undefined)
        setMessage(
          `R${reply.round.next_round}을 마감했습니다. 상위 후보로 R${reply.round.next_round + 1}을 시작하세요.`,
        );
      else setMessage("마지막 라운드를 마감했습니다. 우승 조합을 고르세요.");
    });
  }
  function advance(champion: string, checked = false, skipNext = false) {
    if (!checked && needsSceneWarning(c)) {
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
    : `R${r.index + 1} / ${c.info.round_count}`;

  return (
    <div className="round">
      <div className="evolve-bar">
        <div className="evolve-status" aria-live="polite">
          <strong>{roundTitle}</strong>
          <span>
            후보 {rows.length - r.eliminated.length}개 · 장면 {r.scenes.length}
            개 × 시드 {r.seeds.length}개
          </span>
          <span className="micro">
            실패만 표시하세요. 표시하지 않은 이미지는 성공으로 셉니다.
          </span>
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
                className="primary"
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
              <span className="micro">
                {focusCol && `${focusCol.scene} · 시드 ${focusCol.si + 1}`}
              </span>
            </div>
            {focused && !focused.error ? (
              <ZoomableImage
                className="round-stage-image"
                src={focused.image_url}
                alt={`${name(focusGid)} 결과`}
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
            </div>
            <p className="micro">
              ← → ↑ ↓ 이동 · Space 다음 이미지 · 숫자 키로 라벨 토글(즉시 저장)
            </p>
          </div>
          <div className="round-grid-wrap">
            <div
              className="round-grid"
              role="grid"
              aria-label={`${roundTitle} 결과`}
              style={{
                gridTemplateColumns: `92px repeat(${columns.length}, 84px)`,
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
              {rows.map((gid, row) => {
                const out = r.eliminated.includes(gid);
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
                      const t = trials.get(cellKey(gid, col.seed, col.scene));
                      const isFocus = focus.row === row && focus.col === ci;
                      return (
                        <button
                          key={ci}
                          ref={isFocus ? focusedCell : undefined}
                          tabIndex={isFocus ? 0 : -1}
                          role="gridcell"
                          aria-selected={isFocus}
                          aria-label={`${name(gid)} · ${col.scene} · 시드 ${col.si + 1}${t?.failures.length ? " · 실패" : ""}`}
                          className={
                            "round-cell" +
                            (isFocus ? " focused" : "") +
                            (t?.failures.length ? " failed" : "") +
                            (t?.error ? " void" : "")
                          }
                          onClick={() => setFocus({ row, col: ci })}
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
          </div>
        </section>
        <aside className="round-summary" aria-label="후보별 성공률">
          <h3>후보별 성공률</h3>
          <ul>
            {stageCandidates.map((gid) => {
              const s = stats[gid];
              const inRound = rows.includes(gid);
              const out = !inRound || r.eliminated.includes(gid);
              const genome = c.genomes[gid];
              return (
                <li
                  key={gid}
                  className={
                    "candidate" +
                    (out ? " out" : "") +
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
                    {!confirmStage &&
                      !done &&
                      (out ? (
                        <button
                          className="text-button"
                          onClick={() => setGenome(gid, "revive")}
                        >
                          <RotateCcw size={13} />
                          되살리기
                        </button>
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
                  <IntervalBar s={s} />
                  {reasonsText(s) && (
                    <span className="micro">{reasonsText(s)}</span>
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
            {r.result.overlap
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
                <IntervalBar s={stats[gid]} />
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
