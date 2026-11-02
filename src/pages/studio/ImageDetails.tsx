import {
  Copy,
  CornerUpLeft,
  FlaskConical,
  FolderOpen,
  Heart,
  Layers,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "../../api";
import type { StudioViewState } from "../../hooks/useStudioView";
import type { Edit, Tab, Task } from "../../lib/actions";
import type { AppState } from "../../types";

/** Right studio panel: the selected image's recipe, seed and follow-up actions. */
export function ImageDetails({
  state,
  studio,
  edit,
  task,
  setTab,
  copy,
  setMessage,
  toggleFavorite,
}: {
  state: AppState;
  studio: StudioViewState;
  edit: Edit;
  task: Task;
  setTab: (tab: Tab) => void;
  copy: (text: string) => Promise<void>;
  setMessage: (text: string) => void;
  toggleFavorite: () => Promise<void>;
}) {
  const { current, reference, view, setFocus } = studio;

  /** Pins the selected image's artist weights/order as the next generation's combination. */
  function reuse() {
    if (!current) return;
    edit((s) => {
      s.generation.fixed_artists = structuredClone(current.artists || []);
      if (
        current.preset &&
        s.prompt_presets.some((p) => p.name === current.preset)
      )
        s.generation.preset = current.preset;
    });
    setFocus(false);
    setMessage(
      "작가 가중치와 순서를 고정했습니다. 생성 설정에서 수정할 수 있습니다.",
    );
  }
  const seedControls = (
    <div className="seed-controls">
      <p className="micro selectable seed-setting">
        다음 생성:{" "}
        {state.api.seed === -1 ? "랜덤 시드" : `Seed ${state.api.seed} 고정`}
      </p>
      {current?.seed !== undefined && (
        <button
          className="outline full"
          aria-pressed={state.api.seed === current.seed}
          onClick={() =>
            edit((s) => {
              s.api.seed = s.api.seed === current.seed ? -1 : current.seed!;
            })
          }
        >
          이 시드 사용
        </button>
      )}
      {state.api.seed !== -1 && current?.seed === undefined && (
        <button
          className="text-button"
          onClick={() =>
            edit((s) => {
              s.api.seed = -1;
            })
          }
        >
          시드 고정 해제
        </button>
      )}
      {current && (
        <div className="seed-test-actions">
          <button
            className="outline full"
            disabled={!current.artists?.length || !!current.error}
            title={
              !current.artists?.length
                ? "작가 태그가 기록된 이미지를 선택하세요."
                : "이 이미지의 작가 조합을 고정하고 타율 테스트로 이동"
            }
            onClick={() => {
              reuse();
              setTab("batting");
            }}
          >
            <FlaskConical size={14} />
            타율 테스트
          </button>
          <button
            className="outline full"
            disabled={
              current.seed === undefined ||
              current.prompt === undefined ||
              current.negative_prompt === undefined ||
              !current.width ||
              !current.height ||
              !!current.error
            }
            title="이 이미지를 선택하고 시드를 고정한 상태로 가이던스 테스트로 이동"
            onClick={() => {
              edit((s) => {
                s.api.seed = current.seed!;
                s.guidance_test.source_path = current.path;
              });
              setFocus(false);
              setTab("guidance");
            }}
          >
            <SlidersHorizontal size={14} />
            가이던스 테스트
          </button>
        </div>
      )}
    </div>
  );

  if (!current)
    return (
      <aside className="right-panel">
        <div className="empty-info">
          {state.api.seed !== -1 && seedControls}
          <Layers size={25} />
          <h2>이미지의 레시피</h2>
          <p>이미지를 선택하면 작가 조합과 프롬프트가 여기에 표시됩니다.</p>
        </div>
      </aside>
    );

  return (
    <aside className="right-panel">
      <section>
        <div className="section-heading">
          <h2>선택한 이미지</h2>
          <button
            aria-label="즐겨찾기"
            title="즐겨찾기 (H)"
            className={"favorite-toggle" + (current.favorite ? " accent" : "")}
            aria-pressed={!!current.favorite}
            onClick={() => void task(toggleFavorite)}
          >
            <Heart
              size={18}
              fill={current.favorite ? "currentColor" : "none"}
            />
          </button>
        </div>
        <div className="image-title">
          {current.preset || current.scene_name || "이전 생성 결과"}
        </div>
        <p className="muted">
          {current.width && current.height
            ? `${current.width} × ${current.height} · `
            : ""}
          {current.mock ? "체험 모드" : "생성 결과"}
        </p>
        <p className="micro selectable">
          {current.seed !== undefined ? `Seed ${current.seed}` : ""}
        </p>
        {seedControls}
      </section>
      <section>
        <div className="section-heading">
          <h2>작가 조합</h2>
          <button
            aria-label="작가 조합 복사"
            onClick={() =>
              void copy(
                current.artists
                  .map((a) => `${a.weight}::${a.tag} ::`)
                  .join(", "),
              )
            }
          >
            <Copy size={13} />
          </button>
        </div>
        {(current.artists || []).map((a, i) => (
          <div className="artist-info" key={i}>
            <span>{a.tag}</span>
            <strong>{a.weight}</strong>
          </div>
        ))}
        {!current.artists?.length && (
          <p className="muted">저장된 작가가 없습니다.</p>
        )}
        {view === "compare" && reference && (
          <details open>
            <summary>기준 이미지와의 차이</summary>
            {[
              ...new Set(
                [...reference.artists, ...current.artists].map((a) => a.tag),
              ),
            ]
              .filter(
                (tag) =>
                  reference.artists.find((a) => a.tag === tag)?.weight !==
                  current.artists.find((a) => a.tag === tag)?.weight,
              )
              .map((tag) => (
                <div className="difference" key={tag}>
                  {tag}
                  <span>
                    {reference.artists.find((a) => a.tag === tag)?.weight ??
                      "없음"}{" "}
                    →{" "}
                    {current.artists.find((a) => a.tag === tag)?.weight ??
                      "없음"}
                  </span>
                </div>
              ))}
          </details>
        )}
        <button className="outline full" onClick={reuse}>
          <CornerUpLeft size={14} />이 조합으로 이어서
        </button>
      </section>
      <section className="prompt-section">
        <details>
          <summary>전체 프롬프트</summary>
          <p className="prompt-text">
            {current.prompt ??
              "이전 버전에서 생성한 이미지에는 원문 프롬프트가 저장되어 있지 않습니다."}
          </p>
        </details>
        <button
          aria-label="전체 프롬프트 복사"
          disabled={!current.prompt}
          onClick={() => void copy(current.prompt || "")}
        >
          <Copy size={13} />
        </button>
      </section>
      <section className="prompt-section">
        <details>
          <summary>네거티브 프롬프트</summary>
          <p className="prompt-text">
            {current.negative_prompt || "저장된 네거티브가 없습니다."}
          </p>
        </details>
        <button
          aria-label="네거티브 복사"
          disabled={!current.negative_prompt}
          onClick={() => void copy(current.negative_prompt || "")}
        >
          <Copy size={13} />
        </button>
      </section>
      <button
        className="text-button"
        onClick={() =>
          void task(async () => {
            await api("history/open", { id: current.history_id });
          })
        }
      >
        <FolderOpen size={14} />
        저장 폴더 열기
      </button>
    </aside>
  );
}
