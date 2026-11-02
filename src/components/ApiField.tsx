import type { Edit } from "../lib/actions";
import type { AppState, Settings as ApiSettings } from "../types";
import { NumericInput } from "./NumericInput";

/** A labeled input bound to one `state.api` setting. */
export function ApiField({
  state,
  edit,
  name,
  title,
  type = "number",
}: {
  state: AppState;
  edit: Edit;
  name: keyof ApiSettings;
  title: string;
  type?: string;
}) {
  return (
    <label>
      {title}
      <NumericInput
        type={type}
        step={name === "scale" || name === "guidance_rescale" ? 0.1 : "any"}
        value={String(state.api[name] ?? "")}
        onChange={(e) =>
          edit((s) => {
            (s.api as unknown as Record<string, unknown>)[name] =
              type === "number" ? e.target.valueAsNumber : e.target.value;
          })
        }
      />
    </label>
  );
}
