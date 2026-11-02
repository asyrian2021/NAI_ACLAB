import { useLayoutEffect, useRef, type RefObject } from "react";

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * FLIP reorder animation: children marked `data-flip-key` glide from their
 * previous position when the list order changes. Uses offsetTop, so scrolling
 * the container never triggers movement.
 */
export function useFlip(container: RefObject<HTMLElement | null>) {
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const next = new Map<string, number>();
    const animate = !reducedMotion();
    root.querySelectorAll<HTMLElement>("[data-flip-key]").forEach((node) => {
      const key = node.dataset.flipKey!;
      const top = node.offsetTop;
      const before = positions.current.get(key);
      next.set(key, top);
      if (animate && before !== undefined && before !== top)
        node.animate(
          [
            { transform: `translateY(${before - top}px)` },
            { transform: "none" },
          ],
          { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
    });
    positions.current = next;
  });
}
