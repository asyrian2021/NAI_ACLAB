import { useRef, type CSSProperties, type PointerEvent } from "react";
import {
  Blend,
  ChevronLeft,
  ChevronRight,
  ChevronsLeftRight,
  Columns2,
  Heart,
  Image,
  Pin,
  SquareSplitHorizontal,
  type LucideIcon,
} from "lucide-react";
import { ZoomSurface } from "../../components/ZoomSurface";
import type { CompareMode, StudioViewState } from "../../hooks/useStudioView";
import type { Tab } from "../../lib/actions";
import { actualSizeZoom, measureWell, zoomTransform } from "../../lib/zoom";
import type { ImageItem } from "../../types";

const compareModes: [CompareMode, string, LucideIcon][] = [
  ["side", "나란히", Columns2],
  ["slider", "슬라이더", SquareSplitHorizontal],
  ["overlay", "겹쳐 보기", Blend],
];

/** Studio canvas: single / compare / grid stage with zoom, pan and navigation. */
export function StudioViewer({
  studio,
  setTab,
}: {
  studio: StudioViewState;
  setTab: (tab: Tab) => void;
}) {
  const {
    view,
    setView,
    compareMode,
    setCompareMode,
    split,
    setSplit,
    blend,
    setBlend,
    zoomPan,
    setZoomPan,
    zoom,
    setZoom,
    resetZoom,
    reference,
    current,
    images,
    index,
    favorites,
    limit,
    setLimit,
    unseen,
    select,
    step,
  } = studio;
  const stageRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<HTMLElement | null>(null);
  const transform = zoomTransform(
    view === "grid" ? { zoom: 1, x: 0, y: 0 } : zoomPan,
  );
  const blended =
    view === "compare" &&
    compareMode !== "side" &&
    !!reference &&
    !!current &&
    !reference.error &&
    !current.error;

  function showActualSize() {
    const g = measureWell(
      stageRef.current?.querySelector("[data-zoom-well]") || null,
    );
    if (g) setZoomPan({ zoom: Math.max(1, actualSizeZoom(g)), x: 0, y: 0 });
  }

  function caption(item: ImageItem) {
    return (
      <figcaption>
        <button onClick={() => select(item)}>
          {item.path.split("/").pop()}
        </button>
        <span>
          {item.mock ? (
            "체험 이미지"
          ) : item.favorite ? (
            <Heart size={12} fill="currentColor" />
          ) : (
            ""
          )}
        </span>
      </figcaption>
    );
  }

  function imageCard(item: ImageItem, pinned = false, order = 0) {
    return (
      <figure
        key={(pinned ? "ref" : "img") + item.path}
        className={
          "image-card " +
          (current?.path === item.path ? "selected" : "") +
          (unseen.has(item.path) ? " is-new" : "")
        }
        style={
          view === "grid"
            ? ({ "--i": Math.min(order, 12) } as CSSProperties)
            : undefined
        }
      >
        <div
          className="image-well"
          data-zoom-well
          onDoubleClick={
            view === "grid"
              ? () => {
                  select(item);
                  setView("single");
                }
              : undefined
          }
        >
          {item.error ? (
            <div className="image-error">
              생성 실패<p>{item.error}</p>
            </div>
          ) : (
            <img
              src={item.image_url}
              alt={item.scene_name || item.preset || "생성 이미지"}
              draggable={false}
              data-zoom-target
              style={{ transform }}
            />
          )}
          {pinned && (
            <span className="pin-label">
              <Pin size={12} /> 기준 이미지
            </span>
          )}
        </div>
        {caption(item)}
      </figure>
    );
  }

  function moveSplit(e: PointerEvent, well: Element) {
    const rect = well.getBoundingClientRect();
    setSplit(
      Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
    );
  }

  function blendCard(base: ImageItem, top: ImageItem) {
    const slider = compareMode === "slider";
    return (
      <figure
        key={"blend" + base.path + top.path}
        className="image-card selected blend-card"
      >
        <div
          className={"image-well blend-well " + compareMode}
          data-zoom-well
          style={
            { "--split": `${split}%`, "--blend": blend / 100 } as CSSProperties
          }
          onPointerDown={(e) => {
            // At fit size, dragging anywhere moves the divider; zoomed in, it pans.
            if (!slider || zoom > 1 || e.button !== 0) return;
            splitDrag.current = e.currentTarget;
            e.currentTarget.setPointerCapture(e.pointerId);
            moveSplit(e, e.currentTarget);
          }}
          onPointerMove={(e) => {
            if (splitDrag.current) moveSplit(e, splitDrag.current);
          }}
          onPointerUp={() => (splitDrag.current = null)}
          onPointerCancel={() => (splitDrag.current = null)}
        >
          <img
            src={base.image_url}
            alt="기준 이미지"
            draggable={false}
            data-zoom-target
            style={{ transform }}
          />
          <div className="blend-top">
            <img
              src={top.image_url}
              alt={top.scene_name || top.preset || "현재 이미지"}
              draggable={false}
              data-zoom-target
              style={{ transform }}
            />
          </div>
          {slider && (
            <div
              className="blend-divider"
              data-no-pan
              role="slider"
              tabIndex={0}
              aria-label="비교 위치"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              onPointerDown={(e) => {
                e.stopPropagation();
                const well = e.currentTarget.parentElement!;
                splitDrag.current = well;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (splitDrag.current) moveSplit(e, splitDrag.current);
              }}
              onPointerUp={() => (splitDrag.current = null)}
              onKeyDown={(e) => {
                const delta = { ArrowLeft: -5, ArrowRight: 5 }[e.key];
                if (!delta) return;
                e.preventDefault();
                e.stopPropagation();
                setSplit(Math.max(0, Math.min(100, split + delta)));
              }}
            >
              <span className="blend-handle">
                <ChevronsLeftRight size={14} />
              </span>
            </div>
          )}
          <span className="pin-label">
            <Pin size={12} /> 기준
          </span>
          <span className="blend-label">현재</span>
        </div>
        {caption(top)}
      </figure>
    );
  }

  return (
    <main className="canvas">
      <ZoomSurface
        surfaceRef={stageRef}
        className={"stage " + view}
        enabled={view !== "grid" && images.length > 0}
        value={zoomPan}
        onChange={setZoomPan}
      >
        {images.length === 0 ? (
          <div className="empty">
            <Image size={38} strokeWidth={1} />
            <h1>
              {favorites
                ? "즐겨찾기한 이미지가 없습니다"
                : "새로운 그림체를 발견하세요"}
            </h1>
            <p>
              {favorites
                ? "이미지의 하트를 눌러 모아보세요."
                : "작가와 프롬프트를 준비하고 첫 이미지를 만들어 보세요."}
            </p>
            {!favorites && (
              <button className="outline" onClick={() => setTab("artists")}>
                작가 등록하기 <ChevronRight size={15} />
              </button>
            )}
          </div>
        ) : view === "grid" ? (
          images.slice(0, limit).map((item, i) => imageCard(item, false, i))
        ) : view === "compare" ? (
          blended ? (
            blendCard(reference!, current!)
          ) : (
            <>
              {reference ? (
                imageCard(reference, true)
              ) : (
                <div className="empty">기준 이미지를 고정하세요.</div>
              )}
              {current && imageCard(current)}
            </>
          )
        ) : (
          current && imageCard(current)
        )}
      </ZoomSurface>
      {view === "grid" && images.length > limit && (
        <button onClick={() => setLimit(limit + 60)}>
          더 보기 ({images.length - limit}장)
        </button>
      )}
      <div className="viewer-tools">
        <button
          aria-label="이전 이미지"
          onClick={() => step(-1)}
          disabled={!images.length}
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          {images.length ? Math.max(0, index) + 1 : 0} / {images.length}
        </span>
        <button
          aria-label="다음 이미지"
          onClick={() => step(1)}
          disabled={!images.length}
        >
          <ChevronRight size={17} />
        </button>
        <i />
        <button onClick={resetZoom} aria-pressed={zoom === 1}>
          화면 맞춤
        </button>
        <button
          disabled={view === "grid" || !images.length}
          onClick={showActualSize}
          title="원본 픽셀 크기로 보기 (더블클릭)"
        >
          1:1
        </button>
        <button
          disabled={view === "grid"}
          onClick={() => setZoom(2)}
          aria-pressed={zoom === 2}
        >
          2×
        </button>
        <button
          disabled={view === "grid"}
          onClick={() => setZoom(4)}
          aria-pressed={zoom === 4}
        >
          4×
        </button>
        {view !== "grid" && (
          <span className={"zoom-readout" + (zoom > 1 ? " zoomed" : "")}>
            {Math.round(zoom * 100)}%
          </span>
        )}
        {view === "compare" && (
          <>
            <i />
            <div className="compare-modes" role="group" aria-label="비교 방식">
              {compareModes.map(([id, title, Icon]) => (
                <button
                  key={id}
                  aria-pressed={compareMode === id}
                  onClick={() => setCompareMode(id)}
                >
                  <Icon size={14} />
                  {title}
                </button>
              ))}
            </div>
            {compareMode === "overlay" && (
              <input
                className="blend-range"
                type="range"
                min={0}
                max={100}
                value={blend}
                aria-label="겹침 비율"
                onChange={(e) => setBlend(Number(e.target.value))}
              />
            )}
            {compareMode === "side" && (
              <span className="muted">확대·이동 동기화</span>
            )}
          </>
        )}
      </div>
    </main>
  );
}
