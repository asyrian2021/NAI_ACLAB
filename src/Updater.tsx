import { useEffect, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { Download, RefreshCw, X } from "lucide-react";

import { version } from "../package.json";

type Release = { current: string; version?: string; notes?: string };
export function Updater({
  blocked,
  prepare,
}: {
  blocked: boolean;
  prepare: () => Promise<void>;
}) {
  const [release, setRelease] = useState<Release>({ current: version });
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState("");
  const [checked, setChecked] = useState(false);
  const [download, setDownload] = useState<{
    downloaded?: number;
    total?: number;
    installing?: boolean;
  }>({});
  const desktop = isTauri();
  async function check(manual = false) {
    if (!desktop || checking) return;
    setChecking(true);
    setFailure("");
    if (manual) setOpen(true);
    try {
      setRelease(await invoke<Release>("check_update"));
      setChecked(true);
    } catch {
      setFailure(
        "업데이트를 확인하지 못했습니다. 인터넷 연결 또는 배포 준비 상태를 확인한 후 다시 시도하세요.",
      );
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void check();
  }, []);
  async function install() {
    if (blocked || installing || !release.version) return;
    setInstalling(true);
    setFailure("");
    setDownload({});
    try {
      await prepare();
      const progress = new Channel<typeof download>();
      progress.onmessage = setDownload;
      await invoke("install_update", { version: release.version, progress });
    } catch (error) {
      setFailure("업데이트하지 못했습니다: " + String(error));
      setInstalling(false);
    }
  }
  if (!desktop) return null;
  const percent = download.total
    ? Math.min(
        100,
        Math.round(((download.downloaded || 0) / download.total) * 100),
      )
    : undefined;
  return (
    <>
      <button
        className={release.version ? "update-available" : ""}
        onClick={() => {
          setOpen(true);
          if (!release.version) void check();
        }}
        title="앱 업데이트"
      >
        {release.version ? (
          <Download size={14} />
        ) : (
          <RefreshCw size={13} className={checking ? "spin" : ""} />
        )}
        {release.version ? `새 버전 ${release.version}` : `v${release.current}`}
      </button>
      {open && (
        <div className="modal-backdrop">
          <section
            className="modal update-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="앱 업데이트"
          >
            <div className="row spread">
              <h2>앱 업데이트</h2>
              {!installing && (
                <button
                  aria-label="업데이트 창 닫기"
                  onClick={() => setOpen(false)}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <p className="muted">현재 버전 {release.current}</p>
            {checking ? (
              <p>새 버전을 확인하고 있습니다…</p>
            ) : release.version ? (
              <>
                <h3>{release.version} 버전으로 업데이트할 수 있습니다.</h3>
                {release.notes && (
                  <p className="release-notes">{release.notes}</p>
                )}
                <p>
                  업데이트를 설치하면 앱이 종료되고 새 버전으로 다시 실행됩니다.
                </p>
                {blocked && <p>생성 작업이 끝난 후 업데이트할 수 있습니다.</p>}
                <button
                  className="primary full"
                  disabled={blocked || installing}
                  onClick={() => void install()}
                >
                  <Download size={15} />
                  {installing ? "업데이트 중…" : "지금 업데이트"}
                </button>
              </>
            ) : checked && !failure ? (
              <p>최신 버전을 사용하고 있습니다.</p>
            ) : null}
            {installing && (
              <div className="update-download">
                <progress
                  aria-label="업데이트 다운로드 진행률"
                  max={100}
                  value={percent}
                />
                <p>
                  {download.installing
                    ? "서명 확인 완료 · 설치를 시작합니다…"
                    : percent === undefined
                      ? "업데이트를 준비하고 있습니다…"
                      : `다운로드 ${percent}%`}
                </p>
              </div>
            )}
            {failure && (
              <p className="error-text" role="alert">
                {failure}
              </p>
            )}
            {!installing && (
              <button
                className="outline"
                disabled={checking}
                onClick={() => void check(true)}
              >
                업데이트 다시 확인
              </button>
            )}
          </section>
        </div>
      )}
    </>
  );
}
