"""Versioned application data and one-way migration from the 1.x split presets."""
from dataclasses import asdict, dataclass, field, fields
from copy import deepcopy
import math


@dataclass
class Category:
    name: str = "작가 그룹"
    tags: list[str] = field(default_factory=list)
    min_weight: float = 0.8
    max_weight: float = 1.3
    granule: float = 0.05
    picks: int = 0  # Legacy single-count input.
    min_picks: int | None = None
    max_picks: int | None = None
    all_artists: bool | None = None

    def __post_init__(self):
        if self.min_picks is None:
            self.min_picks = max(1, self.picks)
        if self.max_picks is None:
            self.max_picks = self.min_picks
        if self.all_artists is None:
            self.all_artists = self.picks <= 0


@dataclass
class Character:
    prompt: str = ""
    negative: str = ""


@dataclass
class PromptPreset:
    name: str = "새 프리셋"
    base_prompt: str = ""
    characters: list[Character] = field(default_factory=list)


@dataclass
class ApiSettings:
    token: str = ""
    endpoint: str = "https://image.novelai.net/ai/generate-image"
    user_agent: str = "Mozilla/5.0 NAI-ACLAB/2.0"
    model: str = "nai-diffusion-5-full"
    width: int = 832
    height: int = 1216
    steps: int = 28
    scale: float = 5.0
    uncond_scale: float = 0.0
    guidance_rescale: float = 0.0
    sampler: str = "k_euler_ancestral"
    noise_schedule: str = "karras"
    n_samples: int = 1
    seed: int = -1
    mock_mode: bool = True


@dataclass
class GenerationSettings:
    preset: str = ""
    count: int = 4
    image_size: str = "portrait"
    fixed_artists: list[dict] = field(default_factory=list)


@dataclass
class BattingScene:
    name: str = ""
    preset: str = ""
    image_size: str = "portrait"
    count: int = 2


@dataclass
class AppState:
    schema_version: int = 2
    categories: list[Category] = field(default_factory=list)
    prompt_presets: list[PromptPreset] = field(default_factory=list)
    quality_prompt: str = ""
    negative_prompt: str = ""
    api: ApiSettings = field(default_factory=ApiSettings)
    generation: GenerationSettings = field(default_factory=GenerationSettings)
    batting_scenes: list[BattingScene] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)


REMOVED_FIELDS = {"rating", "style_rating", "stability_rating", "rating_disabled", "rating_count", "learned_rating", "learning_role", "artist_rating_summary", "stability_rating_summary"}


def remove_ratings(value):
    if isinstance(value, dict):
        return {k: remove_ratings(v) for k, v in value.items() if k not in REMOVED_FIELDS}
    if isinstance(value, list):
        return [remove_ratings(v) for v in value]
    return value


def construct(cls, data):
    keys = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in (data or {}).items() if k in keys})


def migrate_data(original: dict) -> dict:
    data = remove_ratings(deepcopy(original))
    if int(data.get("schema_version", 1)) >= 2:
        return data
    bases = {p["name"]: p for p in data.get("base_presets", [])}
    chars = {p["name"]: p for p in data.get("character_presets", [])}
    gen = data.setdefault("generation", {})
    presets, pairs, names, set_names = [], {}, set(), {}

    def add(name, base, character):
        pair = (base, character)
        if pair in pairs:
            return pairs[pair]
        unique, suffix = name or "프리셋", 2
        while unique in names:
            unique = f"{name} ({suffix})"
            suffix += 1
        names.add(unique)
        b, c = bases.get(base, {}), chars.get(character, {})
        prompts, negatives = c.get("prompts", []), c.get("negatives", [])
        presets.append({"name": unique, "base_prompt": b.get("prompt", ""), "characters": [
            {"prompt": prompts[i] if i < len(prompts) else "", "negative": negatives[i] if i < len(negatives) else ""}
            for i in range(max(len(prompts), len(negatives)))
        ]})
        pairs[pair] = unique
        return unique

    for item in data.get("preset_sets", []):
        b, c = item.get("base_preset", ""), item.get("character_preset", "")
        if b in bases or c in chars:
            set_names[item["name"]] = add(item["name"], b, c)
    for name in bases:
        if name in chars:
            add(name, name, name)
    # Preserve explicit current and scene combinations, including differing names.
    def resolve(item):
        if item.get("preset_set") in set_names:
            return set_names[item["preset_set"]]
        b, c = item.get("base_preset", ""), item.get("character_preset", "")
        if not b and not c:
            return ""
        return add(b if b == c else " + ".join(x for x in (b, c) if x), b, c)

    if not gen.get('base_preset') and not gen.get('character_preset') and not gen.get('preset_set'):
        gen['base_preset'] = next(iter(bases), '')
        gen['character_preset'] = next(iter(chars), '')
    selected = resolve(gen)
    for scene in data.get("batting_scenes", []):
        scene["preset"] = resolve(scene)
        for key in ("preset_set", "base_preset", "character_preset"):
            scene.pop(key, None)
    used_b = {p[0] for p in pairs}
    used_c = {p[1] for p in pairs}
    for name in bases:
        if name not in used_b:
            add(name, name, "")
    for name in chars:
        if name not in used_c:
            add(name, "", name)
    selected_base = bases.get(gen.get("base_preset", ""), {})
    candidates = [selected_base] + list(bases.values())
    data["quality_prompt"] = data.get("quality_override_prompt", "") or next(
        (p.get("quality_override_prompt") or p.get("quality_prompt") for p in candidates
         if p.get("quality_override_prompt") or p.get("quality_prompt")), "")
    data["prompt_presets"] = presets
    gen["preset"] = selected or (presets[0]["name"] if presets else "")
    for key in ("base_preset", "character_preset", "preset_set", "recent_base_presets", "recent_character_presets"):
        gen.pop(key, None)
    for key in ("base_presets", "character_presets", "preset_sets", "quality_override_prompt"):
        data.pop(key, None)
    data["schema_version"] = 2
    return data


def state_from_dict(raw: dict) -> AppState:
    data = migrate_data(raw)
    presets = []
    for p in data.get("prompt_presets", []):
        preset = construct(PromptPreset, p)
        preset.characters = [construct(Character, c) for c in p.get("characters", [])]
        presets.append(preset)
    state = AppState(
        categories=[construct(Category, c) for c in data.get("categories", [])],
        prompt_presets=presets, quality_prompt=data.get("quality_prompt", ""),
        negative_prompt=data.get("negative_prompt", ""), api=construct(ApiSettings, data.get("api")),
        generation=construct(GenerationSettings, data.get("generation")),
        batting_scenes=[construct(BattingScene, s) for s in data.get("batting_scenes", [])],
        history=data.get("history", []),
    )
    return state


def validate_state(state: AppState):
    names = [p.name.strip() for p in state.prompt_presets]
    if any(not n for n in names) or len(names) != len(set(names)):
        raise ValueError("프리셋 이름은 비어 있거나 중복될 수 없습니다.")
    for c in state.categories:
        values = (c.min_weight, c.max_weight, c.granule)
        if not all(math.isfinite(float(v)) for v in values) or not 0 <= c.min_weight <= c.max_weight <= 10 or c.granule <= 0 or (c.max_weight-c.min_weight)/c.granule > 10000:
            raise ValueError("작가 가중치 범위와 간격을 확인하세요. (0~10)")
        if any(type(v) is not int for v in (c.min_picks, c.max_picks)) or not 1 <= c.min_picks <= c.max_picks:
            raise ValueError("추첨 인원은 최소 1명 이상의 정수이며 최소 ≤ 최대여야 합니다.")
    if type(state.generation.count) is not int or not 1 <= state.generation.count <= 200:
        raise ValueError("생성 매수는 1~200장이어야 합니다.")
    if any(type(v) is not int for v in (state.api.steps, state.api.width, state.api.height)) or not 1 <= state.api.steps <= 100 or not 64 <= state.api.width <= 4096 or not 64 <= state.api.height <= 4096:
        raise ValueError("이미지 크기 또는 Steps를 확인하세요.")
    if type(state.api.seed) is not int or not -1 <= state.api.seed <= 2**32 - 1:
        raise ValueError("Seed는 -1 또는 0~4294967295 정수여야 합니다.")
    if not math.isfinite(state.api.scale) or not 0 <= state.api.scale <= 100 or not math.isfinite(state.api.guidance_rescale) or not 0 <= state.api.guidance_rescale <= 1:
        raise ValueError("Prompt guidance (0~100)와 Guidance rescale (0~1)을 확인하세요.")
    for item in state.generation.fixed_artists:
        if not math.isfinite(float(item.get("weight", 1))) or not 0 <= float(item.get("weight", 1)) <= 10:
            raise ValueError("고정 가중치는 0~10이어야 합니다.")
    for scene in state.batting_scenes:
        if scene.preset not in names or type(scene.count) is not int or not 1 <= scene.count <= 200:
            raise ValueError("타율 테스트의 프리셋과 생성 매수를 확인하세요.")
