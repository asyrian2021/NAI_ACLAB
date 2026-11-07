import { useCallback, useLayoutEffect, useState } from "react";

export type FitTiles = {
  cols: number;
  rows: number;
  /** Image box size in px; 0 until the container has been measured. */
  width: number;
  height: number;
  /** Captions sit beside the images instead of below them. */
  side: boolean;
};

export type FitOptions = {
  /** Space between tiles in px. */
  gap?: number;
  /** Height reserved below every image for its caption (0 = none). */
  caption?: number;
  /** Width a caption takes beside its image, gap included (0 = never beside). */
  sideCaption?: number;
  maxCols?: number;
};

/**
 * The grid that shows `count` images of aspect `ratio` (width / height) as
 * large as possible inside `w`×`h`, with each caption either below or beside
 * its image, whichever leaves the images bigger. On a tie the layout with
 * more columns (fewer rows) wins, so a comparison stays side by side.
 */
export function fitTiles(
  count: number,
  ratio: number,
  w: number,
  h: number,
  { gap = 12, caption = 0, sideCaption = 0, maxCols = count }: FitOptions = {},
): FitTiles {
  let best: FitTiles = {
    cols: Math.max(1, count),
    rows: 1,
    width: 0,
    height: 0,
    side: false,
  };
  if (count < 1 || w <= 0 || h <= 0 || !(ratio > 0)) return best;
  const modes = sideCaption > 0 ? [false, true] : [false];
  for (let cols = Math.min(count, Math.max(1, maxCols)); cols >= 1; cols--) {
    const rows = Math.ceil(count / cols);
    for (const side of modes) {
      const cellW = (w - gap * (cols - 1)) / cols - (side ? sideCaption : 0);
      const cellH = (h - gap * (rows - 1)) / rows - (side ? 0 : caption);
      if (cellW <= 0 || cellH <= 0) continue;
      const width = Math.floor(Math.min(cellW, cellH * ratio));
      // Below wins ties: the caption then lines up with the image width.
      if (width > best.width + (side ? 8 : 0))
        best = { cols, rows, width, height: Math.floor(width / ratio), side };
    }
  }
  return best;
}

/**
 * Measures a container and fits `count` image tiles into it with no slack
 * inside the tiles. Captions are the container's `[data-fit-caption]`
 * elements; the tallest one (plus `captionGap`) is what a caption below an
 * image needs. Attach the returned callback ref to the container, which must
 * get its size from the layout (flex/grid), not from the tiles.
 */
export function useFitTiles(
  count: number,
  ratio: number,
  {
    gap = 12,
    captionGap = 0,
    sideCaption = 0,
    maxCols,
    contentKey = "",
  }: {
    gap?: number;
    captionGap?: number;
    sideCaption?: number;
    maxCols?: number;
    /** Changes whenever the tiles (and so their captions) are replaced. */
    contentKey?: string;
  } = {},
) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0, caption: 0 });
  const ref = useCallback((el: HTMLElement | null) => setNode(el), []);

  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const captions = node.querySelectorAll<HTMLElement>("[data-fit-caption]");
      let caption = 0;
      captions.forEach((c) => (caption = Math.max(caption, c.offsetHeight)));
      if (captions.length) caption += captionGap;
      const w = node.clientWidth;
      const h = node.clientHeight;
      setBox((b) =>
        b.w === w && b.h === h && b.caption === caption ? b : { w, h, caption },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node
      .querySelectorAll<HTMLElement>("[data-fit-caption]")
      .forEach((c) => observer.observe(c));
    measure();
    return () => observer.disconnect();
    // Captions come and go with the tiles, so watch again when they change.
  }, [node, count, captionGap, contentKey]);

  return [
    ref,
    fitTiles(count, ratio, box.w, box.h, {
      gap,
      caption: box.caption,
      sideCaption,
      maxCols,
    }),
  ] as const;
}

/** Aspect ratio (width / height) reported by an image once it has loaded. */
export function naturalRatio(img: HTMLImageElement) {
  return img.naturalWidth && img.naturalHeight
    ? img.naturalWidth / img.naturalHeight
    : 0;
}
