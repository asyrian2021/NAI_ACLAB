import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { finiteDraft } from "../lib/helpers";
import type { AppState } from "../types";

const AUTOSAVE_DELAY_MS = 650;

/**
 * Owns the editable app state. `edit` mutates a cloned draft; changes are
 * saved to the engine after a short pause, one request at a time.
 */
export function useAutosave() {
  const [state, setState] = useState<AppState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState("자동 저장됨");
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const dirtyVersion = useRef(0);
  const latest = useRef(state);
  latest.current = state;

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
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, revision]);

  return { state, setState, latest, edit, persist, dirty, saveStatus };
}
