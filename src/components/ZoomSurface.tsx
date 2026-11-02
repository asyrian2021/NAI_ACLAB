import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  actualSizeZoom,
  clampPan,
  FIT,
  measureWell,
  zoomAt,
  zoomTransform,
  type ZoomPan,
} from "../lib/zoom";

/**
 * The shared image viewer behavior: wheel zoom toward the cursor, drag to pan
 * within the picture's real bounds, and double-click to toggle 1:1 (actual
 * pixels) / fit. Images inside opt in with `data-zoom-target`; the clipping box
 * is the nearest `[data-zoom-well]` (or the surface itself).
 *
 * The surface is controlled: several wells (side-by-side compare) can share
 * one value so zoom and pan stay in sync.
 */
export function ZoomSurface({
  value,
  onChange,
  enabled = true,
  className = "",
  surfaceRef,
  children,
  label,
}: {
  value: ZoomPan;
  onChange: (next: ZoomPan) => void;
  enabled?: boolean;
  className?: string;
  surfaceRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  label?: string;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = surfaceRef || ownRef;
  const latest = useRef({ value, onChange, enabled });
  latest.current = { value, onChange, enabled };
  const drag = useRef<{
    sx: number;
    sy: number;
    start: ZoomPan;
    well: Element;
  } | null>(null);
  const [panning, setPanning] = useState(false);

  const wellOf = (target: EventTarget | null) =>
    (target instanceof Element && target.closest("[data-zoom-well]")) ||
    ref.current;

  // Wheel needs a non-passive listener so the page does not scroll instead.
  useEffect(() => {
    const surface = ref.current;
    if (!surface) return;
    const wheel = (e: WheelEvent) => {
      const { value, onChange, enabled } = latest.current;
      if (!enabled) return;
      const g = measureWell(wellOf(e.target));
      if (!g) return;
      e.preventDefault();
      const step = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      onChange(
        zoomAt(
          value,
          g,
          value.zoom * Math.exp(-step * 0.0015),
          e.clientX,
          e.clientY,
        ),
      );
    };
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => surface.removeEventListener("wheel", wheel);
  }, []);

  // Re-clamp after button zooms, image changes or resizes.
  useLayoutEffect(() => {
    if (!enabled || value.zoom === 1) return;
    const g = measureWell(
      ref.current?.querySelector("[data-zoom-well]") || ref.current || null,
    );
    if (!g) return;
    const clamped = clampPan(value, g);
    if (clamped !== value) onChange(clamped);
  }, [value.zoom, value.x, value.y, enabled]);

  return (
    <div
      ref={ref}
      aria-label={label}
      className={
        className +
        " zoom-surface" +
        (enabled && value.zoom > 1 ? " can-pan" : "") +
        (panning ? " is-panning" : "")
      }
      onPointerDown={(e) => {
        if (!enabled || value.zoom <= 1 || e.button !== 0) return;
        if ((e.target as Element).closest("button, input, [data-no-pan]"))
          return;
        const well = wellOf(e.target);
        if (!well) return;
        drag.current = { sx: e.clientX, sy: e.clientY, start: value, well };
        e.currentTarget.setPointerCapture(e.pointerId);
        setPanning(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const next = {
          ...d.start,
          x: d.start.x + e.clientX - d.sx,
          y: d.start.y + e.clientY - d.sy,
        };
        const g = measureWell(d.well);
        onChange(g ? clampPan(next, g) : next);
      }}
      onPointerUp={() => {
        drag.current = null;
        setPanning(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPanning(false);
      }}
      onDoubleClick={(e) => {
        if (
          !enabled ||
          (e.target as Element).closest("button, input, [data-no-pan]")
        )
          return;
        const g = measureWell(wellOf(e.target));
        if (!g) return;
        if (value.zoom > 1.01) return onChange(FIT);
        const actual = actualSizeZoom(g);
        onChange(
          zoomAt(value, g, actual > 1.05 ? actual : 2, e.clientX, e.clientY),
        );
      }}
    >
      {children}
    </div>
  );
}

/** Small percentage badge that fades in while zoomed. */
export function ZoomChip({ zoom }: { zoom: number }) {
  return (
    <span
      className={"zoom-chip" + (zoom > 1.001 ? " visible" : "")}
      aria-hidden="true"
    >
      {Math.round(zoom * 100)}%
    </span>
  );
}

/** A single zoomable picture that resets to fit whenever its source changes. */
export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const [view, setView] = useState(FIT);
  useEffect(() => setView(FIT), [src]);
  return (
    <ZoomSurface className={className} value={view} onChange={setView}>
      <img
        key={src}
        src={src}
        alt={alt}
        draggable={false}
        data-zoom-target
        style={{ transform: zoomTransform(view) }}
      />
      <ZoomChip zoom={view.zoom} />
    </ZoomSurface>
  );
}
