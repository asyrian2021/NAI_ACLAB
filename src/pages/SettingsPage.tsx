import { ApiField } from "../components/ApiField";
import { NumericInput } from "../components/NumericInput";
import type { Edit } from "../lib/actions";
import type { AppState } from "../types";

export function SettingsPage({ state, edit }: { state: AppState; edit: Edit }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PREFERENCES</div>
          <h1>생성 및 API 설정</h1>
          <p>API 토큰은 Windows 계정에 암호화해 저장됩니다.</p>
        </div>
      </div>
      <section className="settings-block">
        <label className="check">
          <NumericInput
            type="checkbox"
            checked={state.api.mock_mode}
            onChange={(e) => edit((s) => (s.api.mock_mode = e.target.checked))}
          />
          API 없이 체험하기
        </label>
        <label>
          NovelAI API 토큰
          <NumericInput
            type="password"
            autoComplete="off"
            placeholder={
              state.api.token_saved
                ? "저장된 토큰이 있습니다. 변경할 때만 입력하세요."
                : "API 토큰 입력"
            }
            value={state.api.token}
            onChange={(e) => edit((s) => (s.api.token = e.target.value))}
          />
        </label>
        <div className="two-fields">
          <ApiField
            state={state}
            edit={edit}
            name="model"
            title="Model"
            type="text"
          />
          <ApiField
            state={state}
            edit={edit}
            name="sampler"
            title="Sampler"
            type="text"
          />
          <ApiField
            state={state}
            edit={edit}
            name="noise_schedule"
            title="Noise schedule"
            type="text"
          />
          <ApiField state={state} edit={edit} name="steps" title="Steps" />
          <ApiField
            state={state}
            edit={edit}
            name="scale"
            title="Prompt guidance"
          />
          <ApiField
            state={state}
            edit={edit}
            name="guidance_rescale"
            title="Guidance rescale"
          />
        </div>
      </section>
    </>
  );
}
