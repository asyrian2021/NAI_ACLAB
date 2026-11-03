import { useState } from "react";
import { FlaskConical, Plus, Trash2, X } from "lucide-react";
import { NumericInput } from "../../components/NumericInput";
import { SeedStatus } from "../../components/SeedStatus";
import type { Edit } from "../../lib/actions";
import type { AppState, ExploreEntry, Job } from "../../types";
import { BattingResults } from "./BattingResults";

export function BattingPage({
  state,
  edit,
  busy,
  jobs,
  runId,
  selectRun,
  start,
  exploreFrom,
}: {
  state: AppState;
  edit: Edit;
  busy: boolean;
  jobs: Job[];
  runId: string;
  selectRun: (id: string) => void;
  /** Starts the test, asking for confirmation first when the seed is fixed. */
  start: () => void;
  exploreFrom: (entry: ExploreEntry) => void;
}) {
  const sceneTags = state.scene_tags ?? [];
  const usedPresets = new Set(state.batting_scenes.map((sc) => sc.preset));
  const freePreset = state.prompt_presets.find((p) => !usedPresets.has(p.name));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SCENE TEST</div>
          <h1>여러 장면에서 비교하기</h1>
          <p>불러온 고정 조합을 여러 프리셋에서 시험할 수 있습니다.</p>
        </div>
      </div>
      <div className="batting-layout">
        <section className="batting-settings" aria-label="타율 테스트 설정">
          <div className="batting-settings-heading">
            <div>
              <h2>테스트할 프리셋</h2>
              <p className="micro">
                프리셋마다 한 번씩 추가하고, 같은 프리셋을 다른 크기로도
                만들려면 크기를 추가하세요.
              </p>
            </div>
            <button
              className="outline"
              disabled={!freePreset}
              title={
                freePreset ? undefined : "모든 프리셋이 이미 추가되어 있습니다."
              }
              onClick={() =>
                freePreset &&
                edit((s) =>
                  s.batting_scenes.push({
                    name: "",
                    preset: freePreset.name,
                    sizes: [{ image_size: "portrait", count: 2 }],
                    tags: [],
                  }),
                )
              }
            >
              <Plus size={15} />씬 추가
            </button>
            <SceneTagManager
              tags={sceneTags}
              usage={(t) =>
                state.batting_scenes.filter((sc) => (sc.tags || []).includes(t))
                  .length
              }
              add={(t) =>
                edit((s) => {
                  s.scene_tags = [...new Set([...(s.scene_tags ?? []), t])];
                })
              }
              remove={(t) =>
                edit((s) => {
                  s.scene_tags = (s.scene_tags ?? []).filter((x) => x !== t);
                  s.batting_scenes.forEach(
                    (sc) => (sc.tags = (sc.tags || []).filter((x) => x !== t)),
                  );
                })
              }
            />
          </div>
          <div className="generation-action batting-generation">
            <button
              className="primary"
              disabled={busy || !state.batting_scenes.length}
              onClick={start}
            >
              <FlaskConical size={15} />
              타율 테스트 시작
            </button>
            <SeedStatus seed={state.api.seed} />
          </div>
          <div className="notice">
            {state.generation.fixed_artists.length
              ? `고정 조합 ${state.generation.fixed_artists.length}명 사용`
              : "랜덤 모드입니다. 동일 조합으로 비교하려면 작업실에서 이미지의 조합을 불러오세요."}
          </div>
          {state.batting_scenes.map((sc, i) => {
            const freeSize = SIZES.find(
              ([value]) => !sc.sizes.some((size) => size.image_size === value),
            );
            return (
              <section className="scene-editor" key={sc.preset || i}>
                <div className="scene-editor-head">
                  <label>
                    프롬프트 프리셋
                    <select
                      value={sc.preset}
                      onChange={(e) =>
                        edit(
                          (s) => (s.batting_scenes[i].preset = e.target.value),
                        )
                      }
                    >
                      {state.prompt_presets.map((p) => {
                        const taken =
                          p.name !== sc.preset && usedPresets.has(p.name);
                        return (
                          <option key={p.name} value={p.name} disabled={taken}>
                            {p.name}
                            {taken ? " (추가됨)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <button
                    aria-label={`${sc.preset} 씬 삭제`}
                    onClick={() => edit((s) => s.batting_scenes.splice(i, 1))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {sc.sizes.map((size, j) => (
                  <div className="scene-size" key={size.image_size + j}>
                    <label>
                      <span className={j ? "visually-hidden" : ""}>
                        이미지 크기
                      </span>
                      <select
                        value={size.image_size}
                        onChange={(e) =>
                          edit(
                            (s) =>
                              (s.batting_scenes[i].sizes[j].image_size =
                                e.target.value),
                          )
                        }
                      >
                        {!SIZES.some(
                          ([value]) => value === size.image_size,
                        ) && <option value={size.image_size}>직접 설정</option>}
                        {SIZES.map(([value, label]) => (
                          <option
                            key={value}
                            value={value}
                            disabled={sc.sizes.some(
                              (other, k) =>
                                k !== j && other.image_size === value,
                            )}
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className={j ? "visually-hidden" : ""}>매수</span>
                      <NumericInput
                        type="number"
                        min="1"
                        max="200"
                        value={size.count}
                        onChange={(e) =>
                          edit(
                            (s) =>
                              (s.batting_scenes[i].sizes[j].count =
                                e.target.valueAsNumber),
                          )
                        }
                      />
                    </label>
                    <button
                      aria-label={`${sizeName(size.image_size)} 크기 빼기`}
                      disabled={sc.sizes.length === 1}
                      onClick={() =>
                        edit((s) => s.batting_scenes[i].sizes.splice(j, 1))
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {freeSize && (
                  <button
                    className="text-button scene-add-size"
                    onClick={() =>
                      edit((s) =>
                        s.batting_scenes[i].sizes.push({
                          image_size: freeSize[0],
                          count: sc.sizes[0]?.count || 2,
                        }),
                      )
                    }
                  >
                    <Plus size={13} />
                    크기 추가
                  </button>
                )}
                <SceneTags
                  tags={sc.tags || []}
                  known={sceneTags}
                  change={(tags) =>
                    edit((s) => (s.batting_scenes[i].tags = tags))
                  }
                />
              </section>
            );
          })}
        </section>
        <BattingResults
          history={state.history}
          jobs={jobs}
          runId={runId}
          selectRun={selectRun}
          exploreFrom={exploreFrom}
        />
      </div>
    </>
  );
}

const SIZES: [string, string][] = [
  ["portrait", "세로"],
  ["landscape", "가로"],
  ["square", "정사각형"],
];
const sizeName = (value: string) =>
  SIZES.find(([v]) => v === value)?.[1] || "직접 설정";

/**
 * The shared tag list, defined once beside the scenes. A search's rate stage
 * can be limited to scenes with one tag (for example scenes where feet are
 * visible). There are no built-in tags. Removing a tag also removes it from
 * every scene.
 */
function SceneTagManager({
  tags,
  usage,
  add,
  remove,
}: {
  tags: string[];
  usage: (tag: string) => number;
  add: (tag: string) => void;
  remove: (tag: string) => void;
}) {
  const [draft, setDraft] = useState("");
  function submit() {
    const value = draft.trim().slice(0, 40);
    if (value) add(value);
    setDraft("");
  }
  return (
    <div className="scene-tag-manager" aria-label="장면 태그 목록">
      <span className="micro">장면 태그</span>
      {tags.map((t) => (
        <span
          key={t}
          className="scene-tag"
          title={`${usage(t)}개 장면에서 사용 중`}
        >
          {t}
          <button aria-label={`${t} 태그 삭제`} onClick={() => remove(t)}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        aria-label="새 장면 태그"
        placeholder={tags.length ? "태그 추가" : "예: 발 보임"}
        value={draft}
        maxLength={40}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        onBlur={submit}
      />
    </div>
  );
}

/** A scene picks its tags from the shared list. */
function SceneTags({
  tags,
  known,
  change,
}: {
  tags: string[];
  known: string[];
  change: (tags: string[]) => void;
}) {
  if (!known.length) return null;
  return (
    <div className="scene-tags" role="group" aria-label="장면 태그">
      {known.map((t) => {
        const on = tags.includes(t);
        return (
          <button
            key={t}
            className={"scene-tag" + (on ? "" : " add")}
            aria-pressed={on}
            onClick={() =>
              change(
                on
                  ? tags.filter((x) => x !== t)
                  : known.filter((x) => x === t || tags.includes(x)),
              )
            }
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
