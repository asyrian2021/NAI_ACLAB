import { Plus, Trash2 } from "lucide-react";
import { NumericInput } from "../components/NumericInput";
import type { ShowToast } from "../hooks/useNotices";
import type { Edit } from "../lib/actions";
import { artistCount } from "../lib/helpers";
import type { AppState } from "../types";
import { ArtistTagEditor } from "./ArtistTagEditor";

export function ArtistsPage({
  state,
  edit,
  notify,
}: {
  state: AppState;
  edit: Edit;
  notify: ShowToast;
}) {
  function deleteGroup(i: number) {
    const removed = state.categories[i];
    edit((s) => s.categories.splice(i, 1));
    notify(`“${removed.name}” 그룹을 삭제했습니다.`, {
      label: "실행 취소",
      run: () =>
        edit((s) =>
          s.categories.splice(
            Math.min(i, s.categories.length),
            0,
            structuredClone(removed),
          ),
        ),
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ARTIST PALETTE</div>
          <h1>작가와 랜덤 조합</h1>
          <p>
            작가는 균등하게 추첨하고, 가중치와 태그 순서도 매번 새로 정합니다.
          </p>
        </div>
        <button
          className="outline"
          onClick={() =>
            edit((s) =>
              s.categories.push({
                name: "새 작가 그룹",
                tags: [],
                min_weight: 0.8,
                max_weight: 1.2,
                granule: 0.05,
                picks: 0,
                min_picks: 1,
                max_picks: 1,
                all_artists: true,
              }),
            )
          }
        >
          <Plus size={15} />
          그룹 추가
        </button>
      </div>
      <div className="artist-editors">
        {state.categories.map((c, i) => (
          <section className="artist-editor" key={i}>
            <div className="row spread">
              <NumericInput
                aria-label="작가 그룹 이름"
                value={c.name}
                onChange={(e) =>
                  edit((s) => (s.categories[i].name = e.target.value))
                }
              />
              <button
                aria-label="작가 그룹 삭제"
                onClick={() => deleteGroup(i)}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <ArtistTagEditor
              category={c}
              index={i}
              edit={edit}
              notify={notify}
            />
            <div className="four-fields artist-weight-fields">
              {(["min_weight", "max_weight", "granule"] as const).map(
                (key, j) => (
                  <label key={key}>
                    {["최소 가중치", "최대 가중치", "간격"][j]}
                    <NumericInput
                      type="number"
                      min={key === "granule" ? 0.001 : 0}
                      step={0.05}
                      value={c[key]}
                      onChange={(e) =>
                        edit(
                          (s) =>
                            (s.categories[i][key] = e.target.valueAsNumber),
                        )
                      }
                    />
                  </label>
                ),
              )}
            </div>
            <div className="artist-draw-settings">
              <h3>추첨 인원</h3>
              <label className="check artist-all-option">
                <input
                  type="checkbox"
                  aria-label="등록 작가 전체 사용"
                  checked={c.all_artists}
                  onChange={(e) =>
                    edit((s) => {
                      s.categories[i].all_artists = e.target.checked;
                    })
                  }
                />
                등록 작가 전체 사용
              </label>
              {!c.all_artists && (
                <>
                  <div className="two-fields">
                    {(["min_picks", "max_picks"] as const).map((key, j) => (
                      <label key={key}>
                        {j === 0 ? "최소 추첨 인원" : "최대 추첨 인원"}
                        <NumericInput
                          type="number"
                          min={1}
                          step={1}
                          value={c[key]}
                          onChange={(e) =>
                            edit((s) => {
                              s.categories[i][key] = e.target.valueAsNumber;
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="micro">
                    실제 추첨:{" "}
                    {Math.min(
                      c.min_picks,
                      artistCount(c.tags, c.disabled_tags),
                    )}
                    ~
                    {Math.min(
                      c.max_picks,
                      artistCount(c.tags, c.disabled_tags),
                    )}
                    명 · 사용 {artistCount(c.tags, c.disabled_tags)}명. 매
                    이미지마다 인원을 균등 추첨합니다.
                  </p>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
