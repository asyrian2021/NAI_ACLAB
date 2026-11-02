import { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { api } from "./api";
import { AppHeader } from "./components/AppHeader";
import { FixedSeedConfirm } from "./components/FixedSeedConfirm";
import { PromptPreviewDialog } from "./components/PromptPreviewDialog";
import { StatusDock } from "./components/StatusDock";
import { ToastStack } from "./components/ToastStack";
import { useAutosave } from "./hooks/useAutosave";
import { useJobs } from "./hooks/useJobs";
import { useNotices } from "./hooks/useNotices";
import { useQuota } from "./hooks/useQuota";
import { useStudioView } from "./hooks/useStudioView";
import type { Tab } from "./lib/actions";
import { isActiveJob } from "./lib/helpers";
import { ArtistsPage } from "./pages/ArtistsPage";
import { BattingPage } from "./pages/batting/BattingPage";
import { GuidanceTest } from "./pages/guidance/GuidanceTest";
import { PresetsPage } from "./pages/PresetsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StudioPage } from "./pages/studio/StudioPage";
import type { AppState, Job, Preview } from "./types";

const QUEUE_PANEL_MS = 3000;

export function App() {
  const [tab, setTab] = useState<Tab>("studio");
  const [busy, setBusy] = useState(false);
  const [editPreset, setEditPreset] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [battingRunId, setBattingRunId] = useState("");
  const [confirmBattingSeed, setConfirmBattingSeed] = useState<number | null>(
    null,
  );
  const {
    message,
    setMessage,
    error,
    setError,
    toasts,
    showToast,
    dismissToast,
  } = useNotices();
  const connectionError = useRef("");
  const { state, setState, latest, edit, persist, dirty, saveStatus } =
    useAutosave();
  const studio = useStudioView(state);

  // The queue panel pops up when a job is queued and closes itself shortly after.
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueRevision, setQueueRevision] = useState(0);
  function showQueue() {
    setQueueOpen(true);
    setQueueRevision((v) => v + 1);
  }
  useEffect(() => {
    if (!queueOpen) return;
    const timer = setTimeout(() => setQueueOpen(false), QUEUE_PANEL_MS);
    return () => clearTimeout(timer);
  }, [queueOpen, queueRevision]);

  async function refreshHistory() {
    const { state: next } = await api<{ state: AppState }>("state");
    setState((prev) => (prev ? { ...prev, history: next.history } : next));
  }
  useEffect(() => {
    api<{ state: AppState }>("state")
      .then((r) => {
        setState(r.state);
        studio.setSelected(
          r.state.history.flatMap((h) => h.items)[0]?.path || "",
        );
      })
      .catch((e) => setError(e.message));
  }, []);
  const { quota, refreshQuota } = useQuota();
  const { jobs, pending, progress, trackJob } = useJobs({
    onJobsChanged: refreshHistory,
    onAllIdle: () => void refreshQuota(),
    onConnectionError: (text) => {
      connectionError.current = text;
      setError(text);
    },
    onConnectionRestored: () => {
      const lost = connectionError.current;
      connectionError.current = "";
      setError((current) => (current === lost ? "" : current));
      setMessage("엔진에 다시 연결했습니다.");
    },
    onBatchFinished: (failed) =>
      setMessage(
        failed
          ? "작업이 끝났습니다. 대기열에서 오류를 확인하세요."
          : "생성 작업이 끝났습니다.",
      ),
  });

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
  async function generate(batting = false) {
    if (!latest.current) return;
    await persist();
    const queued = await api<{ job_id: string }>(
      batting ? "batting/generate" : "generate",
      {
        state: { ...latest.current, api: { ...latest.current.api, token: "" } },
      },
    );
    trackJob(queued.job_id);
    if (batting) setBattingRunId(queued.job_id);
    showQueue();
    setMessage("생성 대기열에 추가했습니다.");
  }
  async function startGuidance() {
    setBusy(true);
    try {
      await persist();
      const queued = await api<{ job_id: string }>("guidance/generate", {
        state: latest.current,
      });
      trackJob(queued.job_id);
      setMessage("가이던스 테스트를 대기열에 추가했습니다.");
      return queued.job_id;
    } finally {
      setBusy(false);
    }
  }
  async function previewPrompt() {
    await persist();
    const r = await api<Preview>("preview", { state: latest.current });
    setPreview(r);
    setMessage(
      "프롬프트를 미리 조합했습니다. 생성 시 랜덤 조합은 새로 추첨됩니다.",
    );
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("클립보드에 복사했습니다.");
    } catch {
      setError("복사에 실패했습니다. 텍스트를 선택해 복사하세요.");
    }
  }
  async function prepareUpdate() {
    const currentJobs = await api<{ jobs: Job[] }>("jobs");
    if (currentJobs.jobs.some(isActiveJob))
      throw new Error("생성 작업이 끝난 후 업데이트하세요.");
    await persist();
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

  function openPresetEditor() {
    if (!state) return;
    setEditPreset(
      Math.max(
        0,
        state.prompt_presets.findIndex(
          (p) => p.name === state.generation.preset,
        ),
      ),
    );
    setTab("presets");
  }

  return (
    <div className={"app" + (studio.focus && tab === "studio" ? " focus" : "")}>
      <AppHeader
        tab={tab}
        setTab={setTab}
        updateBlocked={busy || pending.length > 0}
        prepareUpdate={prepareUpdate}
        saveStatus={saveStatus}
      />
      {error && (
        <div className="notice error" role="alert" key={error}>
          <CircleAlert size={16} className="notice-icon" />
          <span>{error}</span>
          <button aria-label="오류 닫기" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {tab === "studio" ? (
        <StudioPage
          state={state}
          studio={studio}
          pending={pending}
          edit={edit}
          task={task}
          busy={busy}
          setTab={setTab}
          openPresetEditor={openPresetEditor}
          generate={() => generate()}
          previewPrompt={previewPrompt}
          copy={copy}
          setMessage={setMessage}
          refreshHistory={refreshHistory}
        />
      ) : (
        <main
          className={
            "editor-page" + (tab === "guidance" ? " guidance-page" : "")
          }
          key={tab}
        >
          {tab === "presets" && (
            <PresetsPage
              state={state}
              edit={edit}
              editPreset={editPreset}
              setEditPreset={setEditPreset}
              notify={showToast}
            />
          )}
          {tab === "artists" && (
            <ArtistsPage state={state} edit={edit} notify={showToast} />
          )}
          {tab === "batting" && (
            <BattingPage
              state={state}
              edit={edit}
              busy={busy}
              jobs={jobs}
              runId={battingRunId}
              selectRun={setBattingRunId}
              start={() => {
                if (state.api.seed >= 0) setConfirmBattingSeed(state.api.seed);
                else void task(() => generate(true));
              }}
            />
          )}
          {tab === "guidance" && (
            <GuidanceTest
              state={state}
              jobs={jobs}
              busy={busy}
              edit={edit}
              start={startGuidance}
            />
          )}
          {tab === "settings" && <SettingsPage state={state} edit={edit} />}
        </main>
      )}
      {confirmBattingSeed !== null && (
        <FixedSeedConfirm
          seed={confirmBattingSeed}
          cancel={() => setConfirmBattingSeed(null)}
          confirm={() => {
            setConfirmBattingSeed(null);
            void task(() => generate(true));
          }}
        />
      )}
      {preview && (
        <PromptPreviewDialog
          preview={preview}
          close={() => setPreview(null)}
          copy={copy}
        />
      )}
      <ToastStack toasts={toasts} dismiss={dismissToast} />
      <StatusDock
        queueOpen={queueOpen}
        toggleQueue={() => {
          if (queueOpen) setQueueOpen(false);
          else showQueue();
        }}
        closeQueue={() => setQueueOpen(false)}
        jobs={jobs}
        pending={pending}
        progress={progress}
        cancelJob={(id) =>
          void task(async () => {
            await api("job/cancel", { job_id: id });
            setMessage("현재 처리 중인 이미지가 끝나면 중지합니다.");
          })
        }
        busy={busy}
        message={message}
        dirty={dirty}
        quota={quota}
        refreshQuota={() => void refreshQuota()}
        mockMode={state.api.mock_mode}
      />
    </div>
  );
}
