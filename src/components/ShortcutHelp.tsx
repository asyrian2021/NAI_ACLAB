import { useEffect, useRef } from "react";
import { Keyboard, X } from "lucide-react";

const groups: [string, [string[], string][]][] = [
  [
    "보기",
    [
      [["←", "→"], "이전 · 다음 이미지"],
      [["1", "2", "3"], "감상 · 비교 · 모아보기"],
      [["P"], "현재 이미지를 기준으로 고정"],
      [["F"], "집중 보기"],
      [["Esc"], "집중 보기 해제 · 화면 맞춤"],
    ],
  ],
  [
    "확대",
    [
      [["+", "−"], "확대 · 축소"],
      [["0"], "화면 맞춤"],
      [["휠"], "커서 위치를 기준으로 확대"],
      [["더블클릭"], "원본 크기(1:1) ↔ 화면 맞춤"],
    ],
  ],
  [
    "작업",
    [
      [["Ctrl", "Enter"], "생성 대기열에 추가"],
      [["H"], "즐겨찾기"],
      [["?"], "이 안내 열기 · 닫기"],
    ],
  ],
];

export function ShortcutHelp({ close }: { close: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const launcher = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => {
      if (launcher?.isConnected) launcher.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="단축키 안내"
        className="modal shortcut-help"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>
            <Keyboard size={16} /> 단축키
          </h2>
          <button
            ref={closeButton}
            aria-label="단축키 안내 닫기"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <div className="shortcut-groups">
          {groups.map(([title, items]) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>
                {items.map(([keys, text], i) => (
                  <div key={text} style={{ animationDelay: `${i * 30}ms` }}>
                    <dt>
                      {keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
