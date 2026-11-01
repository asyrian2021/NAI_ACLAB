import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
} from "lucide-react";
import type { History, ImageItem, Job } from "./types";

type Props = {
  history: History[];
  jobs: Job[];
  runId: string;
  selectRun: (id: string) => void;
};

export function BattingResults({ history, jobs, runId, selectRun }: Props) {
  const runs = history.filter((h) => h.type === "batting_test");
  const run =
    runs.find((h) => h.id === runId) || (!runId ? runs[0] : undefined);
  const job = jobs.find((j) => j.id === (runId || run?.id));
  const running =
    job && ["queued", "running", "cancelling"].includes(job.status);
  const items = run?.items || [];
  const [selection, setSelection] = useState({ runId: "", path: "" });
  const index = Math.max(
    0,
    items.findIndex(
      (i) => selection.runId === run?.id && i.path === selection.path,
    ),
  );
  const item = items[index];
  const [expanded, setExpanded] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const thumbnails = useRef<HTMLDivElement>(null);
  const selectedThumbnail = useRef<HTMLButtonElement>(null);
  const groups: { name: string; start: number; items: ImageItem[] }[] = [];
  items.forEach((image, offset) => {
    const name = image.preset || image.scene_name || "프리셋 정보 없음";
    if (groups.at(-1)?.name !== name)
      groups.push({ name, start: offset, items: [] });
    groups.at(-1)!.items.push(image);
  });
  const groupIndex = groups.findIndex(
    (g) => index >= g.start && index < g.start + g.items.length,
  );
  const group = groups[groupIndex];
  function select(next: number) {
    if (!run || !items[next]) return;
    setSelection({ runId: run.id, path: items[next].path });
  }
  function moveGroup(delta: number) {
    const next = groups[groupIndex + delta];
    if (group && next)
      select(next.start + Math.min(index - group.start, next.items.length - 1));
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.defaultPrevented
      )
        return;
      if (
        !expanded &&
        (document.querySelector('[aria-modal="true"]') ||
          (event.target as HTMLElement).closest(
            "input,textarea,select,[contenteditable]",
          ))
      )
        return;
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setExpanded(false);
      } else if (
        item &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "ArrowLeft") select(index - 1);
        if (event.key === "ArrowRight") select(index + 1);
        if (event.key === "ArrowUp") moveGroup(-1);
        if (event.key === "ArrowDown") moveGroup(1);
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  });
  useEffect(() => {
    if (!expanded) return;
    const root = document.getElementById("root");
    const previousInert = root?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    return () => {
      if (root) root.inert = previousInert;
      document.body.style.overflow = overflow;
      previewButton.current?.focus();
    };
  }, [expanded]);
  useEffect(() => {
    const container = thumbnails.current;
    const button = selectedThumbnail.current;
    if (!container || !button) return;
    if (document.activeElement && container.contains(document.activeElement))
      button.focus({ preventScroll: true });
    const outer = container.getBoundingClientRect(),
      inner = button.getBoundingClientRect();
    if (inner.left < outer.left)
      container.scrollLeft += inner.left - outer.left - 8;
    else if (inner.right > outer.right)
      container.scrollLeft += inner.right - outer.right + 8;
  }, [run?.id, item?.path]);
  useEffect(() => {
    const container = thumbnails.current;
    if (!container) return;
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.shiftKey ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        container.scrollWidth <= container.clientWidth
      )
        return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? container.clientWidth
            : 1;
      container.scrollLeft += event.deltaY * unit;
    };
    container.addEventListener("wheel", wheel, { passive: false });
    return () => container.removeEventListener("wheel", wheel);
  }, []);

  const picture = item?.error ? (
    <div className="sweep-viewer-empty" role="status">
      이 이미지는 생성하지 못했습니다.<p>{item.error}</p>
    </div>
  ) : item ? (
    <img
      src={item.image_url}
      alt={`타율 테스트 결과 ${index + 1} · ${group?.name}`}
    />
  ) : (
    <p className="muted">
      {running
        ? "첫 이미지를 생성하는 중입니다. 완료되는 대로 여기에 표시됩니다."
        : "타율 테스트를 시작하면 결과가 여기에 표시됩니다."}
    </p>
  );
  const navigation = (
    <div className="row batting-navigation">
      <button
        className="outline"
        aria-label="이전 결과 이미지"
        disabled={!item || index === 0}
        onClick={() => select(index - 1)}
      >
        <ChevronLeft size={17} />
      </button>
      <span className="batting-image-count" aria-live="polite">
        {item ? index + 1 : 0} / {items.length}
      </span>
      <button
        className="outline"
        aria-label="다음 결과 이미지"
        disabled={!item || index === items.length - 1}
        onClick={() => select(index + 1)}
      >
        <ChevronRight size={17} />
      </button>
      <button
        className="outline"
        aria-label="이전 프리셋 결과"
        disabled={groupIndex <= 0}
        onClick={() => moveGroup(-1)}
      >
        <ArrowUp size={17} />
      </button>
      <button
        className="outline"
        aria-label="다음 프리셋 결과"
        disabled={groupIndex < 0 || groupIndex === groups.length - 1}
        onClick={() => moveGroup(1)}
      >
        <ArrowDown size={17} />
      </button>
    </div>
  );
  const values = item && (
    <div className="batting-image-values" aria-live="polite">
      <strong>{group?.name}</strong>
      <span>Seed {item.seed ?? "기록 없음"}</span>
      <span>
        Guidance {item.scale ?? "—"} · Rescale {item.guidance_rescale ?? "—"}
      </span>
    </div>
  );
  return (
    <section className="batting-results" aria-label="타율 테스트 결과">
      <div className="batting-preview-panel">
        <header className="batting-results-heading">
          <div>
            <h2>테스트 결과</h2>
            <p className="micro">← → 이미지 이동 · ↑ ↓ 프리셋 이동</p>
          </div>
          <label>
            테스트 기록
            <select
              aria-label="타율 테스트 기록"
              value={runId || run?.id || ""}
              onChange={(e) => selectRun(e.target.value)}
            >
              {!run && (
                <option value={runId}>
                  {running ? "생성 중인 테스트" : "기록 없음"}
                </option>
              )}
              {runs.map((h, i) => (
                <option key={h.id} value={h.id}>
                  #{runs.length - i} · {h.created_at} · {h.items.length}장
                </option>
              ))}
            </select>
          </label>
        </header>
        {job && (
          <p className="micro batting-job-status" role="status">
            {running
              ? "생성 진행"
              : job.status === "cancelled"
                ? "중지됨"
                : job.status === "failed"
                  ? "오류 포함"
                  : "생성 완료"}{" "}
            · {job.progress}/{job.total}장
            {job.last_error && ` · ${job.last_error}`}
          </p>
        )}
        <button
          ref={previewButton}
          className="batting-result-stage"
          disabled={!item}
          aria-label="타율 테스트 결과 크게 보기"
          onClick={() => setExpanded(true)}
        >
          {picture}
          {item && (
            <span className="batting-expand-hint">
              <Maximize2 size={14} /> 클릭하여 크게 보기
            </span>
          )}
        </button>
        <div className="batting-result-caption">
          {values}
          {navigation}
        </div>
      </div>
      <section className="batting-gallery" aria-label="생성 이미지 목록">
        <header className="batting-gallery-heading">
          <h2>
            생성 이미지 <span className="micro">{items.length}장</span>
          </h2>
          <span className="micro">가로 스크롤 · 휠로 넘기기</span>
        </header>
        <div
          className="batting-thumbnails"
          ref={thumbnails}
          aria-label="프리셋별 결과 이미지"
        >
          {groups.map((g) => (
            <section key={g.start} className="batting-result-group">
              <h3>
                {g.name} <span className="micro">{g.items.length}장</span>
              </h3>
              <div>
                {g.items.map((image, offset) => (
                  <button
                    key={image.path}
                    ref={index === g.start + offset ? selectedThumbnail : null}
                    aria-label={`타율 결과 ${g.start + offset + 1} 선택 · ${g.name}`}
                    aria-pressed={index === g.start + offset}
                    title={
                      image.error ||
                      `${g.name} · Seed ${image.seed ?? "기록 없음"}`
                    }
                    onClick={() => select(g.start + offset)}
                  >
                    {image.error ? (
                      <span>생성 실패</span>
                    ) : (
                      <img src={image.image_url} alt="" loading="lazy" />
                    )}
                    <small>{offset + 1}</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
      {expanded &&
        createPortal(
          <section
            className="sweep-image-viewer batting-image-viewer"
            role="dialog"
            aria-modal="true"
            aria-label="타율 테스트 이미지 확대"
          >
            <header>
              <div>
                <h2>타율 테스트 · 이미지 확대</h2>
                <span className="micro">← → 이미지 이동 · ↑ ↓ 프리셋 이동</span>
              </div>
              <button
                autoFocus
                className="outline"
                aria-label="타율 확대 이미지 닫기"
                onClick={() => setExpanded(false)}
              >
                <X size={18} /> 닫기 · Esc
              </button>
            </header>
            <div className="sweep-image-stage">{picture}</div>
            <footer>
              {values}
              {navigation}
            </footer>
          </section>,
          document.body,
        )}
    </section>
  );
}
