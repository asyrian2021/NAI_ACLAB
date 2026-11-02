import { useEffect, useRef, useState } from "react";
import { FIT, zoomCentered, type ZoomPan } from "../lib/zoom";
import type { AppState, ImageItem } from "../types";

export type ViewMode = "single" | "compare" | "grid";
export type CompareMode = "side" | "slider" | "overlay";

/**
 * Studio viewing state (selection, zoom, filters). Lives in App rather than the
 * studio page so it survives switching to other menus and back.
 */
export function useStudioView(state: AppState | null) {
  const [view, setView] = useState<ViewMode>("single");
  const [compareMode, setCompareMode] = useState<CompareMode>("side");
  const [split, setSplit] = useState(50);
  const [blend, setBlend] = useState(50);
  const [focus, setFocus] = useState(false);
  const [selected, setSelected] = useState("");
  const [reference, setReference] = useState<ImageItem | null>(null);
  const [zoomPan, setZoomPan] = useState<ZoomPan>(FIT);
  const [favorites, setFavorites] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("");
  const [limit, setLimit] = useState(60);
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());
  const known = useRef<Set<string> | null>(null);

  const all =
    state?.history.flatMap((h) =>
      h.items.map((i) => ({ ...i, history_id: h.id })),
    ) || [];
  const images = all.filter(
    (i) =>
      (!favorites || i.favorite) &&
      (!historyFilter || i.history_id === historyFilter),
  );
  const current = all.find((i) => i.path === selected) || images[0] || null;
  const index = images.findIndex((i) => i.path === current?.path);
  /** The most recently generated image (last item of the newest run). */
  const newest = state?.history[0]?.items.at(-1) ?? null;

  useEffect(() => {
    if (current && (!selected || !all.some((i) => i.path === selected)))
      setSelected(current.path);
  }, [current?.path, selected]);

  // Images that arrived after the first load and have not been looked at yet.
  const allKey = all.map((i) => i.path).join("\n");
  useEffect(() => {
    if (!state) return;
    const paths = all.map((i) => i.path);
    if (!known.current) {
      known.current = new Set(paths);
      return;
    }
    const seen = known.current;
    const fresh = paths.filter((p) => !seen.has(p));
    paths.forEach((p) => seen.add(p));
    const present = new Set(paths);
    setUnseen((prev) => {
      const next = new Set([...prev].filter((p) => present.has(p)));
      fresh.forEach((p) => next.add(p));
      return next.size === prev.size && fresh.length === 0 ? prev : next;
    });
  }, [allKey, !!state]);
  useEffect(() => {
    if (!current || !unseen.has(current.path)) return;
    setUnseen((prev) => {
      const next = new Set(prev);
      next.delete(current.path);
      return next;
    });
  }, [current?.path, unseen]);

  function select(image: ImageItem) {
    setSelected(image.path);
    setZoomPan((v) => ({ ...v, x: 0, y: 0 }));
  }
  function step(delta: number) {
    if (images.length)
      select(
        images[(Math.max(0, index) + delta + images.length) % images.length],
      );
  }
  function setZoom(zoom: number) {
    setZoomPan((v) => zoomCentered(v, zoom));
  }
  function resetZoom() {
    setZoomPan(FIT);
  }
  /** Pins the current image as the comparison reference and moves on. */
  function pinReference() {
    if (!current) return;
    setReference(current);
    setView("compare");
    if (images.length > 1) step(1);
  }
  function changeView(next: ViewMode) {
    setView(next);
    resetZoom();
    if (next === "compare" && !reference && current) setReference(current);
  }
  /** Jumps to the newest image, clearing filters that would hide it. */
  function showNewest() {
    if (!newest) return;
    setFavorites(false);
    setHistoryFilter("");
    setSelected(newest.path);
    setZoomPan(FIT);
    setUnseen(new Set());
  }

  return {
    view,
    setView,
    changeView,
    compareMode,
    setCompareMode,
    split,
    setSplit,
    blend,
    setBlend,
    focus,
    setFocus,
    selected,
    setSelected,
    reference,
    setReference,
    pinReference,
    zoomPan,
    setZoomPan,
    zoom: zoomPan.zoom,
    setZoom,
    resetZoom,
    favorites,
    setFavorites,
    historyFilter,
    setHistoryFilter,
    limit,
    setLimit,
    images,
    current,
    index,
    newest,
    unseen,
    showNewest,
    select,
    step,
  };
}

export type StudioViewState = ReturnType<typeof useStudioView>;
