import { useRef } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
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
  // Stable React keys per group, so a moved group keeps its editor's draft text.
  const keys = useRef<number[]>([]);
  const nextKey = useRef(0);
  while (keys.current.length < state.categories.length)
    keys.current.push(nextKey.current++);
  keys.current.length = state.categories.length;
  const page = useRef<HTMLDivElement>(null);

  function deleteGroup(i: number) {
    const removed = state.categories[i];
    keys.current.splice(i, 1);
    edit((s) => s.categories.splice(i, 1));
    notify(`“${removed.name}” 그룹을 삭제했습니다.`, {
      label: "실행 취소",
      run: () => {
        keys.current.splice(i, 0, nextKey.current++);
        edit((s) =>
          s.categories.splice(
            Math.min(i, s.categories.length),
            0,
            structuredClone(removed),
          ),
        );
      },
    });
  }
  function moveGroup(i: number, step: -1 | 1) {
    const j = i + step;
    if (j < 0 || j >= state.categories.length) return;
    const k = keys.current;
    [k[i], k[j]] = [k[j], k[i]];
    edit((s) => {
      [s.categories[i], s.categories[j]] = [s.categories[j], s.categories[i]];
    });
    // Keep the focus on the same button of the moved group (or the other one at an edge).
    requestAnimationFrame(() => {
      const editors = page.current?.querySelectorAll(".artist-editor");
      const buttons = editors?.[j]?.querySelectorAll<HTMLButtonElement>(
        ".artist-order button",
      );
      const same = buttons?.[step < 0 ? 0 : 1];
      (same && !same.disabled ? same : buttons?.[step < 0 ? 1 : 0])?.focus();
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
            그룹 순서는 화살표로 바꿀 수 있고, 탐색 메뉴의 작가 순서가 이 순서를
            따릅니다.
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
      <div className="artist-editors" ref={page}>
        {state.categories.map((c, i) => (
          <section className="artist-editor" key={keys.current[i]}>
            <div className="row spread">
              <span className="artist-order-number" aria-hidden="true">
                {i + 1}
              </span>
              <NumericInput
                aria-label="작가 그룹 이름"
                value={c.name}
                onChange={(e) =>
                  edit((s) => (s.categories[i].name = e.target.value))
                }
              />
              <div className="artist-order">
                <button
                  aria-label={`${c.name} 그룹 앞으로`}
                  title="앞으로"
                  disabled={i === 0}
                  onClick={() => moveGroup(i, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  aria-label={`${c.name} 그룹 뒤로`}
                  title="뒤로"
                  disabled={i === state.categories.length - 1}
                  onClick={() => moveGroup(i, 1)}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
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
