import { useEffect, useState } from "react";
import { ArrowLeft, Check, RotateCcw, Trash2 } from "lucide-react";
import { exploreApi } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { Edit, Tab, Task } from "../../lib/actions";
import type {
  AppState,
  Campaign,
  CampaignSummary,
  ExploreEntry,
  Job,
  StageInfo,
} from "../../types";
import { DoneView } from "./DoneView";
import { EvolveView } from "./EvolveView";
import { ExploreList } from "./ExploreList";
import { stagePrefix } from "./lib";
import { RoundView } from "./RoundView";

export type ExploreActions = {
  campaign: Campaign;
  /** Replaces the shown campaign with the engine's latest copy. */
  setCampaign: (c: Campaign) => void;
  /** Queues the current batch's missing images. */
  run: () => Promise<void>;
  task: Task;
  busy: boolean;
  running: boolean;
  setMessage: (text: string) => void;
};

/**
 * Combination search: a list of campaigns, and for the open one the screen of
 * its current stage (evolution grid, success-rate rounds or the summary).
 */
export function ExplorePage({
  state,
  edit,
  jobs,
  busy,
  task,
  persist,
  queued,
  setTab,
  setMessage,
  entry,
  clearEntry,
  openId,
  setOpenId,
}: {
  state: AppState;
  edit: Edit;
  jobs: Job[];
  busy: boolean;
  task: Task;
  persist: () => Promise<unknown>;
  /** Tracks a newly queued job and shows the queue. */
  queued: (jobId: string) => void;
  setTab: (tab: Tab) => void;
  setMessage: (text: string) => void;
  entry: ExploreEntry | null;
  clearEntry: () => void;
  openId: string;
  setOpenId: (id: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reopen, setReopen] = useState<StageInfo | null>(null);

  const campaignJobs = jobs.filter(
    (j) => j.campaign_id && j.campaign_id === openId,
  );
  const running = campaignJobs.some((j) =>
    ["queued", "running", "cancelling"].includes(j.status),
  );
  const jobStamp = campaignJobs
    .map((j) => `${j.id}:${j.status}:${j.progress}`)
    .join("|");

  useEffect(() => {
    if (openId) return;
    setCampaign(null);
    void task(async () => setCampaigns((await exploreApi.list()).campaigns));
  }, [openId]);
  useEffect(() => {
    if (!openId) return;
    let live = true;
    exploreApi
      .get(openId)
      .then((r) => live && setCampaign(r.campaign))
      .catch((e) => {
        if (!live) return;
        setOpenId("");
        void task(async () => {
          throw e;
        });
      });
    return () => {
      live = false;
    };
  }, [openId, jobStamp]);

  if (!openId || !campaign || campaign.id !== openId)
    return (
      <ExploreList
        state={state}
        campaigns={campaigns}
        busy={busy}
        task={task}
        entry={entry}
        clearEntry={clearEntry}
        open={setOpenId}
        start={async (c) => {
          setCampaign(c);
          setOpenId(c.id);
          await persist();
          const r = await exploreApi.run(c.id);
          setCampaign(r.campaign);
          queued(r.job_id);
        }}
        loading={!!openId}
      />
    );

  const actions: ExploreActions = {
    campaign,
    setCampaign,
    task,
    busy,
    running,
    setMessage,
    run: async () => {
      await persist();
      const r = await exploreApi.run(campaign.id);
      setCampaign(r.campaign);
      queued(r.job_id);
    },
  };
  const steps = campaign.info.stages;
  const stepIndex = steps.findIndex((s) => s.key === campaign.stage);
  // Earlier searched stages can be opened again (the final check is redone from the stages).
  const canReopen = (step: StageInfo) =>
    !!step.group &&
    step.key !== "retune" &&
    steps.findIndex((s) => s.key === step.key) < stepIndex;
  const dropped = reopen
    ? steps
        .slice(steps.findIndex((s) => s.key === reopen.key) + 1, stepIndex + 1)
        .filter((s) => s.kind !== "done")
    : [];

  return (
    <div className="explore">
      <header className="explore-header">
        <button
          className="outline"
          aria-label="캠페인 목록으로"
          onClick={() => setOpenId("")}
        >
          <ArrowLeft size={15} />
          목록
        </button>
        <div className="explore-title">
          <div className="eyebrow">COMBINATION SEARCH</div>
          <h1>{campaign.name}</h1>
        </div>
        <ol className="explore-steps" aria-label="탐색 단계">
          {steps.map((step, index) => (
            <li
              key={step.key}
              title={step.name}
              className={
                (canReopen(step) ? "reopenable " : "") +
                (index < stepIndex
                  ? "done"
                  : index === stepIndex
                    ? "current"
                    : "")
              }
              aria-current={index === stepIndex ? "step" : undefined}
            >
              {canReopen(step) ? (
                <button
                  className="step-reopen"
                  aria-label={`${step.name}로 돌아가기`}
                  onClick={() => setReopen(step)}
                >
                  <Check size={12} />
                  {`${stagePrefix(step)} ${step.group}`}
                  <RotateCcw size={11} className="step-reopen-icon" />
                </button>
              ) : (
                <>
                  {index < stepIndex && <Check size={12} />}
                  {step.kind === "done"
                    ? step.name
                    : step.group
                      ? `${stagePrefix(step)} ${step.group}`
                      : step.name}
                </>
              )}
            </li>
          ))}
        </ol>
        <button
          className="outline"
          aria-label="캠페인 삭제"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={15} />
        </button>
      </header>
      {campaign.info.stage.kind === "evolve" ? (
        <EvolveView
          key={campaign.id + campaign.stage}
          {...actions}
          state={state}
        />
      ) : campaign.info.stage.kind === "done" ? (
        <DoneView
          {...actions}
          reopen={(step) => setReopen(step)}
          applyFixed={(artists, toBatting) => {
            edit((s) => {
              s.generation.fixed_artists = artists;
              if (s.prompt_presets.some((p) => p.name === campaign.preset))
                s.generation.preset = campaign.preset;
            });
            setMessage(
              toBatting
                ? "최종 조합을 고정하고 타율 테스트로 이동했습니다."
                : "최종 조합을 고정 조합으로 적용했습니다.",
            );
            if (toBatting) setTab("batting");
          }}
        />
      ) : (
        <RoundView
          key={campaign.id + campaign.stage}
          {...actions}
          state={state}
        />
      )}
      {reopen && (
        <ConfirmDialog
          title={`${reopen.name}로 돌아갈까요?`}
          confirmLabel="이 단계로 돌아가기"
          cancel={() => setReopen(null)}
          confirm={() => {
            const step = reopen;
            setReopen(null);
            void task(async () => {
              const r = await exploreApi.reopen(campaign.id, step.key);
              setCampaign(r.campaign);
              setMessage(`${step.name}로 돌아왔습니다.`);
            });
          }}
        >
          {campaign.champions[reopen.key]
            ? "우승 조합을 확정하기 직전 상태로 돌아갑니다."
            : [...campaign.rounds, ...campaign.generations].some(
                  (b) => b.stage === reopen.key,
                )
              ? "건너뛰기 직전 상태로 돌아가 이어서 진행합니다."
              : "이 단계를 처음부터 시작합니다."}{" "}
          {dropped.length > 0 &&
            `그 뒤 단계(${dropped.map((s) => s.name).join(", ")})의 선택과 라벨 기록은 지워지고, 이 단계를 마치면 다시 진행합니다. `}
          생성한 이미지는 작업실 기록에 남습니다.
        </ConfirmDialog>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="캠페인을 삭제할까요?"
          confirmLabel="삭제"
          tone="danger"
          cancel={() => setConfirmDelete(false)}
          confirm={() => {
            setConfirmDelete(false);
            void task(async () => {
              await exploreApi.remove(campaign.id);
              setOpenId("");
              setMessage(
                "캠페인을 삭제했습니다. 생성된 이미지는 작업실에 남아 있습니다.",
              );
            });
          }}
        >
          선택 기록과 라벨이 사라집니다. 이미지 파일과 작업실 기록은 그대로
          둡니다.
        </ConfirmDialog>
      )}
    </div>
  );
}
