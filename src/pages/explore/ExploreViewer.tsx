import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from "lucide-react";
import { ZoomableImage } from "../../components/ZoomSurface";

export type ViewerCell = { url: string; error?: string; caption: string };

/**
 * Enlarged image over a rows × columns grid. ← → move between columns
 * (combinations), ↑ ↓ between rows (seeds); Esc closes.
 */
export function ExploreViewer({
  title,
  row,
  col,
  rows,
  cols,
  cell,
  move,
  close,
  extraKeys,
  footer,
}: {
  title: string;
  row: number;
  col: number;
  rows: number;
  cols: number;
  cell: (row: number, col: number) => ViewerCell | undefined;
  move: (row: number, col: number) => void;
  close: () => void;
  /** Return true when the key was handled (e.g. a pick shortcut). */
  extraKeys?: (event: KeyboardEvent) => boolean;
  footer?: ReactNode;
}) {
  const latest = useRef({ row, col, rows, cols, move, close, extraKeys });
  latest.current = { row, col, rows, cols, move, close, extraKeys };
  useEffect(() => {
    const root = document.getElementById("root");
    const inert = root?.inert ?? false;
    const overflow = document.body.style.overflow;
    const returnFocus = document.activeElement as HTMLElement | null;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const p = latest.current;
      const steps: Record<string, [number, number]> = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
      };
      if (event.key === "Escape") p.close();
      else if (event.key in steps) {
        const [dr, dc] = steps[event.key];
        p.move(
          Math.max(0, Math.min(p.rows - 1, p.row + dr)),
          Math.max(0, Math.min(p.cols - 1, p.col + dc)),
        );
      } else if (!p.extraKeys?.(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      if (root) root.inert = inert;
      document.body.style.overflow = overflow;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);
  const current = cell(row, col);
  return createPortal(
    <section
      className="sweep-image-viewer explore-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header>
        <div>
          <h2>{title}</h2>
          <span className="micro">{current?.caption}</span>
        </div>
        <button
          autoFocus
          className="outline"
          aria-label="확대 이미지 닫기"
          onClick={close}
        >
          <X size={18} />
          닫기 · Esc
        </button>
      </header>
      {current?.url && !current.error ? (
        <ZoomableImage
          className="sweep-image-stage"
          src={current.url}
          alt={current.caption}
        />
      ) : (
        <div className="sweep-image-stage">
          <div className="sweep-viewer-empty" role="status">
            {current?.error ? (
              <>
                이 칸은 생성하지 못했습니다.<p>{current.error}</p>
              </>
            ) : (
              "아직 생성되지 않은 칸입니다."
            )}
          </div>
        </div>
      )}
      <footer>
        <div className="sweep-viewer-values">{footer}</div>
        <div className="row sweep-viewer-navigation">
          <button
            className="outline"
            aria-label="이전 조합"
            disabled={col === 0}
            onClick={() => move(row, col - 1)}
          >
            <ArrowLeft size={18} />
          </button>
          <button
            className="outline"
            aria-label="이전 시드"
            disabled={row === 0}
            onClick={() => move(row - 1, col)}
          >
            <ArrowUp size={18} />
          </button>
          <button
            className="outline"
            aria-label="다음 시드"
            disabled={row === rows - 1}
            onClick={() => move(row + 1, col)}
          >
            <ArrowDown size={18} />
          </button>
          <button
            className="outline"
            aria-label="다음 조합"
            disabled={col === cols - 1}
            onClick={() => move(row, col + 1)}
          >
            <ArrowRight size={18} />
          </button>
        </div>
        <span className="micro">← → 조합 · ↑ ↓ 시드</span>
      </footer>
    </section>,
    document.body,
  );
}
