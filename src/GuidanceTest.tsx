import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FlaskConical, Maximize2, Minus, Plus, X } from "lucide-react";
import type { AppState, GuidanceSettings, ImageItem, Job } from "./types";
import { api } from "./api";
import { SweepImageViewer } from "./SweepImageViewer";
import { SeedStatus } from "./SeedStatus";

function axis(min: number, max: number, step: number, cap: number) {
  if (
    ![min, max, step].every(Number.isFinite) ||
    min < 0 ||
    max > cap ||
    min > max ||
    step <= 0
  )
    return [];
  // Match the engine's decimal arithmetic without binary float boundary errors.
  const parts = [min, max, step].map((value) => {
    const [coefficient, power = "0"] = value
      .toString()
      .toLowerCase()
      .split("e");
    const [whole, fraction = ""] = coefficient.split(".");
    return {
      digits: BigInt(whole + fraction),
      exponent: Number(power) - fraction.length,
    };
  });
  const exponent = Math.min(...parts.map((part) => part.exponent));
  const [low, high, gap] = parts.map(
    (part) => part.digits * 10n ** BigInt(part.exponent - exponent),
  );
  const count = (high - low) / gap + 1n;
  if (count > 200n) return [];
  return Array.from({ length: Number(count) }, (_, index) =>
    Number(`${low + gap * BigInt(index)}e${exponent}`),
  );
}
const validSource = (i: ImageItem) =>
  !i.error &&
  i.prompt !== undefined &&
  i.negative_prompt !== undefined &&
  i.seed !== undefined &&
  !!i.width &&
  !!i.height;

export function GuidanceTest({
  state,
  jobs,
  busy,
  edit,
  start,
}: {
  state: AppState;
  jobs: Job[];
  busy: boolean;
  edit: (fn: (s: AppState) => void) => void;
  start: () => Promise<string>;
}) {
  const [selectedCell, setSelectedCell] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const lastCellButton = useRef<HTMLButtonElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fitGrid, setFitGrid] = useState(true);
  const [fullZoom, setFullZoom] = useState(160);
  const [gridSpace, setGridSpace] = useState({ width: 1000, height: 700 });
  const fullGrid = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    const root = document.getElementById("root");
    const previousInert = root?.inert ?? false;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (document.querySelector(".sweep-image-viewer")) return;
        event.stopImmediatePropagation();
        setExpanded(false);
      }
    };
    document.addEventListener("keydown", key, true);
    const node = fullGrid.current;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setGridSpace({ width: rect.width, height: rect.height });
    });
    if (node) observer.observe(node);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", key, true);
      document.body.style.overflow = previous;
      if (root) root.inert = previousInert;
      expandButton.current?.focus();
    };
  }, [expanded]);
  const [runId, setRunId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState("");
  const [limit, setLimit] = useState(80);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cellSize, setCellSize] = useState(160);
  const settings = state.guidance_test;
  const images = state.history.flatMap((h) => h.items);
  const source = images.find((i) => i.path === settings.source_path);
  let sourceOffset = 0;
  const sourceGroups = state.history
    .map((history, historyIndex) => {
      const offset = sourceOffset;
      sourceOffset += history.items.length;
      return {
        history,
        historyIndex,
        offset,
        items: history.items.slice(0, Math.max(0, limit - offset)),
      };
    })
    .filter((group) => group.items.length > 0);
  const recordedSettings =
    source?.generation_settings &&
    [
      "model",
      "steps",
      "sampler",
      "noise_schedule",
      "uncond_scale",
      "n_samples",
      "scale",
      "guidance_rescale",
    ].every((key) => key in source.generation_settings!);
  const runs = state.history.filter(
    (h) => h.type === "guidance_test" && h.sweep,
  );
  const result =
    runs.find((h) => h.id === runId) || (!runId ? runs[0] : undefined);
  const job = jobs.find((j) => j.id === (runId || result?.id));
  const running =
    job && ["queued", "running", "cancelling"].includes(job.status);
  const x = axis(settings.x_min, settings.x_max, settings.x_step, 100);
  const y = axis(settings.y_min, settings.y_max, settings.y_step, 1);
  const total = x.length * y.length;
  const valid = total > 0 && total <= 200;
  const gridX = result?.sweep?.x_values || x;
  const gridY = result?.sweep?.y_values || y;
  const fullGap = fitGrid
    ? Math.max(
        0,
        Math.min(
          5,
          Math.floor(
            Math.min(
              gridSpace.width / (gridX.length + 1),
              gridSpace.height / (gridY.length + 2),
            ) / 5,
          ),
        ),
      )
    : 5;
  const fullCellSize = fitGrid
    ? Math.max(
        2,
        Math.floor(
          Math.min(
            (gridSpace.width - 104 - gridX.length * fullGap - 4) /
              Math.max(1, gridX.length),
            (gridSpace.height - 100 - gridY.length * fullGap - 4) /
              Math.max(1, gridY.length),
          ),
        ),
      )
    : fullZoom;
  const cells = new Map(
    result?.items.map((i) => [`${i.sweep_x}:${i.sweep_y}`, i]),
  );
  const axisEditor = (prefix: "x" | "y", name: string) => (
    <fieldset disabled={submitting}>
      <legend>{name}</legend>
      <div className="sweep-axis-fields">
        {(["min", "max", "step"] as const).map((part, index) => {
          const key = `${prefix}_${part}` as keyof Omit<
            GuidanceSettings,
            "source_path"
          >;
          return (
            <label key={part}>
              {["시작", "끝", "간격 (resolution)"][index]}
              <input
                aria-label={`${name} ${["시작", "끝", "간격"][index]}`}
                type="number"
                step="0.1"
                min={part === "step" ? undefined : 0}
                max={part === "step" ? undefined : prefix === "x" ? 100 : 1}
                value={Number.isFinite(settings[key]) ? settings[key] : ""}
                onChange={(e) =>
                  edit((s) => {
                    s.guidance_test[key] = e.target.valueAsNumber;
                  })
                }
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
  const renderGrid = (full = false) => {
    const size = full ? fullCellSize : cellSize;
    return (
      <div
        className={"sweep-grid-scroll" + (full ? " sweep-grid-full" : "")}
        ref={full ? fullGrid : undefined}
      >
        <div
          className="sweep-grid"
          style={{
            gridTemplateColumns: `104px repeat(${gridX.length}, ${size}px)`,
            gap: full ? fullGap : undefined,
          }}
          role="table"
          aria-label="가이던스 리스케일 비교 격자"
        >
          <div className="sweep-corner" role="columnheader">
            <strong>Y축</strong>
            <span>Rescale ↑</span>
            <small>위쪽으로 증가</small>
          </div>
          <div className="sweep-axis-x" style={{ gridColumn: "2 / -1" }}>
            <strong>X축 · Guidance →</strong>
            <span>오른쪽으로 증가</span>
          </div>
          {gridX.map((value, index) => (
            <div className="sweep-x" role="columnheader" key={`x${index}`}>
              <span
                style={full ? { fontSize: Math.min(15, size / 3) } : undefined}
              >
                {value}
              </span>
            </div>
          ))}
          {[...gridY.keys()].reverse().map((yi) => (
            <div className="sweep-grid-row" role="row" key={`y${yi}`}>
              <div
                className="sweep-y"
                role="rowheader"
                aria-label={`Y축 Rescale ${gridY[yi]}`}
              >
                <span
                  style={
                    full
                      ? {
                          fontSize: Math.min(16, Math.max(2, size * 0.6)),
                          lineHeight: 1,
                        }
                      : undefined
                  }
                >
                  {gridY[yi]}
                </span>
              </div>
              {gridX.map((value, xi) => {
                const item = cells.get(`${xi}:${yi}`);
                return (
                  <div
                    className="sweep-cell"
                    role="cell"
                    key={xi}
                    style={{ height: size }}
                  >
                    {item ? (
                      item.error ? (
                        <div className="sweep-error" title={item.error}>
                          생성 오류
                          <br />
                          <small>{item.error}</small>
                        </div>
                      ) : (
                        <button
                          aria-label={`Guidance ${value}, Rescale ${gridY[yi]} 결과 보기`}
                          title={`X축 Guidance ${value} · Y축 Rescale ${gridY[yi]}`}
                          onClick={(event) => {
                            lastCellButton.current = event.currentTarget;
                            setSelectedCell({ x: xi, y: yi });
                          }}
                        >
                          <img
                            src={item.image_url}
                            alt={`Guidance ${value}, Rescale ${gridY[yi]}`}
                            loading="lazy"
                          />
                        </button>
                      )
                    ) : (
                      <span className="micro">
                        {running || submitting ? "대기 중" : "미생성"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="guidance-test">
      <aside className="sweep-sources" aria-label="가이던스 테스트 원본 이미지">
        <h2>생성 기록에서 선택</h2>
        <p className="micro">테스트할 원본 이미지를 선택하세요.</p>
        <div className="sweep-source-list">
          {sourceGroups.map(({ history, historyIndex, offset, items }) => (
            <details className="sweep-source-group" key={history.id} open>
              <summary>
                <div className="sweep-turn-title">
                  <span className="sweep-turn-number">
                    #{state.history.length - historyIndex}
                  </span>
                  <strong>
                    {history.preset ||
                      [history.base_preset, history.character_preset]
                        .filter(Boolean)
                        .join(" · ") ||
                      "생성 기록"}
                  </strong>
                </div>
                <span className="sweep-turn-meta">
                  {history.type === "guidance_test"
                    ? "가이던스 테스트"
                    : history.type === "batting_test"
                      ? "타율 테스트"
                      : "이미지 생성"}{" "}
                  · {history.items.length}장
                </span>
                <time>{history.created_at}</time>
              </summary>
              <div className="sweep-turn-images">
                {items.map((image, index) => (
                  <button
                    key={image.path}
                    className="sweep-source"
                    aria-label={`원본 이미지 ${offset + index + 1} 선택`}
                    aria-pressed={source?.path === image.path}
                    disabled={!validSource(image) || submitting}
                    title={
                      validSource(image)
                        ? image.preset || "생성 이미지"
                        : "프롬프트·시드·크기가 기록되지 않은 이미지입니다."
                    }
                    onClick={() =>
                      edit((s) => {
                        s.guidance_test.source_path = image.path;
                      })
                    }
                  >
                    <img
                      src={image.image_url}
                      loading="lazy"
                      alt={image.preset || "생성 이미지"}
                    />
                    <span>
                      이미지 {String(index + 1).padStart(2, "0")}
                      <small>Seed {image.seed ?? "정보 없음"}</small>
                      {image.scale !== undefined && (
                        <small>
                          G {image.scale} · R {image.guidance_rescale}
                        </small>
                      )}
                    </span>
                  </button>
                ))}
              </div>
              {items.length < history.items.length && (
                <p className="micro">
                  {items.length}/{history.items.length}장 표시 중
                </p>
              )}
            </details>
          ))}
        </div>
        {!images.length && (
          <p className="muted">
            작업실에서 이미지를 생성하면 여기에 표시됩니다.
          </p>
        )}
        {images.length > limit && (
          <button
            className="outline full"
            onClick={() => setLimit((v) => v + 80)}
          >
            기록 더 보기
          </button>
        )}
      </aside>
      <div className="sweep-main">
        <div className="page-heading">
          <div>
            <div className="eyebrow">GUIDANCE TEST</div>
            <h1>가이던스 테스트</h1>
            <p>X축은 Prompt guidance, Y축은 Guidance rescale입니다.</p>
          </div>
        </div>
        <section className="sweep-setup">
          <div
            className={"sweep-selected-source" + (source ? " has-source" : "")}
          >
            {source && (
              <figure className="sweep-selected-preview">
                <button
                  aria-label="선택한 원본 크게 보기"
                  title="원본 이미지 크게 보기"
                  onClick={() => setPreviewOpen(true)}
                >
                  <img src={source.image_url} alt="선택한 원본 프리뷰" />
                </button>
                <figcaption>선택한 원본 · 클릭하여 크게 보기</figcaption>
              </figure>
            )}
            <div className="sweep-source-summary">
              {source ? (
                <>
                  <span className="eyebrow">SELECTED IMAGE</span>
                  <h2>{source.preset || "선택한 이미지"}</h2>
                  <p className="muted">
                    Seed {source.seed} · {source.width} × {source.height}
                  </p>
                  {source.scale !== undefined && (
                    <p className="micro">
                      원본 Guidance {source.scale} · Rescale{" "}
                      {source.guidance_rescale}
                    </p>
                  )}
                  <p className="micro">
                    프롬프트·네거티브·작가 순서·시드·크기를 원본과 동일하게
                    유지합니다.
                  </p>
                  <p className="micro">
                    {recordedSettings
                      ? `원본 설정: ${source.generation_settings?.model} · ${source.generation_settings?.steps} steps · ${source.generation_settings?.sampler}`
                      : "이전 기록에 모델·Steps·Sampler 정보가 없어 현재 설정을 사용합니다."}
                  </p>
                </>
              ) : (
                <p className="muted">왼쪽에서 원본 이미지를 선택하세요.</p>
              )}
            </div>
          </div>
          <div className="sweep-axes">
            {axisEditor("x", "X축 · Guidance")}
            {axisEditor("y", "Y축 · Rescale")}
          </div>
          <p className={valid ? "muted" : "error-text"}>
            {valid
              ? `${x.length}열 × ${y.length}행 = 총 ${total}장 · 마지막 값 X ${x.at(-1)}, Y ${y.at(-1)}`
              : "축 범위와 양수 간격을 확인하세요. Guidance 0~100, Rescale 0~1, 총 200장까지 생성할 수 있습니다."}
          </p>
          <p className="micro">
            시작 값부터 간격만큼 증가하며 끝 값을 넘지 않습니다.{" "}
            {state.api.mock_mode
              ? "현재 체험 모드입니다."
              : "NovelAI API로 격자의 각 칸을 생성합니다."}
          </p>
          <div className="generation-action guidance-generation">
            <button
              className="primary"
              disabled={
                busy || submitting || !source || !validSource(source) || !valid
              }
              onClick={async () => {
                setFailure("");
                setSubmitting(true);
                try {
                  setRunId(await start());
                } catch (error) {
                  setFailure((error as Error).message);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <FlaskConical size={15} />
              {submitting
                ? "추가 중…"
                : `가이던스 테스트 시작${valid ? ` · ${total}장` : ""}`}
            </button>
            <SeedStatus
              seed={source?.seed}
              unsetLabel="원본 이미지를 선택하세요"
            />
          </div>
          {failure && (
            <p className="error-text" role="alert">
              {failure}
            </p>
          )}
        </section>
        <section className="sweep-results">
          <div className="sweep-result-toolbar">
            <h2>비교 격자</h2>
            <button
              ref={expandButton}
              className="outline"
              disabled={!result && !runId}
              onClick={() => {
                setFitGrid(true);
                setExpanded(true);
              }}
            >
              <Maximize2 size={15} />
              전체 화면
            </button>
            <label>
              테스트 기록
              <select
                aria-label="가이던스 테스트 기록"
                value={result?.id || ""}
                onChange={(e) => setRunId(e.target.value)}
              >
                <option value="">
                  {runId && !result ? "새 테스트 준비 중" : "기록 선택"}
                </option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.created_at} · {run.preset} ·{" "}
                    {run.sweep!.x_values.length} × {run.sweep!.y_values.length}
                  </option>
                ))}
              </select>
            </label>
            <label>
              칸 크기
              <input
                aria-label="격자 칸 크기"
                type="range"
                min="90"
                max="320"
                step="10"
                value={cellSize}
                onChange={(e) => setCellSize(Number(e.target.value))}
              />
            </label>
          </div>
          {result && (
            <p className="micro">
              원본 Seed {result.sweep!.source_seed} ·{" "}
              {result.sweep!.settings_source === "recorded"
                ? "원본 생성 설정 사용"
                : "기록에 없는 설정은 테스트 시작 당시 설정 사용"}
            </p>
          )}
          {job && (
            <div className="row">
              <span>
                {job.progress}/{job.total}장 ·{" "}
                {running
                  ? "진행 중"
                  : job.status === "cancelled"
                    ? "중지됨"
                    : job.status === "failed" || job.failures
                      ? "완료 · 오류 있음"
                      : "완료"}
              </span>
              {running && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api("job/cancel", { job_id: job.id });
                    } catch (e) {
                      setFailure((e as Error).message);
                    }
                  }}
                >
                  <X size={13} />
                  테스트 중지
                </button>
              )}
            </div>
          )}
          {!result && !runId ? (
            <div className="sweep-empty">
              이미지를 선택하고 테스트를 시작하면 결과가 여기에 쌓입니다.
            </div>
          ) : expanded ? (
            <div className="sweep-empty">
              전체 화면에서 비교 격자를 보고 있습니다.
            </div>
          ) : (
            renderGrid()
          )}
        </section>
      </div>
      {selectedCell && (
        <SweepImageViewer
          x={selectedCell.x}
          y={selectedCell.y}
          xValues={gridX}
          yValues={gridY}
          cells={cells}
          move={(x, y) => setSelectedCell({ x, y })}
          close={() => setSelectedCell(null)}
          returnFocus={lastCellButton.current}
        />
      )}
      {expanded &&
        createPortal(
          <section
            className="sweep-fullscreen"
            role="dialog"
            aria-modal="true"
            aria-label="비교 격자 전체 화면"
          >
            <header className="sweep-fullscreen-toolbar">
              <div>
                <h2>가이던스 테스트 · 비교 격자</h2>
                <span className="micro">
                  {gridX.length}열 × {gridY.length}행 · X축 Guidance → / Y축
                  Rescale ↑
                </span>
              </div>
              <div className="row">
                <button
                  className="outline"
                  aria-pressed={fitGrid}
                  onClick={() => setFitGrid(true)}
                >
                  화면 맞춤
                </button>
                <button
                  aria-label="격자 축소"
                  onClick={() => {
                    setFullZoom(Math.max(2, fullCellSize - 20));
                    setFitGrid(false);
                  }}
                >
                  <Minus size={15} />
                </button>
                <span className="micro">{fullCellSize}px</span>
                <button
                  aria-label="격자 확대"
                  onClick={() => {
                    setFullZoom(Math.min(500, fullCellSize + 20));
                    setFitGrid(false);
                  }}
                >
                  <Plus size={15} />
                </button>
                <button
                  className="outline"
                  onClick={() => {
                    setFullZoom(cellSize);
                    setFitGrid(false);
                  }}
                >
                  원래 크기
                </button>
                <button
                  autoFocus
                  className="outline"
                  aria-label="격자 전체 화면 닫기"
                  onClick={() => setExpanded(false)}
                >
                  <X size={17} />
                  닫기 · Esc
                </button>
              </div>
            </header>
            {renderGrid(true)}
          </section>,
          document.body,
        )}
      {previewOpen &&
        source &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => setPreviewOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPreviewOpen(false);
            }}
          >
            <section
              className="modal sweep-preview-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="원본 이미지 프리뷰"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="row spread">
                <h2>{source.preset || "선택한 원본"}</h2>
                <button
                  autoFocus
                  aria-label="원본 프리뷰 닫기"
                  onClick={() => setPreviewOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <img src={source.image_url} alt="확대한 원본 이미지" />
              <p className="micro">
                Seed {source.seed} · {source.width} × {source.height}
              </p>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}
