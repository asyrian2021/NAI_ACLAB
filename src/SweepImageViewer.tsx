import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from "lucide-react";
import type { ImageItem } from "./types";

type Props = {
  x: number;
  y: number;
  xValues: number[];
  yValues: number[];
  cells: Map<string, ImageItem>;
  move: (x: number, y: number) => void;
  close: () => void;
  returnFocus: HTMLElement | null;
};
export function SweepImageViewer(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const layers = [
      document.getElementById("root"),
      document.querySelector<HTMLElement>(".sweep-fullscreen"),
    ].filter((e): e is HTMLElement => !!e);
    const previousInert = layers.map((layer) => layer.inert);
    layers.forEach((layer) => {
      layer.inert = true;
    });
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const p = latest.current;
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
      };
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        p.close();
      } else if (event.key in directions) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const [dx, dy] = directions[event.key];
        p.move(
          Math.max(0, Math.min(p.xValues.length - 1, p.x + dx)),
          Math.max(0, Math.min(p.yValues.length - 1, p.y + dy)),
        );
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.body.style.overflow = previousOverflow;
      layers.forEach((layer, i) => {
        layer.inert = previousInert[i];
      });
      if (latest.current.returnFocus?.isConnected)
        latest.current.returnFocus.focus();
    };
  }, []);
  const { x, y, xValues, yValues, cells, move, close } = props;
  const item = cells.get(`${x}:${y}`);
  return createPortal(
    <section
      className="sweep-image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="가이던스 테스트 이미지 확대"
    >
      <header>
        <div>
          <h2>가이던스 테스트 · 이미지 확대</h2>
          <span className="micro">
            열 {x + 1}/{xValues.length} · 행 {yValues.length - y}/
            {yValues.length}
          </span>
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
      <div className="sweep-image-stage">
        {item?.error ? (
          <div className="sweep-viewer-empty" role="status">
            이 칸은 생성하지 못했습니다.<p>{item.error}</p>
          </div>
        ) : item ? (
          <img
            src={item.image_url}
            alt={`확대 결과 · Guidance ${xValues[x]}, Rescale ${yValues[y]}`}
          />
        ) : (
          <div className="sweep-viewer-empty" role="status">
            아직 생성되지 않은 칸입니다.
          </div>
        )}
      </div>
      <footer>
        <div className="sweep-viewer-values" aria-live="polite">
          <strong className="viewer-guidance">Guidance {xValues[x]}</strong>
          <strong className="viewer-rescale">Rescale {yValues[y]}</strong>
        </div>
        <div className="row sweep-viewer-navigation">
          <button
            className="outline"
            aria-label="Guidance 감소"
            disabled={x === 0}
            onClick={() => move(x - 1, y)}
          >
            <ArrowLeft size={18} />
          </button>
          <button
            className="outline"
            aria-label="Rescale 증가"
            disabled={y === yValues.length - 1}
            onClick={() => move(x, y + 1)}
          >
            <ArrowUp size={18} />
          </button>
          <button
            className="outline"
            aria-label="Rescale 감소"
            disabled={y === 0}
            onClick={() => move(x, y - 1)}
          >
            <ArrowDown size={18} />
          </button>
          <button
            className="outline"
            aria-label="Guidance 증가"
            disabled={x === xValues.length - 1}
            onClick={() => move(x + 1, y)}
          >
            <ArrowRight size={18} />
          </button>
        </div>
        <span className="micro">← → Guidance · ↑ ↓ Rescale</span>
      </footer>
    </section>,
    document.body,
  );
}
