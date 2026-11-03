import { Plus, X } from "lucide-react";
import { NumericInput } from "../../components/NumericInput";
import type { Category, Gene } from "../../types";
import { categoryPool, shortTag, weightGrid } from "./lib";

/** Edits one frozen group: which artists, their order and weights. */
export function GeneEditor({
  category,
  genes,
  onChange,
  label,
}: {
  category: Category | undefined;
  genes: Gene[];
  onChange: (genes: Gene[]) => void;
  label: string;
}) {
  const pool = categoryPool(category);
  const grid = weightGrid(category);
  const used = new Set(genes.map((g) => g.tag));
  const free = pool.filter((t) => !used.has(t));
  const middle = grid[Math.floor((grid.length - 1) / 2)];
  return (
    <div className="gene-editor" aria-label={label}>
      {genes.map((g, i) => (
        <div className="gene-editor-row" key={g.tag + i}>
          <select
            aria-label={`${label} ${i + 1}번 작가`}
            value={g.tag}
            onChange={(e) =>
              onChange(
                genes.map((x, j) =>
                  j === i ? { ...x, tag: e.target.value } : x,
                ),
              )
            }
          >
            {[g.tag, ...free].map((t) => (
              <option key={t} value={t}>
                {shortTag(t)}
              </option>
            ))}
          </select>
          <NumericInput
            type="number"
            aria-label={`${label} ${i + 1}번 가중치`}
            step={category?.granule || 0.05}
            min={category?.min_weight}
            max={category?.max_weight}
            value={g.weight}
            onChange={(e) =>
              onChange(
                genes.map((x, j) =>
                  j === i ? { ...x, weight: e.target.valueAsNumber } : x,
                ),
              )
            }
          />
          <button
            aria-label={`${shortTag(g.tag)} 빼기`}
            onClick={() => onChange(genes.filter((_, j) => j !== i))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        className="text-button"
        disabled={!free.length || !category}
        onClick={() =>
          onChange([
            ...genes,
            { group: category!.name, tag: free[0], weight: middle },
          ])
        }
      >
        <Plus size={14} />
        작가 추가
      </button>
    </div>
  );
}
