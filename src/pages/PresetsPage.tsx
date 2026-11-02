import { ArrowUp, Layers, Plus, Trash2, X } from "lucide-react";
import { NumericInput } from "../components/NumericInput";
import type { ShowToast } from "../hooks/useNotices";
import type { Edit } from "../lib/actions";
import type { AppState } from "../types";

export function PresetsPage({
  state,
  edit,
  editPreset,
  setEditPreset,
  notify,
}: {
  state: AppState;
  edit: Edit;
  editPreset: number;
  setEditPreset: (index: number) => void;
  notify: ShowToast;
}) {
  const preset = state.prompt_presets[editPreset];

  /** Deletes the open preset (and its batting scenes) with an undo toast. */
  function deletePreset() {
    if (!preset) return;
    const at = editPreset;
    const removedScenes = state.batting_scenes
      .map((scene, index) => ({ scene, index }))
      .filter(({ scene }) => scene.preset === preset.name);
    const wasSelected = state.generation.preset === preset.name;
    edit((s) => {
      s.prompt_presets.splice(at, 1);
      s.batting_scenes = s.batting_scenes.filter(
        (sc) => sc.preset !== preset.name,
      );
      if (s.generation.preset === preset.name)
        s.generation.preset = s.prompt_presets[0]?.name || "";
    });
    setEditPreset(0);
    notify(`“${preset.name}” 프리셋을 삭제했습니다.`, {
      label: "실행 취소",
      run: () => {
        edit((s) => {
          if (s.prompt_presets.some((p) => p.name === preset.name)) return;
          s.prompt_presets.splice(
            Math.min(at, s.prompt_presets.length),
            0,
            structuredClone(preset),
          );
          removedScenes.forEach(({ scene, index }) =>
            s.batting_scenes.splice(
              Math.min(index, s.batting_scenes.length),
              0,
              structuredClone(scene),
            ),
          );
          if (wasSelected) s.generation.preset = preset.name;
        });
        setEditPreset(at);
      },
    });
  }
  function deleteCharacter(i: number) {
    const removed = preset.characters[i];
    const at = editPreset;
    edit((s) => s.prompt_presets[at].characters.splice(i, 1));
    notify(`캐릭터 ${i + 1}을(를) 삭제했습니다.`, {
      label: "실행 취소",
      run: () =>
        edit((s) => {
          const list = s.prompt_presets[at]?.characters;
          if (list)
            list.splice(Math.min(i, list.length), 0, structuredClone(removed));
        }),
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PROMPTS</div>
          <h1>프롬프트 프리셋</h1>
          <p>공통 설정은 그대로, 장면과 캐릭터는 하나의 세트로.</p>
        </div>
      </div>
      <section className="global-prompts">
        <div>
          <h2>모든 프리셋의 공통 설정</h2>
          <p className="muted">프리셋을 바꿔도 유지됩니다.</p>
        </div>
        <div className="two-fields">
          <label>
            공통 퀄리티
            <textarea
              rows={4}
              value={state.quality_prompt}
              onChange={(e) => edit((s) => (s.quality_prompt = e.target.value))}
            />
          </label>
          <label>
            공통 네거티브
            <textarea
              rows={4}
              value={state.negative_prompt}
              onChange={(e) =>
                edit((s) => (s.negative_prompt = e.target.value))
              }
            />
          </label>
        </div>
      </section>
      <div className="preset-layout">
        <aside className="preset-list">
          <h2>
            프리셋 <span className="muted">{state.prompt_presets.length}</span>
          </h2>
          {state.prompt_presets.map((p, i) => (
            <button
              key={i}
              aria-pressed={editPreset === i}
              onClick={() => setEditPreset(i)}
            >
              <Layers size={14} />
              {p.name}
            </button>
          ))}
          <button
            className="outline"
            onClick={() => {
              let n = 1;
              while (
                state.prompt_presets.some((p) => p.name === `새 프리셋 ${n}`)
              )
                n++;
              edit((s) =>
                s.prompt_presets.push({
                  name: `새 프리셋 ${n}`,
                  base_prompt: "",
                  characters: [{ prompt: "", negative: "" }],
                }),
              );
              setEditPreset(state.prompt_presets.length);
            }}
          >
            <Plus size={14} />
            프리셋 추가
          </button>
        </aside>
        {preset ? (
          <section className="preset-editor">
            <div className="row spread">
              <h2>개별 프리셋</h2>
              <button
                className="danger"
                aria-label="프리셋 삭제"
                onClick={deletePreset}
              >
                <Trash2 size={14} />
                삭제
              </button>
            </div>
            <label>
              프리셋 이름
              <NumericInput
                value={preset.name}
                onChange={(e) =>
                  edit((s) => {
                    const old = s.prompt_presets[editPreset].name;
                    s.prompt_presets[editPreset].name = e.target.value;
                    if (s.generation.preset === old)
                      s.generation.preset = e.target.value;
                    s.batting_scenes.forEach((sc) => {
                      if (sc.preset === old) sc.preset = e.target.value;
                    });
                  })
                }
              />
            </label>
            <label>
              베이스 프롬프트
              <textarea
                rows={4}
                value={preset.base_prompt}
                onChange={(e) =>
                  edit(
                    (s) =>
                      (s.prompt_presets[editPreset].base_prompt =
                        e.target.value),
                  )
                }
              />
            </label>
            {preset.characters.map((c, i) => (
              <div className="character-editor" key={i}>
                <div className="row spread">
                  <h3>캐릭터 {i + 1}</h3>
                  <div className="row">
                    <button
                      aria-label="캐릭터 위로"
                      disabled={i === 0}
                      onClick={() =>
                        edit((s) => {
                          const a = s.prompt_presets[editPreset].characters;
                          [a[i - 1], a[i]] = [a[i], a[i - 1]];
                        })
                      }
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      aria-label="캐릭터 삭제"
                      onClick={() => deleteCharacter(i)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="two-fields">
                  <label>
                    캐릭터 프롬프트
                    <textarea
                      rows={4}
                      value={c.prompt}
                      onChange={(e) =>
                        edit(
                          (s) =>
                            (s.prompt_presets[editPreset].characters[i].prompt =
                              e.target.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    캐릭터 네거티브
                    <textarea
                      rows={4}
                      value={c.negative}
                      onChange={(e) =>
                        edit(
                          (s) =>
                            (s.prompt_presets[editPreset].characters[
                              i
                            ].negative = e.target.value),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
            <button
              className="outline"
              onClick={() =>
                edit((s) =>
                  s.prompt_presets[editPreset].characters.push({
                    prompt: "",
                    negative: "",
                  }),
                )
              }
            >
              <Plus size={14} />
              캐릭터 추가
            </button>
          </section>
        ) : (
          <section className="empty">프리셋을 추가하세요.</section>
        )}
      </div>
    </>
  );
}
