import type { AppState } from "../types";

export type Tab =
  "studio" | "presets" | "artists" | "batting" | "guidance" | "settings";

/** Applies a mutation to a cloned draft and schedules an autosave. */
export type Edit = (fn: (s: AppState) => void) => void;

/** Runs an async action with the busy flag set; failures go to the error notice. */
export type Task = (fn: () => Promise<void>) => Promise<void>;
