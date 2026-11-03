import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { Campaign } from "../../types";

/** True when the next stage is a rate stage with fewer than two scenes to test on. */
export function needsSceneWarning(c: Campaign) {
  const next = c.info.stages.find((s) => s.key === c.info.next_stage);
  return (
    !!next &&
    next.kind === "round" &&
    next.key !== "confirm" &&
    c.info.next_scenes.length < 2
  );
}

/**
 * Warns before a rate stage that has too few scenes: with one scene the rate is
 * easily inflated, and with none the stage cannot start (it can be skipped).
 */
export function SceneWarningDialog({
  c,
  cancel,
  proceed,
}: {
  c: Campaign;
  cancel: () => void;
  /** `skipNext` is true when the next stage has no scene at all. */
  proceed: (skipNext: boolean) => void;
}) {
  const next = c.info.stages.find((s) => s.key === c.info.next_stage)!;
  const count = c.info.next_scenes.length;
  const tag = next.scene_tag ? `'${next.scene_tag}' 태그가 붙은 ` : "";
  return (
    <ConfirmDialog
      title="검증할 장면이 부족합니다"
      confirmLabel={count ? "그래도 진행" : `${next.group} 단계 건너뛰고 진행`}
      cancel={cancel}
      confirm={() => proceed(!count)}
    >
      다음 단계({next.name})에 쓸 {tag}장면이 {count}개입니다. 2개 미만이면
      타율이 특정 장면에 치우칠 수 있습니다. 타율 테스트 메뉴에서 장면을
      추가하거나 태그를 붙이세요.
      {count === 0 && " 장면이 없으면 이 단계를 시작할 수 없습니다."}
    </ConfirmDialog>
  );
}
