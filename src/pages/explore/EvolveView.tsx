import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  Flag,
  LoaderCircle,
  Play,
  Sparkles,
  ThumbsDown,
} from "lucide-react";
import { exploreApi } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { AppState, Campaign, Gene } from "../../types";
import type { ExploreActions } from "./ExplorePage";
import { ExploreViewer } from "./ExploreViewer";
import { needsSceneWarning, SceneWarningDialog } from "./SceneWarning";
import {
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
  const [picks, setPicks] = useState<string[]>(gen.picks);
  const [noneChosen, setNoneChosen] = useState(false);
  const [viewer, setViewer] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [askForce, setAskForce] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [warnChampion, setWarnChampion] = useState<string | null>(null);
  useEffect(() => {
    setPicks(gen.picks);
    setNoneChosen(false);
  }, [gen.index]);

  const done = gen.status === "done";
  const total = gen.seeds.length * gen.genome_ids.length;
  const pending = c.info.pending;
  const untouched = pending === total && !running;
  const limitReached = done && gen.index + 1 >= c.info.generation_limit;
  const stageLabel = stagePrefix(c.info.stage);

  function toggle(id: string) {
    if (done) return;
    setNoneChosen(false);
    setPicks((p) =>
      p.includes(id)
        ? p.filter((x) => x !== id)
        : p.length >= 2
          ? [p[0], id]
          : [...p, id],
    );
  }
  function submit(force = false) {
    if (done) return;
    if (!picks.length && !noneChosen) {
      setMessage(
        "마음에 드는 조합을 고르거나 0을 눌러 모두 별로로 표시하세요.",
      );
      return;
    }
    if (pending && !force) {
      setAskForce(true);
      return;
    }
    void task(async () => {
      const r = await exploreApi.pick(c.id, gen.index, picks, force);
      setCampaign(r.campaign);
      const next = currentGeneration(r.campaign);
      if (!next || next.index === gen.index) {
        setMessage(`최대 세대에 도달했습니다. ${stageLabel} 완료를 누르세요.`);
        return;
      }
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
      if (/^[1-9]$/.test(event.key) && n <= gen.genome_ids.length)
        toggle(gen.genome_ids[n - 1]);
      else if (event.key === "0" && !done) {
        setPicks([]);
        setNoneChosen(true);
      } else if (event.key === "Enter" && !busy) {
        if (untouched && !done) startRun();
        else submit();
      } else return;
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
  const cellAt = (row: number, col: number) => {
    const gid = gen.genome_ids[col];
    const t = trials.get(cellKey(gid, gen.seeds[row], c.preset));
    return {
      url: t?.image_url || "",
      error: t?.error,
      caption: `${col + 1}번 조합 · 시드 ${row + 1} (${gen.seeds[row]})`,
    };
  };
  const saved = archived(c);
  const lastWinner = saved[0] || "";

  return (
    <div className="evolve">
      <div className="evolve-bar">
        <div className="evolve-status" aria-live="polite">
          <strong>{gen.index}세대</strong>
          <span>같은 1등 {c.info.streak}회 연속</span>
          {c.info.converging && (
            <span className="badge">
              <Sparkles size={12} /> 수렴 모드
            </span>
          )}
          <span className="micro">
            최대 {c.info.generation_limit}세대 · {c.preset}
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
            disabled={
              busy ||
              (!saved.length && !picks.length && !c.frozen[group]?.length)
            }
            onClick={() => setFinishing(true)}
          >
            <Flag size={15} />
            {stageLabel} 완료
          </button>
        </div>
      </div>
      <p className="micro evolve-help">
        <kbd>1</kbd>~<kbd>{gen.genome_ids.length}</kbd> 또는 열 클릭으로 선택(첫
        번째 1등, 두 번째 2등) · <kbd>0</kbd> 모두 별로 · <kbd>Enter</kbd>{" "}
        저장하고 다음 세대 · 더블클릭 확대
      </p>
      {limitReached && (
        <div className="notice" role="status">
          최대 세대에 도달했습니다. {stageLabel} 완료를 눌러 우승 조합을
          확정하세요.
        </div>
      )}
      <div
        className="evolve-grid"
        style={{
          gridTemplateColumns: `56px repeat(${gen.genome_ids.length}, minmax(0, 1fr))`,
        }}
        role="grid"
        aria-label={`${gen.index}세대 비교`}
      >
        <div role="presentation" />
        {gen.genome_ids.map((gid, i) => {
          const rank = picks.indexOf(gid);
          const genome = c.genomes[gid];
          return (
            <button
              key={gid}
              className={"evolve-head" + (rank >= 0 ? " picked" : "")}
              aria-pressed={rank >= 0}
              aria-label={`${i + 1}번 조합 ${rank === 0 ? "1등" : rank === 1 ? "2등" : ""}`.trim()}
              onClick={() => toggle(gid)}
            >
              <span className="row">
                <kbd>{i + 1}</kbd>
                <span
                  className={
                    "origin origin-" +
                    (gen.origins[i] || "").replace(/^mut_.*/, "mutate")
                  }
                >
                  {originName(gen.origins[i] || genome.origin)}
                </span>
                {rank >= 0 && (
                  <span className="rank-badge">
                    {rank === 0 ? "1등" : "2등"}
                  </span>
                )}
              </span>
              <GeneChanges
                parent={parentGenes(i)}
                genes={groupGenes(genome, group)}
              />
            </button>
          );
        })}
        {gen.seeds.map((seed, row) => (
          <Row key={seed} label={`시드 ${row + 1}`}>
            {gen.genome_ids.map((gid, col) => {
              const t = trials.get(cellKey(gid, seed, c.preset));
              return (
                <button
                  key={gid}
                  role="gridcell"
                  className={
                    "evolve-cell" +
                    (picks.includes(gid) ? " picked" : "") +
                    (noneChosen ? " dimmed" : "")
                  }
                  aria-label={`${col + 1}번 조합 · 시드 ${row + 1}`}
                  onClick={() => toggle(gid)}
                  onDoubleClick={() => setViewer({ row, col })}
                >
                  {t && !t.error ? (
                    <img
                      src={t.image_url}
                      alt=""
                      draggable={false}
                      loading="lazy"
                    />
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
              );
            })}
          </Row>
        ))}
      </div>
      <div className="evolve-footer">
        {noneChosen ? (
          <span className="badge">
            <ThumbsDown size={12} /> 모두 별로
          </span>
        ) : (
          <span className="micro">
            {done ? "저장된 선택" : "선택"}:{" "}
            {picks.length
              ? picks
                  .map((p) => `${gen.genome_ids.indexOf(p) + 1}번`)
                  .join(" > ")
              : "없음"}
          </span>
        )}
        {!done && (
          <button
            className="primary"
            disabled={busy || (!picks.length && !noneChosen)}
            onClick={() => submit()}
          >
            선택 저장 · 다음 세대
          </button>
        )}
      </div>
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
                    ? "이번 세대에 있음"
                    : "이번 세대에 다시 넣기"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {viewer && (
        <ExploreViewer
          title={`${gen.index}세대 · 이미지 확대`}
          row={viewer.row}
          col={viewer.col}
          rows={gen.seeds.length}
          cols={gen.genome_ids.length}
          cell={cellAt}
          move={(row, col) => setViewer({ row, col })}
          close={() => setViewer(null)}
          extraKeys={(event) => {
            const n = Number(event.key);
            if (!/^[1-9]$/.test(event.key) || n > gen.genome_ids.length)
              return false;
            toggle(gen.genome_ids[n - 1]);
            return true;
          }}
          footer={(() => {
            const gid = gen.genome_ids[viewer.col];
            const rank = picks.indexOf(gid);
            return (
              <>
                <strong>{viewer.col + 1}번 조합</strong>
                {rank >= 0 && (
                  <span className="rank-badge">
                    {rank === 0 ? "1등" : "2등"}
                  </span>
                )}
              </>
            );
          })()}
        />
      )}
      {askForce && (
        <ConfirmDialog
          title="있는 것만으로 진행할까요?"
          confirmLabel="있는 것만으로 진행"
          cancel={() => setAskForce(false)}
          confirm={() => {
            setAskForce(false);
            submit(true);
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
          options={[...new Set([...picks, ...saved])]}
          initial={picks[0] || lastWinner}
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="evolve-row-label" role="rowheader">
        {label}
      </div>
      {children}
    </>
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
