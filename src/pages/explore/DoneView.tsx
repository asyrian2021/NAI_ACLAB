import { FlaskConical, Pin, Trophy } from "lucide-react";
import type { Artist } from "../../types";
import type { ExploreActions } from "./ExplorePage";
import {
  genesToArtists,
  groupGenes,
  MODE_NAMES,
  reasonsText,
  shortTag,
  statsText,
  weightText,
} from "./lib";

/** One-page summary: each stage's winner and the final combination's confirmed success rate. */
export function DoneView({
  campaign: c,
  applyFixed,
}: ExploreActions & {
  applyFixed: (artists: Artist[], toBatting: boolean) => void;
}) {
  const final = c.genomes[c.champions.final];
  const confirm = c.champions.final
    ? c.info.stats.confirm?.[c.champions.final]
    : undefined;
  const modes = new Map(c.plan.map((p) => [p.group, p.mode]));
  const searched = c.info.stages.filter((s) => s.group);

  return (
    <div className="explore-done">
      <section className="done-final" aria-label="최종 조합">
        <h2>
          <Trophy size={18} /> 최종 조합
        </h2>
        {final ? (
          <>
            <ol className="done-genes">
              {c.group_order.map((group) => (
                <li key={group}>
                  <span
                    className="muted"
                    title={MODE_NAMES[modes.get(group) || "fixed"]}
                  >
                    {group}
                  </span>
                  {groupGenes(final, group).map((g) => (
                    <span key={g.tag} className="done-gene" title={g.tag}>
                      {shortTag(g.tag)} <strong>{weightText(g.weight)}</strong>
                    </span>
                  ))}
                </li>
              ))}
            </ol>
            <p className="candidate-rate">
              최종 확인: {statsText(confirm)}
              {reasonsText(confirm) && ` · ${reasonsText(confirm)}`}
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => applyFixed(genesToArtists(final.genes), false)}
              >
                <Pin size={15} />
                고정 조합으로 적용
              </button>
              <button
                className="outline"
                onClick={() => applyFixed(genesToArtists(final.genes), true)}
              >
                <FlaskConical size={15} />
                타율 테스트로 보내기
              </button>
            </div>
          </>
        ) : (
          <p className="micro">최종 조합이 없습니다.</p>
        )}
      </section>
      <section className="done-stages" aria-label="단계별 우승">
        <h3>단계별 우승 조합</h3>
        <ul>
          {searched.map((stage) => {
            const gid = c.champions[stage.key];
            const s = gid ? c.info.stats[stage.key]?.[gid] : undefined;
            return (
              <li key={stage.key}>
                <strong>{stage.name}</strong>
                <span>
                  {gid
                    ? groupGenes(c.genomes[gid], stage.group)
                        .map(
                          (g) => `${shortTag(g.tag)} ${weightText(g.weight)}`,
                        )
                        .join(", ")
                    : "건너뜀 · 기준 세트 유지"}
                </span>
                {s && <span className="micro">{statsText(s)}</span>}
              </li>
            );
          })}
        </ul>
        <p className="micro">
          세대 {c.generations.length}개 · 라운드 {c.rounds.length}개 · 이미지{" "}
          {c.trials.filter((t) => !t.error).length}장
        </p>
      </section>
    </div>
  );
}
