import { useEffect, useState } from "react";
import {
  Archive,
  Flag,
  LoaderCircle,
  Play,
  Sparkles,
  ThumbsDown,
  Undo2,
} from "lucide-react";
import { exploreApi } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { AppState, Campaign, Gene } from "../../types";
import type { ExploreActions } from "./ExplorePage";
import { ExploreViewer } from "./ExploreViewer";
import { needsSceneWarning, SceneWarningDialog } from "./SceneWarning";
import {
  bracket,
  cellKey,
  currentGeneration,
  diffGenes,
  ignoreKey,
  originName,
  groupGenes,
  shortTag,
  stagePrefix,
  trialMap,
  weightText,
} from "./lib";

const SIZE_NAMES: Record<string, string> = {
  portrait: "세로",
  landscape: "가로",
  square: "정사각형",
};

/** Artists of the moving group, with what changed against the parent highlighted. */
export function GeneChanges({
  parent,
  genes,
}: {
  parent?: Gene[];
  genes: Gene[];
}) {
  const { rows, dropped } = diffGenes(parent, genes);
  return (
    <ul className="gene-changes">
      {rows.map((g) => (
        <li key={g.tag} className={"change-" + g.kind} title={g.tag}>
          <span className="gene-tag">{shortTag(g.tag)}</span>
          <span className="gene-weight">
            {g.kind === "weight" && (
              <>
                <s>{weightText(g.before!)}</s> →{" "}
              </>
            )}
            {weightText(g.weight)}
          </span>
        </li>
      ))}
      {dropped.map((g) => (
        <li
          key={"-" + g.tag}
          className="change-dropped"
          title={g.tag + " 제거됨"}
        >
          <span className="gene-tag">{shortTag(g.tag)}</span>
          <span className="gene-weight">제거</span>
        </li>
      ))}
    </ul>
  );
}

/** Genomes picked at least once in this stage, newest first. */
function archived(c: Campaign) {
  const seen = new Set<string>();
  return c.generations
    .filter((g) => g.stage === c.stage)
    .flatMap((g) => g.picks)
    .reverse()
    .filter((id) => !seen.has(id) && !!seen.add(id));
}

export function EvolveView({
  campaign: c,
  setCampaign,
  run,
  task,
  busy,
  running,
  setMessage,
}: ExploreActions & { state: AppState }) {
  const gen = currentGeneration(c)!;
  const group = c.info.stage.group!;
  const trials = trialMap(c, c.stage, gen.index);
  // Outcome of each bracket match (undefined = still open, null = all bad).
  const [winners, setWinners] = useState<(string | null | undefined)[]>([]);
  const [seedRow, setSeedRow] = useState(0);
  const [viewer, setViewer] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [askForce, setAskForce] = useState<string[] | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [warnChampion, setWarnChampion] = useState<string | null>(null);
  const columnsKey = gen.genome_ids.join(",");
  useEffect(() => {
    setWinners([]);
    setSeedRow(0);
  }, [gen.index, columnsKey]);

  const done = gen.status === "done";
  const total = gen.seeds.length * gen.genome_ids.length;
  const pending = c.info.pending;
  const untouched = pending === total && !running;
  const limit = c.info.generation_limit;
  const limitReached = done && gen.index + 1 >= limit;
  const stageLabel = stagePrefix(c.info.stage);
  const { matches, open, picks } = bracket(gen.genome_ids, winners);
  const match = open >= 0 ? matches[open] : undefined;
  const row = Math.min(seedRow, gen.seeds.length - 1);

  function decide(id: string | null) {
    if (done || busy || open < 0) return;
    const next = [...winners];
    next[open] = id;
    setWinners(next);
    const result = bracket(gen.genome_ids, next).picks;
    if (result) submit(result);
  }
  function undo() {
    if (done || busy) return;
    let last = winners.length - 1;
    while (last >= 0 && winners[last] === undefined) last--;
    if (last >= 0) setWinners(winners.slice(0, last));
  }
  function submit(chosen: string[], force = false) {
    if (pending && !force) {
      setAskForce(chosen);
      return;
    }
    void task(async () => {
      const r = await exploreApi.pick(c.id, gen.index, chosen, force);
      setCampaign(r.campaign);
      const next = currentGeneration(r.campaign);
      if (!next || next.index === gen.index) {
        setFinishing(true);
        return;
      }
      await run();
    });
  }
  function extend() {
    void task(async () => {
      const r = await exploreApi.extend(c.id);
      setCampaign(r.campaign);
      await run();
    });
  }
  function advance(id: string, skipNext: boolean) {
    void task(async () => {
      const r = await exploreApi.advance(c.id, id, skipNext);
      setCampaign(r.campaign);
      setMessage(`${stageLabel} 완료 · 다음: ${r.campaign.info.stage_name}`);
    });
  }
  function startRun() {
    void task(run);
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (ignoreKey(event)) return;
      const n = Number(event.key);
      if (match && /^[1-3]$/.test(event.key) && n <= match.columns.length)
        decide(gen.genome_ids[match.columns[n - 1]]);
      else if (match && event.key === "0") decide(null);
      else if (event.key === "Backspace") undo();
      else if (event.key === "ArrowUp") setSeedRow(Math.max(0, row - 1));
      else if (event.key === "ArrowDown")
        setSeedRow(Math.min(gen.seeds.length - 1, row + 1));
      else if (event.key === "Enter" && !busy && untouched && !done) startRun();
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  const parentGenes = (i: number) => {
    const parent = gen.parents[i]?.[0];
    return parent && c.genomes[parent]
      ? groupGenes(c.genomes[parent], group)
      : undefined;
  };
  // The viewer walks the columns of the open match (or the saved picks).
  const shown = match
    ? match.columns
    : gen.picks.map((id) => gen.genome_ids.indexOf(id)).filter((i) => i >= 0);
  const cellAt = (r: number, i: number) => {
    const col = shown[i];
    const gid = gen.genome_ids[col];
    const t = trials.get(cellKey(gid, gen.seeds[r], c.preset));
    return {
      url: t?.image_url || "",
      error: t?.error,
      caption: `${i + 1}번 · 시드 ${r + 1} (${gen.seeds[r]})`,
    };
  };
  const saved = archived(c);
  const lastWinner = saved[0] || "";
  const finalPicks = done ? gen.picks : picks || [];

  return (
    <div className="evolve">
      <div className="evolve-bar">
        <div className="evolve-status" aria-live="polite">
          <strong>
            라운드 {gen.index + 1} / {Math.max(limit, gen.index + 1)}
          </strong>
          {c.info.streak > 0 && <span>같은 1등 {c.info.streak}회 연속</span>}
          {c.info.converging && (
            <span className="badge">
              <Sparkles size={12} /> 수렴 모드
            </span>
          )}
          <span className="micro">
            조합 {gen.genome_ids.length}개 · {c.preset}
            {SIZE_NAMES[c.image_size] && ` · ${SIZE_NAMES[c.image_size]}`}
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
                className={untouched ? "primary" : "outline"}
                disabled={busy}
                onClick={startRun}
              >
                <Play size={15} />
                {untouched ? `${total}장 생성` : `남은 ${pending}장 생성`}
              </button>
            )
          )}
          <button
            className={
              c.info.suggest_finish ? "primary finish-suggested" : "outline"
            }
            disabled={busy || (!saved.length && !c.frozen[group]?.length)}
            onClick={() => setFinishing(true)}
          >
            <Flag size={15} />
            {stageLabel} 완료
          </button>
        </div>
      </div>
      {!done && (
        <ol className="bracket-steps" aria-label="이번 라운드 비교 순서">
          {matches.map((m, i) => {
            const w = winners[i];
            return (
              <li
                key={m.key}
                className={
                  i === open ? "current" : w !== undefined ? "decided" : ""
                }
                aria-current={i === open ? "step" : undefined}
              >
                {m.name}
                {w !== undefined && (
                  <span className="micro">
                    {" "}
                    · {w ? `${gen.genome_ids.indexOf(w) + 1}번` : "모두 별로"}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="micro evolve-help">
        {done ? (
          "이번 라운드의 선택이 저장되었습니다."
        ) : (
          <>
            <kbd>1</kbd>~<kbd>{Math.max(2, match?.columns.length || 2)}</kbd>{" "}
            또는 클릭으로 하나 고르기 · <kbd>0</kbd> 모두 별로 ·{" "}
            <kbd>Backspace</kbd> 되돌리기
            {gen.seeds.length > 1 && (
              <>
                {" "}
                · <kbd>↑</kbd> <kbd>↓</kbd> 시드 바꾸기
              </>
            )}{" "}
            · 더블클릭 확대
          </>
        )}
      </p>
      {limitReached && (
        <div className="notice row" role="status">
          <span>
            {limit}라운드를 마쳤습니다. 우승 조합으로 {stageLabel}를 마치거나 한
            라운드 더 고르세요.
          </span>
          <button className="outline" disabled={busy} onClick={extend}>
            한 라운드 더
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => setFinishing(true)}
          >
            <Flag size={15} /> {stageLabel} 완료
          </button>
        </div>
      )}
      {gen.seeds.length > 1 && (
        <div className="seed-tabs" role="tablist" aria-label="시드">
          {gen.seeds.map((seed, i) => (
            <button
              key={seed}
              role="tab"
              aria-selected={i === row}
              className={i === row ? "primary" : "outline"}
              onClick={() => setSeedRow(i)}
            >
              시드 {i + 1}
            </button>
          ))}
        </div>
      )}
      {match && match.columns.length > 0 ? (
        <div
          className="match"
          style={{
            gridTemplateColumns: `repeat(${match.columns.length}, minmax(0, 1fr))`,
          }}
          role="group"
          aria-label={`${gen.index + 1}라운드 ${match.name}`}
        >
          {match.columns.map((col, i) => {
            const gid = gen.genome_ids[col];
            const genome = c.genomes[gid];
            const t = trials.get(cellKey(gid, gen.seeds[row], c.preset));
            return (
              <div key={gid} className="match-card">
                <button
                  className="evolve-cell match-image"
                  aria-label={`${i + 1}번 고르기`}
                  disabled={busy}
                  onClick={() => decide(gid)}
                  onDoubleClick={() => setViewer({ row, col: i })}
                >
                  {t && !t.error ? (
                    <img src={t.image_url} alt="" draggable={false} />
                  ) : t?.error ? (
                    <span className="cell-empty error-text">오류</span>
                  ) : (
                    <span
                      className={"cell-empty" + (running ? " waiting" : "")}
                    >
                      {running ? "생성 대기" : "미생성"}
                    </span>
                  )}
                </button>
                <div className="match-info">
                  <span className="row">
                    <kbd>{i + 1}</kbd>
                    <span
                      className={
                        "origin origin-" +
                        (gen.origins[col] || "").replace(/^mut_.*/, "mutate")
                      }
                    >
                      {originName(gen.origins[col] || genome.origin)}
                    </span>
                  </span>
                  <GeneChanges
                    parent={parentGenes(col)}
                    genes={groupGenes(genome, group)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="match match-result" role="status">
          {finalPicks.length ? (
            finalPicks.map((gid, i) => {
              const col = gen.genome_ids.indexOf(gid);
              const t = trials.get(cellKey(gid, gen.seeds[row], c.preset));
              return (
                <div key={gid} className="match-card picked">
                  <div
                    className="evolve-cell match-image"
                    onDoubleClick={() => setViewer({ row, col: i })}
                  >
                    {t && !t.error && (
                      <img src={t.image_url} alt="" draggable={false} />
                    )}
                  </div>
                  <div className="match-info">
                    <span className="row">
                      <span className="rank-badge">
                        {i === 0 ? "1등" : "2등"}
                      </span>
                    </span>
                    <GeneChanges
                      parent={parentGenes(col)}
                      genes={groupGenes(c.genomes[gid], group)}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <span className="badge">
              <ThumbsDown size={12} /> 모두 별로
            </span>
          )}
        </div>
      )}
      {!done && match && (
        <div className="evolve-footer">
          <button
            className="outline"
            disabled={busy || !winners.some((w) => w !== undefined)}
            onClick={undo}
          >
            <Undo2 size={15} /> 되돌리기
          </button>
          <button
            className="outline"
            disabled={busy}
            onClick={() => decide(null)}
          >
            <ThumbsDown size={15} /> 모두 별로
          </button>
        </div>
      )}
      {saved.length > 0 && (
        <details className="evolve-archive">
          <summary>
            <Archive size={14} /> 보관함 · 한 번이라도 고른 조합 {saved.length}
            개
          </summary>
          <ul>
            {saved.map((gid) => (
              <li key={gid}>
                <GeneChanges genes={groupGenes(c.genomes[gid], group)} />
                <button
                  className="text-button"
                  disabled={busy || done || gen.genome_ids.includes(gid)}
                  onClick={() =>
                    void task(async () =>
                      setCampaign(
                        (await exploreApi.genome(c.id, gid, "revive")).campaign,
                      ),
                    )
                  }
                >
                  {gen.genome_ids.includes(gid)
                    ? "이번 라운드에 있음"
                    : "이번 라운드에 다시 넣기"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {viewer && shown.length > 0 && (
        <ExploreViewer
          title={`${gen.index + 1}라운드 · 이미지 확대`}
          row={viewer.row}
          col={Math.min(viewer.col, shown.length - 1)}
          rows={gen.seeds.length}
          cols={shown.length}
          cell={cellAt}
          move={(r, col) => {
            setViewer({ row: r, col });
            setSeedRow(r);
          }}
          close={() => setViewer(null)}
          extraKeys={(event) => {
            const n = Number(event.key);
            if (!match || !/^[1-3]$/.test(event.key) || n > shown.length)
              return false;
            setViewer(null);
            decide(gen.genome_ids[shown[n - 1]]);
            return true;
          }}
          footer={<strong>{viewer.col + 1}번</strong>}
        />
      )}
      {askForce && (
        <ConfirmDialog
          title="있는 것만으로 진행할까요?"
          confirmLabel="있는 것만으로 진행"
          cancel={() => {
            setAskForce(null);
            undo();
          }}
          confirm={() => {
            const chosen = askForce;
            setAskForce(null);
            submit(chosen, true);
          }}
        >
          아직 {pending}장이 생성되지 않았습니다. 진행하면 남은 생성은 중지되고
          지금 보이는 이미지로 선택을 저장합니다.
        </ConfirmDialog>
      )}
      {finishing && (
        <FinishDialog
          c={c}
          group={group}
          options={[...new Set([...finalPicks, ...saved])]}
          initial={finalPicks[0] || lastWinner}
          close={() => setFinishing(false)}
          finish={(id) => {
            setFinishing(false);
            if (needsSceneWarning(c)) setWarnChampion(id);
            else advance(id, false);
          }}
        />
      )}
      {warnChampion !== null && (
        <SceneWarningDialog
          c={c}
          cancel={() => setWarnChampion(null)}
          proceed={(skipNext) => {
            const id = warnChampion;
            setWarnChampion(null);
            advance(id, skipNext);
          }}
        />
      )}
    </div>
  );
}

function FinishDialog({
  c,
  group,
  options,
  initial,
  close,
  finish,
}: {
  c: Campaign;
  group: string;
  options: string[];
  initial: string;
  close: () => void;
  finish: (id: string) => void;
}) {
  const [choice, setChoice] = useState(initial || options[0] || "");
  // A group that already holds a set (a later pick stage, or the retune) may keep it.
  const canKeep = !!c.frozen[group]?.length;
  const stage = c.info.stage;
  return (
    <ConfirmDialog
      title={`${stage.name} · 단계를 마칠까요?`}
      confirmLabel={choice ? "이 조합으로 확정" : "기존 조합으로 넘어가기"}
      cancel={close}
      confirm={() => finish(choice)}
      className="explore-finish"
    >
      <p>우승 조합의 {group} 작가를 고정하고 다음 단계로 넘어갑니다.</p>
      <div className="finish-options" role="radiogroup" aria-label="우승 조합">
        {options.map((gid) => (
          <label
            key={gid}
            className={"finish-option" + (choice === gid ? " chosen" : "")}
          >
            <input
              type="radio"
              name="champion"
              checked={choice === gid}
              onChange={() => setChoice(gid)}
            />
            <GeneChanges genes={groupGenes(c.genomes[gid], group)} />
          </label>
        ))}
        {canKeep && (
          <label className={"finish-option" + (!choice ? " chosen" : "")}>
            <input
              type="radio"
              name="champion"
              checked={!choice}
              onChange={() => setChoice("")}
            />
            기존 {group} 조합 그대로 두기
          </label>
        )}
      </div>
    </ConfirmDialog>
  );
}
