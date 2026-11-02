import { X } from "lucide-react";
import { TOAST_MS, type Toast } from "../hooks/useNotices";

/** Bottom-center cards for short confirmations such as "삭제됨 · 실행 취소". */
export function ToastStack({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action!.run();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button aria-label="알림 닫기" onClick={() => dismiss(toast.id)}>
            <X size={14} />
          </button>
          <i
            className="toast-timer"
            style={{ animationDuration: `${TOAST_MS}ms` }}
            aria-hidden="true"
          />
        </div>
      ))}
    </div>
  );
}
