import { useEffect, useRef, type MouseEvent } from "react";

/**
 * Lets one element take both a click and a double click: the click waits
 * `delay` ms and is dropped when a second click turns it into a double click.
 * Keyboard activation (Enter / Space, detail 0) acts at once.
 */
export function useClickOrDouble(delay = 250) {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (single: () => void, double: () => void) => ({
    onClick: (event: MouseEvent) => {
      window.clearTimeout(timer.current);
      if (event.detail === 0) single();
      else if (event.detail === 1)
        timer.current = window.setTimeout(single, delay);
    },
    onDoubleClick: () => {
      window.clearTimeout(timer.current);
      double();
    },
  });
}
