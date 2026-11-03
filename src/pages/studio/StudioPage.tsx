import { useEffect, useState } from "react";
import {
  Columns2,
  Grid2X2,
  Image,
  Keyboard,
  PanelLeftClose,
  Pin,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../api";
import { ShortcutHelp } from "../../components/ShortcutHelp";
import type { StudioViewState, ViewMode } from "../../hooks/useStudioView";
import type { Edit, Tab, Task } from "../../lib/actions";
import type { AppState, ExploreEntry, Job } from "../../types";
import { Filmstrip } from "./Filmstrip";
import { GenerationPanel } from "./GenerationPanel";
import { ImageDetails } from "./ImageDetails";
import { StudioViewer } from "./StudioViewer";

const views: [ViewMode, string, LucideIcon][] = [
  ["single", "감상", Image],
  ["compare", "비교", Columns2],
  ["grid", "모아보기", Grid2X2],
];
const viewKeys: Record<string, ViewMode> = {
  Digit1: "single",
  Digit2: "compare",
  Digit3: "grid",
};

/** The studio: toolbar, three-column workspace and filmstrip. */
export function StudioPage({
  state,
  studio,
  pending,
  edit,
  task,
  busy,
  setTab,
  openPresetEditor,
  generate,
  previewPrompt,
  copy,
  setMessage,
  refreshHistory,
  exploreFrom,
}: {
  state: AppState;
  studio: StudioViewState;
  pending: Job[];
  edit: Edit;
  task: Task;
  busy: boolean;
  setTab: (tab: Tab) => void;
  openPresetEditor: () => void;
  generate: () => Promise<void>;
  previewPrompt: () => Promise<void>;
  copy: (text: string) => Promise<void>;
  setMessage: (text: string) => void;
  refreshHistory: () => Promise<void>;
  exploreFrom: (entry: ExploreEntry) => void;
}) {
  const {
    view,
    changeView,
    focus,
    setFocus,
    current,
    zoom,
    setZoom,
    step,
    resetZoom,
    pinReference,
  } = studio;
  const [helpOpen, setHelpOpen] = useState(false);
  const [burst, setBurst] = useState(0);

  function runGenerate() {
    if (busy) return;
    setBurst((n) => n + 1);
    void task(generate);
  }
  async function toggleFavorite() {
    if (!current) return;
    await api("history/favorite", {
      history_id: current.history_id,
      path: current.path,
      favorite: !current.favorite,
    });
    await refreshHistory();
  }

  // Re-registered every render so the handler always sees current state.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runGenerate();
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable],[role=slider]",
        )
      )
        return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (helpOpen) {
        if (e.key === "Escape") setHelpOpen(false);
        return;
      }
      if (document.querySelector(".modal-backdrop, dialog[open]")) return;
      const letter = e.code.startsWith("Key")
        ? e.code.slice(3)
        : e.key.toUpperCase();
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (letter === "F") setFocus((v) => !v);
      else if (letter === "H") {
        if (current) void task(toggleFavorite);
      } else if (letter === "P") pinReference();
      else if (viewKeys[e.code]) changeView(viewKeys[e.code]);
      else if (e.key === "+" || e.key === "=") {
        if (view !== "grid") setZoom(Math.min(8, zoom * 1.25));
      } else if (e.key === "-" || e.key === "_") {
        if (view !== "grid") setZoom(zoom / 1.25 <= 1.01 ? 1 : zoom / 1.25);
      } else if (e.key === "0") resetZoom();
      else if (e.key === "Escape") {
        setFocus(false);
        resetZoom();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  return (
    <>
      <div className="toolbar">
        <div className="segments">
          {views.map(([id, title, Icon]) => (
            <button
              key={id}
              aria-pressed={view === id}
              onClick={() => changeView(id)}
            >
              <Icon size={15} />
              {title}
            </button>
          ))}
        </div>
        <div className="row">
          <button disabled={!current} onClick={pinReference}>
            <Pin size={14} />
            기준으로 고정
          </button>
          <button aria-pressed={focus} onClick={() => setFocus(!focus)}>
            <PanelLeftClose size={15} />
            집중 보기 <kbd>F</kbd>
          </button>
          <button
            aria-label="단축키 안내"
            title="단축키 안내 (?)"
            onClick={() => setHelpOpen(true)}
          >
            <Keyboard size={15} />
            <kbd>?</kbd>
          </button>
        </div>
      </div>
      <div className="workspace">
        <GenerationPanel
          state={state}
          edit={edit}
          busy={busy}
          task={task}
          runGenerate={runGenerate}
          burst={burst}
          previewPrompt={previewPrompt}
          setTab={setTab}
          openPresetEditor={openPresetEditor}
        />
        <StudioViewer studio={studio} setTab={setTab} />
        <ImageDetails
          state={state}
          studio={studio}
          edit={edit}
          task={task}
          setTab={setTab}
          copy={copy}
          setMessage={setMessage}
          toggleFavorite={toggleFavorite}
          exploreFrom={exploreFrom}
        />
      </div>
      <Filmstrip
        state={state}
        studio={studio}
        pending={pending}
        task={task}
        refreshHistory={refreshHistory}
      />
      {helpOpen && <ShortcutHelp close={() => setHelpOpen(false)} />}
    </>
  );
}
