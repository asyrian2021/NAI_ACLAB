import { useEffect, useId, useRef, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

/**
 * In-app replacement for `window.confirm`: a modal <dialog> that focuses the
 * safe choice first and restores focus to whatever opened it.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "취소",
  tone = "primary",
  icon,
  className = "",
  confirm,
  cancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  icon?: ReactNode;
  className?: string;
  confirm: () => void;
  cancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current!;
    const launcher = document.activeElement as HTMLElement | null;
    node.showModal();
    cancelButton.current?.focus();
    return () => {
      node.close();
      if (launcher?.isConnected) launcher.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`confirm-dialog ${tone} ${className}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={id + "title"}
      aria-describedby={id + "text"}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div className="confirm-body">
        <div className="row">
          {icon ??
            (tone === "danger" && (
              <TriangleAlert size={20} className="confirm-icon" />
            ))}
          <h2 id={id + "title"}>{title}</h2>
        </div>
        <p id={id + "text"}>{children}</p>
        <div className="confirm-actions">
          <button ref={cancelButton} className="outline" onClick={cancel}>
            {cancelLabel}
          </button>
          <button
            className={tone === "danger" ? "danger-fill" : "primary"}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
