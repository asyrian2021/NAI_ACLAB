import { useEffect, useRef, useState } from "react";

const MESSAGE_MS = 3000;
export const TOAST_MS = 6000;

export type Toast = {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
};

/**
 * Three kinds of feedback:
 * - message: status-bar text that clears itself after 3 seconds;
 * - error: banner that stays until dismissed (errors are easy to miss);
 * - toasts: short-lived cards, optionally with an action such as undo.
 */
export function useNotices() {
  const [message, updateMessage] = useState("");
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextToast = useRef(1);

  function setMessage(text: string) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    updateMessage(text);
    messageTimer.current = setTimeout(() => updateMessage(""), MESSAGE_MS);
  }
  function dismissToast(id: number) {
    clearTimeout(toastTimers.current.get(id));
    toastTimers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }
  function showToast(text: string, action?: Toast["action"]) {
    const id = nextToast.current++;
    setToasts((list) => [...list.slice(-2), { id, text, action }]);
    toastTimers.current.set(
      id,
      setTimeout(() => dismissToast(id), TOAST_MS),
    );
  }
  useEffect(
    () => () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
      toastTimers.current.forEach(clearTimeout);
    },
    [],
  );
  return {
    message,
    setMessage,
    error,
    setError,
    toasts,
    showToast,
    dismissToast,
  };
}

export type ShowToast = ReturnType<typeof useNotices>["showToast"];
