import { useState, type CSSProperties } from "react";
import { FileText, ListPlus, Plus, Power, X } from "lucide-react";
import type { ShowToast } from "../hooks/useNotices";
import type { Edit } from "../lib/actions";
import { parseArtistTag, splitArtistText } from "../lib/helpers";
import type { Category } from "../types";

type Row = { raw: string; tag: string; issue: string; off: boolean };

/** Labels each row the way the engine will treat it on save. */
function analyze(category: Category): Row[] {
  const disabled = new Set(category.disabled_tags ?? []);
  const seen = new Set<string>();
  return category.tags.map((raw) => {
    const tag = parseArtistTag(raw);
    let issue = "";
    if (!raw.trim()) issue = "빈 칸";
    else if (!tag) issue = "artist: 없음";
    else if (seen.has(tag)) issue = "중복";
    if (tag) seen.add(tag);
    return { raw, tag, issue, off: !!tag && disabled.has(tag) };
  });
}

/**
 * Row-per-artist editor: toggle each artist in or out of the draw, see which
 * lines the engine would drop, and paste many lines at once. A plain-text mode
 * remains for bulk editing.
 */
export function ArtistTagEditor({
  category,
  index,
  edit,
  notify,
}: {
  category: Category;
  index: number;
  edit: Edit;
  notify: ShowToast;
}) {
  const [bulk, setBulk] = useState(false);
  const [draft, setDraft] = useState("");
  const rows = analyze(category);
  const valid = rows.filter((r) => r.tag && r.issue !== "중복");
  const active = valid.filter((r) => !r.off).length;

  function update(fn: (c: Category) => void) {
    edit((s) => fn(s.categories[index]));
  }
  function setDisabled(c: Category, tag: string, off: boolean) {
    const list = (c.disabled_tags ?? []).filter((t) => t !== tag);
    c.disabled_tags = off ? [...list, tag] : list;
  }
  function add() {
    const known = new Set(rows.map((r) => r.tag || r.raw.trim()));
    const fresh: string[] = [];
    let skipped = 0;
    for (const chunk of splitArtistText(draft)) {
      const value = parseArtistTag(chunk) || chunk;
      if (known.has(value)) skipped++;
      else {
        known.add(value);
        fresh.push(value);
      }
    }
    // Blank lines never reach the engine; drop them while adding.
    if (fresh.length)
      update((c) => (c.tags = [...c.tags.filter((t) => t.trim()), ...fresh]));
    setDraft("");
    if (skipped) notify(`이미 등록된 작가 ${skipped}명은 건너뛰었습니다.`);
  }

  return (
    <div className="tag-editor">
      <div className="tag-editor-head">
        <span>
          작가 태그{" "}
          <span className="muted">
            사용 {active} / 등록 {valid.length}명
          </span>
        </span>
        <div className="row">
          {active < valid.length && (
            <button
              className="text-button"
              onClick={() => update((c) => (c.disabled_tags = []))}
            >
              <Power size={13} />
              모두 사용
            </button>
          )}
          <button
            className="text-button"
            onClick={() => {
              if (bulk && category.tags.some((t) => !t.trim()))
                update((c) => (c.tags = c.tags.filter((t) => t.trim())));
              setBulk(!bulk);
            }}
          >
            {bulk ? <ListPlus size={13} /> : <FileText size={13} />}
            {bulk ? "목록으로 보기" : "텍스트로 편집"}
          </button>
        </div>
      </div>
      {bulk ? (
        <>
          <label className="bulk-label">
            <span className="visually-hidden">작가 태그</span>
            <textarea
              rows={10}
              placeholder={"artist:example_a\nartist:example_b"}
              value={category.tags.join("\n")}
              onChange={(e) =>
                update((c) => (c.tags = e.target.value.split("\n")))
              }
            />
          </label>
          <p className="muted">
            한 줄에 하나씩 입력하거나 가중치가 포함된 태그를 붙여넣으세요.
            저장할 때 정리됩니다.
          </p>
        </>
      ) : (
        <>
          {rows.length ? (
            <ol className="tag-list">
              {rows.map((row, i) => (
                <li
                  key={i}
                  className={
                    "tag-row" +
                    (row.off ? " is-off" : "") +
                    (row.issue ? " has-issue" : "")
                  }
                  style={{ "--i": Math.min(i, 16) } as CSSProperties}
                >
                  <label className="switch" title="추첨에 사용">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`${row.tag || row.raw || "빈 칸"} 사용`}
                      checked={!row.off}
                      disabled={!row.tag || row.issue === "중복"}
                      onChange={(e) =>
                        update((c) =>
                          setDisabled(c, row.tag, !e.target.checked),
                        )
                      }
                    />
                    <span aria-hidden="true" />
                  </label>
                  <input
                    className="tag-input"
                    aria-label={`작가 태그 ${i + 1}`}
                    value={row.raw}
                    spellCheck={false}
                    onChange={(e) => {
                      const value = e.target.value;
                      update((c) => {
                        c.tags[i] = value;
                        const next = parseArtistTag(value);
                        if (row.off) {
                          setDisabled(c, row.tag, false);
                          if (next) setDisabled(c, next, true);
                        }
                      });
                    }}
                  />
                  {row.issue && (
                    <span
                      className="tag-issue"
                      title={
                        row.issue === "중복"
                          ? "같은 작가가 이미 있어 저장할 때 하나만 남습니다."
                          : "저장할 때 이 줄은 제외됩니다."
                      }
                    >
                      {row.issue}
                    </span>
                  )}
                  <button
                    aria-label={`작가 태그 ${i + 1} 삭제`}
                    onClick={() =>
                      update((c) => {
                        c.tags.splice(i, 1);
                        if (
                          row.tag &&
                          !c.tags.some((t) => parseArtistTag(t) === row.tag)
                        )
                          setDisabled(c, row.tag, false);
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="tag-empty">
              아직 등록된 작가가 없습니다. 아래에 붙여넣어 추가하세요.
            </p>
          )}
          <div className="tag-add">
            <textarea
              rows={2}
              aria-label="작가 태그 추가"
              placeholder="artist:이름 — 여러 줄이나 쉼표로 붙여넣으면 한 번에 추가됩니다"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button className="outline" disabled={!draft.trim()} onClick={add}>
              <Plus size={14} />
              추가
            </button>
          </div>
        </>
      )}
    </div>
  );
}
