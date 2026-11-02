import { useLayoutEffect, useRef, useState } from "react";
import {
  FlaskConical,
  Image,
  Layers,
  Palette,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { Tab } from "../lib/actions";
import { Updater } from "./Updater";

const tabs: [Tab, string, LucideIcon][] = [
  ["studio", "작업실", Image],
  ["presets", "프롬프트", Layers],
  ["artists", "작가", Palette],
  ["batting", "타율 테스트", FlaskConical],
  ["guidance", "가이던스 테스트", SlidersHorizontal],
  ["settings", "설정", Settings],
];

export function AppHeader({
  tab,
  setTab,
  updateBlocked,
  prepareUpdate,
  saveStatus,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  updateBlocked: boolean;
  prepareUpdate: () => Promise<void>;
  saveStatus: string;
}) {
  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  // The highlight glides between menu items instead of jumping.
  useLayoutEffect(() => {
    const place = () => {
      const active = nav.current?.querySelector<HTMLElement>("button.active");
      if (!active) return;
      setPill({
        x: active.offsetLeft,
        y: active.offsetTop,
        w: active.offsetWidth,
        h: active.offsetHeight,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (nav.current) observer.observe(nav.current);
    return () => observer.disconnect();
  }, [tab]);

  const saving = saveStatus !== "자동 저장됨";
  return (
    <header className="app-header">
      <div className="wordmark">
        NAI <em>/</em> ACLAB <small>STUDIO</small>
      </div>
      <nav aria-label="주 메뉴" ref={nav}>
        {pill && (
          <span
            className="nav-indicator"
            aria-hidden="true"
            style={{
              transform: `translate(${pill.x}px, ${pill.y}px)`,
              width: pill.w,
              height: pill.h,
            }}
          />
        )}
        {tabs.map(([id, title, Icon]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {title}
          </button>
        ))}
      </nav>
      <Updater blocked={updateBlocked} prepare={prepareUpdate} />
      <span
        className={"save-status" + (saving ? " saving" : "")}
        aria-live="polite"
        title={saveStatus}
      >
        {saveStatus}
      </span>
    </header>
  );
}
