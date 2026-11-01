import { useEffect, useRef } from "react";
import { SeedStatus } from "./SeedStatus";

export function FixedSeedConfirm({
  seed,
  cancel,
  confirm,
}: {
  seed: number;
  cancel: () => void;
  confirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
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
      className="seed-confirmation"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="seed-confirm-title"
      aria-describedby="seed-confirm-description"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <div className="row">
        <SeedStatus seed={seed} />
        <h2 id="seed-confirm-title">고정 시드로 시작할까요?</h2>
      </div>
      <p id="seed-confirm-description">
        현재 시드: <strong>{seed}</strong> (고정)
        <br />
        모든 테스트 이미지에 같은 시드를 사용합니다. 이 상태로 타율 테스트를
        시작할까요?
      </p>
      <div className="seed-confirm-actions">
        <button ref={cancelButton} className="outline" onClick={cancel}>
          취소
        </button>
        <button className="primary" onClick={confirm}>
          고정 시드로 시작
        </button>
      </div>
    </dialog>
  );
}
