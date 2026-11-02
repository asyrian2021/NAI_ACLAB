import { Check, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { JobProgress } from "../hooks/useJobs";
import { isActiveJob, jobStatusNames } from "../lib/helpers";
import type { Job } from "../types";

/** Bottom status bar with overall progress, plus the pop-up queue panel. */
export function StatusDock({
  queueOpen,
  toggleQueue,
  closeQueue,
  jobs,
  pending,
  progress,
  cancelJob,
  busy,
  message,
  dirty,
  quota,
  refreshQuota,
  mockMode,
}: {
  queueOpen: boolean;
  toggleQueue: () => void;
  closeQueue: () => void;
  jobs: Job[];
  pending: Job[];
  progress: JobProgress;
  cancelJob: (id: string) => void;
  busy: boolean;
  message: string;
  dirty: boolean;
  quota: Record<string, unknown> | null;
  refreshQuota: () => void;
  mockMode: boolean;
}) {
  const recentJobs = jobs
    .filter((job) => !isActiveJob(job))
    .slice(-5)
    .reverse();
  const queueJobs = [...pending, ...recentJobs];
  const { total, done, running, failed, stopped } = progress;
  return (
    <div className="status-dock">
      {queueOpen && (
        <section className="queue-panel">
          <div className="row spread">
            <h2>
              생성 대기열{" "}
              <span className="muted">{pending.length}개 진행 중</span>
            </h2>
            <button aria-label="대기열 닫기" onClick={closeQueue}>
              <X size={16} />
            </button>
          </div>
          <p className="micro">
            진행·대기 작업과 최근 종료 작업 5개까지 표시합니다.
          </p>
          {queueJobs.length ? (
            queueJobs.map((j) => (
              <div className="job" key={j.id}>
                <div className="row spread">
                  <span>
                    {j.name}{" "}
                    <small>{jobStatusNames[j.status] || j.status}</small>
                  </span>
                  <span>
                    {j.progress}/{j.total}{" "}
                    {isActiveJob(j) && (
                      <button
                        aria-label="작업 중지"
                        onClick={() => cancelJob(j.id)}
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
            className={
              "total-progress " +
              (running
                ? "running"
                : total > 0 && done === total
                  ? failed
                    ? "has-error"
                    : "complete"
                  : "")
            }
            title="현재 대기열 묶음의 이미지 처리 진행률"
          >
            <span className="progress-count">
              {done}/{total}장{failed ? " · 오류" : stopped ? " · 중지" : ""}
            </span>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="전체 이미지 생성 진행률"
              aria-valuemin={0}
              aria-valuemax={total || 1}
              aria-valuenow={done}
              aria-valuetext={`${done}/${total}장 처리${failed ? ", 오류 있음" : stopped ? ", 중지됨" : ""}`}
            >
              <span
                className="progress-fill"
                style={{
                  width: `${total ? (done / total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <button onClick={toggleQueue}>
            {pending.length > 0 ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <Check size={13} />
            )}
            대기열 {pending.length}
          </button>
          <button
            className="quota"
            onClick={refreshQuota}
            title={String(quota?.reason || "할당량 새로고침")}
          >
            <RefreshCw size={12} />
            {quota?.available
              ? `${quota.total_anlas} Anlas${quota.v5_percent != null ? " · V5 " + quota.v5_percent + "%" : ""}`
              : mockMode
                ? "체험 모드"
                : "할당량 확인"}
          </button>
        </div>
      </footer>
    </div>
  );
}
