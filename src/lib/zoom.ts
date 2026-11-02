/**
 * Zoom/pan math shared by every image viewer.
 *
 * A "well" is the clipping box; its image fills the well with
 * `object-fit: contain` and is transformed with
 * `translate(x, y) scale(zoom)` around its center.
 */
export type ZoomPan = { zoom: number; x: number; y: number };

export const FIT: ZoomPan = { zoom: 1, x: 0, y: 0 };
export const BASE_MAX_ZOOM = 8;

export type WellGeometry = {
  /** Well center in client coordinates. */
  cx: number;
  cy: number;
  viewW: number;
  viewH: number;
  /** Size of the visible (contained) picture at zoom 1. */
  contentW: number;
  contentH: number;
  naturalW: number;
};

export const zoomTransform = (v: ZoomPan) =>
  `translate(${v.x}px,${v.y}px) scale(${v.zoom})`;

export function measureWell(well: Element | null): WellGeometry | null {
  if (!well) return null;
  const img =
    well.querySelector<HTMLImageElement>("img[data-zoom-target]") ||
    well.querySelector<HTMLImageElement>("img");
  if (!img || !img.naturalWidth || !img.offsetWidth) return null;
  const rect = well.getBoundingClientRect();
  const fit = Math.min(
    img.offsetWidth / img.naturalWidth,
    img.offsetHeight / img.naturalHeight,
  );
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    viewW: rect.width,
    viewH: rect.height,
    contentW: img.naturalWidth * fit,
    contentH: img.naturalHeight * fit,
    naturalW: img.naturalWidth,
  };
}

/** Zoom at which one image pixel maps to one device pixel. */
export function actualSizeZoom(g: WellGeometry) {
  return g.naturalW / (g.contentW * (window.devicePixelRatio || 1));
}

export function maxZoom(g: WellGeometry | null) {
  return g ? Math.max(BASE_MAX_ZOOM, actualSizeZoom(g) * 2) : BASE_MAX_ZOOM;
}

/** Keeps the picture's edges from being dragged past the well's edges. */
export function clampPan(v: ZoomPan, g: WellGeometry): ZoomPan {
  const limitX = Math.max(0, (g.contentW * v.zoom - g.viewW) / 2);
  const limitY = Math.max(0, (g.contentH * v.zoom - g.viewH) / 2);
  const x = Math.max(-limitX, Math.min(limitX, v.x));
  const y = Math.max(-limitY, Math.min(limitY, v.y));
  return x === v.x && y === v.y ? v : { ...v, x, y };
}

/** Zooms to `target` while keeping the picture point under (clientX, clientY) still. */
export function zoomAt(
  v: ZoomPan,
  g: WellGeometry,
  target: number,
  clientX = g.cx,
  clientY = g.cy,
): ZoomPan {
  const zoom = Math.max(1, Math.min(maxZoom(g), target));
  if (zoom === 1) return FIT;
  const px = clientX - g.cx;
  const py = clientY - g.cy;
  const k = zoom / v.zoom;
  return clampPan({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, g);
}

/** Zooms about the well center, keeping the current center point in view. */
export function zoomCentered(v: ZoomPan, target: number): ZoomPan {
  if (target <= 1) return FIT;
  const k = target / v.zoom;
  return { zoom: target, x: v.x * k, y: v.y * k };
}
