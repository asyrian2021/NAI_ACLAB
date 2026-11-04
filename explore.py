"""Combination search (campaigns).

A campaign has a plan: every artist group (Category) gets a search mode.
  - pick:  evolve the group from side-by-side picks on shared seeds,
  - rate:  narrow the group by success rate over labelled trials (8 → 4 → 2),
  - fixed: keep one drawn set for the whole search.
Groups are searched one at a time in plan order; every other group stays in
`Campaign.frozen`. After the plan, the first pick group is retuned against the
new stabilizers and a final round confirms the result. Prompts always follow
the category order of the artist menu (`Campaign.group_order`). Scoring is per
whole combination (Genome), never per artist.

Every random choice takes an explicit `rng: random.Random` so tests can replay
it; image seeds still come from `secrets`.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
import secrets
import time
import uuid
from copy import deepcopy
from dataclasses import asdict, dataclass, field, fields

import app
from models import AppState, Category

MODES = ("pick", "rate", "fixed")
IMAGE_SIZES = ("portrait", "landscape", "square")
FAILURES = {"anatomy": "신체 붕괴", "hands": "손 붕괴", "feet": "발 붕괴", "prompt": "프롬프트 불일치",
            "style": "화풍 덮어씀", "background": "배경 붕괴"}
DEFAULT_LABELS = ["anatomy", "prompt", "style"]
OPERATORS = ("mut_weight", "mut_swap", "mut_add", "mut_drop", "mut_reorder")
RETRIES = 20

DEFAULT_PARAMS = {
    "pop_size": 6,
    "seeds_per_gen": 2,
    "max_generations": 12,
    "stop_after_same_winner": 3,
    "converge_after_same_winner": 2,
    "second_op_prob": 0.3,
    "rates": {"mut_weight": .55, "mut_swap": .20, "mut_add": .08, "mut_drop": .08, "mut_reorder": .09},
    "rates_converge": {"mut_weight": .80, "mut_swap": .10, "mut_add": .03, "mut_drop": .03, "mut_reorder": .04},
    "round_candidates": 8,
    "round_seeds": [2, 4, 8],
    "retune_generations": 4,
    "confirm_seeds": 4,
    "wilson_z": 1.645,
}
PARAM_LIMITS = {"pop_size": (2, 8), "seeds_per_gen": (1, 8), "max_generations": (1, 50), "stop_after_same_winner": (1, 20),
                "converge_after_same_winner": (1, 20), "round_candidates": (2, 16), "retune_generations": (1, 20),
                "confirm_seeds": (1, 16)}


@dataclass
class Gene:                 # One artist inside a combination.
    group: str              # Category.name
    tag: str
    weight: float           # A value on that Category's granule grid.


@dataclass
class Genome:               # One combination = the unit of evaluation.
    id: str                 # First 10 hex chars of sha1(canonical_key).
    genes: list[Gene]       # Full prompt: groups in group_order, then stored order.
    parents: list[str] = field(default_factory=list)
    origin: str = "seed"    # seed | elite | mut_* | crossover | random | revived | final
    born_in: int = 0

    @property
    def key(self) -> str:
        return canonical_key(self.genes)


@dataclass
class Trial:                # One image.
    id: str
    genome_id: str
    seed: int
    scene: str              # Preset name of the scene (pick stages: the campaign preset).
    image_path: str = ""
    job_id: str = ""
    failures: list[str] = field(default_factory=list)  # [] = success
    error: str = ""         # API errors are void attempts, not failures.
    stage: str = ""         # Stage key (see `stages`).
    batch: int = 0          # Generation/round index inside the stage.
    created_at: str = ""


@dataclass
class Generation:           # A generation of a pick (or retune) stage.
    index: int
    genome_ids: list[str]
    seeds: list[int]
    picks: list[str] = field(default_factory=list)  # Order = preference.
    status: str = "pending"  # pending | generating | awaiting_pick | done
    stage: str = ""
    origins: list[str] = field(default_factory=list)       # Per column, this generation's role.
    parents: list[list[str]] = field(default_factory=list)  # Per column.


@dataclass
class Round:                # A round of a rate stage (and the one-candidate confirm round).
    index: int
    genome_ids: list[str]
    seeds: list[int]
    scenes: list[str]
    survivors: list[str] = field(default_factory=list)
    status: str = "pending"  # pending | generating | awaiting_labels | done
    stage: str = ""
    eliminated: list[str] = field(default_factory=list)
    result: dict = field(default_factory=dict)  # Final round: finalists, recommended, overlap.


@dataclass
class Campaign:
    id: str
    name: str
    created_at: str
    stage: str                      # Current stage key.
    plan: list[dict]                # [{group, mode, labels, scene_tag}] in search order.
    group_order: list[str]          # Prompt order of the groups in the plan.
    frozen: dict[str, list[Gene]]   # Group name → genes held while another group moves.
    params: dict
    preset: str
    genomes: dict[str, Genome] = field(default_factory=dict)
    generations: list[Generation] = field(default_factory=list)
    rounds: list[Round] = field(default_factory=list)
    trials: list[Trial] = field(default_factory=list)
    champions: dict[str, str] = field(default_factory=dict)  # Stage key → winning Genome id (+ "final").
    updated_at: str = ""
    # Image size of the pick and retune stages; "" keeps the studio's current size (older campaigns).
    image_size: str = ""
    # Searched group → the set it held before its stage ran ([] = none). Empty in older campaigns.
    baselines: dict[str, list[Gene]] = field(default_factory=dict)


# ---------------------------------------------------------------- stages

def stages(c: Campaign) -> list[dict]:
    """The campaign's stages in order: plan groups, retune, confirm, done."""
    out, number = [], 0
    for i, p in enumerate(c.plan):
        if p["mode"] == "fixed":
            continue
        number += 1
        pick = p["mode"] == "pick"
        out.append({"key": f"s{i}", "kind": "evolve" if pick else "round", "group": p["group"],
                    "labels": [] if pick else list(p.get("labels") or DEFAULT_LABELS),
                    "scene_tag": "" if pick else str(p.get("scene_tag") or ""),
                    "name": f"{number}단계 · {p['group']} {'고르기' if pick else '타율'}"})
    first_pick = next((s for s in out if s["kind"] == "evolve"), None)
    if first_pick and out.index(first_pick) < len(out) - 1:
        out.append({"key": "retune", "kind": "evolve", "group": first_pick["group"], "labels": [], "scene_tag": "",
                    "name": f"재조정 · {first_pick['group']}"})
    labels = [code for code in FAILURES if any(code in s["labels"] for s in out)] or list(DEFAULT_LABELS)
    out.append({"key": "confirm", "kind": "round", "group": None, "labels": labels, "scene_tag": "", "name": "최종 확인"})
    out.append({"key": "done", "kind": "done", "group": None, "labels": [], "scene_tag": "", "name": "완료"})
    return out


def stage_info(c: Campaign, key: str | None = None) -> dict:
    key = key or c.stage
    found = next((s for s in stages(c) if s["key"] == key), None)
    if found is None:
        raise ValueError("알 수 없는 탐색 단계입니다.")
    return found


def next_stage(c: Campaign, key: str) -> str:
    keys = [s["key"] for s in stages(c)]
    return keys[min(keys.index(key) + 1, len(keys) - 1)]


def is_evolve(c: Campaign) -> bool:
    return stage_info(c)["kind"] == "evolve"


def reference_stage(c: Campaign) -> str:
    """The first pick stage; its winner's images are the style reference in rounds."""
    return next((s["key"] for s in stages(c) if s["kind"] == "evolve"), "")


# ---------------------------------------------------------------- persistence

def now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def explore_dir():
    return app.EXPLORE_DIR


def campaign_path(campaign_id: str):
    if not re.fullmatch(r"[\w-]{1,80}", str(campaign_id or "")):
        raise ValueError("캠페인 ID가 올바르지 않습니다.")
    return explore_dir() / f"{campaign_id}.json"


def _build(cls, data):
    keys = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in (data or {}).items() if k in keys})


def genes_from(items) -> list[Gene]:
    """Accepts Gene dicts or image artist dicts (`category` instead of `group`)."""
    result = []
    for item in items or []:
        if isinstance(item, Gene):
            result.append(Gene(item.group, item.tag, float(item.weight)))
            continue
        tag = str(item.get("tag", "")).strip()
        try:
            weight = float(item.get("weight", 1))
        except (TypeError, ValueError):
            continue
        if not tag or not math.isfinite(weight):
            continue
        result.append(Gene(str(item.get("group", item.get("category", ""))), tag, weight))
    return result


def campaign_from_dict(data: dict) -> Campaign:
    if "plan" not in data:
        raise ValueError("이전 형식의 캠페인입니다.")
    c = _build(Campaign, data)
    c.frozen = {group: genes_from(genes) for group, genes in (c.frozen or {}).items()}
    c.baselines = {group: genes_from(genes) for group, genes in (c.baselines or {}).items()}
    c.params = {**deepcopy(DEFAULT_PARAMS), **(c.params or {})}
    genomes = {}
    for gid, g in (c.genomes or {}).items():
        genome = _build(Genome, g)
        genome.genes = genes_from(genome.genes)
        genomes[gid] = genome
    c.genomes = genomes
    c.generations = [_build(Generation, g) for g in c.generations or []]
    c.rounds = [_build(Round, r) for r in c.rounds or []]
    c.trials = [_build(Trial, t) for t in c.trials or []]
    return c


def campaign_to_dict(c: Campaign) -> dict:
    return asdict(c)


def load_campaign(campaign_id: str) -> Campaign:
    path = campaign_path(campaign_id)
    if not path.is_file():
        raise FileNotFoundError("캠페인을 찾을 수 없습니다.")
    return campaign_from_dict(json.loads(path.read_text(encoding="utf-8")))


def save_campaign(c: Campaign) -> None:
    path = campaign_path(c.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    c.updated_at = now()
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(campaign_to_dict(c), ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(temp, path)


def delete_campaign(campaign_id: str) -> None:
    path = campaign_path(campaign_id)
    if path.is_file():
        path.unlink()


def progress_label(c: Campaign) -> str:
    batch = current_batch(c)
    if isinstance(batch, Generation):
        return f"{batch.index}세대"
    if isinstance(batch, Round):
        return "확인" if c.stage == "confirm" else f"R{batch.index + 1}"
    return ""


def list_campaigns() -> list[dict]:
    folder = explore_dir()
    if not folder.is_dir():
        return []
    result = []
    for path in folder.glob("*.json"):
        try:
            c = load_campaign(path.stem)
            name = stage_info(c)["name"]
        except (OSError, ValueError, TypeError, KeyError):
            continue
        result.append({"id": c.id, "name": c.name, "stage": c.stage, "stage_name": name,
                       "progress": progress_label(c), "created_at": c.created_at, "updated_at": c.updated_at,
                       "images": sum(1 for t in c.trials if not t.error)})
    return sorted(result, key=lambda s: s["updated_at"], reverse=True)


# ---------------------------------------------------------------- genes

def canonical_key(genes: list[Gene]) -> str:
    return "|".join(f"{g.group}:{g.tag}:{g.weight:.2f}" for g in genes)


def genome_id(genes: list[Gene]) -> str:
    return hashlib.sha1(canonical_key(genes).encode("utf-8")).hexdigest()[:10]


def category(state: AppState, group: str) -> Category:
    found = next((cat for cat in state.categories if cat.name == group), None)
    if not found:
        raise ValueError(f"작가 그룹 '{group}'을 찾을 수 없습니다.")
    return found


def pool(cat: Category) -> list[str]:
    disabled = set(app.parse_artist_tags(cat.disabled_tags))
    return [t for t in app.parse_artist_tags(cat.tags) if t not in disabled]


def grid(cat: Category) -> list[float]:
    return app.float_range(cat.min_weight, cat.max_weight, cat.granule) or [round(cat.min_weight, 3)]


def center(values: list[float]) -> float:
    return values[(len(values) - 1) // 2]


def snap(values: list[float], weight: float) -> float:
    return min(values, key=lambda v: (abs(v - weight), v))


def bounds(cat: Category, tags: list[str]) -> tuple[int, int]:
    if cat.all_artists:
        return len(tags), len(tags)
    return min(cat.min_picks, len(tags)), min(cat.max_picks, len(tags))


def group_genes(genome: Genome, group: str) -> list[Gene]:
    return [Gene(g.group, g.tag, g.weight) for g in genome.genes if g.group == group]


def full_genes(c: Campaign, group: str | None, genes: list[Gene]) -> list[Gene]:
    """The moving group's genes plus every frozen group, in prompt (category) order."""
    out = []
    for name in c.group_order:
        source = genes if name == group else c.frozen.get(name, [])
        out.extend(Gene(g.group, g.tag, g.weight) for g in source)
    return out


def normalize(genes: list[Gene], cat: Category, rng: random.Random) -> list[Gene]:
    """Keeps genes valid for the category: known enabled tags, no duplicates, grid weights, pick bounds."""
    tags, values = pool(cat), grid(cat)
    allowed, seen, out = set(tags), set(), []
    for g in genes:
        if g.tag in allowed and g.tag not in seen:
            seen.add(g.tag)
            out.append(Gene(cat.name, g.tag, snap(values, g.weight)))
    lo, hi = bounds(cat, tags)
    while len(out) > hi:
        out.pop(rng.randrange(len(out)))
    unused = [t for t in tags if t not in seen]
    while len(out) < lo and unused:
        tag = unused.pop(rng.randrange(len(unused)))
        out.insert(rng.randint(0, len(out)), Gene(cat.name, tag, center(values)))
    return out


def random_genome(state: AppState, group: str, rng: random.Random, centered=False) -> list[Gene]:
    """Draws one group the way `random_artist_tags_for_state` does for that category."""
    cat = category(state, group)
    tags, values = pool(cat), grid(cat)
    lo, hi = bounds(cat, tags)
    count = rng.randint(lo, hi) if hi else 0
    return [Gene(cat.name, tag, center(values) if centered else rng.choice(values)) for tag in rng.sample(tags, count)]


def _mutate_once(genes, op, cat, tags, values, rng, converge):
    used = {g.tag for g in genes}
    unused = [t for t in tags if t not in used]
    if op == "mut_weight":
        for g in rng.sample(genes, min(len(genes), rng.choice((1, 2)))):
            index = values.index(snap(values, g.weight))
            step = 1 if converge or rng.random() < .7 else 2
            sign = rng.choice((-1, 1))
            moved = max(0, min(len(values) - 1, index + sign * step))
            if moved == index:
                moved = max(0, min(len(values) - 1, index - sign * step))
            g.weight = values[moved]
    elif op == "mut_swap":
        genes[rng.randrange(len(genes))].tag = rng.choice(unused)
    elif op == "mut_add":
        genes.insert(rng.randint(0, len(genes)), Gene(cat.name, rng.choice(unused), center(values)))
    elif op == "mut_drop":
        genes.pop(rng.randrange(len(genes)))
    elif op == "mut_reorder":
        i = rng.randrange(len(genes) - 1)
        genes[i], genes[i + 1] = genes[i + 1], genes[i]


def mutate(c: Campaign, state: AppState, genome: Genome, group: str, rates: dict, rng: random.Random,
           converge=False) -> tuple[list[Gene], str]:
    """Applies one operator (plus a second with `second_op_prob`). Returns the group's genes and the first operator."""
    cat = category(state, group)
    tags, values = pool(cat), grid(cat)
    lo, hi = bounds(cat, tags)
    genes = normalize(group_genes(genome, group), cat, rng)
    applied = []
    for _ in range(2 if rng.random() < float(c.params["second_op_prob"]) else 1):
        used = {g.tag for g in genes}
        has_unused = any(t not in used for t in tags)
        able = {"mut_weight": bool(genes) and len(values) > 1, "mut_swap": bool(genes) and has_unused,
                "mut_add": len(genes) < hi and has_unused, "mut_drop": len(genes) > lo, "mut_reorder": len(genes) > 1}
        choices = [op for op in OPERATORS if able[op] and float(rates.get(op, 0)) > 0]
        if not choices:
            break
        op = rng.choices(choices, [float(rates[o]) for o in choices])[0]
        _mutate_once(genes, op, cat, tags, values, rng, converge)
        applied.append(op)
    return genes, (applied[0] if applied else "mut_weight")


def crossover(c: Campaign, state: AppState, a: Genome, b: Genome, group: str, rng: random.Random) -> list[Gene]:
    """Shared tags stay (mean weight); one-sided tags fill up to a size between the parents'.
    Order follows the first parent; tags from the second keep their relative position."""
    cat = category(state, group)
    values = grid(cat)
    first, second = normalize(group_genes(a, group), cat, rng), normalize(group_genes(b, group), cat, rng)
    second_weights = {g.tag: g.weight for g in second}
    shared = {g.tag for g in first} & set(second_weights)
    lo, hi = bounds(cat, pool(cat))
    target = rng.randint(min(len(first), len(second)), max(len(first), len(second)))
    target = max(lo, min(hi, target, len(first) + len(second) - len(shared)))
    one_sided = [g for g in first if g.tag not in shared] + [g for g in second if g.tag not in shared]
    chosen = {g.tag for g in rng.sample(one_sided, max(0, min(len(one_sided), target - len(shared))))}
    out = [Gene(cat.name, g.tag, snap(values, (g.weight + second_weights[g.tag]) / 2) if g.tag in shared else g.weight)
           for g in first if g.tag in shared or g.tag in chosen]
    for i, g in enumerate(second):
        if g.tag in chosen and g.tag not in {x.tag for x in out}:
            position = round(i / max(1, len(second)) * len(out))
            out.insert(min(position, len(out)), Gene(cat.name, g.tag, g.weight))
    return normalize(out, cat, rng)


def register(c: Campaign, genes: list[Gene], origin: str, parents: list[str], born_in: int) -> Genome:
    """Returns the existing Genome when the same key was seen before."""
    gid = genome_id(genes)
    if gid not in c.genomes:
        c.genomes[gid] = Genome(gid, [Gene(g.group, g.tag, g.weight) for g in genes], list(parents), origin, born_in)
    return c.genomes[gid]


def new_seeds(count: int) -> list[int]:
    return [secrets.randbelow(2**32) for _ in range(max(0, int(count)))]


# ---------------------------------------------------------------- pick stages: evolution

def stage_generations(c: Campaign, stage: str | None = None) -> list[Generation]:
    stage = stage or c.stage
    return [g for g in c.generations if g.stage == stage]


def stage_rounds(c: Campaign, stage: str | None = None) -> list[Round]:
    stage = stage or c.stage
    return [r for r in c.rounds if r.stage == stage]


def current_batch(c: Campaign):
    kind = stage_info(c)["kind"]
    if kind == "evolve":
        gens = stage_generations(c)
        return gens[-1] if gens else None
    if kind == "round":
        rounds = stage_rounds(c)
        return rounds[-1] if rounds else None
    return None


def same_winner_streak(c: Campaign, stage: str | None = None) -> int:
    streak, last = 0, None
    for g in reversed([g for g in stage_generations(c, stage) if g.status == "done"]):
        winner = g.picks[0] if g.picks else None
        if winner is None or (last is not None and winner != last):
            break
        last, streak = winner, streak + 1
    return streak


def is_converging(c: Campaign) -> bool:
    return c.stage == "retune" or same_winner_streak(c) >= int(c.params["converge_after_same_winner"])


def generation_limit(c: Campaign) -> int:
    return int(c.params["retune_generations"] if c.stage == "retune" else c.params["max_generations"])


def recent_keys(c: Campaign, generations=3) -> set[str]:
    keys = set()
    for g in stage_generations(c)[-generations:]:
        keys.update(c.genomes[gid].key for gid in g.genome_ids if gid in c.genomes)
    return keys


def last_elite(c: Campaign) -> Genome:
    for g in reversed(stage_generations(c)):
        if g.picks:
            return c.genomes[g.picks[0]]
    return c.genomes[stage_generations(c)[-1].genome_ids[0]]


def _fill_generation(c, state, plan, index, rng, rates, converge) -> Generation:
    group = stage_info(c)["group"]
    recent = recent_keys(c, 3)
    gen = Generation(index=index, genome_ids=[], seeds=new_seeds(c.params["seeds_per_gen"]), stage=c.stage)
    for kind, src in plan:
        child = None
        for _ in range(RETRIES):
            parents = []
            if kind in ("elite", "seed"):
                genes, origin, parents = src.genes, kind, [src.id] if kind == "elite" else []
            elif kind == "crossover":
                genes, origin, parents = full_genes(c, group, crossover(c, state, *src, group, rng)), "crossover", [src[0].id, src[1].id]
            elif kind == "mutate":
                moved, origin = mutate(c, state, src, group, rates, rng, converge)
                genes, parents = full_genes(c, group, moved), [src.id]
            else:
                genes, origin = full_genes(c, group, random_genome(state, group, rng)), "random"
            child = (genes, origin, parents)
            if kind in ("elite", "seed") or canonical_key(genes) not in recent:
                break
        genes, origin, parents = child
        genome = register(c, genes, origin, parents, index)
        if genome.id in gen.genome_ids:
            continue  # The pool is too small to produce a distinct column.
        recent.add(genome.key)
        gen.genome_ids.append(genome.id)
        gen.origins.append(origin)
        gen.parents.append(parents)
    return gen


def first_generation(c: Campaign, state: AppState, rng: random.Random, start: list[Gene] | None = None) -> Generation:
    """Generation 0: the start (or baseline) set and fresh draws; a retune starts from the frozen winner."""
    size = int(c.params["pop_size"])
    group = stage_info(c)["group"]
    cat = category(state, group)
    if c.stage == "retune":
        base = register(c, full_genes(c, group, c.frozen[group]), "elite", [], 0)
        plan = [("elite", base)] + [("mutate", base)] * (size - 1)
        return _fill_generation(c, state, plan, 0, rng, c.params["rates_converge"], True)
    source = [g for g in (start or []) if g.group == group] or c.frozen.get(group, [])
    seed = normalize(source, cat, rng) if source else []
    plan = []
    if seed:
        genes = full_genes(c, group, seed)
        plan.append(("seed", Genome(genome_id(genes), genes)))
    plan += [("random", None)] * (size - len(plan))
    return _fill_generation(c, state, plan, 0, rng, c.params["rates"], False)


def next_generation(c: Campaign, state: AppState, rng: random.Random) -> Generation:
    """Builds the next generation from the current one's picks (see the stage 1 table)."""
    gen = stage_generations(c)[-1]
    size = int(c.params["pop_size"])
    picks = [c.genomes[g] for g in gen.picks if g in c.genomes]
    if not picks:
        prev = last_elite(c)
        plan = [("elite", prev)] + [("mutate", prev)] * max(0, size - 3) + [("random", None)] * min(2, size - 1)
    elif len(picks) == 1:
        plan = [("elite", picks[0])] + [("mutate", picks[0])] * max(0, size - 2) + [("random", None)] * min(1, size - 1)
    else:
        a, b = picks[:2]
        plan = [("elite", a), ("elite", b), ("crossover", (a, b)), ("mutate", a), ("mutate", rng.choice([a, a, b]))]
        plan += [("mutate", a)] * max(0, size - 6) + [("random", None)] * (1 if size >= 6 else 0)
        plan = plan[:size]
    converge = is_converging(c)
    rates = c.params["rates_converge"] if converge else c.params["rates"]
    return _fill_generation(c, state, plan, gen.index + 1, rng, rates, converge)


def pick(c: Campaign, state: AppState, generation: int, picks: list[str], rng: random.Random, force=False) -> Generation | None:
    gen = current_batch(c)
    if not isinstance(gen, Generation) or gen.index != int(generation):
        raise ValueError("현재 세대가 아닙니다. 화면을 새로 고치세요.")
    if gen.status == "done":
        raise ValueError("이미 선택을 저장한 세대입니다.")
    picks = list(dict.fromkeys(str(p) for p in picks or []))
    if len(picks) > 2 or any(p not in gen.genome_ids for p in picks):
        raise ValueError("이 세대의 조합 중 최대 2개를 고르세요.")
    if pending_tasks(c) and not force:
        raise ValueError("아직 생성되지 않은 이미지가 있습니다. 있는 것만으로 진행하려면 다시 확인하세요.")
    gen.picks, gen.status = picks, "done"
    if len(stage_generations(c)) >= generation_limit(c):
        return None
    nxt = next_generation(c, state, rng)
    c.generations.append(nxt)
    return nxt


# ---------------------------------------------------------------- rate stages: rounds

def wilson(s: int, n: int, z: float = 1.645) -> tuple[float, float]:
    if n <= 0:
        return 0.0, 1.0
    p = s / n
    denom = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / denom
    half = z / denom * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, mid - half), min(1.0, mid + half)


def genome_stats(c: Campaign, genome_id: str, stage: str | None = None) -> dict:
    trials = [t for t in c.trials if t.genome_id == genome_id and not t.error and (stage is None or t.stage == stage)]
    s = sum(1 for t in trials if not t.failures)
    low, high = wilson(s, len(trials), float(c.params.get("wilson_z", 1.645)))
    reasons = {code: sum(1 for t in trials if code in t.failures) for code in FAILURES}
    scenes = {}
    for t in trials:
        entry = scenes.setdefault(t.scene, {"s": 0, "n": 0})
        entry["n"] += 1
        entry["s"] += 0 if t.failures else 1
    return {"s": s, "n": len(trials), "rate": s / len(trials) if trials else 0.0, "low": low, "high": high,
            "reasons": reasons, "scenes": scenes}


def round_scenes(state: AppState, tag: str = "") -> list[str]:
    """Scene presets of the batting test, limited to scenes carrying `tag` when one is given."""
    names = []
    for scene in state.batting_scenes:
        if tag and tag not in (scene.tags or []):
            continue
        if scene.preset and scene.preset not in names:
            names.append(scene.preset)
    return names


def distance(c: Campaign, genome: Genome, group: str) -> tuple[int, float]:
    mine = {g.tag: g.weight for g in group_genes(genome, group)}
    base = {g.tag: g.weight for g in c.frozen.get(group, [])}
    return len(mine.keys() ^ base.keys()), sum(abs(mine[t] - base[t]) for t in mine.keys() & base.keys())


def no_scene_message(info: dict) -> str:
    if info["scene_tag"]:
        return f"'{info['scene_tag']}' 태그가 붙은 장면이 없습니다. 타율 테스트에서 장면에 태그를 추가하세요."
    return "타율 테스트에 장면을 추가하세요."


def start_round(c: Campaign, state: AppState, rng: random.Random, manual: list[list[Gene]] | None = None) -> Round:
    """R1 of the current rate stage: baseline, its mutations, then manual entries and fresh draws."""
    info = stage_info(c)
    group = info["group"]
    scenes = round_scenes(state, info["scene_tag"])
    if not scenes:
        raise ValueError(no_scene_message(info))
    cat = category(state, group)
    size = max(2, int(c.params["round_candidates"]))
    if not c.frozen.get(group):
        c.frozen[group] = random_genome(state, group, rng, centered=True)
    base = register(c, full_genes(c, group, normalize(c.frozen[group], cat, rng)), "seed", [], 0)
    ids, seen = [base.id], {base.key}

    def add(make, origin, parents):
        for _ in range(RETRIES):
            genes = full_genes(c, group, make())
            if canonical_key(genes) not in seen:
                break
        else:
            return
        genome = register(c, genes, origin, parents, 0)
        seen.add(genome.key)
        ids.append(genome.id)

    for _ in range((size - 1) // 2):
        add(lambda: mutate(c, state, base, group, c.params["rates"], rng)[0], "mutate", [base.id])
    for genes in (manual or [])[: size - len(ids)]:
        add(lambda genes=genes: normalize(genes_from(genes), cat, rng), "seed", [])
    while len(ids) < size:
        before = len(ids)
        add(lambda: random_genome(state, group, rng), "random", [])
        if len(ids) == before:
            break
    r = Round(index=0, genome_ids=ids, seeds=new_seeds(c.params["round_seeds"][0]), scenes=scenes, stage=c.stage)
    c.rounds.append(r)
    return r


def round_count(c: Campaign) -> int:
    return 1 if c.stage == "confirm" else len(c.params["round_seeds"])


def rank_round(c: Campaign, r: Round) -> list[str]:
    group = stage_info(c)["group"]
    active = [gid for gid in r.genome_ids if gid not in r.eliminated]

    def key(gid):
        stats = genome_stats(c, gid, c.stage)
        near = distance(c, c.genomes[gid], group) if group else (0, 0.0)
        return -stats["rate"], stats["reasons"]["style"], near

    return sorted(active, key=key)


def close_round(c: Campaign, state: AppState, rng: random.Random, force=False) -> dict:
    """Keeps the better half by success rate (ties: fewer style failures, then nearer the baseline)."""
    r = current_batch(c)
    if not isinstance(r, Round):
        raise ValueError("진행 중인 라운드가 없습니다.")
    if r.status == "done":
        raise ValueError("이미 마감한 라운드입니다.")
    if pending_tasks(c) and not force:
        raise ValueError("아직 생성되지 않은 이미지가 있습니다. 있는 것만으로 진행하려면 다시 확인하세요.")
    ranked = rank_round(c, r)
    if not ranked:
        raise ValueError("남은 후보가 없습니다. 후보를 되살리세요.")
    if c.stage == "confirm":
        r.survivors, r.status = ranked, "done"
        r.result = {"finalists": ranked[:1], "recommended": ranked[0], "overlap": False}
        c.champions["confirm"] = ranked[0]
        c.stage = "done"
        return r.result
    keep = min(len(ranked), max(1, len(r.genome_ids) // 2))
    r.survivors, r.status = ranked[:keep], "done"
    if r.index + 1 < round_count(c) and keep > 1:
        nxt = Round(index=r.index + 1, genome_ids=list(r.survivors), seeds=new_seeds(c.params["round_seeds"][r.index + 1]),
                    scenes=list(r.scenes), stage=c.stage)
        c.rounds.append(nxt)
        return {"next_round": nxt.index}
    finalists = ranked[:2]
    stats = [genome_stats(c, gid, c.stage) for gid in finalists]
    overlap = len(stats) > 1 and stats[0]["low"] <= stats[1]["high"] and stats[1]["low"] <= stats[0]["high"]
    r.survivors = finalists
    r.result = {"finalists": finalists, "recommended": "" if overlap else finalists[0], "overlap": overlap}
    return r.result


def set_genome(c: Campaign, genome_id: str, action: str) -> None:
    """Manual elimination/revival in rounds; revival also adds an archived Genome to the current generation."""
    batch = current_batch(c)
    if genome_id not in c.genomes or batch is None or batch.status == "done":
        raise ValueError("지금은 이 조합을 바꿀 수 없습니다.")
    if action not in ("eliminate", "revive"):
        raise ValueError("알 수 없는 동작입니다.")
    if isinstance(batch, Generation):
        if action == "revive" and genome_id not in batch.genome_ids:
            batch.genome_ids.append(genome_id)
            batch.origins.append("revived")
            batch.parents.append([])
        elif action == "eliminate" and genome_id in batch.genome_ids and len(batch.genome_ids) > 1:
            i = batch.genome_ids.index(genome_id)
            for column in (batch.genome_ids, batch.origins, batch.parents):
                if i < len(column):
                    column.pop(i)
        return
    if action == "eliminate":
        if genome_id in batch.genome_ids and genome_id not in batch.eliminated:
            batch.eliminated.append(genome_id)
        return
    if genome_id in batch.eliminated:
        batch.eliminated.remove(genome_id)
    elif genome_id not in batch.genome_ids and any(genome_id in r.genome_ids for r in stage_rounds(c)):
        batch.genome_ids.append(genome_id)


# ---------------------------------------------------------------- stage flow

def final_genome(c: Campaign) -> Genome:
    return register(c, full_genes(c, None, []), "final", [], 0)


def enter_stage(c: Campaign, state: AppState, rng: random.Random, start=None, manual=None) -> None:
    """Creates the first generation/round of the current stage."""
    info = stage_info(c)
    if c.stage == "confirm":
        final = final_genome(c)
        c.champions["final"] = final.id
        c.rounds.append(Round(index=0, genome_ids=[final.id], seeds=new_seeds(c.params["confirm_seeds"]),
                              scenes=round_scenes(state) or [c.preset], stage="confirm"))
    elif info["kind"] == "evolve":
        c.generations.append(first_generation(c, state, rng, start))
    elif info["kind"] == "round":
        start_round(c, state, rng, manual)
    else:
        c.champions["final"] = final_genome(c).id


def advance_stage(c: Campaign, state: AppState, champion_id: str | None, rng: random.Random,
                  manual: list[list[Gene]] | None = None, skip_next: bool = False) -> str:
    """Records the winner, freezes its group and prepares the next stage.
    An empty champion keeps the group's baseline (skips the stage); `skip_next` also skips the following one."""
    if c.stage == "done":
        raise ValueError("이미 끝난 캠페인입니다.")
    info = stage_info(c)
    group = info["group"]
    previous = deepcopy(c)
    if champion_id:
        if champion_id not in c.genomes:
            raise ValueError("우승 조합을 찾을 수 없습니다.")
        c.champions[c.stage] = champion_id
        if group:
            c.frozen[group] = group_genes(c.genomes[champion_id], group)
    elif group and not c.frozen.get(group):
        raise ValueError("우승 조합을 고르세요. 이 그룹에는 기준 세트가 없습니다.")
    batch = current_batch(c)
    if batch is not None and batch.status != "done":
        batch.status = "done"
    nxt = next_stage(c, c.stage)
    if skip_next and nxt not in ("confirm", "done"):
        nxt = next_stage(c, nxt)
    c.stage = nxt
    try:
        enter_stage(c, state, rng, manual=manual)
    except Exception:
        c.__dict__.update(previous.__dict__)
        raise
    return nxt


def stage_baseline(c: Campaign, s: dict) -> list[Gene]:
    """The set a group held before its stage ran; older campaigns read it back from the stage's first batch."""
    group = s["group"]
    if group in c.baselines:
        return deepcopy(c.baselines[group])
    if s["kind"] == "round":
        rounds = stage_rounds(c, s["key"])
        if rounds:
            return group_genes(c.genomes[rounds[0].genome_ids[0]], group)
    else:
        gens = stage_generations(c, s["key"])
        if gens:
            return next((group_genes(c.genomes[gid], group) for gid, origin in zip(gens[0].genome_ids, gens[0].origins)
                         if origin == "seed"), [])
        # Skipped without a winner: a retune of this group started from the untouched baseline.
        retune = stage_generations(c, "retune")
        if retune and stage_info(c, "retune")["group"] == group:
            return group_genes(c.genomes[retune[0].genome_ids[0]], group)
    return deepcopy(c.frozen.get(group, []))


def frozen_at(c: Campaign, key: str) -> dict[str, list[Gene]]:
    """Group sets as they stood while stage `key` ran: baselines, then the winners of the stages before it."""
    order = stages(c)
    out = deepcopy(c.frozen)
    for s in order:
        if s["group"] and s["key"] != "retune":
            base = stage_baseline(c, s)
            if base:
                out[s["group"]] = base
            else:
                out.pop(s["group"], None)
    for s in order[:[x["key"] for x in order].index(key)]:
        gid = c.champions.get(s["key"])
        if s["group"] and gid in c.genomes:
            out[s["group"]] = group_genes(c.genomes[gid], s["group"])
    return out


def reopen_stage(c: Campaign, state: AppState, key: str, rng: random.Random) -> None:
    """Goes back to an earlier stage as it stood before the campaign moved past it, dropping the records
    of the stages after it (their images stay in the studio history). A skipped stage starts fresh."""
    order = [s["key"] for s in stages(c)]
    if key not in order or not stage_info(c, key)["group"]:
        raise ValueError("돌아갈 수 없는 단계입니다.")
    if order.index(key) >= order.index(c.stage):
        raise ValueError("지나온 단계로만 돌아갈 수 있습니다.")
    previous = deepcopy(c)
    try:
        frozen = frozen_at(c, key)
        if not c.baselines:  # Keep the read-back sets: the batches they came from may be dropped below.
            c.baselines = {s["group"]: stage_baseline(c, s) for s in stages(c) if s["group"] and s["key"] != "retune"}
        later = set(order[order.index(key) + 1:])
        c.generations = [g for g in c.generations if g.stage not in later]
        c.rounds = [r for r in c.rounds if r.stage not in later]
        c.trials = [t for t in c.trials if t.stage not in later]
        c.champions = {k: v for k, v in c.champions.items() if k not in later and k not in (key, "final")}
        c.frozen, c.stage = frozen, key
        batch = current_batch(c)
        if batch is None:
            enter_stage(c, state, rng)
        elif batch.status == "done" and not (batch.picks if isinstance(batch, Generation) else batch.result):
            batch.status = "pending"  # Left unfinished by a skip: open it again.
            refresh_status(c)
    except Exception:
        c.__dict__.update(previous.__dict__)
        raise


def clean_params(params: dict | None) -> dict:
    merged = deepcopy(DEFAULT_PARAMS)
    for key, value in (params or {}).items():
        if key not in DEFAULT_PARAMS or value is None:
            continue
        if key in PARAM_LIMITS:
            low, high = PARAM_LIMITS[key]
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f"탐색 설정 '{key}'는 {low}~{high} 사이의 정수여야 합니다.")
        merged[key] = value
    return merged


def clean_plan(state: AppState, plan: list | None) -> list[dict]:
    """Validates the per-group modes. Groups left out of the plan are not used in the prompt."""
    out, seen = [], set()
    for item in plan or []:
        group, mode = str(item.get("group", "")), str(item.get("mode", ""))
        if mode == "off":
            continue
        if group in seen:
            raise ValueError(f"'{group}' 그룹이 두 번 들어 있습니다.")
        if mode not in MODES:
            raise ValueError(f"'{group}' 그룹의 탐색 방식을 고르세요.")
        cat = category(state, group)
        if not pool(cat):
            raise ValueError(f"'{group}' 그룹에 사용할 수 있는 작가가 없습니다.")
        entry = {"group": group, "mode": mode}
        if mode == "rate":
            labels = list(dict.fromkeys(item.get("labels") or DEFAULT_LABELS))
            if any(code not in FAILURES for code in labels):
                raise ValueError("알 수 없는 실패 라벨입니다.")
            tag = str(item.get("scene_tag") or "").strip()
            if len(tag) > 40:
                raise ValueError("장면 태그는 40자 이하여야 합니다.")
            entry.update(labels=labels, scene_tag=tag)
        seen.add(group)
        out.append(entry)
    if not any(p["mode"] != "fixed" for p in out):
        raise ValueError("고르기 또는 타율로 탐색할 그룹을 하나 이상 고르세요.")
    return out


def create_campaign(state: AppState, name: str, plan: list, preset: str, frozen: dict | None = None,
                    start_genes: list | None = None, params: dict | None = None, rng: random.Random | None = None,
                    image_size: str = "") -> Campaign:
    rng = rng or random.Random()
    plan = clean_plan(state, plan)
    if any(p["mode"] == "pick" for p in plan) and not any(p.name == preset for p in state.prompt_presets):
        raise ValueError("고르기 단계에 사용할 프롬프트 프리셋을 고르세요.")
    if image_size not in ("",) + IMAGE_SIZES:
        raise ValueError("고르기 단계의 이미지 크기를 고르세요.")
    groups = {p["group"] for p in plan}
    stamp = time.strftime("%Y%m%d_%H%M%S")
    c = Campaign(id=f"{stamp}_{uuid.uuid4().hex[:6]}", name=(name or "").strip() or f"탐색 {stamp}",
                 created_at=now(), stage="", plan=plan, group_order=[cat.name for cat in state.categories if cat.name in groups],
                 frozen={}, params=clean_params(params), preset=preset, image_size=image_size)
    c.stage = stages(c)[0]["key"]
    first = stage_info(c)["group"]
    start = genes_from(start_genes)
    sets = baseline(state, plan, start_genes, rng, frozen)
    c.frozen = {group: genes_from(genes) for group, genes in sets.items()}
    if not c.frozen.get(first) and stage_info(c)["kind"] == "round":
        c.frozen[first] = random_genome(state, first, rng, centered=True)
    c.baselines = {p["group"]: deepcopy(c.frozen.get(p["group"], [])) for p in plan if p["mode"] != "fixed"}
    enter_stage(c, state, rng, start=start)
    return c


def baseline(state: AppState, plan: list, start_genes: list | None = None, rng: random.Random | None = None,
             given: dict | None = None) -> dict:
    """The sets every group holds while another one moves, for the user to check before starting.
    The first searched group has none when it is a pick group (it starts from the start genes)."""
    rng = rng or random.Random()
    plan = clean_plan(state, plan)
    first = next(p for p in plan if p["mode"] != "fixed")
    start = genes_from(start_genes)
    result = {}
    for p in plan:
        group = p["group"]
        if p is first and first["mode"] == "pick":
            continue
        cat = category(state, group)
        chosen = genes_from((given or {}).get(group)) or [g for g in start if g.group == group]
        genes = normalize(chosen, cat, rng) if chosen else random_genome(state, group, rng, centered=True)
        result[group] = [asdict(g) for g in genes]
    return result


# ---------------------------------------------------------------- execution bookkeeping

def pending_tasks(c: Campaign) -> list[dict]:
    """(genome, seed, scene) cells of the current batch that have no successful image yet."""
    batch = current_batch(c)
    if batch is None or batch.status == "done":
        return []
    done = {(t.genome_id, t.seed, t.scene) for t in c.trials
            if not t.error and t.stage == c.stage and t.batch == batch.index}
    if isinstance(batch, Generation):
        kind = "evolve"
        cells = [(gid, seed, c.preset) for seed in batch.seeds for gid in batch.genome_ids]
    else:
        kind = "round"
        cells = [(gid, seed, scene) for scene in batch.scenes for seed in batch.seeds
                 for gid in batch.genome_ids if gid not in batch.eliminated]
    return [{"genome_id": gid, "seed": seed, "scene": scene, "stage": c.stage, "kind": kind, "batch": batch.index}
            for gid, seed, scene in dict.fromkeys(cells) if (gid, seed, scene) not in done]


def refresh_status(c: Campaign) -> None:
    batch = current_batch(c)
    if batch is None or batch.status == "done":
        return
    waiting = "awaiting_pick" if isinstance(batch, Generation) else "awaiting_labels"
    started = any(t.stage == c.stage and t.batch == batch.index for t in c.trials)
    batch.status = waiting if not pending_tasks(c) else "generating" if started else batch.status


def record_trial(c: Campaign, task: dict, image_path: str, job_id: str, error: str = "",
                 trial_id: str = "") -> Trial | None:
    """Ignores an image whose batch is gone (the campaign went back past it while it was generating)."""
    stage, index, seed = task.get("stage", c.stage), int(task.get("batch", 0)), int(task["seed"])
    if not any(b.stage == stage and b.index == index and seed in b.seeds for b in [*c.generations, *c.rounds]):
        return None
    trial = Trial(id=trial_id or uuid.uuid4().hex[:12], genome_id=task["genome_id"], seed=int(task["seed"]),
                  scene=task["scene"], image_path=image_path, job_id=job_id, error=error,
                  stage=task.get("stage", c.stage), batch=int(task.get("batch", 0)), created_at=now())
    c.trials.append(trial)
    refresh_status(c)
    return trial


def label_trial(c: Campaign, trial_id: str, failures: list[str]) -> Trial:
    trial = next((t for t in c.trials if t.id == trial_id), None)
    if trial is None:
        raise ValueError("이미지 기록을 찾을 수 없습니다.")
    codes = list(dict.fromkeys(failures or []))
    allowed = stage_info(c, trial.stage)["labels"]
    if any(code not in allowed for code in codes):
        raise ValueError("이 단계에서 쓰지 않는 실패 라벨입니다.")
    trial.failures = codes
    return trial


def campaign_info(c: Campaign, state: AppState | None = None) -> dict:
    """Derived values the screens show next to the stored campaign."""
    info = stage_info(c)
    evolve = info["kind"] == "evolve"
    result = {"stage_name": info["name"], "stage": info, "stages": stages(c), "progress": progress_label(c),
              "pending": len(pending_tasks(c)), "streak": same_winner_streak(c) if evolve else 0,
              "converging": is_converging(c) if evolve else False,
              "generation_limit": generation_limit(c) if evolve else 0,
              "round_count": round_count(c) if info["kind"] == "round" else 0,
              "next_stage": next_stage(c, c.stage), "reference_stage": reference_stage(c)}
    batch = current_batch(c)
    result["suggest_finish"] = bool(evolve and (
        result["streak"] >= int(c.params["stop_after_same_winner"])
        or (isinstance(batch, Generation) and batch.status == "done")))
    if state is not None:
        nxt = stage_info(c, result["next_stage"])
        result["next_scenes"] = round_scenes(state, nxt["scene_tag"]) if nxt["kind"] == "round" else []
    stats = {}
    for s in stages(c):
        if s["kind"] != "round":
            continue
        ids = {gid for r in stage_rounds(c, s["key"]) for gid in r.genome_ids}
        if ids:
            stats[s["key"]] = {gid: genome_stats(c, gid, s["key"]) for gid in ids}
    result["stats"] = stats
    return result
