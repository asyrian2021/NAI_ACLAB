import type { InputHTMLAttributes } from "react";

/** An input that shows NaN (an emptied number field) as blank instead of "NaN". */
export function NumericInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      value={
        typeof props.value === "number" && Number.isNaN(props.value)
          ? ""
          : props.value
      }
    />
  );
}
