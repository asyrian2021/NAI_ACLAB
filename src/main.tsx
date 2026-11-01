import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Image,
  Columns2,
  Grid2X2,
  PanelLeftClose,
  Pin,
  Heart,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Settings,
  SlidersHorizontal,
  Layers,
  Copy,
  CornerUpLeft,
  Plus,
  Trash2,
  FolderOpen,
  Shuffle,
  X,
  Check,
  Maximize2,
  FlaskConical,
  LoaderCircle,
  RefreshCw,
  ArrowUp,
  GripVertical,
} from "lucide-react";
import { api } from "./api";
import type {
  AppState,
  ImageItem,
  Job,
  Preview,
  Preset,
  Settings as ApiSettings,
} from "./types";
import "./styles.css";
import { Updater } from "./Updater";

const sizes: Record<string, [number, number]> = {
  portrait: [832, 1216],
  landscape: [1216, 832],
  square: [1024, 1024],
};
const statusNames: Record<string, string> = {
  queued: "대기",
  running: "생성 중",
  cancelling: "중지 중",
  cancelled: "중지됨",
  done: "완료",
  failed: "오류",
};
const active = (j: Job) =>
  ["queued", "running", "cancelling"].includes(j.status);
const label = (h: AppState["history"][number]) =>
  h.preset ||
  [h.base_preset, h.character_preset].filter(Boolean).join(" · ") ||
  "생성 기록";

function NumericInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      value={
        typeof props.value === "number" && Number.isNaN(props.value)
          ? ""
          : props.value
      }
    />
  );
}
function artistCount(tags: string[]) {
  return new Set(
    tags
      .join("\n")
      .split(/[,\r\n]+/)
      .map((t) => {
        const start = t.toLowerCase().indexOf("artist:");
        return start < 0
          ? ""
          : t
              .slice(start)
              .replace(/\s*::\s*$/, "")
              .trim();
      })
      .filter(Boolean),
  ).size;
}
function finiteDraft(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object")
    return Object.values(value).every(finiteDraft);
  return true;
}
function App() {
  const [dragArtist, setDragArtist] = useState<number | null>(null);
  const [dropArtist, setDropArtist] = useState<number | null>(null);
  const artistPointer = useRef<{ from: number; to: number } | null>(null);
  function moveArtist(from: number, to: number) {
    if (from === to) return;
    edit((s) => {
      const artists = s.generation.fixed_artists;
      const [artist] = artists.splice(from, 1);
      artists.splice(to, 0, artist);
    });
  }
  const [state, setState] = useState<AppState | null>(null),
    [tab, setTab] = useState("studio"),
    [view, setView] = useState("single");
  const [focus, setFocus] = useState(false),
    [selected, setSelected] = useState(""),
    [reference, setReference] = useState<ImageItem | null>(null);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [favorites, setFavorites] = useState(false),
    [historyFilter, setHistoryFilter] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]),
    [message, updateMessage] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null),
    [editPreset, setEditPreset] = useState(0),
    [queueOpen, setQueueOpen] = useState(false),
    [limit, setLimit] = useState(60);
  const [revision, setRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState("자동 저장됨");
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const [quota, setQuota] = useState<Record<string, unknown> | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null),
    latest = useRef(state),
    dirtyVersion = useRef(0),
    jobStamp = useRef("");
  latest.current = state;
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
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setMessage(text: string) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    updateMessage(text);
    messageTimer.current = setTimeout(() => updateMessage(""), 3000);
  }
  useEffect(
    () => () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 3000);
    return () => clearTimeout(timer);
  }, [error]);
  const [progressJobs, setProgressJobs] = useState<Job[]>([]);
  const batchIds = useRef(new Set<string>());
  const batchRunning = useRef(false);
  useEffect(() => {
    const running = jobs.filter(active);
    if (running.length) {
      if (!batchRunning.current) batchIds.current.clear();
      running.forEach((j) => batchIds.current.add(j.id));
    }
    batchRunning.current = running.length > 0;
    setProgressJobs(jobs.filter((j) => batchIds.current.has(j.id)));
  }, [jobs]);
  const progressTotal = progressJobs.reduce((sum, j) => sum + j.total, 0);
  const progressDone = progressJobs.reduce(
    (sum, j) => sum + Math.min(j.progress, j.total),
    0,
  );
  const progressRunning = progressJobs.some(active);
  const progressFailed = progressJobs.some(
    (j) => j.status === "failed" || (j.failures || 0) > 0,
  );
  const progressStopped = progressJobs.some((j) => j.status === "cancelled");
  const jobStatus = jobs.map((j) => `${j.id}:${j.status}`).join("|");
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = jobs.some(active);
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    const failed = jobs.some((j) => j.status === "failed");
    setMessage(
      failed
        ? "작업이 끝났습니다. 대기열에서 오류를 확인하세요."
        : "생성 작업이 끝났습니다.",
    );
    if (failed) return;
    const timer = setTimeout(() => setQueueOpen(false), 3000);
    return () => clearTimeout(timer);
  }, [jobStatus]);
  useEffect(() => {
    if (current && (!selected || !all.some((i) => i.path === selected)))
      setSelected(current.path);
  }, [current?.path, selected]);
  function edit(fn: (s: AppState) => void) {
    setState((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    dirtyVersion.current++;
    setRevision((v) => v + 1);
    setDirty(true);
  }
  async function task(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function refreshHistory() {
    const { state: next } = await api<{ state: AppState }>("state");
    setState((prev) => (prev ? { ...prev, history: next.history } : next));
  }
  async function refreshQuota() {
    try {
      const r = await api<{ quota: Record<string, unknown> }>("quota");
      setQuota(r.quota);
    } catch {
      setQuota({ reason: "할당량을 확인하지 못했습니다." });
    }
  }
  useEffect(() => {
    api<{ state: AppState }>("state")
      .then((r) => {
        setState(r.state);
        setSelected(r.state.history.flatMap((h) => h.items)[0]?.path || "");
      })
      .catch((e) => setError(e.message));
    void refreshQuota();
  }, []);
  useEffect(() => {
    let live = true,
      inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await api<{ jobs: Job[] }>("jobs");
        if (!live) return;
        setJobs(r.jobs);
        const stamp = JSON.stringify(
          r.jobs.map((j) => [j.id, j.status, j.progress]),
        );
        if (stamp !== jobStamp.current) {
          jobStamp.current = stamp;
          await refreshHistory();
          if (r.jobs.length && !r.jobs.some(active)) void refreshQuota();
        }
      } catch (e) {
        if (live) setError("엔진 연결을 확인하세요: " + (e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 1500),
      q = setInterval(refreshQuota, 60000);
    return () => {
      live = false;
      clearInterval(timer);
      clearInterval(q);
    };
  }, []);
  async function persist() {
    const snapshot = structuredClone(latest.current);
    const version = dirtyVersion.current;
    if (!snapshot) return;
    if (!finiteDraft(snapshot))
      throw new Error("비어 있는 숫자 입력을 확인하세요.");
    const operation = saveChain.current
      .catch(() => {})
      .then(async () => {
        setSaveStatus("저장 중…");
        const { state: next } = await api<{ state: AppState }>("state", {
          state: snapshot,
        });
        if (version === dirtyVersion.current) {
          // Keep editor text/caret intact; the engine normalizes its stored copy.
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  api: {
                    ...prev.api,
                    token: "",
                    token_saved: next.api.token_saved,
                  },
                }
              : prev,
          );
          setDirty(false);
          setSaveStatus("자동 저장됨");
        }
      });
    saveChain.current = operation;
    return operation;
  }
  useEffect(() => {
    if (!dirty || !state) return;
    if (!finiteDraft(state)) {
      setSaveStatus("입력 확인 필요 · 미저장");
      return;
    }
    setSaveStatus("저장 대기 중…");
    const timer = setTimeout(() => {
      void persist().catch((e) => setSaveStatus("미저장 · " + e.message));
    }, 650);
    return () => clearTimeout(timer);
  }, [dirty, revision]);
  async function generate(batting = false) {
    if (!latest.current) return;
    await persist();
    const queued = await api<{ job_id: string }>(
      batting ? "batting/generate" : "generate",
      {
        state: { ...latest.current, api: { ...latest.current.api, token: "" } },
      },
    );
    if (!batchRunning.current) batchIds.current.clear();
    batchIds.current.add(queued.job_id);
    batchRunning.current = true;
    wasRunning.current = true;
    setQueueOpen(true);
    setMessage("생성 대기열에 추가했습니다.");
  }
  function select(image: ImageItem) {
    setSelected(image.path);
    setPan({ x: 0, y: 0 });
  }
  function step(delta: number) {
    if (images.length)
      select(
        images[(Math.max(0, index) + delta + images.length) % images.length],
      );
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (tab !== "studio") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
      if (e.key.toLowerCase() === "f") setFocus((v) => !v);
      if (e.key === "Escape") {
        setFocus(false);
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [images, selected, tab]);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("클립보드에 복사했습니다.");
    } catch {
      setError("복사에 실패했습니다. 텍스트를 선택해 복사하세요.");
    }
  }
  function reuse() {
    if (!current) return;
    edit((s) => {
      s.generation.fixed_artists = structuredClone(current.artists || []);
      if (
        current.preset &&
        s.prompt_presets.some((p) => p.name === current.preset)
      )
        s.generation.preset = current.preset;
    });
    setFocus(false);
    setMessage(
      "작가 가중치와 순서를 고정했습니다. 생성 설정에서 수정할 수 있습니다.",
    );
  }
  async function favorite() {
    if (!current) return;
    await api("history/favorite", {
      history_id: current.history_id,
      path: current.path,
      favorite: !current.favorite,
    });
    await refreshHistory();
  }
  function imageCard(item: ImageItem, pinned = false) {
    return (
      <figure
        key={(pinned ? "ref" : "img") + item.path}
        className={
          "image-card " + (current?.path === item.path ? "selected" : "")
        }
      >
        <div
          className="image-well"
          onDoubleClick={() => {
            select(item);
            setView("single");
          }}
        >
          {item.error ? (
            <div className="image-error">
              생성 실패<p>{item.error}</p>
            </div>
          ) : (
            <img
              src={item.image_url}
              alt={item.scene_name || item.preset || "생성 이미지"}
              draggable={false}
              style={{
                transform: `translate(${pan.x}px,${pan.y}px) scale(${view === "grid" ? 1 : zoom})`,
              }}
            />
          )}
          {pinned && (
            <span className="pin-label">
              <Pin size={12} /> 기준 이미지
            </span>
          )}
        </div>
        <figcaption>
          <button onClick={() => select(item)}>
            {item.path.split("/").pop()}
          </button>
          <span>
            {item.mock ? (
              "체험 이미지"
            ) : item.favorite ? (
              <Heart size={12} fill="currentColor" />
            ) : (
              ""
            )}
          </span>
        </figcaption>
      </figure>
    );
  }
  if (!state)
    return (
      <div className="loading">
        <div className="wordmark">
          NAI <em>/</em> ACLAB
        </div>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => location.reload()}>다시 시도</button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" /> 작업 공간을 준비하고 있습니다.
          </p>
        )}
      </div>
    );
  const preset = state.prompt_presets[editPreset];
  const pending = jobs.filter(active);
  const field = (key: keyof ApiSettings, title: string, type = "number") => (
    <label key={key}>
      {title}
      <NumericInput
        type={type}
        step="any"
        value={String(state.api[key] ?? "")}
        onChange={(e) =>
          edit((s) => {
            (s.api as unknown as Record<string, unknown>)[key] =
              type === "number" ? e.target.valueAsNumber : e.target.value;
          })
        }
      />
    </label>
  );
  const seedControls = (
    <div className="seed-controls">
      <p className="micro selectable seed-setting">
        다음 생성:{" "}
        {state.api.seed === -1 ? "랜덤 시드" : `Seed ${state.api.seed} 고정`}
      </p>
      {current?.seed !== undefined && (
        <button
          className="outline full"
          aria-pressed={state.api.seed === current.seed}
          onClick={() =>
            edit((s) => {
              s.api.seed = current.seed!;
            })
          }
        >
          이 시드 사용
        </button>
      )}
      {state.api.seed !== -1 && (
        <button
          className="text-button"
          onClick={() =>
            edit((s) => {
              s.api.seed = -1;
            })
          }
        >
          시드 고정 해제
        </button>
      )}
    </div>
  );
  return (
    <div
      className={
        "app " +
        (tab === "studio" ? "studio-layout " : "") +
        (focus && tab === "studio" ? "focus" : "")
      }
    >
      <header className="app-header">
        <div className="wordmark">
          NAI <em>/</em> ACLAB <small>STUDIO</small>
        </div>
        <nav aria-label="주 메뉴">
          {[
            ["studio", "작업실", Image],
            ["presets", "프롬프트", Layers],
            ["artists", "작가", SlidersHorizontal],
            ["batting", "타율 테스트", FlaskConical],
            ["settings", "설정", Settings],
          ].map(([id, title, Icon]) => (
            <button
              key={id as string}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id as string)}
            >
              <Icon size={15} />
              {title as string}
            </button>
          ))}
        </nav>
        <Updater
          blocked={busy || pending.length > 0}
          prepare={async () => {
            const currentJobs = await api<{ jobs: Job[] }>("jobs");
            if (currentJobs.jobs.some(active))
              throw new Error("생성 작업이 끝난 후 업데이트하세요.");
            await persist();
          }}
        />
        <span className="save-status" aria-live="polite" title={saveStatus}>
          {saveStatus}
        </span>
      </header>
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <button aria-label="오류 닫기" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {tab === "studio" ? (
        <>
          <div className="toolbar">
            <div className="segments">
              {[
                ["single", "감상", Image],
                ["compare", "비교", Columns2],
                ["grid", "모아보기", Grid2X2],
              ].map(([id, title, Icon]) => (
                <button
                  key={id as string}
                  aria-pressed={view === id}
                  onClick={() => {
                    setView(id as string);
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                    if (id === "compare" && !reference && current)
                      setReference(current);
                  }}
                >
                  <Icon size={15} />
                  {title as string}
                </button>
              ))}
            </div>
            <div className="row">
              <button
                disabled={!current}
                onClick={() => {
                  setReference(current);
                  setView("compare");
                  if (images.length > 1) step(1);
                }}
              >
                <Pin size={14} />
                기준으로 고정
              </button>
              <button aria-pressed={focus} onClick={() => setFocus(!focus)}>
                <PanelLeftClose size={15} />
                집중 보기 <kbd>F</kbd>
              </button>
            </div>
          </div>
          <div className="workspace">
            <aside className="left-panel">
              <section>
                <h2>다음 이미지 만들기</h2>
                <label>
                  프롬프트 프리셋
                  <select
                    value={state.generation.preset}
                    onChange={(e) =>
                      edit((s) => (s.generation.preset = e.target.value))
                    }
                  >
                    <option value="">프리셋 선택</option>
                    {state.prompt_presets.map((p) => (
                      <option key={p.name}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="text-button"
                  onClick={() => {
                    setEditPreset(
                      Math.max(
                        0,
                        state.prompt_presets.findIndex(
                          (p) => p.name === state.generation.preset,
                        ),
                      ),
                    );
                    setTab("presets");
                  }}
                >
                  프롬프트 편집 <ChevronRight size={13} />
                </button>
              </section>
              <section>
                <div className="two-fields">
                  <label>
                    이미지 크기
                    <select
                      value={state.generation.image_size}
                      onChange={(e) =>
                        edit((s) => {
                          s.generation.image_size = e.target.value;
                          if (sizes[e.target.value])
                            [s.api.width, s.api.height] = sizes[e.target.value];
                        })
                      }
                    >
                      <option value="portrait">세로</option>
                      <option value="landscape">가로</option>
                      <option value="square">정사각형</option>
                      <option value="custom">직접 설정</option>
                    </select>
                  </label>
                  <label>
                    생성 매수
                    <NumericInput
                      type="number"
                      min="1"
                      max="200"
                      value={state.generation.count}
                      onChange={(e) =>
                        edit(
                          (s) =>
                            (s.generation.count =
                              e.target.value === ""
                                ? NaN
                                : Number(e.target.value)),
                        )
                      }
                    />
                  </label>
                </div>
                <p className="muted">
                  {state.api.width} × {state.api.height} · {state.api.steps}{" "}
                  steps
                </p>
                {state.generation.image_size === "custom" && (
                  <div className="two-fields">
                    {field("width", "가로 픽셀")}
                    {field("height", "세로 픽셀")}
                  </div>
                )}
                <div className="two-fields guidance-fields">
                  {field("scale", "Prompt guidance")}
                  {field("guidance_rescale", "Guidance rescale")}
                </div>
                <button
                  className="outline full"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      await persist();
                      const r = await api<Preview>("preview", {
                        state: latest.current,
                      });
                      setPreview(r);
                      setMessage(
                        "프롬프트를 미리 조합했습니다. 생성 시 랜덤 조합은 새로 추첨됩니다.",
                      );
                    })
                  }
                >
                  프롬프트 미리보기
                </button>
                <button
                  className="primary full generate"
                  disabled={busy}
                  onClick={() => void task(() => generate())}
                >
                  <Sparkles size={16} />
                  {state.api.mock_mode
                    ? "체험 이미지 생성"
                    : "생성 대기열에 추가"}
                </button>
                <p className="micro">
                  {state.api.mock_mode
                    ? "API를 사용하지 않는 체험 모드"
                    : "NovelAI API 사용 · Anlas가 소모될 수 있습니다"}
                </p>
              </section>
              <section>
                <div className="section-heading">
                  <h2>작가 조합</h2>
                  {state.generation.fixed_artists.length ? (
                    <button
                      className="text-button artist-randomize"
                      onClick={() =>
                        edit((s) => {
                          s.generation.fixed_artists = [];
                        })
                      }
                    >
                      <Shuffle size={13} />
                      랜덤으로 전환
                    </button>
                  ) : (
                    <span className="badge">랜덤</span>
                  )}
                </div>
                {state.generation.fixed_artists.length ? (
                  <>
                    <p className="muted">
                      핸들을 드래그해 순서를 바꿀 수 있습니다.
                    </p>
                    {state.generation.fixed_artists.map((a, i) => (
                      <div
                        className={
                          "fixed-artist" +
                          (dragArtist === i ? " dragging" : "") +
                          (dropArtist === i && dragArtist !== i
                            ? " drop-target"
                            : "")
                        }
                        key={i}
                        data-artist-index={i}
                      >
                        <div className="fixed-artist-heading">
                          <button
                            className="drag-handle"
                            aria-label={`${a.tag} 순서 드래그`}
                            title="드래그 또는 위아래 방향키로 순서 변경"
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.preventDefault();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              artistPointer.current = { from: i, to: i };
                              setDragArtist(i);
                              setDropArtist(i);
                            }}
                            onPointerMove={(e) => {
                              if (!artistPointer.current) return;
                              const panel = e.currentTarget.closest(
                                ".left-panel",
                              ) as HTMLElement;
                              const rect = panel.getBoundingClientRect();
                              if (e.clientY < rect.top + 35)
                                panel.scrollTop -= 18;
                              if (e.clientY > rect.bottom - 35)
                                panel.scrollTop += 18;
                              const target = document
                                .elementFromPoint(e.clientX, e.clientY)
                                ?.closest(
                                  "[data-artist-index]",
                                ) as HTMLElement | null;
                              if (target) {
                                const to = Number(target.dataset.artistIndex);
                                artistPointer.current.to = to;
                                setDropArtist(to);
                              }
                            }}
                            onPointerUp={(e) => {
                              const pointer = artistPointer.current;
                              artistPointer.current = null;
                              if (
                                e.currentTarget.hasPointerCapture(e.pointerId)
                              )
                                e.currentTarget.releasePointerCapture(
                                  e.pointerId,
                                );
                              if (pointer) moveArtist(pointer.from, pointer.to);
                              setDragArtist(null);
                              setDropArtist(null);
                            }}
                            onPointerCancel={() => {
                              artistPointer.current = null;
                              setDragArtist(null);
                              setDropArtist(null);
                            }}
                            onLostPointerCapture={() => {
                              artistPointer.current = null;
                              setDragArtist(null);
                              setDropArtist(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowUp" && i > 0) {
                                e.preventDefault();
                                moveArtist(i, i - 1);
                              } else if (
                                e.key === "ArrowDown" &&
                                i < state.generation.fixed_artists.length - 1
                              ) {
                                e.preventDefault();
                                moveArtist(i, i + 1);
                              }
                            }}
                          >
                            <GripVertical size={15} />
                          </button>
                          <span>{a.tag}</span>
                        </div>
                        <div className="row">
                          <NumericInput
                            aria-label={a.tag + " 가중치"}
                            type="number"
                            min="0"
                            max="10"
                            step="0.05"
                            value={a.weight}
                            onChange={(e) =>
                              edit(
                                (s) =>
                                  (s.generation.fixed_artists[i].weight =
                                    e.target.value === ""
                                      ? NaN
                                      : Number(e.target.value)),
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    {state.categories.map((c, i) => (
                      <div className="category-summary" key={i}>
                        <div className="row spread">
                          <span>{c.name}</span>
                          <span className="accent">
                            {c.all_artists
                              ? "전체"
                              : `${c.min_picks}~${c.max_picks}명`}
                          </span>
                        </div>
                        <div className="row spread muted">
                          <span>등록 {artistCount(c.tags)}명</span>
                          <span>
                            {c.min_weight} ~ {c.max_weight}
                          </span>
                        </div>
                      </div>
                    ))}
                    <button
                      className="text-button"
                      onClick={() => setTab("artists")}
                    >
                      작가와 가중치 범위 편집 <ChevronRight size={13} />
                    </button>
                  </>
                )}
              </section>
            </aside>
            <main className="canvas">
              <div
                className={"stage " + view}
                onPointerDown={(e) => {
                  if (
                    zoom > 1 &&
                    view !== "grid" &&
                    !(e.target as HTMLElement).closest("button")
                  ) {
                    drag.current = {
                      x: e.clientX - pan.x,
                      y: e.clientY - pan.y,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }
                }}
                onPointerMove={(e) => {
                  if (drag.current)
                    setPan({
                      x: Math.max(
                        -600,
                        Math.min(600, e.clientX - drag.current.x),
                      ),
                      y: Math.max(
                        -800,
                        Math.min(800, e.clientY - drag.current.y),
                      ),
                    });
                }}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
              >
                {images.length === 0 ? (
                  <div className="empty">
                    <Image size={38} strokeWidth={1} />
                    <h1>
                      {favorites
                        ? "즐겨찾기한 이미지가 없습니다"
                        : "새로운 그림체를 발견하세요"}
                    </h1>
                    <p>
                      {favorites
                        ? "이미지의 하트를 눌러 모아보세요."
                        : "작가와 프롬프트를 준비하고 첫 이미지를 만들어 보세요."}
                    </p>
                    {!favorites && (
                      <button
                        className="outline"
                        onClick={() => setTab("artists")}
                      >
                        작가 등록하기 <ChevronRight size={15} />
                      </button>
                    )}
                  </div>
                ) : view === "grid" ? (
                  images.slice(0, limit).map((i) => imageCard(i))
                ) : view === "compare" ? (
                  <>
                    {reference ? (
                      imageCard(reference, true)
                    ) : (
                      <div className="empty">기준 이미지를 고정하세요.</div>
                    )}
                    {current && imageCard(current)}
                  </>
                ) : (
                  current && imageCard(current)
                )}
              </div>
              {view === "grid" && images.length > limit && (
                <button onClick={() => setLimit(limit + 60)}>
                  더 보기 ({images.length - limit}장)
                </button>
              )}
              <div className="viewer-tools">
                <button
                  aria-label="이전 이미지"
                  onClick={() => step(-1)}
                  disabled={!images.length}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {images.length ? Math.max(0, index) + 1 : 0} / {images.length}
                </span>
                <button
                  aria-label="다음 이미지"
                  onClick={() => step(1)}
                  disabled={!images.length}
                >
                  <ChevronRight size={17} />
                </button>
                <i />
                <button
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  aria-pressed={zoom === 1}
                >
                  화면 맞춤
                </button>
                <button
                  disabled={view === "grid"}
                  onClick={() => setZoom(2)}
                  aria-pressed={zoom === 2}
                >
                  2×
                </button>
                <button
                  disabled={view === "grid"}
                  onClick={() => setZoom(4)}
                  aria-pressed={zoom === 4}
                >
                  4×
                </button>
                {view === "compare" && (
                  <span className="muted">확대·이동 동기화</span>
                )}
              </div>
            </main>
            <aside className="right-panel">
              {current ? (
                <>
                  <section>
                    <div className="section-heading">
                      <h2>선택한 이미지</h2>
                      <button
                        aria-label="즐겨찾기"
                        className={current.favorite ? "accent" : ""}
                        aria-pressed={!!current.favorite}
                        onClick={() => void task(favorite)}
                      >
                        <Heart
                          size={18}
                          fill={current.favorite ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                    <div className="image-title">
                      {current.preset || current.scene_name || "이전 생성 결과"}
                    </div>
                    <p className="muted">
                      {current.width && current.height
                        ? `${current.width} × ${current.height} · `
                        : ""}
                      {current.mock ? "체험 모드" : "생성 결과"}
                    </p>
                    <p className="micro selectable">
                      {current.seed !== undefined ? `Seed ${current.seed}` : ""}
                    </p>
                    {seedControls}
                  </section>
                  <section>
                    <div className="section-heading">
                      <h2>작가 조합</h2>
                      <button
                        aria-label="작가 조합 복사"
                        onClick={() =>
                          void copy(
                            current.artists
                              .map((a) => `${a.weight}::${a.tag} ::`)
                              .join(", "),
                          )
                        }
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                    {(current.artists || []).map((a, i) => (
                      <div className="artist-info" key={i}>
                        <span>{a.tag}</span>
                        <strong>{a.weight}</strong>
                      </div>
                    ))}
                    {!current.artists?.length && (
                      <p className="muted">저장된 작가가 없습니다.</p>
                    )}
                    {view === "compare" && reference && (
                      <details open>
                        <summary>기준 이미지와의 차이</summary>
                        {[
                          ...new Set(
                            [...reference.artists, ...current.artists].map(
                              (a) => a.tag,
                            ),
                          ),
                        ]
                          .filter(
                            (tag) =>
                              reference.artists.find((a) => a.tag === tag)
                                ?.weight !==
                              current.artists.find((a) => a.tag === tag)
                                ?.weight,
                          )
                          .map((tag) => (
                            <div className="difference" key={tag}>
                              {tag}
                              <span>
                                {reference.artists.find((a) => a.tag === tag)
                                  ?.weight ?? "없음"}{" "}
                                →{" "}
                                {current.artists.find((a) => a.tag === tag)
                                  ?.weight ?? "없음"}
                              </span>
                            </div>
                          ))}
                      </details>
                    )}
                    <button className="outline full" onClick={reuse}>
                      <CornerUpLeft size={14} />이 조합으로 이어서
                    </button>
                  </section>
                  <section className="prompt-section">
                    <details>
                      <summary>전체 프롬프트</summary>
                      <p className="prompt-text">
                        {current.prompt ??
                          "이전 버전에서 생성한 이미지에는 원문 프롬프트가 저장되어 있지 않습니다."}
                      </p>
                    </details>
                    <button
                      aria-label="전체 프롬프트 복사"
                      disabled={!current.prompt}
                      onClick={() => void copy(current.prompt || "")}
                    >
                      <Copy size={13} />
                    </button>
                  </section>
                  <section className="prompt-section">
                    <details>
                      <summary>네거티브 프롬프트</summary>
                      <p className="prompt-text">
                        {current.negative_prompt ||
                          "저장된 네거티브가 없습니다."}
                      </p>
                    </details>
                    <button
                      aria-label="네거티브 복사"
                      disabled={!current.negative_prompt}
                      onClick={() => void copy(current.negative_prompt || "")}
                    >
                      <Copy size={13} />
                    </button>
                  </section>
                  <button
                    className="text-button"
                    onClick={() =>
                      void task(async () => {
                        await api("history/open", { id: current.history_id });
                      })
                    }
                  >
                    <FolderOpen size={14} />
                    저장 폴더 열기
                  </button>
                </>
              ) : (
                <div className="empty-info">
                  {state.api.seed !== -1 && seedControls}
                  <Layers size={25} />
                  <h2>이미지의 레시피</h2>
                  <p>
                    이미지를 선택하면 작가 조합과 프롬프트가 여기에 표시됩니다.
                  </p>
                </div>
              )}
            </aside>
          </div>
          <section className="filmstrip">
            <div className="film-head">
              <div className="row">
                <select
                  aria-label="생성 기록 선택"
                  value={historyFilter}
                  onChange={(e) => {
                    setHistoryFilter(e.target.value);
                    setSelected("");
                    setLimit(60);
                  }}
                >
                  <option value="">모든 생성 기록</option>
                  {state.history.map((h) => (
                    <option value={h.id} key={h.id}>
                      {label(h)} · {h.created_at}
                    </option>
                  ))}
                </select>
                <span className="muted">{images.length}장</span>
              </div>
              <div className="row">
                <button
                  aria-pressed={favorites}
                  onClick={() => {
                    setFavorites(!favorites);
                    setSelected("");
                  }}
                >
                  <Heart size={13} />
                  즐겨찾기만
                </button>
                {historyFilter && (
                  <button
                    aria-label="선택한 생성 기록 삭제"
                    onClick={() => {
                      if (
                        window.confirm(
                          "선택한 생성 기록을 목록에서 삭제할까요? 이미지 파일은 유지됩니다.",
                        )
                      )
                        void task(async () => {
                          await api("history/delete", { ids: [historyFilter] });
                          setHistoryFilter("");
                          setSelected("");
                          await refreshHistory();
                        });
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="thumbnails">
              {state.history.map((history, historyIndex) => {
                const visible = images
                  .slice(0, limit)
                  .filter((item) => item.history_id === history.id);
                if (!visible.length) return null;
                return (
                  <section
                    className="generation-group"
                    key={history.id}
                    aria-label={`생성 ${state.history.length - historyIndex}`}
                  >
                    <div className="generation-group-heading">
                      <strong>
                        #{state.history.length - historyIndex} ·{" "}
                        {history.type === "batting_test"
                          ? "타율 테스트"
                          : label(history)}
                      </strong>
                      <span>
                        {history.created_at} · {history.items.length}장
                        {visible.length !== history.items.length
                          ? ` (표시 ${visible.length}장)`
                          : ""}
                      </span>
                    </div>
                    <div className="generation-thumbnails">
                      {visible.map((item) => (
                        <button
                          className="thumbnail-button"
                          key={item.path}
                          aria-label={`생성 ${state.history.length - historyIndex} 이미지 ${history.items.findIndex((i) => i.path === item.path) + 1} 선택`}
                          aria-pressed={current?.path === item.path}
                          onClick={() => select(item)}
                        >
                          {item.error ? (
                            <div className="thumb-error">실패</div>
                          ) : (
                            <img src={item.image_url} loading="lazy" alt="" />
                          )}
                          <span>
                            {String(
                              history.items.findIndex(
                                (i) => i.path === item.path,
                              ) + 1,
                            ).padStart(2, "0")}
                            {item.favorite && (
                              <Heart size={10} fill="currentColor" />
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
              {images.length > limit && (
                <button className="more" onClick={() => setLimit(limit + 60)}>
                  더 보기
                </button>
              )}
              {!images.length && (
                <p className="muted">생성한 이미지가 여기에 모입니다.</p>
              )}
            </div>
          </section>
        </>
      ) : (
        <main className="editor-page" key={tab}>
          {tab === "presets" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PROMPTS</div>
                  <h1>프롬프트 프리셋</h1>
                  <p>공통 설정은 그대로, 장면과 캐릭터는 하나의 세트로.</p>
                </div>
              </div>
              <section className="global-prompts">
                <div>
                  <h2>모든 프리셋의 공통 설정</h2>
                  <p className="muted">프리셋을 바꿔도 유지됩니다.</p>
                </div>
                <div className="two-fields">
                  <label>
                    공통 퀄리티
                    <textarea
                      rows={4}
                      value={state.quality_prompt}
                      onChange={(e) =>
                        edit((s) => (s.quality_prompt = e.target.value))
                      }
                    />
                  </label>
                  <label>
                    공통 네거티브
                    <textarea
                      rows={4}
                      value={state.negative_prompt}
                      onChange={(e) =>
                        edit((s) => (s.negative_prompt = e.target.value))
                      }
                    />
                  </label>
                </div>
              </section>
              <div className="preset-layout">
                <aside className="preset-list">
                  <h2>
                    프리셋{" "}
                    <span className="muted">{state.prompt_presets.length}</span>
                  </h2>
                  {state.prompt_presets.map((p, i) => (
                    <button
                      key={i}
                      aria-pressed={editPreset === i}
                      onClick={() => setEditPreset(i)}
                    >
                      <Layers size={14} />
                      {p.name}
                    </button>
                  ))}
                  <button
                    className="outline"
                    onClick={() => {
                      let n = 1;
                      while (
                        state.prompt_presets.some(
                          (p) => p.name === `새 프리셋 ${n}`,
                        )
                      )
                        n++;
                      edit((s) =>
                        s.prompt_presets.push({
                          name: `새 프리셋 ${n}`,
                          base_prompt: "",
                          characters: [{ prompt: "", negative: "" }],
                        }),
                      );
                      setEditPreset(state.prompt_presets.length);
                    }}
                  >
                    <Plus size={14} />
                    프리셋 추가
                  </button>
                </aside>
                {preset ? (
                  <section className="preset-editor">
                    <div className="row spread">
                      <h2>개별 프리셋</h2>
                      <button
                        className="danger"
                        aria-label="프리셋 삭제"
                        onClick={() => {
                          if (
                            confirm(`“${preset.name}” 프리셋을 삭제할까요?`)
                          ) {
                            edit((s) => {
                              s.prompt_presets.splice(editPreset, 1);
                              s.batting_scenes = s.batting_scenes.filter(
                                (sc) => sc.preset !== preset.name,
                              );
                              if (s.generation.preset === preset.name)
                                s.generation.preset =
                                  s.prompt_presets[0]?.name || "";
                            });
                            setEditPreset(0);
                          }
                        }}
                      >
                        <Trash2 size={14} />
                        삭제
                      </button>
                    </div>
                    <label>
                      프리셋 이름
                      <NumericInput
                        value={preset.name}
                        onChange={(e) =>
                          edit((s) => {
                            const old = s.prompt_presets[editPreset].name;
                            s.prompt_presets[editPreset].name = e.target.value;
                            if (s.generation.preset === old)
                              s.generation.preset = e.target.value;
                            s.batting_scenes.forEach((sc) => {
                              if (sc.preset === old) sc.preset = e.target.value;
                            });
                          })
                        }
                      />
                    </label>
                    <label>
                      베이스 프롬프트
                      <textarea
                        rows={4}
                        value={preset.base_prompt}
                        onChange={(e) =>
                          edit(
                            (s) =>
                              (s.prompt_presets[editPreset].base_prompt =
                                e.target.value),
                          )
                        }
                      />
                    </label>
                    {preset.characters.map((c, i) => (
                      <div className="character-editor" key={i}>
                        <div className="row spread">
                          <h3>캐릭터 {i + 1}</h3>
                          <div className="row">
                            <button
                              aria-label="캐릭터 위로"
                              disabled={i === 0}
                              onClick={() =>
                                edit((s) => {
                                  const a =
                                    s.prompt_presets[editPreset].characters;
                                  [a[i - 1], a[i]] = [a[i], a[i - 1]];
                                })
                              }
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              aria-label="캐릭터 삭제"
                              onClick={() =>
                                edit((s) =>
                                  s.prompt_presets[
                                    editPreset
                                  ].characters.splice(i, 1),
                                )
                              }
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="two-fields">
                          <label>
                            캐릭터 프롬프트
                            <textarea
                              rows={4}
                              value={c.prompt}
                              onChange={(e) =>
                                edit(
                                  (s) =>
                                    (s.prompt_presets[editPreset].characters[
                                      i
                                    ].prompt = e.target.value),
                                )
                              }
                            />
                          </label>
                          <label>
                            캐릭터 네거티브
                            <textarea
                              rows={4}
                              value={c.negative}
                              onChange={(e) =>
                                edit(
                                  (s) =>
                                    (s.prompt_presets[editPreset].characters[
                                      i
                                    ].negative = e.target.value),
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    <button
                      className="outline"
                      onClick={() =>
                        edit((s) =>
                          s.prompt_presets[editPreset].characters.push({
                            prompt: "",
                            negative: "",
                          }),
                        )
                      }
                    >
                      <Plus size={14} />
                      캐릭터 추가
                    </button>
                  </section>
                ) : (
                  <section className="empty">프리셋을 추가하세요.</section>
                )}
              </div>
            </>
          )}
          {tab === "artists" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ARTIST PALETTE</div>
                  <h1>작가와 랜덤 조합</h1>
                  <p>
                    작가는 균등하게 추첨하고, 가중치와 태그 순서도 매번 새로
                    정합니다.
                  </p>
                </div>
                <button
                  className="outline"
                  onClick={() =>
                    edit((s) =>
                      s.categories.push({
                        name: "새 작가 그룹",
                        tags: [],
                        min_weight: 0.8,
                        max_weight: 1.2,
                        granule: 0.05,
                        picks: 0,
                        min_picks: 1,
                        max_picks: 1,
                        all_artists: true,
                      }),
                    )
                  }
                >
                  <Plus size={15} />
                  그룹 추가
                </button>
              </div>
              <div className="artist-editors">
                {state.categories.map((c, i) => (
                  <section className="artist-editor" key={i}>
                    <div className="row spread">
                      <NumericInput
                        aria-label="작가 그룹 이름"
                        value={c.name}
                        onChange={(e) =>
                          edit((s) => (s.categories[i].name = e.target.value))
                        }
                      />
                      <button
                        aria-label="작가 그룹 삭제"
                        onClick={() => {
                          if (confirm("이 작가 그룹을 삭제할까요?"))
                            edit((s) => s.categories.splice(i, 1));
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <label>
                      작가 태그
                      <textarea
                        rows={10}
                        placeholder={"artist:example_a\nartist:example_b"}
                        value={c.tags.join("\n")}
                        onChange={(e) =>
                          edit(
                            (s) =>
                              (s.categories[i].tags =
                                e.target.value.split("\n")),
                          )
                        }
                      />
                    </label>
                    <p className="muted">
                      한 줄에 하나씩 입력하거나 가중치가 포함된 태그를
                      붙여넣으세요. 저장할 때 정리됩니다.
                    </p>
                    <div className="four-fields">
                      {(["min_weight", "max_weight", "granule"] as const).map(
                        (key, j) => (
                          <label key={key}>
                            {["최소 가중치", "최대 가중치", "간격"][j]}
                            <NumericInput
                              type="number"
                              min={key === "granule" ? 0.001 : 0}
                              step={0.05}
                              value={c[key]}
                              onChange={(e) =>
                                edit(
                                  (s) =>
                                    (s.categories[i][key] =
                                      e.target.valueAsNumber),
                                )
                              }
                            />
                          </label>
                        ),
                      )}
                    </div>
                    <label className="row">
                      <input
                        type="checkbox"
                        checked={c.all_artists}
                        onChange={(e) =>
                          edit((s) => {
                            s.categories[i].all_artists = e.target.checked;
                          })
                        }
                      />
                      등록 작가 전체 사용
                    </label>
                    {!c.all_artists && (
                      <>
                        <div className="two-fields">
                          {(["min_picks", "max_picks"] as const).map(
                            (key, j) => (
                              <label key={key}>
                                {j === 0 ? "최소 추첨 인원" : "최대 추첨 인원"}
                                <NumericInput
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={c[key]}
                                  onChange={(e) =>
                                    edit((s) => {
                                      s.categories[i][key] =
                                        e.target.valueAsNumber;
                                    })
                                  }
                                />
                              </label>
                            ),
                          )}
                        </div>
                        <p className="micro">
                          실제 추첨:{" "}
                          {Math.min(c.min_picks, artistCount(c.tags))}~
                          {Math.min(c.max_picks, artistCount(c.tags))}명 · 등록{" "}
                          {artistCount(c.tags)}명. 매 이미지마다 인원을 균등
                          추첨합니다.
                        </p>
                      </>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
          {tab === "batting" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">SCENE TEST</div>
                  <h1>여러 장면에서 비교하기</h1>
                  <p>불러온 고정 조합을 여러 프리셋에서 시험할 수 있습니다.</p>
                </div>
                <button
                  className="outline"
                  onClick={() =>
                    edit((s) =>
                      s.batting_scenes.push({
                        name: "",
                        preset: s.prompt_presets[0]?.name || "",
                        image_size: "portrait",
                        count: 2,
                      }),
                    )
                  }
                >
                  <Plus size={15} />씬 추가
                </button>
              </div>
              <div className="notice">
                {state.generation.fixed_artists.length
                  ? `고정 조합 ${state.generation.fixed_artists.length}명 사용`
                  : "랜덤 모드입니다. 동일 조합으로 비교하려면 작업실에서 이미지의 조합을 불러오세요."}
              </div>
              {state.batting_scenes.map((sc, i) => (
                <section className="scene-editor" key={i}>
                  <label>
                    프롬프트 프리셋
                    <select
                      value={sc.preset}
                      onChange={(e) =>
                        edit(
                          (s) => (s.batting_scenes[i].preset = e.target.value),
                        )
                      }
                    >
                      {state.prompt_presets.map((p) => (
                        <option key={p.name}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    이미지 크기
                    <select
                      value={sc.image_size}
                      onChange={(e) =>
                        edit(
                          (s) =>
                            (s.batting_scenes[i].image_size = e.target.value),
                        )
                      }
                    >
                      <option value="portrait">세로</option>
                      <option value="landscape">가로</option>
                      <option value="square">정사각형</option>
                    </select>
                  </label>
                  <label>
                    매수
                    <NumericInput
                      type="number"
                      min="1"
                      max="200"
                      value={sc.count}
                      onChange={(e) =>
                        edit(
                          (s) =>
                            (s.batting_scenes[i].count =
                              e.target.valueAsNumber),
                        )
                      }
                    />
                  </label>
                  <button
                    aria-label="씬 삭제"
                    onClick={() => edit((s) => s.batting_scenes.splice(i, 1))}
                  >
                    <Trash2 size={15} />
                  </button>
                </section>
              ))}
              <button
                className="primary"
                disabled={busy || !state.batting_scenes.length}
                onClick={() => void task(() => generate(true))}
              >
                <FlaskConical size={15} />
                타율 테스트 시작
              </button>
            </>
          )}
          {tab === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PREFERENCES</div>
                  <h1>생성 및 API 설정</h1>
                  <p>API 토큰은 Windows 계정에 암호화해 저장됩니다.</p>
                </div>
              </div>
              <section className="settings-block">
                <label className="check">
                  <NumericInput
                    type="checkbox"
                    checked={state.api.mock_mode}
                    onChange={(e) =>
                      edit((s) => (s.api.mock_mode = e.target.checked))
                    }
                  />
                  API 없이 체험하기
                </label>
                <label>
                  NovelAI API 토큰
                  <NumericInput
                    type="password"
                    autoComplete="off"
                    placeholder={
                      state.api.token_saved
                        ? "저장된 토큰이 있습니다. 변경할 때만 입력하세요."
                        : "API 토큰 입력"
                    }
                    value={state.api.token}
                    onChange={(e) =>
                      edit((s) => (s.api.token = e.target.value))
                    }
                  />
                </label>
                <div className="two-fields">
                  {field("model", "Model", "text")}
                  {field("sampler", "Sampler", "text")}
                  {field("noise_schedule", "Noise schedule", "text")}
                  {field("steps", "Steps")}
                  {field("scale", "Prompt guidance")}
                  {field("guidance_rescale", "Guidance rescale")}
                </div>
              </section>
            </>
          )}
        </main>
      )}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="프롬프트 미리보기"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row spread">
              <h2>프롬프트 미리보기</h2>
              <button
                aria-label="미리보기 닫기"
                onClick={() => setPreview(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="muted">
              랜덤 모드에서는 실제 생성 시 새로 추첨합니다.
            </p>
            <h3>전체 프롬프트</h3>
            <p className="prompt-text">{preview.prompt || "(비어 있음)"}</p>
            <button onClick={() => void copy(preview.prompt)}>
              <Copy size={14} />
              복사
            </button>
            <h3>네거티브</h3>
            <p className="prompt-text">{preview.negative || "(비어 있음)"}</p>
          </section>
        </div>
      )}
      {queueOpen && (
        <section className="queue-panel">
          <div className="row spread">
            <h2>
              생성 대기열{" "}
              <span className="muted">{pending.length}개 진행 중</span>
            </h2>
            <button
              aria-label="대기열 닫기"
              onClick={() => setQueueOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          {jobs.length ? (
            jobs
              .slice()
              .reverse()
              .map((j) => (
                <div className="job" key={j.id}>
                  <div className="row spread">
                    <span>
                      {j.name}{" "}
                      <small>{statusNames[j.status] || j.status}</small>
                    </span>
                    <span>
                      {j.progress}/{j.total}{" "}
                      {active(j) && (
                        <button
                          aria-label="작업 중지"
                          onClick={() =>
                            void task(async () => {
                              await api("job/cancel", { job_id: j.id });
                              setMessage(
                                "현재 처리 중인 이미지가 끝나면 중지합니다.",
                              );
                            })
                          }
                        >
                          <X size={14} />
                        </button>
                      )}
                    </span>
                  </div>
                  <progress value={j.progress} max={j.total} />
                  {j.last_error && <p className="error-text">{j.last_error}</p>}
                </div>
              ))
          ) : (
            <p className="muted">대기 중인 작업이 없습니다.</p>
          )}
        </section>
      )}
      <footer className="statusbar">
        <span role="status" className="status-message">
          <span className="status-dot" />
          {busy
            ? "처리 중…"
            : message ||
              (dirty ? "저장하지 않은 변경 사항이 있습니다." : "준비됨")}
        </span>
        <div className="row">
          <div
            className={"total-progress " + (progressRunning ? "running" : "")}
            title="현재 대기열 묶음의 이미지 처리 진행률"
          >
            <span className="progress-count">
              {progressDone}/{progressTotal}장
              {progressFailed ? " · 오류" : progressStopped ? " · 중지" : ""}
            </span>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="전체 이미지 생성 진행률"
              aria-valuemin={0}
              aria-valuemax={progressTotal || 1}
              aria-valuenow={progressDone}
              aria-valuetext={`${progressDone}/${progressTotal}장 처리${progressFailed ? ", 오류 있음" : progressStopped ? ", 중지됨" : ""}`}
            >
              <span
                className="progress-fill"
                style={{
                  width: `${progressTotal ? (progressDone / progressTotal) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <button onClick={() => setQueueOpen(!queueOpen)}>
            {pending.length > 0 ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <Check size={13} />
            )}
            대기열 {pending.length}
          </button>
          <button
            className="quota"
            onClick={() => void refreshQuota()}
            title={String(quota?.reason || "할당량 새로고침")}
          >
            <RefreshCw size={12} />
            {quota?.available
              ? `${quota.total_anlas} Anlas${quota.v5_percent != null ? " · V5 " + quota.v5_percent + "%" : ""}`
              : state.api.mock_mode
                ? "체험 모드"
                : "할당량 확인"}
          </button>
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
