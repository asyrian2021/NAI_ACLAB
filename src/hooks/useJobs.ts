import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { isActiveJob } from "../lib/helpers";
import type { Job } from "../types";

const POLL_MS = 1500;

export type JobProgress = {
  total: number;
  done: number;
  running: boolean;
  failed: boolean;
  stopped: boolean;
};

type Options = {
  /** Called whenever any job's status or progress changes. */
  onJobsChanged: () => Promise<void>;
  /** Called after a change when no job is left running. */
  onAllIdle: () => void;
  onConnectionError: (message: string) => void;
  /** Called on the first successful poll after a connection error. */
  onConnectionRestored: () => void;
  /** Called once when the current batch of jobs has stopped running. */
  onBatchFinished: (failed: boolean) => void;
};

/**
 * Polls the engine's job list. Jobs queued while others are still running form
 * one "batch"; the status bar shows that batch's combined progress.
 */
export function useJobs(options: Options) {
  const handlers = useRef(options);
  handlers.current = options;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [progressJobs, setProgressJobs] = useState<Job[]>([]);
  const jobStamp = useRef("");
  const batchIds = useRef(new Set<string>());
  const batchRunning = useRef(false);
  const wasRunning = useRef(false);

  useEffect(() => {
    const running = jobs.filter(isActiveJob);
    if (running.length) {
      if (!batchRunning.current) batchIds.current.clear();
      running.forEach((j) => batchIds.current.add(j.id));
    }
    batchRunning.current = running.length > 0;
    setProgressJobs(jobs.filter((j) => batchIds.current.has(j.id)));
  }, [jobs]);

  const jobStatus = jobs.map((j) => `${j.id}:${j.status}`).join("|");
  useEffect(() => {
    const running = jobs.some(isActiveJob);
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    const failed = jobs.some(
      (j) =>
        batchIds.current.has(j.id) &&
        (j.status === "failed" || (j.failures || 0) > 0),
    );
    handlers.current.onBatchFinished(failed);
  }, [jobStatus]);

  useEffect(() => {
    let live = true,
      inFlight = false,
      failing = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await api<{ jobs: Job[] }>("jobs");
        if (!live) return;
        if (failing) {
          failing = false;
          handlers.current.onConnectionRestored();
        }
        setJobs(r.jobs);
        const stamp = JSON.stringify(
          r.jobs.map((j) => [j.id, j.status, j.progress]),
        );
        if (stamp !== jobStamp.current) {
          jobStamp.current = stamp;
          await handlers.current.onJobsChanged();
          if (r.jobs.length && !r.jobs.some(isActiveJob))
            handlers.current.onAllIdle();
        }
      } catch (e) {
        failing = true;
        if (live)
          handlers.current.onConnectionError(
            "엔진 연결을 확인하세요: " + (e as Error).message,
          );
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  /** Adds a newly queued job to the current batch before the next poll sees it. */
  function trackJob(id: string) {
    if (!batchRunning.current) batchIds.current.clear();
    batchIds.current.add(id);
    batchRunning.current = true;
    wasRunning.current = true;
  }

  const progress: JobProgress = {
    total: progressJobs.reduce((sum, j) => sum + j.total, 0),
    done: progressJobs.reduce(
      (sum, j) => sum + Math.min(j.progress, j.total),
      0,
    ),
    running: progressJobs.some(isActiveJob),
    failed: progressJobs.some(
      (j) => j.status === "failed" || (j.failures || 0) > 0,
    ),
    stopped: progressJobs.some((j) => j.status === "cancelled"),
  };
  const pending = jobs.filter(isActiveJob);
  return { jobs, pending, progress, trackJob };
}
