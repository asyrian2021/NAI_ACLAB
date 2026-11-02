import { Copy, X } from "lucide-react";
import type { Preview } from "../types";

export function PromptPreviewDialog({
  preview,
  close,
  copy,
}: {
  preview: Preview;
  close: () => void;
  copy: (text: string) => Promise<void>;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="프롬프트 미리보기"
        className="modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>프롬프트 미리보기</h2>
          <button aria-label="미리보기 닫기" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <p className="muted">랜덤 모드에서는 실제 생성 시 새로 추첨합니다.</p>
        <h3>전체 프롬프트</h3>
        <p className="prompt-text">{preview.prompt || "(비어 있음)"}</p>
        <button onClick={() => void copy(preview.prompt)}>
          <Copy size={14} />
          복사
        </button>
        <h3>네거티브</h3>
        <p className="prompt-text">{preview.negative || "(비어 있음)"}</p>
      </section>
    </div>
  );
}
