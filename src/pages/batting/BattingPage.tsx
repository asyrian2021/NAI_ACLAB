import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { NumericInput } from "../../components/NumericInput";
import { SeedStatus } from "../../components/SeedStatus";
import type { Edit } from "../../lib/actions";
import type { AppState, Job } from "../../types";
import { BattingResults } from "./BattingResults";

export function BattingPage({
  state,
  edit,
  busy,
  jobs,
  runId,
  selectRun,
  start,
}: {
  state: AppState;
  edit: Edit;
  busy: boolean;
  jobs: Job[];
  runId: string;
  selectRun: (id: string) => void;
  /** Starts the test, asking for confirmation first when the seed is fixed. */
  start: () => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SCENE TEST</div>
          <h1>여러 장면에서 비교하기</h1>
          <p>불러온 고정 조합을 여러 프리셋에서 시험할 수 있습니다.</p>
        </div>
      </div>
      <div className="batting-layout">
        <section className="batting-settings" aria-label="타율 테스트 설정">
          <div className="batting-settings-heading">
            <div>
              <h2>테스트할 프리셋</h2>
              <p className="micro">크기와 생성 매수를 지정하세요.</p>
            </div>
            <button
              className="outline"
              onClick={() =>
                edit((s) =>
                  s.batting_scenes.push({
                    name: "",
                    preset: s.prompt_presets[0]?.name || "",
                    image_size: "portrait",
                    count: 2,
                  }),
                )
              }
            >
              <Plus size={15} />씬 추가
            </button>
          </div>
          <div className="generation-action batting-generation">
            <button
              className="primary"
              disabled={busy || !state.batting_scenes.length}
              onClick={start}
            >
              <FlaskConical size={15} />
              타율 테스트 시작
            </button>
            <SeedStatus seed={state.api.seed} />
          </div>
          <div className="notice">
            {state.generation.fixed_artists.length
              ? `고정 조합 ${state.generation.fixed_artists.length}명 사용`
              : "랜덤 모드입니다. 동일 조합으로 비교하려면 작업실에서 이미지의 조합을 불러오세요."}
          </div>
          {state.batting_scenes.map((sc, i) => (
            <section className="scene-editor" key={i}>
              <label>
                프롬프트 프리셋
                <select
                  value={sc.preset}
                  onChange={(e) =>
                    edit((s) => (s.batting_scenes[i].preset = e.target.value))
                  }
                >
                  {state.prompt_presets.map((p) => (
                    <option key={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                이미지 크기
                <select
                  value={sc.image_size}
                  onChange={(e) =>
                    edit(
                      (s) => (s.batting_scenes[i].image_size = e.target.value),
                    )
                  }
                >
                  <option value="portrait">세로</option>
                  <option value="landscape">가로</option>
                  <option value="square">정사각형</option>
                </select>
              </label>
              <label>
                매수
                <NumericInput
                  type="number"
                  min="1"
                  max="200"
                  value={sc.count}
                  onChange={(e) =>
                    edit(
                      (s) =>
                        (s.batting_scenes[i].count = e.target.valueAsNumber),
                    )
                  }
                />
              </label>
              <button
                aria-label="씬 삭제"
                onClick={() => edit((s) => s.batting_scenes.splice(i, 1))}
              >
                <Trash2 size={15} />
              </button>
            </section>
          ))}
        </section>
        <BattingResults
          history={state.history}
          jobs={jobs}
          runId={runId}
          selectRun={selectRun}
        />
      </div>
    </>
  );
}
