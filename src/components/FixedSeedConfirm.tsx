import { ConfirmDialog } from "./ConfirmDialog";
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
  return (
    <ConfirmDialog
      className="seed-confirmation"
      title="고정 시드로 시작할까요?"
      confirmLabel="고정 시드로 시작"
      icon={<SeedStatus seed={seed} />}
      cancel={cancel}
      confirm={confirm}
    >
      현재 시드: <strong>{seed}</strong> (고정)
      <br />
      모든 테스트 이미지에 같은 시드를 사용합니다. 이 상태로 타율 테스트를
      시작할까요?
    </ConfirmDialog>
  );
}
