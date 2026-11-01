import { LockKeyhole, LockKeyholeOpen } from "lucide-react";

export function SeedStatus({
  seed,
  unsetLabel = "랜덤 시드",
}: {
  seed?: number;
  unsetLabel?: string;
}) {
  const fixed = seed !== undefined && Number.isInteger(seed) && seed >= 0;
  const label = fixed ? `시드 고정 · Seed ${seed}` : unsetLabel;
  const Icon = fixed ? LockKeyhole : LockKeyholeOpen;
  return (
    <span
      className={`seed-status ${fixed ? "fixed" : "random"}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon size={18} aria-hidden="true" />
    </span>
  );
}
