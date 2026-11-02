import { useRef, useState, type CSSProperties } from "react";
import { ChevronRight, GripVertical, Shuffle, Sparkles } from "lucide-react";
import { ApiField } from "../../components/ApiField";
import { useFlip } from "../../hooks/useFlip";
import { NumericInput } from "../../components/NumericInput";
import { SeedStatus } from "../../components/SeedStatus";
import type { Edit, Tab, Task } from "../../lib/actions";
import { artistCount, imageSizes } from "../../lib/helpers";
import type { AppState } from "../../types";

/** Left studio panel: preset, size, guidance and artist setup for the next run. */
export function GenerationPanel({
  state,
  edit,
  busy,
  task,
  runGenerate,
  burst,
  previewPrompt,
  setTab,
  openPresetEditor,
}: {
  state: AppState;
  edit: Edit;
  busy: boolean;
  task: Task;
  /** Queues a generation (also bound to Ctrl+Enter). */
  runGenerate: () => void;
  /** Increments on every generate request; replays the sparkle burst. */
  burst: number;
  previewPrompt: () => Promise<void>;
  setTab: (tab: Tab) => void;
  openPresetEditor: () => void;
}) {
  return (
    <aside className="left-panel">
      <section>
        <h2>다음 이미지 만들기</h2>
        <label>
          프롬프트 프리셋
          <select
            value={state.generation.preset}
            onChange={(e) =>
              edit((s) => (s.generation.preset = e.target.value))
            }
          >
            <option value="">프리셋 선택</option>
            {state.prompt_presets.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <button className="text-button" onClick={openPresetEditor}>
          프롬프트 편집 <ChevronRight size={13} />
        </button>
      </section>
      <section>
        <div className="two-fields">
          <label>
            이미지 크기
            <select
              value={state.generation.image_size}
              onChange={(e) =>
                edit((s) => {
                  s.generation.image_size = e.target.value;
                  if (imageSizes[e.target.value])
                    [s.api.width, s.api.height] = imageSizes[e.target.value];
                })
              }
            >
              <option value="portrait">세로</option>
              <option value="landscape">가로</option>
              <option value="square">정사각형</option>
              <option value="custom">직접 설정</option>
            </select>
          </label>
          <label>
            생성 매수
            <NumericInput
              type="number"
              min="1"
              max="200"
              value={state.generation.count}
              onChange={(e) =>
                edit(
                  (s) =>
                    (s.generation.count =
                      e.target.value === "" ? NaN : Number(e.target.value)),
                )
              }
            />
          </label>
        </div>
        <p className="muted">
          {state.api.width} × {state.api.height} · {state.api.steps} steps
        </p>
        {state.generation.image_size === "custom" && (
          <div className="two-fields">
            <ApiField
              state={state}
              edit={edit}
              name="width"
              title="가로 픽셀"
            />
            <ApiField
              state={state}
              edit={edit}
              name="height"
              title="세로 픽셀"
            />
          </div>
        )}
        <div className="two-fields guidance-fields">
          <ApiField
            state={state}
            edit={edit}
            name="scale"
            title="Prompt guidance"
          />
          <ApiField
            state={state}
            edit={edit}
            name="guidance_rescale"
            title="Guidance rescale"
          />
        </div>
        <button
          className="outline full"
          disabled={busy}
          onClick={() => void task(previewPrompt)}
        >
          프롬프트 미리보기
        </button>
        <div className="generation-action studio-generation">
          <button
            className="primary full generate"
            disabled={busy}
            title="Ctrl+Enter"
            onClick={runGenerate}
          >
            <Sparkles size={16} />
            {state.api.mock_mode ? "체험 이미지 생성" : "생성 대기열에 추가"}
            {burst > 0 && <SparkleBurst key={burst} />}
          </button>
          <SeedStatus seed={state.api.seed} />
        </div>
        <p className="micro">
          {state.api.mock_mode
            ? "API를 사용하지 않는 체험 모드"
            : "NovelAI API 사용 · Anlas가 소모될 수 있습니다"}
        </p>
      </section>
      <section>
        <div className="section-heading">
          <h2>작가 조합</h2>
          {state.generation.fixed_artists.length ? (
            <button
              className="text-button artist-randomize"
              onClick={() =>
                edit((s) => {
                  s.generation.fixed_artists = [];
                })
              }
            >
              <Shuffle size={13} />
              랜덤으로 전환
            </button>
          ) : (
            <span className="badge">랜덤</span>
          )}
        </div>
        {state.generation.fixed_artists.length ? (
          <FixedArtistList state={state} edit={edit} />
        ) : (
          <>
            {state.categories.map((c, i) => (
              <div className="category-summary" key={i}>
                <div className="row spread">
                  <span>{c.name}</span>
                  <span className="accent">
                    {c.all_artists ? "전체" : `${c.min_picks}~${c.max_picks}명`}
                  </span>
                </div>
                <div className="row spread muted">
                  <span>
                    {c.disabled_tags?.length
                      ? `사용 ${artistCount(c.tags, c.disabled_tags)}/${artistCount(c.tags)}명`
                      : `등록 ${artistCount(c.tags)}명`}
                  </span>
                  <span>
                    {c.min_weight} ~ {c.max_weight}
                  </span>
                </div>
              </div>
            ))}
            <button className="text-button" onClick={() => setTab("artists")}>
              작가와 가중치 범위 편집 <ChevronRight size={13} />
            </button>
          </>
        )}
      </section>
    </aside>
  );
}

/** Fixed artist combination with pointer-drag and arrow-key reordering. */
function FixedArtistList({ state, edit }: { state: AppState; edit: Edit }) {
  const [dragArtist, setDragArtist] = useState<number | null>(null);
  const [dropArtist, setDropArtist] = useState<number | null>(null);
  const artistPointer = useRef<{ from: number; to: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useFlip(list);
  const seen = new Map<string, number>();
  const flipKey = (tag: string) => {
    const n = seen.get(tag) || 0;
    seen.set(tag, n + 1);
    return `${tag}#${n}`;
  };
  function moveArtist(from: number, to: number) {
    if (from === to) return;
    edit((s) => {
      const artists = s.generation.fixed_artists;
      const [artist] = artists.splice(from, 1);
      artists.splice(to, 0, artist);
    });
  }
  function endDrag() {
    artistPointer.current = null;
    setDragArtist(null);
    setDropArtist(null);
  }
  return (
    <div ref={list} className="fixed-artist-list">
      <p className="muted">핸들을 드래그해 순서를 바꿀 수 있습니다.</p>
      {state.generation.fixed_artists.map((a, i) => (
        <div
          data-flip-key={flipKey(a.tag)}
          className={
            "fixed-artist" +
            (dragArtist === i ? " dragging" : "") +
            (dropArtist === i && dragArtist !== i ? " drop-target" : "")
          }
          key={i}
          data-artist-index={i}
        >
          <div className="fixed-artist-heading">
            <button
              className="drag-handle"
              aria-label={`${a.tag} 순서 드래그`}
              title="드래그 또는 위아래 방향키로 순서 변경"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                artistPointer.current = { from: i, to: i };
                setDragArtist(i);
                setDropArtist(i);
              }}
              onPointerMove={(e) => {
                if (!artistPointer.current) return;
                const panel = e.currentTarget.closest(
                  ".left-panel",
                ) as HTMLElement;
                const rect = panel.getBoundingClientRect();
                if (e.clientY < rect.top + 35) panel.scrollTop -= 18;
                if (e.clientY > rect.bottom - 35) panel.scrollTop += 18;
                const target = document
                  .elementFromPoint(e.clientX, e.clientY)
                  ?.closest("[data-artist-index]") as HTMLElement | null;
                if (target) {
                  const to = Number(target.dataset.artistIndex);
                  artistPointer.current.to = to;
                  setDropArtist(to);
                }
              }}
              onPointerUp={(e) => {
                const pointer = artistPointer.current;
                artistPointer.current = null;
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
                if (pointer) moveArtist(pointer.from, pointer.to);
                setDragArtist(null);
                setDropArtist(null);
              }}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && i > 0) {
                  e.preventDefault();
                  moveArtist(i, i - 1);
                } else if (
                  e.key === "ArrowDown" &&
                  i < state.generation.fixed_artists.length - 1
                ) {
                  e.preventDefault();
                  moveArtist(i, i + 1);
                }
              }}
            >
              <GripVertical size={15} />
            </button>
            <span>{a.tag}</span>
          </div>
          <div className="row weight-row">
            <input
              type="range"
              className="weight-slider"
              aria-label={a.tag + " 슬라이더"}
              min={0}
              max={2}
              step={0.05}
              value={Number.isFinite(a.weight) ? Math.min(2, a.weight) : 1}
              style={
                {
                  "--fill": `${(Math.min(2, Number.isFinite(a.weight) ? a.weight : 1) / 2) * 100}%`,
                } as CSSProperties
              }
              onChange={(e) =>
                edit(
                  (s) =>
                    (s.generation.fixed_artists[i].weight = Number(
                      e.target.value,
                    )),
                )
              }
            />
            <NumericInput
              aria-label={a.tag + " 가중치"}
              type="number"
              min="0"
              max="10"
              step="0.05"
              value={a.weight}
              onChange={(e) =>
                edit(
                  (s) =>
                    (s.generation.fixed_artists[i].weight =
                      e.target.value === "" ? NaN : Number(e.target.value)),
                )
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A one-shot ring of sparks around the generate button. */
function SparkleBurst() {
  return (
    <span className="sparkle-burst" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} style={{ "--a": `${i * 36}deg` } as CSSProperties} />
      ))}
    </span>
  );
}
