from __future__ import annotations

import base64
import io
import json
import math
import os
import random
import re
import threading
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from dataclasses import asdict, dataclass, field
from pathlib import Path
try:
    from tkinter import END, LEFT, RIGHT, BOTH, X, Y, filedialog, messagebox, ttk
    import tkinter as tk
except Exception:
    END = LEFT = RIGHT = BOTH = X = Y = None
    filedialog = messagebox = ttk = tk = None


APP_DIR = Path(__file__).resolve().parent


def default_user_dir() -> Path:
    configured = os.environ.get("NAI_ARTIST_LAB_USER_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "nai_aclab"


USER_DIR = default_user_dir()
DATA_DIR = USER_DIR / "data"
OUTPUT_DIR = USER_DIR / "outputs"
STATE_PATH = DATA_DIR / "app_state.json"
TOKEN_SECRET_PATH = DATA_DIR / ("api_token.dpapi" if os.name == "nt" else "api_token.secret")
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _windows_protect(data: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    class DataBlob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    buffer = ctypes.create_string_buffer(data)
    in_blob = DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    out_blob = DataBlob()
    if not crypt32.CryptProtectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError("Failed to protect API token with Windows DPAPI.")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def _windows_unprotect(data: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    class DataBlob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    buffer = ctypes.create_string_buffer(data)
    in_blob = DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    out_blob = DataBlob()
    if not crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError("Failed to unprotect API token with Windows DPAPI.")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def save_api_token(token: str) -> None:
    token = token.strip()
    if not token:
        return
    ensure_dirs()
    raw = token.encode("utf-8")
    payload = _windows_protect(raw) if os.name == "nt" else raw
    TOKEN_SECRET_PATH.write_bytes(payload)
    if os.name != "nt":
        try:
            TOKEN_SECRET_PATH.chmod(0o600)
        except OSError:
            pass


def load_api_token() -> str:
    try:
        payload = TOKEN_SECRET_PATH.read_bytes()
    except OSError:
        return ""
    try:
        raw = _windows_unprotect(payload) if os.name == "nt" else payload
        return raw.decode("utf-8")
    except Exception:
        return ""


def has_saved_api_token() -> bool:
    return bool(load_api_token().strip())


def cleanup_saved_request_jsons() -> None:
    try:
        for path in OUTPUT_DIR.rglob("*_request.json"):
            if path.is_file():
                path.unlink()
    except OSError:
        pass


def state_dict_without_secrets(state: AppState | dict) -> dict:
    data = asdict(state) if not isinstance(state, dict) else dict(state)
    data.pop("uc_prompt", None)
    api = dict(data.get("api", {}) or {})
    api["token"] = ""
    data["api"] = api
    data["history"] = [sanitize_history_entry(item) for item in data.get("history", [])]
    return data


def output_ref(path_value: str) -> str:
    raw = str(path_value or "").strip()
    if not raw:
        return ""
    path = Path(raw)
    try:
        if path.is_absolute():
            resolved = path.resolve()
            return str(resolved.relative_to(OUTPUT_DIR.resolve())).replace("\\", "/")
    except (OSError, ValueError):
        return path.name
    return raw.replace("\\", "/")


def sanitize_history_item(item: dict) -> dict:
    clean = {
        key: value
        for key, value in dict(item or {}).items()
        if key not in {"prompt", "negative_prompt", "uc_prompt", "request_path", "request_url"}
    }
    if "style_rating" not in clean and "rating" in clean:
        clean["style_rating"] = clean.get("rating")
    clean.pop("rating", None)
    if "path" in clean:
        clean["path"] = output_ref(clean.get("path", ""))
    return clean


def sanitize_history_entry(history: dict) -> dict:
    clean = dict(history or {})
    if "output_dir" in clean:
        clean["output_dir"] = output_ref(clean.get("output_dir", ""))
    clean["items"] = [sanitize_history_item(item) for item in clean.get("items", [])]
    return clean


def now_id() -> str:
    return time.strftime("%Y%m%d_%H%M%S")


def safe_path_name(value: str) -> str:
    cleaned = "".join("_" if ch in '<>:"/\\|?*' else ch for ch in value.strip())
    cleaned = "_".join(part for part in cleaned.split())
    cleaned = cleaned.strip(" ._")
    return cleaned or "untitled"


def float_range(min_value: float, max_value: float, granule: float) -> list[float]:
    if granule <= 0:
        granule = 0.1
    steps = int(round((max_value - min_value) / granule))
    return [round(min_value + i * granule, 3) for i in range(max(0, steps) + 1)]


def weight_tag(tag: str, weight: float) -> str:
    tag = tag.strip()
    if not tag:
        return ""
    return f"{weight:g}::{tag} ::"


def parse_artist_tags(text: str | list[str]) -> list[str]:
    if isinstance(text, list):
        text = "\n".join(str(item) for item in text)
    found: list[str] = []
    seen = set()
    chunks = re.split(r"[,\n\r]+", text)
    for chunk in chunks:
        item = chunk.strip()
        if not item:
            continue
        item = re.sub(r"^[+-]?\d+(?:\.\d+)?\s*::\s*", "", item)
        start = item.lower().find("artist:")
        if start < 0:
            continue
        tag = item[start:].strip()
        tag = re.sub(r"\s*::\s*$", "", tag).strip()
        if tag and tag not in seen:
            seen.add(tag)
            found.append(tag)
    return found


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        len(data).to_bytes(4, "big")
        + kind
        + data
        + zlib.crc32(kind + data).to_bytes(4, "big")
    )


def write_placeholder_png(path: Path, title: str, width: int = 768, height: int = 1024) -> None:
    """Create a deterministic lightweight PNG so the GUI can be tested without API credits."""
    seed = zlib.crc32(title.encode("utf-8"))
    rng = random.Random(seed)
    c1 = (rng.randrange(60, 220), rng.randrange(70, 230), rng.randrange(80, 240))
    c2 = (rng.randrange(20, 160), rng.randrange(30, 170), rng.randrange(40, 180))
    rows = []
    for y in range(height):
        t = y / max(1, height - 1)
        row = bytearray([0])
        for x in range(width):
            wave = (x / width) * 0.18
            mix = min(1, max(0, t + wave))
            row.extend(
                int(c1[i] * (1 - mix) + c2[i] * mix)
                for i in range(3)
            )
        rows.append(bytes(row))
    raw = b"".join(rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", width.to_bytes(4, "big") + height.to_bytes(4, "big") + b"\x08\x02\x00\x00\x00")
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )
    path.write_bytes(png)


@dataclass
class Category:
    name: str
    tags: list[str]
    min_weight: float
    max_weight: float
    granule: float
    picks: int = 0
    learning_role: str = ""

    def __post_init__(self) -> None:
        if self.learning_role not in {"style", "stability"}:
            self.learning_role = "stability" if "안정" in self.name else "style"


@dataclass
class PromptPreset:
    name: str
    prompt: str = ""
    quality_prompt: str = ""
    quality_override_prompt: str = ""


@dataclass
class CharacterPreset:
    name: str
    prompts: list[str] = field(default_factory=lambda: ["", "", ""])
    negatives: list[str] = field(default_factory=lambda: ["", "", ""])
    quality_override_prompt: str = ""


@dataclass
class PresetSet:
    name: str
    base_preset: str = ""
    character_preset: str = ""
    auto: bool = False


@dataclass
class ApiSettings:
    token: str = ""
    endpoint: str = "https://image.novelai.net/ai/generate-image"
    user_agent: str = DEFAULT_USER_AGENT
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
    preset_set: str = ""
    base_preset: str = ""
    character_preset: str = ""
    count: int = 4
    image_size: str = "portrait"
    fixed_artists: list[dict] = field(default_factory=list)
    recent_base_presets: list[str] = field(default_factory=list)
    recent_character_presets: list[str] = field(default_factory=list)


@dataclass
class BattingScene:
    name: str = ""
    preset_set: str = ""
    base_preset: str = ""
    character_preset: str = ""
    image_size: str = "portrait"
    count: int = 2


@dataclass
class AppState:
    categories: list[Category] = field(default_factory=list)
    base_presets: list[PromptPreset] = field(default_factory=list)
    character_presets: list[CharacterPreset] = field(default_factory=list)
    preset_sets: list[PresetSet] = field(default_factory=list)
    quality_override_prompt: str = ""
    negative_prompt: str = "lowres, bad anatomy, bad hands, text, error, missing fingers"
    api: ApiSettings = field(default_factory=ApiSettings)
    generation: GenerationSettings = field(default_factory=GenerationSettings)
    batting_scenes: list[BattingScene] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)


def character_negative_prompt(common_prompt: str, character: CharacterPreset | None) -> str:
    parts = [common_prompt.strip()]
    if character:
        for prompt, negative in zip(character.prompts, character.negatives):
            if prompt.strip():
                parts.append(negative.strip())
    while len(parts) > 1 and not parts[-1]:
        parts.pop()
    return " | ".join(parts)


def sync_auto_preset_sets(state: AppState) -> AppState:
    base_names = {item.name for item in state.base_presets if item.name.strip()}
    character_names = {item.name for item in state.character_presets if item.name.strip()}
    manual_sets = [
        item
        for item in state.preset_sets
        if not item.auto and item.base_preset in base_names and item.character_preset in character_names
    ]
    used_names = {item.name for item in manual_sets}
    auto_sets: list[PresetSet] = []
    for common_name in sorted(base_names & character_names):
        matching_manual = next(
            (
                item
                for item in manual_sets
                if item.base_preset == common_name and item.character_preset == common_name
            ),
            None,
        )
        if matching_manual:
            continue
        set_name = common_name
        if set_name in used_names:
            base_name = f"{common_name} (자동)"
            set_name = base_name
            suffix = 2
            while set_name in used_names:
                set_name = f"{base_name} {suffix}"
                suffix += 1
        used_names.add(set_name)
        auto_sets.append(PresetSet(set_name, common_name, common_name, True))
    state.preset_sets = manual_sets + auto_sets

    valid_set_names = {item.name for item in state.preset_sets}
    if state.generation.preset_set not in valid_set_names:
        matching_set = next(
            (
                item
                for item in state.preset_sets
                if item.base_preset == state.generation.base_preset
                and item.character_preset == state.generation.character_preset
            ),
            None,
        )
        state.generation.preset_set = matching_set.name if matching_set else ""
    if state.generation.preset_set:
        selected_set = next(item for item in state.preset_sets if item.name == state.generation.preset_set)
        state.generation.base_preset = selected_set.base_preset
        state.generation.character_preset = selected_set.character_preset
    for scene in state.batting_scenes:
        if scene.preset_set not in valid_set_names:
            matching_set = next(
                (
                    item
                    for item in state.preset_sets
                    if item.base_preset == scene.base_preset
                    and item.character_preset == scene.character_preset
                ),
                None,
            )
            scene.preset_set = matching_set.name if matching_set else ""
        if scene.preset_set:
            selected_set = next(item for item in state.preset_sets if item.name == scene.preset_set)
            scene.base_preset = selected_set.base_preset
            scene.character_preset = selected_set.character_preset
    return state


ARTIST_RATING_PRIOR_COUNT = 4
ARTIST_RATING_PRIOR_VALUE = 3.0


def _artist_learning_role(artist: dict) -> str:
    role = str(artist.get("learning_role", "")).strip().lower()
    if role in {"style", "stability"}:
        return role
    return "stability" if "안정" in str(artist.get("category", "")) else "style"


def _rating_value(item: dict, field: str) -> int:
    value = item.get(field)
    if value in (None, "") and field == "style_rating":
        value = item.get("rating")
    try:
        rating = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return rating if 1 <= rating <= 5 else 0


def _finish_rating_entry(entry: dict) -> dict:
    count = entry["count"]
    smoothed = (
        entry["rating_sum"] + ARTIST_RATING_PRIOR_VALUE * ARTIST_RATING_PRIOR_COUNT
    ) / (count + ARTIST_RATING_PRIOR_COUNT)
    signal = max(-1.0, min(1.0, (smoothed - ARTIST_RATING_PRIOR_VALUE) / 2.0))
    entry["average_rating"] = round(entry["rating_sum"] / count, 3)
    entry["smoothed_rating"] = round(smoothed, 3)
    entry["preference_signal"] = signal
    entry["selection_multiplier"] = round(math.exp(signal), 3)
    return entry


def artist_rating_summary(history: list[dict]) -> dict[str, dict]:
    summary: dict[str, dict] = {}
    for history_entry in history or []:
        if history_entry.get("type") == "batting_test":
            continue
        for item in history_entry.get("items", []) or []:
            rating = _rating_value(item, "style_rating")
            if not rating:
                continue
            seen = set()
            for artist in item.get("artists", []) or []:
                if _artist_learning_role(artist) != "style":
                    continue
                tag = str(artist.get("tag", "")).strip()
                key = tag.casefold()
                if not key or key in seen:
                    continue
                seen.add(key)
                entry = summary.setdefault(key, {"tag": tag, "count": 0, "rating_sum": 0.0})
                entry["count"] += 1
                entry["rating_sum"] += rating

    for entry in summary.values():
        _finish_rating_entry(entry)
    return summary


def stability_rating_summary(history: list[dict]) -> dict[str, dict]:
    summary: dict[str, dict] = {}
    for history_entry in history or []:
        if history_entry.get("type") == "batting_test":
            continue
        for item in history_entry.get("items", []) or []:
            rating = _rating_value(item, "stability_rating")
            if not rating:
                continue
            seen = set()
            for artist in item.get("artists", []) or []:
                if _artist_learning_role(artist) != "stability":
                    continue
                tag = str(artist.get("tag", "")).strip()
                try:
                    weight = round(float(artist.get("weight", 1.0)), 6)
                except (TypeError, ValueError):
                    continue
                key = tag.casefold()
                pair_key = (key, weight)
                if not key or pair_key in seen:
                    continue
                seen.add(pair_key)
                entry = summary.setdefault(
                    key,
                    {"tag": tag, "count": 0, "rating_sum": 0.0, "weights": {}},
                )
                entry["count"] += 1
                entry["rating_sum"] += rating
                weight_entry = entry["weights"].setdefault(
                    weight,
                    {"weight": weight, "count": 0, "rating_sum": 0.0},
                )
                weight_entry["count"] += 1
                weight_entry["rating_sum"] += rating

    for entry in summary.values():
        _finish_rating_entry(entry)
        weight_rows = []
        for weight_entry in entry["weights"].values():
            _finish_rating_entry(weight_entry)
            weight_rows.append(weight_entry)
        weight_rows.sort(key=lambda row: row["weight"])
        best = max(
            weight_rows,
            key=lambda row: (row["smoothed_rating"], row["count"], -abs(row["weight"])),
        )
        entry["weights"] = weight_rows
        entry["best_weight"] = best["weight"]
        entry["best_smoothed_rating"] = best["smoothed_rating"]
        entry["tested_weight_count"] = len(weight_rows)
        best_signal = max(-1.0, min(1.0, (best["smoothed_rating"] - ARTIST_RATING_PRIOR_VALUE) / 2.0))
        entry["selection_multiplier"] = round(math.exp(best_signal), 3)
    return summary


def _weighted_sample_without_replacement(items: list[str], count: int, weights: list[float]) -> list[str]:
    pool = list(items)
    pool_weights = [max(0.001, float(value)) for value in weights]
    result: list[str] = []
    for _ in range(min(count, len(pool))):
        selected_index = random.choices(range(len(pool)), weights=pool_weights, k=1)[0]
        result.append(pool.pop(selected_index))
        pool_weights.pop(selected_index)
    return result


def _adaptive_weight(values: list[float], preference_signal: float) -> float:
    if not values:
        return 1.0
    if len(values) == 1 or abs(preference_signal) < 0.001:
        return random.choice(values)
    likelihoods = []
    for index in range(len(values)):
        position = index / (len(values) - 1)
        likelihoods.append(math.exp(1.35 * preference_signal * (position * 2.0 - 1.0)))
    return random.choices(values, weights=likelihoods, k=1)[0]


def _stability_weight(values: list[float], rating: dict) -> float:
    if not values:
        return 1.0
    if not rating:
        return random.choice(values)
    observed = {round(float(row["weight"]), 6): row for row in rating.get("weights", [])}
    likelihoods = []
    for value in values:
        row = observed.get(round(float(value), 6), {})
        count = int(row.get("count", 0))
        estimate = float(row.get("smoothed_rating", ARTIST_RATING_PRIOR_VALUE))
        exploration_bonus = 0.55 / math.sqrt(count + 1)
        likelihoods.append(math.exp(1.45 * (estimate + exploration_bonus - ARTIST_RATING_PRIOR_VALUE)))
    return random.choices(values, weights=likelihoods, k=1)[0]


def random_artist_tags_for_state(state: AppState) -> list[dict]:
    result = []
    style_ratings = artist_rating_summary(state.history)
    stability_ratings = stability_rating_summary(state.history)
    for category in state.categories:
        tags = parse_artist_tags(category.tags)
        if not tags:
            continue
        role = category.learning_role if category.learning_role in {"style", "stability"} else "style"
        ratings = style_ratings if role == "style" else stability_ratings
        values = float_range(category.min_weight, category.max_weight, category.granule)
        pick_count = len(tags) if category.picks <= 0 else min(category.picks, len(tags))
        selection_weights = [ratings.get(tag.casefold(), {}).get("selection_multiplier", 1.0) for tag in tags]
        selected_tags = _weighted_sample_without_replacement(tags, pick_count, selection_weights)
        for tag in selected_tags:
            rating = ratings.get(tag.casefold(), {})
            weight = (
                _adaptive_weight(values, float(rating.get("preference_signal", 0.0)))
                if role == "style"
                else _stability_weight(values, rating)
            )
            result.append(
                {
                    "category": category.name,
                    "learning_role": role,
                    "tag": tag,
                    "weight": weight,
                    "prompt": weight_tag(tag, weight),
                    "rating_count": int(rating.get("count", 0)),
                    "learned_rating": rating.get("smoothed_rating"),
                }
            )
    return result


def fixed_artist_tags_for_state(state: AppState) -> list[dict]:
    result = []
    for item in state.generation.fixed_artists or []:
        tag = str(item.get("tag", "")).strip()
        if not tag:
            continue
        try:
            weight = float(item.get("weight", 1.0))
        except (TypeError, ValueError):
            weight = 1.0
        result.append(
            {
                "category": item.get("category", "fixed"),
                "learning_role": item.get("learning_role") or _artist_learning_role(item),
                "tag": tag,
                "weight": weight,
                "prompt": item.get("prompt") or weight_tag(tag, weight),
            }
        )
    return result


def order_artist_tags(artists: list[dict]) -> list[dict]:
    if len(artists) < 2:
        return list(artists)
    shuffled = list(artists)
    random.shuffle(shuffled)
    ranked = sorted(shuffled, key=lambda item: float(item.get("weight", 0.0)), reverse=True)
    ordered: list[dict | None] = [None] * len(ranked)
    left = 0
    right = len(ranked) - 1
    highest_at_front = bool(random.getrandbits(1))
    for index, artist in enumerate(ranked):
        place_front = highest_at_front if index % 2 == 0 else not highest_at_front
        if place_front:
            ordered[left] = artist
            left += 1
        else:
            ordered[right] = artist
            right -= 1
    return [item for item in ordered if item is not None]


def artist_tags_for_prompt(state: AppState) -> list[dict]:
    fixed = fixed_artist_tags_for_state(state)
    if fixed:
        return fixed
    return order_artist_tags(random_artist_tags_for_state(state))


def default_state() -> AppState:
    return sync_auto_preset_sets(AppState(
        categories=[
            Category("메인 그림체 작가", [], 1.0, 1.4, 0.05, 0, "style"),
            Category("그림체 안정화 작가", [], 0.4, 0.9, 0.1, 0, "stability"),
        ],
        base_presets=[
            PromptPreset("기본", "", "masterpiece, best quality, very aesthetic, detailed illustration"),
        ],
        character_presets=[
            CharacterPreset("1인 기본", ["1girl, looking at viewer, detailed eyes", "", ""], ["", "", ""]),
        ],
    ))


def load_state() -> AppState:
    ensure_dirs()
    cleanup_saved_request_jsons()
    if not STATE_PATH.exists():
        state = default_state()
        state.api.token = load_api_token()
        return state
    data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    base_data = data.get("base_presets", [])
    quality_override = data.get("quality_override_prompt", "")
    if not quality_override.strip():
        selected_base_name = data.get("generation", {}).get("base_preset", "")
        selected_base = next((item for item in base_data if item.get("name") == selected_base_name), None)
        fallback_base = (
            selected_base
            if selected_base and selected_base.get("quality_override_prompt")
            else next((item for item in base_data if item.get("quality_override_prompt")), None)
        )
        quality_override = (fallback_base or {}).get("quality_override_prompt", "")
    api_data = dict(data.get("api", {}) or {})
    legacy_token = str(api_data.pop("token", "") or "").strip()
    if legacy_token and not has_saved_api_token():
        save_api_token(legacy_token)
        data["api"] = api_data
        STATE_PATH.write_text(
            json.dumps(state_dict_without_secrets(data), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    if api_data.get("user_agent") in (None, "", "NAIArtistCombination/0.1"):
        api_data["user_agent"] = DEFAULT_USER_AGENT
    sanitized_data = state_dict_without_secrets(data)
    if sanitized_data != data:
        STATE_PATH.write_text(
            json.dumps(sanitized_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    api_data["token"] = load_api_token()
    state = AppState(
        categories=[Category(**item) for item in data.get("categories", [])],
        base_presets=[PromptPreset(**item) for item in base_data],
        character_presets=[CharacterPreset(**item) for item in data.get("character_presets", [])],
        preset_sets=[PresetSet(**item) for item in data.get("preset_sets", [])],
        quality_override_prompt=quality_override,
        negative_prompt=data.get("negative_prompt", ""),
        api=ApiSettings(**api_data),
        generation=GenerationSettings(**data.get("generation", {})),
        batting_scenes=[BattingScene(**item) for item in data.get("batting_scenes", [])],
        history=[sanitize_history_entry(item) for item in data.get("history", [])],
    )
    return sync_auto_preset_sets(state)


def save_state(state: AppState) -> None:
    ensure_dirs()
    sync_auto_preset_sets(state)
    STATE_PATH.write_text(
        json.dumps(state_dict_without_secrets(state), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class NovelAIClient:
    def __init__(self, settings: ApiSettings):
        self.settings = settings

    def build_payload(self, prompt: str, negative_prompt: str, seed: int | None = None) -> dict:
        actual_seed = seed if seed is not None else (
            self.settings.seed if self.settings.seed >= 0 else random.randint(0, 2**32 - 1)
        )
        return {
            "input": prompt,
            "model": self.settings.model,
            "action": "generate",
            "parameters": {
                "steps": self.settings.steps,
                "height": self.settings.height,
                "width": self.settings.width,
                "scale": self.settings.scale,
                "uncond_scale": self.settings.uncond_scale,
                "cfg_rescale": self.settings.guidance_rescale,
                "seed": actual_seed,
                "n_samples": self.settings.n_samples,
                "noise_schedule": self.settings.noise_schedule,
                "legacy_v3_extend": False,
                "reference_information_extracted_multiple": [],
                "reference_strength_multiple": [],
                "v4_prompt": {
                    "caption": {
                        "base_caption": prompt,
                        "char_captions": [],
                    },
                    "use_coords": False,
                    "use_order": True,
                    "legacy_uc": False,
                },
                "v4_negative_prompt": {
                    "caption": {
                        "base_caption": negative_prompt,
                        "char_captions": [],
                    },
                    "use_coords": False,
                    "use_order": False,
                    "legacy_uc": False,
                },
                "director_reference_descriptions": [],
                "director_reference_information_extracted": [],
                "sampler": self.settings.sampler,
                "controlnet_strength": 1.0,
                "controlnet_model": None,
                "sm": False,
                "sm_dyn": False,
                "skip_cfg_below_sigma": 0.0,
                "deliberate_euler_ancestral_bug": False,
                "prefer_brownian": True,
                "cfg_sched_eligibility": "enable_for_post_summer_samplers",
                "explike_fine_detail": False,
                "minimize_sigma_inf": False,
                "uncond_per_vibe": True,
                "wonky_vibe_correlation": True,
                "stream": "none",
                "version": 1,
                "uc": negative_prompt,
                "negative_prompt": negative_prompt,
                "request_type": "PromptGenerateRequest",
            },
        }

    def generate(self, prompt: str, negative_prompt: str, output_path: Path) -> None:
        if self.settings.mock_mode or not self.settings.token.strip():
            write_placeholder_png(output_path, prompt, self.settings.width, self.settings.height)
            return

        payload = self.build_payload(prompt, negative_prompt)
        req = urllib.request.Request(
            self.settings.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.settings.token.strip()}",
                "User-Agent": self.settings.user_agent.strip() or DEFAULT_USER_AGENT,
                "Content-Type": "application/json",
                "Accept": "application/zip, image/png, application/json",
                "Origin": "https://novelai.net",
                "Referer": "https://novelai.net/",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"NovelAI API 오류 {exc.code}: {detail[:600]}") from exc

        if "zip" in content_type or body[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                image_names = [n for n in archive.namelist() if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
                if not image_names:
                    raise RuntimeError("API 응답 zip에서 이미지 파일을 찾지 못했습니다.")
                output_path.write_bytes(archive.read(image_names[0]))
        elif body.startswith(b"\x89PNG"):
            output_path.write_bytes(body)
        else:
            maybe_json = body.decode("utf-8", errors="ignore")
            if "base64" in maybe_json:
                decoded = json.loads(maybe_json)
                image_b64 = decoded.get("image") or decoded.get("data")
                output_path.write_bytes(base64.b64decode(image_b64))
            else:
                raise RuntimeError(f"알 수 없는 API 응답 형식: {maybe_json[:300]}")

    def subscription_quota(self) -> dict:
        """Return a safe, UI-ready subset of the NovelAI subscription response."""
        if self.settings.mock_mode:
            return {"available": False, "reason": "체험 모드에서는 할당량을 확인할 수 없습니다."}
        token = self.settings.token.strip()
        if not token:
            return {"available": False, "reason": "API 토큰을 입력하면 할당량을 확인합니다."}

        headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": self.settings.user_agent.strip() or DEFAULT_USER_AGENT,
            "Accept": "application/json",
            "Origin": "https://novelai.net",
            "Referer": "https://novelai.net/",
        }
        errors: list[str] = []
        # Subscription requests never follow a user-configured image endpoint.
        # The token is sent only to NovelAI's official hosts.
        for endpoint in (
            "https://image.novelai.net/user/subscription",
            "https://api.novelai.net/user/subscription",
        ):
            request = urllib.request.Request(endpoint, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    data = json.loads(response.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as exc:
                errors.append(str(exc.code))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                errors.append(type(exc).__name__)
        else:
            status = errors[-1] if errors else "unknown"
            return {"available": False, "reason": f"할당량 정보를 불러오지 못했습니다. ({status})"}

        steps = data.get("trainingStepsLeft") or {}
        fixed_anlas = int(steps.get("fixedTrainingStepsLeft") or 0)
        purchased_anlas = int(steps.get("purchasedTrainingSteps") or 0)
        usage = data.get("usage") or data.get("imageGenerationUsage") or {}
        if not isinstance(usage, dict):
            usage = {}
        percent = usage.get("percent")
        try:
            percent = float(percent) if percent is not None else None
        except (TypeError, ValueError):
            percent = None
        next_percent = usage.get("timeUntilNextPercent")
        try:
            next_percent = float(next_percent) if next_percent is not None else None
        except (TypeError, ValueError):
            next_percent = None
        return {
            "available": True,
            "tier": int(data.get("tier") or 0),
            "active": bool(data.get("active")),
            "subscription_anlas": fixed_anlas,
            "paid_anlas": purchased_anlas,
            "total_anlas": fixed_anlas + purchased_anlas,
            "v5_percent": percent,
            "v5_is_negative": bool(usage.get("isNegative")),
            "v5_next_percent_seconds": next_percent,
        }


class ScrollFrame(ttk.Frame if ttk else object):
    def __init__(self, parent):
        super().__init__(parent)
        canvas = tk.Canvas(self, highlightthickness=0)
        scroll = ttk.Scrollbar(self, orient="vertical", command=canvas.yview)
        self.content = ttk.Frame(canvas)
        self.content.bind("<Configure>", lambda _: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=self.content, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side=LEFT, fill=BOTH, expand=True)
        scroll.pack(side=RIGHT, fill=Y)


class App(tk.Tk if tk else object):
    def __init__(self):
        super().__init__()
        self.title("NAI Artist Combination Lab")
        self.geometry("1220x780")
        self.minsize(1040, 680)
        self.state_data = load_state()
        self.current_category_index: int | None = None
        self.current_base_index: int | None = None
        self.current_char_index: int | None = None
        self.last_tab_id: str | None = None
        self.suppress_preset_events = False
        self.suppress_generation_events = False
        self.preview_images: list[tk.PhotoImage] = []
        self.worldcup_items: list[dict] = []
        self.current_pair: tuple[dict, dict] | None = None
        self._build_ui()
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.refresh_all()

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)
        self.tabs = ttk.Notebook(self)
        self.tabs.grid(row=0, column=0, sticky="nsew")

        self.generate_tab = ttk.Frame(self.tabs, padding=10)
        self.tags_tab = ttk.Frame(self.tabs, padding=10)
        self.presets_tab = ttk.Frame(self.tabs, padding=10)
        self.history_tab = ttk.Frame(self.tabs, padding=10)
        self.settings_tab = ttk.Frame(self.tabs, padding=10)
        for tab, title in [
            (self.generate_tab, "생성"),
            (self.tags_tab, "작가 태그"),
            (self.presets_tab, "프리셋"),
            (self.history_tab, "히스토리 / 월드컵"),
            (self.settings_tab, "API 설정"),
        ]:
            self.tabs.add(tab, text=title)
        self.last_tab_id = self.tabs.select()
        self.tabs.bind("<<NotebookTabChanged>>", self.on_tab_changed)

        self._build_generate_tab()
        self._build_tags_tab()
        self._build_presets_tab()
        self._build_history_tab()
        self._build_settings_tab()

    def _build_generate_tab(self) -> None:
        left = ttk.Frame(self.generate_tab)
        right = ttk.Frame(self.generate_tab)
        left.pack(side=LEFT, fill=BOTH, expand=True)
        right.pack(side=RIGHT, fill=BOTH, expand=True, padx=(12, 0))

        form = ttk.LabelFrame(left, text="프롬프트 조합", padding=10)
        form.pack(fill=X)
        ttk.Label(form, text="베이스 + 퀄리티 프리셋").grid(row=0, column=0, sticky="w")
        self.base_combo = ttk.Combobox(form, state="readonly")
        self.base_combo.grid(row=0, column=1, sticky="ew", padx=6)
        self.base_combo.bind("<<ComboboxSelected>>", self.on_generation_options_changed)
        ttk.Label(form, text="캐릭터 프롬프트 프리셋").grid(row=1, column=0, sticky="w", pady=6)
        self.char_combo = ttk.Combobox(form, state="readonly")
        self.char_combo.grid(row=1, column=1, sticky="ew", padx=6)
        self.char_combo.bind("<<ComboboxSelected>>", self.on_generation_options_changed)
        ttk.Label(form, text="생성 개수").grid(row=2, column=0, sticky="w")
        self.count_var = tk.IntVar(value=max(1, self.state_data.generation.count))
        self.count_var.trace_add("write", lambda *_: self.on_generation_options_changed())
        ttk.Spinbox(form, from_=1, to=200, textvariable=self.count_var, width=8).grid(row=2, column=1, sticky="w", padx=6)
        form.columnconfigure(1, weight=1)

        prompt_box = ttk.LabelFrame(left, text="최종 프롬프트 미리보기", padding=10)
        prompt_box.pack(fill=BOTH, expand=True, pady=10)
        self.prompt_preview = tk.Text(prompt_box, height=12, wrap="word")
        self.prompt_preview.pack(fill=BOTH, expand=True)
        buttons = ttk.Frame(left)
        buttons.pack(fill=X)
        ttk.Button(buttons, text="프롬프트 새로 뽑기", command=self.preview_prompt).pack(side=LEFT)
        ttk.Button(buttons, text="이미지 생성 시작", command=self.start_generation).pack(side=LEFT, padx=6)
        ttk.Button(buttons, text="출력 폴더 열기", command=self.pick_output_folder).pack(side=LEFT)

        self.log = tk.Text(right, height=10, wrap="word")
        self.log.pack(fill=BOTH, expand=True)
        self.progress = ttk.Progressbar(right, mode="determinate")
        self.progress.pack(fill=X, pady=(8, 0))

    def _build_tags_tab(self) -> None:
        self.category_list = tk.Listbox(self.tags_tab, width=28)
        self.category_list.pack(side=LEFT, fill=Y)
        self.category_list.bind("<<ListboxSelect>>", self.on_category_selected)
        editor = ttk.Frame(self.tags_tab)
        editor.pack(side=LEFT, fill=BOTH, expand=True, padx=(12, 0))

        row = ttk.Frame(editor)
        row.pack(fill=X)
        ttk.Label(row, text="카테고리명").pack(side=LEFT)
        self.cat_name = tk.StringVar()
        ttk.Entry(row, textvariable=self.cat_name).pack(side=LEFT, fill=X, expand=True, padx=6)
        ttk.Button(row, text="새 카테고리", command=self.new_category).pack(side=LEFT)
        ttk.Button(row, text="저장", command=self.save_category).pack(side=LEFT, padx=4)
        ttk.Button(row, text="삭제", command=self.delete_category).pack(side=LEFT)

        grid = ttk.Frame(editor)
        grid.pack(fill=X, pady=8)
        self.cat_min = tk.DoubleVar(value=1.0)
        self.cat_max = tk.DoubleVar(value=1.4)
        self.cat_granule = tk.DoubleVar(value=0.05)
        self.cat_picks = tk.StringVar(value="")
        for i, (label, var) in enumerate([
            ("최소 가중치", self.cat_min),
            ("최대 가중치", self.cat_max),
            ("granule", self.cat_granule),
            ("선택 태그 수", self.cat_picks),
        ]):
            ttk.Label(grid, text=label).grid(row=0, column=i * 2, sticky="w", padx=(0, 4))
            ttk.Entry(grid, textvariable=var, width=9).grid(row=0, column=i * 2 + 1, sticky="w", padx=(0, 12))

        ttk.Label(
            editor,
            text="선택 태그 수: 빈칸이면 이 카테고리의 작가 태그를 모두 포함합니다. 숫자를 넣으면 프롬프트 1개마다 그 개수만큼만 랜덤 선택합니다.",
            wraplength=760,
        ).pack(anchor="w", pady=(0, 8))

        ttk.Label(editor, text="태그 목록: 한 줄에 하나씩 입력").pack(anchor="w")
        self.cat_tags = tk.Text(editor, wrap="word")
        self.cat_tags.pack(fill=BOTH, expand=True)

    def _build_presets_tab(self) -> None:
        pane = ttk.PanedWindow(self.presets_tab, orient="horizontal")
        pane.pack(fill=BOTH, expand=True)
        base = ttk.Frame(pane, padding=(0, 0, 8, 0))
        char = ttk.Frame(pane, padding=(8, 0, 0, 0))
        pane.add(base, weight=1)
        pane.add(char, weight=1)

        ttk.Label(base, text="베이스 + 퀄리티 프롬프트 프리셋").pack(anchor="w")
        self.base_list = tk.Listbox(base, height=7)
        self.base_list.pack(fill=X)
        self.base_list.bind("<<ListboxSelect>>", self.on_base_preset_selected)
        self.base_name = tk.StringVar()
        ttk.Label(base, text="프리셋 이름").pack(anchor="w", pady=(8, 0))
        ttk.Entry(base, textvariable=self.base_name).pack(fill=X, pady=6)
        base_prompt_box = ttk.LabelFrame(base, text="베이스 프롬프트", padding=8)
        base_prompt_box.pack(fill=BOTH, expand=True, pady=(0, 8))
        self.base_text = tk.Text(base_prompt_box, height=8, wrap="word")
        self.base_text.pack(fill=BOTH, expand=True)
        quality_prompt_box = ttk.LabelFrame(base, text="퀄리티 프롬프트", padding=8)
        quality_prompt_box.pack(fill=BOTH, expand=True)
        self.quality_text = tk.Text(quality_prompt_box, height=6, wrap="word")
        self.quality_text.pack(fill=BOTH, expand=True)
        row = ttk.Frame(base)
        row.pack(fill=X, pady=6)
        ttk.Button(row, text="베이스 새로 만들기", command=self.new_base_preset).pack(side=LEFT)
        ttk.Button(row, text="저장", command=self.save_base_preset).pack(side=LEFT, padx=4)
        ttk.Button(row, text="삭제", command=self.delete_base_preset).pack(side=LEFT)

        ttk.Label(char, text="캐릭터 프롬프트 프리셋").pack(anchor="w")
        ttk.Label(
            char,
            text="생성 시 캐릭터 프롬프트는 쉼표가 아니라 NovelAI V4+ 멀티 캐릭터 문법인 | 로 분리됩니다.",
            wraplength=520,
        ).pack(anchor="w", pady=(0, 6))
        self.char_list = tk.Listbox(char, height=8)
        self.char_list.pack(fill=X)
        self.char_list.bind("<<ListboxSelect>>", self.on_char_preset_selected)
        self.char_name = tk.StringVar()
        ttk.Label(char, text="프리셋 이름").pack(anchor="w", pady=(8, 0))
        ttk.Entry(char, textvariable=self.char_name).pack(fill=X, pady=6)
        self.char_prompts: list[tk.Text] = []
        self.char_negs: list[tk.Text] = []
        for idx in range(3):
            box = ttk.LabelFrame(char, text=f"캐릭터 {idx + 1}", padding=6)
            box.pack(fill=X, pady=3)
            p = tk.Text(box, height=3, wrap="word")
            n = tk.Text(box, height=2, wrap="word")
            ttk.Label(box, text=f"캐릭터 {idx + 1} 프롬프트").pack(anchor="w")
            p.pack(fill=X)
            ttk.Label(box, text=f"캐릭터 {idx + 1} 네거티브 프롬프트").pack(anchor="w")
            n.pack(fill=X)
            self.char_prompts.append(p)
            self.char_negs.append(n)
        row = ttk.Frame(char)
        row.pack(fill=X, pady=6)
        ttk.Button(row, text="캐릭터 새로 만들기", command=self.new_char_preset).pack(side=LEFT)
        ttk.Button(row, text="저장", command=self.save_char_preset).pack(side=LEFT, padx=4)
        ttk.Button(row, text="삭제", command=self.delete_char_preset).pack(side=LEFT)

    def _build_history_tab(self) -> None:
        top = ttk.Frame(self.history_tab)
        top.pack(fill=X)
        ttk.Label(top, text="히스토리").pack(side=LEFT)
        self.history_combo = ttk.Combobox(top, state="readonly", width=58)
        self.history_combo.pack(side=LEFT, padx=6)
        self.history_combo.bind("<<ComboboxSelected>>", lambda _: self.load_history_selection())
        ttk.Button(top, text="월드컵 시작", command=self.start_worldcup).pack(side=LEFT)

        body = ttk.PanedWindow(self.history_tab, orient="horizontal")
        body.pack(fill=BOTH, expand=True, pady=8)
        self.history_detail = tk.Text(body, wrap="word", width=46)
        self.worldcup_frame = ttk.Frame(body)
        body.add(self.history_detail, weight=1)
        body.add(self.worldcup_frame, weight=2)

        self.left_img = ttk.Label(self.worldcup_frame)
        self.right_img = ttk.Label(self.worldcup_frame)
        self.left_img.grid(row=0, column=0, sticky="nsew", padx=8)
        self.right_img.grid(row=0, column=1, sticky="nsew", padx=8)
        ttk.Button(self.worldcup_frame, text="왼쪽 선택", command=lambda: self.pick_worldcup("left")).grid(row=1, column=0, sticky="ew", padx=8, pady=8)
        ttk.Button(self.worldcup_frame, text="오른쪽 선택", command=lambda: self.pick_worldcup("right")).grid(row=1, column=1, sticky="ew", padx=8, pady=8)
        self.worldcup_status = ttk.Label(self.worldcup_frame, text="")
        self.worldcup_status.grid(row=2, column=0, columnspan=2, sticky="ew", padx=8)
        self.worldcup_frame.columnconfigure(0, weight=1)
        self.worldcup_frame.columnconfigure(1, weight=1)
        self.worldcup_frame.rowconfigure(0, weight=1)

    def _build_settings_tab(self) -> None:
        frame = ttk.Frame(self.settings_tab)
        frame.pack(fill=X)
        self.api_vars = {
            "token": tk.StringVar(),
            "endpoint": tk.StringVar(),
            "user_agent": tk.StringVar(),
            "model": tk.StringVar(),
            "width": tk.IntVar(),
            "height": tk.IntVar(),
            "steps": tk.IntVar(),
            "scale": tk.DoubleVar(),
            "uncond_scale": tk.DoubleVar(),
            "guidance_rescale": tk.DoubleVar(),
            "sampler": tk.StringVar(),
            "noise_schedule": tk.StringVar(),
            "n_samples": tk.IntVar(),
            "seed": tk.IntVar(),
            "mock_mode": tk.BooleanVar(),
        }
        labels = [
            ("API 토큰", "token"),
            ("Endpoint", "endpoint"),
            ("User-Agent", "user_agent"),
            ("Model", "model"),
            ("Width", "width"),
            ("Height", "height"),
            ("Steps", "steps"),
            ("Scale", "scale"),
            ("Uncond Scale", "uncond_scale"),
            ("Guidance Rescale", "guidance_rescale"),
            ("Sampler", "sampler"),
            ("Noise Schedule", "noise_schedule"),
            ("N Samples", "n_samples"),
            ("Seed (-1=random)", "seed"),
        ]
        for r, (label, key) in enumerate(labels):
            ttk.Label(frame, text=label).grid(row=r, column=0, sticky="w", pady=3)
            show = "*" if key == "token" else None
            ttk.Entry(frame, textvariable=self.api_vars[key], show=show).grid(row=r, column=1, sticky="ew", padx=8)
        ttk.Checkbutton(frame, text="목업 모드 사용: 토큰 없이 테스트 이미지 생성", variable=self.api_vars["mock_mode"]).grid(row=len(labels), column=1, sticky="w", pady=8)
        ttk.Button(frame, text="API 설정 저장", command=self.save_api_settings).grid(row=len(labels) + 1, column=1, sticky="w")
        frame.columnconfigure(1, weight=1)

        neg_box = ttk.LabelFrame(self.settings_tab, text="공통 네거티브 프롬프트", padding=8)
        neg_box.pack(fill=BOTH, expand=True, pady=12)
        self.negative_text = tk.Text(neg_box, height=8, wrap="word")
        self.negative_text.pack(fill=BOTH, expand=True)
        ttk.Button(neg_box, text="네거티브 프롬프트 저장", command=self.save_negative).pack(anchor="e", pady=6)

    def refresh_all(self) -> None:
        self.refresh_categories()
        self.refresh_presets()
        self.refresh_api()
        self.refresh_history()
        self.preview_prompt()

    def log_line(self, text: str) -> None:
        self.log.insert(END, text + "\n")
        self.log.see(END)

    def selected_index(self, listbox: tk.Listbox) -> int | None:
        sel = listbox.curselection()
        return int(sel[0]) if sel else None

    def on_close(self) -> None:
        self.save_category_from_editor()
        self.save_base_preset_from_editor()
        self.save_char_preset_from_editor()
        self.save_negative()
        self.save_generation_options()
        self.destroy()

    def on_tab_changed(self, _event: tk.Event) -> None:
        if self.last_tab_id == str(self.tags_tab):
            self.save_category_from_editor()
        elif self.last_tab_id == str(self.presets_tab):
            self.save_base_preset_from_editor()
            self.save_char_preset_from_editor()
        self.last_tab_id = self.tabs.select()

    def on_generation_options_changed(self, _event: tk.Event | None = None) -> None:
        if self.suppress_generation_events:
            return
        self.save_generation_options()
        self.preview_prompt()

    def save_generation_options(self) -> None:
        try:
            count = max(1, int(self.count_var.get()))
        except (tk.TclError, ValueError):
            count = max(1, self.state_data.generation.count)
        self.state_data.generation = GenerationSettings(
            base_preset=self.base_combo.get(),
            character_preset=self.char_combo.get(),
            count=count,
        )
        save_state(self.state_data)

    def refresh_categories(self) -> None:
        self.category_list.delete(0, END)
        for cat in self.state_data.categories:
            self.category_list.insert(END, cat.name)
        if self.state_data.categories and not self.category_list.curselection():
            self.category_list.selection_set(0)
            self.load_category_at(0)

    def on_category_selected(self, _event: tk.Event) -> None:
        idx = self.selected_index(self.category_list)
        if idx is None:
            return
        if idx != self.current_category_index:
            self.save_category_from_editor()
        self.load_category_at(idx)

    def load_category_at(self, idx: int) -> None:
        if idx < 0 or idx >= len(self.state_data.categories):
            return
        cat = self.state_data.categories[idx]
        self.current_category_index = idx
        self.cat_name.set(cat.name)
        self.cat_min.set(cat.min_weight)
        self.cat_max.set(cat.max_weight)
        self.cat_granule.set(cat.granule)
        self.cat_picks.set("" if cat.picks <= 0 else str(cat.picks))
        self.cat_tags.delete("1.0", END)
        self.cat_tags.insert("1.0", "\n".join(cat.tags))

    def new_category(self) -> None:
        self.save_category_from_editor()
        self.category_list.selection_clear(0, END)
        self.current_category_index = None
        self.cat_name.set("커스텀 카테고리")
        self.cat_min.set(0.5)
        self.cat_max.set(1.2)
        self.cat_granule.set(0.1)
        self.cat_picks.set("")
        self.cat_tags.delete("1.0", END)

    def category_editor_has_content(self) -> bool:
        name = self.cat_name.get().strip()
        tags = self.cat_tags.get("1.0", END).strip()
        return bool(tags or (name and name != "커스텀 카테고리"))

    def category_from_editor(self) -> Category:
        min_weight = float(self.cat_min.get())
        max_weight = float(self.cat_max.get())
        granule = float(self.cat_granule.get())
        picks_text = self.cat_picks.get().strip()
        picks = max(1, int(picks_text)) if picks_text else 0
        return Category(
            self.cat_name.get().strip() or "이름 없는 카테고리",
            [line.strip() for line in self.cat_tags.get("1.0", END).splitlines() if line.strip()],
            min_weight,
            max_weight,
            granule,
            picks,
        )

    def save_category_from_editor(self) -> int | None:
        if self.current_category_index is None and not self.category_editor_has_content():
            return None
        try:
            cat = self.category_from_editor()
        except (tk.TclError, ValueError) as exc:
            messagebox.showwarning("카테고리 저장 실패", f"가중치, granule, 선택 태그 수 값을 확인해주세요. 선택 태그 수는 빈칸 또는 1 이상의 숫자여야 합니다.\n\n{exc}")
            return self.current_category_index

        if self.current_category_index is None:
            self.state_data.categories.append(cat)
            self.current_category_index = len(self.state_data.categories) - 1
            self.category_list.insert(END, cat.name)
        elif 0 <= self.current_category_index < len(self.state_data.categories):
            self.state_data.categories[self.current_category_index] = cat
            self.category_list.delete(self.current_category_index)
            self.category_list.insert(self.current_category_index, cat.name)

        save_state(self.state_data)
        self.preview_prompt()
        return self.current_category_index

    def save_category(self) -> None:
        idx = self.save_category_from_editor()
        if idx is not None:
            self.category_list.selection_clear(0, END)
            self.category_list.selection_set(idx)

    def delete_category(self) -> None:
        idx = self.current_category_index
        if idx is None:
            return
        del self.state_data.categories[idx]
        self.current_category_index = None
        save_state(self.state_data)
        self.refresh_categories()

    def refresh_presets(self) -> None:
        base_names = [p.name for p in self.state_data.base_presets]
        char_names = [p.name for p in self.state_data.character_presets]
        self.suppress_generation_events = True
        self.base_combo["values"] = base_names
        self.char_combo["values"] = char_names
        saved_base = self.state_data.generation.base_preset
        saved_char = self.state_data.generation.character_preset
        if base_names:
            self.base_combo.set(saved_base if saved_base in base_names else base_names[0])
        else:
            self.base_combo.set("")
        if char_names:
            self.char_combo.set(saved_char if saved_char in char_names else char_names[0])
        else:
            self.char_combo.set("")
        self.count_var.set(max(1, self.state_data.generation.count))
        self.suppress_generation_events = False

        self.base_list.delete(0, END)
        for item in base_names:
            self.base_list.insert(END, item)
        self.char_list.delete(0, END)
        for item in char_names:
            self.char_list.insert(END, item)
        self.save_generation_options()

    def refresh_preset_names(self) -> None:
        base_names = [p.name for p in self.state_data.base_presets]
        char_names = [p.name for p in self.state_data.character_presets]
        self.suppress_generation_events = True
        self.base_combo["values"] = base_names
        self.char_combo["values"] = char_names
        if self.base_combo.get() not in base_names and base_names:
            self.base_combo.set(base_names[0])
        if self.char_combo.get() not in char_names and char_names:
            self.char_combo.set(char_names[0])
        self.suppress_generation_events = False
        self.save_generation_options()

    def find_base(self) -> PromptPreset | None:
        name = self.base_combo.get()
        return next((p for p in self.state_data.base_presets if p.name == name), None)

    def find_char(self) -> CharacterPreset | None:
        name = self.char_combo.get()
        return next((p for p in self.state_data.character_presets if p.name == name), None)

    def on_base_preset_selected(self, _event: tk.Event) -> None:
        if self.suppress_preset_events:
            return
        idx = self.selected_index(self.base_list)
        if idx is None:
            return
        if idx != self.current_base_index:
            self.save_base_preset_from_editor()
        self.load_base_preset_at(idx)

    def new_base_preset(self) -> None:
        self.save_base_preset_from_editor()
        self.base_list.selection_clear(0, END)
        self.current_base_index = None
        self.base_name.set("새 베이스")
        self.base_text.delete("1.0", END)
        self.quality_text.delete("1.0", END)

    def load_base_preset(self) -> None:
        idx = self.selected_index(self.base_list)
        if idx is None:
            return
        self.load_base_preset_at(idx)

    def load_base_preset_at(self, idx: int) -> None:
        if idx < 0 or idx >= len(self.state_data.base_presets):
            return
        preset = self.state_data.base_presets[idx]
        self.current_base_index = idx
        self.base_name.set(preset.name)
        self.base_text.delete("1.0", END)
        self.base_text.insert("1.0", preset.prompt)
        self.quality_text.delete("1.0", END)
        self.quality_text.insert("1.0", preset.quality_prompt)

    def base_preset_editor_has_content(self) -> bool:
        name = self.base_name.get().strip()
        return bool(
            self.base_text.get("1.0", END).strip()
            or self.quality_text.get("1.0", END).strip()
            or (name and name != "새 베이스")
        )

    def base_preset_from_editor(self) -> PromptPreset:
        return PromptPreset(
            self.base_name.get().strip() or "이름 없는 베이스",
            self.base_text.get("1.0", END).strip(),
            self.quality_text.get("1.0", END).strip(),
        )

    def save_base_preset_from_editor(self) -> int | None:
        if self.current_base_index is None and not self.base_preset_editor_has_content():
            return None
        preset = self.base_preset_from_editor()
        if self.current_base_index is None:
            self.state_data.base_presets.append(preset)
            self.current_base_index = len(self.state_data.base_presets) - 1
            self.base_list.insert(END, preset.name)
        elif 0 <= self.current_base_index < len(self.state_data.base_presets):
            self.state_data.base_presets[self.current_base_index] = preset
            self.base_list.delete(self.current_base_index)
            self.base_list.insert(self.current_base_index, preset.name)
        save_state(self.state_data)
        self.base_combo.set(preset.name)
        self.refresh_preset_names()
        self.preview_prompt()
        return self.current_base_index

    def save_base_preset(self) -> None:
        idx = self.save_base_preset_from_editor()
        if idx is not None:
            self.base_list.selection_clear(0, END)
            self.base_list.selection_set(idx)

    def delete_base_preset(self) -> None:
        idx = self.current_base_index
        if idx is None:
            return
        del self.state_data.base_presets[idx]
        self.current_base_index = None
        self.base_name.set("")
        self.base_text.delete("1.0", END)
        self.quality_text.delete("1.0", END)
        save_state(self.state_data)
        self.refresh_presets()

    def on_char_preset_selected(self, _event: tk.Event) -> None:
        if self.suppress_preset_events:
            return
        idx = self.selected_index(self.char_list)
        if idx is None:
            return
        if idx != self.current_char_index:
            self.save_char_preset_from_editor()
        self.load_char_preset_at(idx)

    def new_char_preset(self) -> None:
        self.save_char_preset_from_editor()
        self.char_list.selection_clear(0, END)
        self.current_char_index = None
        self.char_name.set("새 캐릭터")
        for box in self.char_prompts + self.char_negs:
            box.delete("1.0", END)

    def load_char_preset(self) -> None:
        idx = self.selected_index(self.char_list)
        if idx is None:
            return
        self.load_char_preset_at(idx)

    def load_char_preset_at(self, idx: int) -> None:
        if idx < 0 or idx >= len(self.state_data.character_presets):
            return
        preset = self.state_data.character_presets[idx]
        self.current_char_index = idx
        self.char_name.set(preset.name)
        for i in range(3):
            self.char_prompts[i].delete("1.0", END)
            self.char_prompts[i].insert("1.0", preset.prompts[i] if i < len(preset.prompts) else "")
            self.char_negs[i].delete("1.0", END)
            self.char_negs[i].insert("1.0", preset.negatives[i] if i < len(preset.negatives) else "")

    def char_preset_editor_has_content(self) -> bool:
        name = self.char_name.get().strip()
        prompts = [box.get("1.0", END).strip() for box in self.char_prompts]
        negatives = [box.get("1.0", END).strip() for box in self.char_negs]
        return bool(any(prompts) or any(negatives) or (name and name != "새 캐릭터"))

    def char_preset_from_editor(self) -> CharacterPreset:
        return CharacterPreset(
            self.char_name.get().strip() or "이름 없는 캐릭터",
            [box.get("1.0", END).strip() for box in self.char_prompts],
            [box.get("1.0", END).strip() for box in self.char_negs],
        )

    def save_char_preset_from_editor(self) -> int | None:
        if self.current_char_index is None and not self.char_preset_editor_has_content():
            return None
        preset = self.char_preset_from_editor()
        if self.current_char_index is None:
            self.state_data.character_presets.append(preset)
            self.current_char_index = len(self.state_data.character_presets) - 1
            self.char_list.insert(END, preset.name)
        elif 0 <= self.current_char_index < len(self.state_data.character_presets):
            self.state_data.character_presets[self.current_char_index] = preset
            self.char_list.delete(self.current_char_index)
            self.char_list.insert(self.current_char_index, preset.name)
        save_state(self.state_data)
        self.char_combo.set(preset.name)
        self.refresh_preset_names()
        self.preview_prompt()
        return self.current_char_index

    def save_char_preset(self) -> None:
        idx = self.save_char_preset_from_editor()
        if idx is not None:
            self.char_list.selection_clear(0, END)
            self.char_list.selection_set(idx)

    def delete_char_preset(self) -> None:
        idx = self.current_char_index
        if idx is None:
            return
        del self.state_data.character_presets[idx]
        self.current_char_index = None
        self.char_name.set("")
        for box in self.char_prompts + self.char_negs:
            box.delete("1.0", END)
        save_state(self.state_data)
        self.refresh_presets()

    def refresh_api(self) -> None:
        api = self.state_data.api
        for key, var in self.api_vars.items():
            var.set(getattr(api, key))
        self.negative_text.delete("1.0", END)
        self.negative_text.insert("1.0", self.state_data.negative_prompt)

    def save_api_settings(self, show_message: bool = True) -> None:
        api = self.state_data.api
        for key, var in self.api_vars.items():
            setattr(api, key, var.get())
        save_state(self.state_data)
        if show_message:
            messagebox.showinfo("저장 완료", "API 설정을 저장했습니다.")

    def save_negative(self) -> None:
        self.state_data.negative_prompt = self.negative_text.get("1.0", END).strip()
        save_state(self.state_data)

    def random_artist_tags(self) -> list[dict]:
        return random_artist_tags_for_state(self.state_data)

    def build_prompt(self) -> tuple[str, str, list[dict]]:
        base = self.find_base()
        char = self.find_char()
        artists = order_artist_tags(self.random_artist_tags())
        base_chunks = []
        if base and base.prompt.strip():
            base_chunks.append(base.prompt.strip())
        if artists:
            base_chunks.append(", ".join(item["prompt"] for item in artists))
        quality_prompt = ""
        if self.state_data.quality_override_prompt.strip():
            quality_prompt = self.state_data.quality_override_prompt.strip()
        elif base and base.quality_prompt.strip():
            quality_prompt = base.quality_prompt.strip()
        if quality_prompt:
            base_chunks.append(quality_prompt)
        base_prompt = ", ".join(base_chunks)
        character_prompts = []
        if char:
            character_prompts = [p.strip() for p in char.prompts if p.strip()]
        prompt_parts = [base_prompt] if base_prompt else []
        prompt_parts.extend(character_prompts)
        negative_prompt = character_negative_prompt(self.state_data.negative_prompt, char)
        return " | ".join(prompt_parts), negative_prompt, artists

    def preview_prompt(self) -> None:
        prompt, negative, artists = self.build_prompt()
        base = self.find_base()
        char = self.find_char()
        self.prompt_preview.delete("1.0", END)
        self.prompt_preview.insert("1.0", "[Final Prompt]\n")
        self.prompt_preview.insert(END, f"{prompt}\n\n")
        self.prompt_preview.insert(END, "[Base Prompt]\n")
        self.prompt_preview.insert(END, f"{base.prompt if base else ''}\n\n")
        self.prompt_preview.insert(END, "[Artist Tags]\n")
        for item in artists:
            self.prompt_preview.insert(END, f"- {item['category']}: {item['tag']} / {item['weight']}\n")
        self.prompt_preview.insert(END, "\n")
        self.prompt_preview.insert(END, "[Quality Prompt]\n")
        self.prompt_preview.insert(END, f"{base.quality_prompt if base else ''}\n\n")
        self.prompt_preview.insert(END, "[Character Prompts]\n")
        if char:
            for idx, char_prompt in enumerate(char.prompts, start=1):
                if char_prompt.strip():
                    self.prompt_preview.insert(END, f"{idx}. {char_prompt.strip()}\n")
        self.prompt_preview.insert(END, f"\n[Negative / UC]\n{negative}\n")

    def start_generation(self) -> None:
        count = max(1, int(self.count_var.get()))
        self.save_generation_options()
        self.save_negative()
        base = self.find_base()
        char = self.find_char()
        if not base or not char:
            messagebox.showwarning("프리셋 필요", "베이스 프리셋과 캐릭터 프리셋을 선택해주세요.")
            return
        self.save_api_settings(show_message=False)
        run_id = now_id()
        out_dir = OUTPUT_DIR / f"{run_id}_{safe_path_name(base.name)}_{safe_path_name(char.name)}"
        out_dir.mkdir(parents=True, exist_ok=True)
        self.progress["value"] = 0
        self.progress["maximum"] = count
        self.log_line(f"생성 시작: {count}장 -> {out_dir}")
        thread = threading.Thread(target=self.generate_batch, args=(count, out_dir, base.name, char.name), daemon=True)
        thread.start()

    def generate_batch(self, count: int, out_dir: Path, base_name: str, char_name: str) -> None:
        client = NovelAIClient(self.state_data.api)
        items = []
        for idx in range(count):
            prompt, negative, artists = self.build_prompt()
            path = out_dir / f"image_{idx + 1:03}.png"
            metadata = {
                "path": output_ref(str(path)),
                "artists": artists,
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            try:
                client.generate(prompt, negative, path)
                items.append(metadata)
                self.after(0, self.log_line, f"{idx + 1}/{count} 완료: {path.name}")
            except Exception as exc:
                metadata["error"] = str(exc)
                items.append(metadata)
                self.after(0, self.log_line, f"{idx + 1}/{count} 실패: {exc}")
            self.after(0, lambda v=idx + 1: self.progress.configure(value=v))

        history = {
            "id": out_dir.name,
            "base_preset": base_name,
            "character_preset": char_name,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "output_dir": str(out_dir),
            "items": items,
        }
        self.state_data.history.insert(0, history)
        save_state(self.state_data)
        self.after(0, self.refresh_history)
        self.after(0, self.log_line, "생성 작업이 끝났습니다.")

    def pick_output_folder(self) -> None:
        path = filedialog.askdirectory(initialdir=str(OUTPUT_DIR))
        if path:
            self.log_line(f"출력 폴더: {path}")

    def refresh_history(self) -> None:
        values = [
            f"{h['created_at']} | {h['base_preset']} + {h['character_preset']} | {len(h.get('items', []))}장"
            for h in self.state_data.history
        ]
        self.history_combo["values"] = values
        if values:
            self.history_combo.set(values[0])
            self.load_history_selection()

    def selected_history(self) -> dict | None:
        idx = self.history_combo.current()
        if idx < 0 or idx >= len(self.state_data.history):
            return None
        return self.state_data.history[idx]

    def load_history_selection(self) -> None:
        history = self.selected_history()
        self.history_detail.delete("1.0", END)
        if not history:
            return
        self.history_detail.insert(END, json.dumps(history, ensure_ascii=False, indent=2))

    def start_worldcup(self) -> None:
        history = self.selected_history()
        if not history:
            return
        self.worldcup_items = [item for item in history.get("items", []) if Path(item.get("path", "")).exists()]
        random.shuffle(self.worldcup_items)
        if len(self.worldcup_items) < 2:
            self.worldcup_status.configure(text="월드컵을 하려면 이미지가 최소 2장 필요합니다.")
            return
        self.next_worldcup_pair()

    def load_photo(self, item: dict) -> tk.PhotoImage:
        photo = tk.PhotoImage(file=item["path"])
        max_w, max_h = 420, 560
        factor = max(1, int(max(photo.width() / max_w, photo.height() / max_h)))
        if factor > 1:
            photo = photo.subsample(factor, factor)
        self.preview_images.append(photo)
        self.preview_images = self.preview_images[-8:]
        return photo

    def next_worldcup_pair(self) -> None:
        if len(self.worldcup_items) == 1:
            winner = self.worldcup_items[0]
            self.left_img.configure(image=self.load_photo(winner))
            self.right_img.configure(image="")
            self.worldcup_status.configure(text=f"우승: {winner['path']}\n프롬프트: {winner['prompt']}")
            return
        if len(self.worldcup_items) < 2:
            return
        left = self.worldcup_items.pop()
        right = self.worldcup_items.pop()
        self.current_pair = (left, right)
        self.left_img.configure(image=self.load_photo(left))
        self.right_img.configure(image=self.load_photo(right))
        self.worldcup_status.configure(text=f"남은 후보: {len(self.worldcup_items) + 2}")

    def pick_worldcup(self, side: str) -> None:
        if not self.current_pair:
            return
        winner = self.current_pair[0] if side == "left" else self.current_pair[1]
        self.worldcup_items.insert(0, winner)
        self.current_pair = None
        random.shuffle(self.worldcup_items)
        self.next_worldcup_pair()


if __name__ == "__main__":
    if tk is None:
        raise SystemExit("tkinter is not available. Use `python launcher.py` or `python web_app.py` for the web UI.")
    ensure_dirs()
    app = App()
    app.mainloop()
