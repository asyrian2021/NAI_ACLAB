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
from models import (ApiSettings, AppState, BattingScene, Category, Character, GenerationSettings,
                    PromptPreset, state_from_dict, remove_ratings, validate_state)


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
    data = remove_ratings(asdict(state) if not isinstance(state, dict) else dict(state))
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
        if key not in {"uc_prompt", "request_path", "request_url", "image_url", "history_id"}
    }
    clean = remove_ratings(clean)
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
    steps = int(math.floor((max_value - min_value) / granule + 1e-9))
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


def character_negative_prompt(common_prompt: str, preset: PromptPreset | None) -> str:
    parts = [common_prompt.strip()]
    if preset:
        parts.extend(c.negative.strip() for c in preset.characters if c.prompt.strip())
    while len(parts) > 1 and not parts[-1]:
        parts.pop()
    return " | ".join(parts)


def random_artist_tags_for_state(state: AppState) -> list[dict]:
    result = []
    for category in state.categories:
        tags = parse_artist_tags(category.tags)
        values = float_range(category.min_weight, category.max_weight, category.granule)
        count = len(tags) if category.all_artists else random.randint(min(category.min_picks, len(tags)), min(category.max_picks, len(tags)))
        for tag in random.sample(tags, count):
            weight = random.choice(values)
            result.append({"category": category.name, "tag": tag, "weight": weight, "prompt": weight_tag(tag, weight)})
    return result


def fixed_artist_tags_for_state(state: AppState) -> list[dict]:
    return [{"category": i.get("category", "fixed"), "tag": i["tag"], "weight": float(i.get("weight", 1)),
             "prompt": weight_tag(i["tag"], float(i.get("weight", 1)))}
            for i in state.generation.fixed_artists if str(i.get("tag", "")).strip()]


def order_artist_tags(artists: list[dict]) -> list[dict]:
    shuffled = list(artists)
    random.shuffle(shuffled)
    return shuffled


def artist_tags_for_prompt(state: AppState) -> list[dict]:
    fixed = fixed_artist_tags_for_state(state)
    return fixed if fixed else order_artist_tags(random_artist_tags_for_state(state))


def default_state() -> AppState:
    return AppState(categories=[Category("메인 작가", [], 1, 1.4, .05), Category("보조 작가", [], .4, .9, .1)],
                    prompt_presets=[PromptPreset("기본", "", [Character("1girl, looking at viewer, detailed eyes")])],
                    quality_prompt="masterpiece, best quality, very aesthetic, detailed illustration",
                    negative_prompt="lowres, bad anatomy, bad hands, text, error, missing fingers",
                    generation=GenerationSettings(preset="기본"))


def load_state() -> AppState:
    ensure_dirs()
    if not STATE_PATH.exists():
        state = default_state()
        state.api.token = load_api_token()
        return state
    data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    if int(data.get("schema_version", 1)) > 2:
        raise ValueError("더 새로운 버전에서 저장한 데이터입니다. 앱을 업데이트하세요.")
    legacy_token = str(data.get("api", {}).get("token", "") or "").strip()
    if legacy_token and not has_saved_api_token():
        save_api_token(legacy_token)
    state = state_from_dict(data)
    state.api.token = load_api_token()
    if state_dict_without_secrets(state) != data:
        if int(data.get("schema_version", 1)) < 2:
            backup = STATE_PATH.with_name("app_state.pre-v2.json")
            if not backup.exists():
                backup.write_text(json.dumps(state_dict_without_secrets(remove_ratings(data)), ensure_ascii=False, indent=2), encoding="utf-8")
        save_state(state)
    return state


def save_state(state: AppState) -> None:
    ensure_dirs()
    target = STATE_PATH.with_suffix(".tmp")
    target.write_text(json.dumps(state_dict_without_secrets(state), ensure_ascii=False, indent=2), encoding="utf-8")
    target.replace(STATE_PATH)


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
        if self.settings.mock_mode:
            write_placeholder_png(output_path, prompt, self.settings.width, self.settings.height)
            return

        if not self.settings.token.strip():
            raise ValueError("API 토큰을 입력하거나 체험 모드를 켜세요.")
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
