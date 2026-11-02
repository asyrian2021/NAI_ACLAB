import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Heart, LoaderCircle, Trash2 } from "lucide-react";
import { api } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { StudioViewState } from "../../hooks/useStudioView";
import type { Task } from "../../lib/actions";
import { historyLabel } from "../../lib/helpers";
import type { AppState, Job } from "../../types";

const MAX_PLACEHOLDERS = 8;

/** Bottom strip of generated images, grouped by generation run. */
export function Filmstrip({
  state,
  studio,
  pending,
  task,
  refreshHistory,
}: {
  state: AppState;
  studio: StudioViewState;
  pending: Job[];
  task: Task;
  refreshHistory: () => Promise<void>;
}) {
  const {
    images,
    current,
    limit,
    setLimit,
    favorites,
    setFavorites,
    historyFilter,
    setHistoryFilter,
    setSelected,
    select,
    unseen,
    showNewest,
  } = studio;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const strip = useRef<HTMLDivElement>(null);

  // Keep the selected thumbnail in view without scrolling any outer container.
  useEffect(() => {
    const container = strip.current;
    const thumb = container?.querySelector<HTMLElement>(
      '.thumbnail-button[aria-pressed="true"]',
    );
    if (!container || !thumb) return;
    const outer = container.getBoundingClientRect();
    const inner = thumb.getBoundingClientRect();
    if (inner.left < outer.left)
      container.scrollBy({
        left: inner.left - outer.left - 12,
        behavior: "smooth",
      });
    else if (inner.right > outer.right)
      container.scrollBy({
        left: inner.right - outer.right + 12,
        behavior: "smooth",
      });
  }, [current?.path]);

  // Slots for images still being generated, shown where they will appear.
  const showPlaceholders = !favorites;
  const remaining = new Map(
    pending
      .filter((j) => !historyFilter || j.id === historyFilter)
      .map((j) => [
        j.id,
        Math.min(MAX_PLACEHOLDERS, Math.max(0, j.total - j.progress)),
      ]),
  );
  const visibleIds = new Set(images.slice(0, limit).map((i) => i.history_id));
  const waiting = showPlaceholders
    ? pending.filter(
        (j) => (remaining.get(j.id) || 0) > 0 && !visibleIds.has(j.id),
      )
    : [];
  const placeholders = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      <div
        className={"thumbnail-placeholder" + (i === 0 ? " is-next" : "")}
        key={"wait" + i}
        aria-hidden="true"
      >
        {i === 0 && <LoaderCircle size={16} className="spin" />}
      </div>
    ));
  const newCount =
    images.filter((i) => unseen.has(i.path)).length || unseen.size;

  return (
    <section className="filmstrip">
      <div className="film-head">
        <div className="row">
          <select
            aria-label="생성 기록 선택"
            value={historyFilter}
            onChange={(e) => {
              setHistoryFilter(e.target.value);
              setSelected("");
              setLimit(60);
            }}
          >
            <option value="">모든 생성 기록</option>
            {state.history.map((h) => (
              <option value={h.id} key={h.id}>
                {historyLabel(h)} · {h.created_at}
              </option>
            ))}
          </select>
          <span className="muted">{images.length}장</span>
          {unseen.size > 0 && (
            <button className="new-images" onClick={showNewest}>
              <ArrowDownToLine size={13} />새 이미지 {newCount}장 · 최신으로
              이동
            </button>
          )}
        </div>
        <div className="row">
          <button
            aria-pressed={favorites}
            onClick={() => {
              setFavorites(!favorites);
              setSelected("");
            }}
          >
            <Heart size={13} />
            즐겨찾기만
          </button>
          {historyFilter && (
            <button
              aria-label="선택한 생성 기록 삭제"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="thumbnails" ref={strip}>
        {waiting.map((job) => (
          <section
            className="generation-pending"
            key={job.id}
            aria-label="생성 중"
          >
            <div className="generation-pending-heading">
              <strong>생성 중 · {job.name}</strong>
              <span>
                {job.progress}/{job.total}장
              </span>
            </div>
            <div className="generation-thumbnails">
              {placeholders(remaining.get(job.id) || 0)}
            </div>
          </section>
        ))}
        {state.history.map((history, historyIndex) => {
          const visible = images
            .slice(0, limit)
            .filter((item) => item.history_id === history.id);
          if (!visible.length) return null;
          const turn = state.history.length - historyIndex;
          const position = (path: string) =>
            history.items.findIndex((i) => i.path === path) + 1;
          return (
            <section
              className="generation-group"
              key={history.id}
              aria-label={`생성 ${turn}`}
            >
              <div className="generation-group-heading">
                <strong>
                  #{turn} ·{" "}
                  {history.type === "batting_test"
                    ? "타율 테스트"
                    : historyLabel(history)}
                </strong>
                <span>
                  {history.created_at} · {history.items.length}장
                  {visible.length !== history.items.length
                    ? ` (표시 ${visible.length}장)`
                    : ""}
                </span>
              </div>
              <div className="generation-thumbnails">
                {visible.map((item) => (
                  <button
                    className={
                      "thumbnail-button" +
                      (unseen.has(item.path) ? " is-new" : "")
                    }
                    key={item.path}
                    aria-label={`생성 ${turn} 이미지 ${position(item.path)} 선택`}
                    aria-pressed={current?.path === item.path}
                    onClick={() => select(item)}
                  >
                    {item.error ? (
                      <div className="thumb-error">실패</div>
                    ) : (
                      <img src={item.image_url} loading="lazy" alt="" />
                    )}
                    <span>
                      {String(position(item.path)).padStart(2, "0")}
                      {item.favorite && <Heart size={10} fill="currentColor" />}
                    </span>
                  </button>
                ))}
                {showPlaceholders &&
                  placeholders(remaining.get(history.id) || 0)}
              </div>
            </section>
          );
        })}
        {images.length > limit && (
          <button className="more" onClick={() => setLimit(limit + 60)}>
            더 보기
          </button>
        )}
        {!images.length && !waiting.length && (
          <p className="muted">생성한 이미지가 여기에 모입니다.</p>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          tone="danger"
          title="생성 기록을 삭제할까요?"
          confirmLabel="기록 삭제"
          cancel={() => setConfirmDelete(false)}
          confirm={() => {
            setConfirmDelete(false);
            void task(async () => {
              await api("history/delete", { ids: [historyFilter] });
              setHistoryFilter("");
              setSelected("");
              await refreshHistory();
            });
          }}
        >
          선택한 생성 기록을 목록에서 삭제합니다. 이미지 파일은 저장 폴더에
          그대로 남습니다.
        </ConfirmDialog>
      )}
    </section>
  );
}
