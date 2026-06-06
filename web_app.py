from __future__ import annotations

import json
import mimetypes
import os
import random
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
from dataclasses import asdict, fields
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from app import (
    APP_DIR,
    OUTPUT_DIR,
    ApiSettings,
    AppState,
    BattingScene,
    Category,
    CharacterPreset,
    GenerationSettings,
    NovelAIClient,
    PromptPreset,
    float_range,
    has_saved_api_token,
    load_api_token,
    load_state,
    now_id,
    output_ref,
    parse_artist_tags,
    safe_path_name,
    save_api_token,
    save_state,
    sanitize_history_entry,
    sanitize_history_item,
    weight_tag,
)


WEB_DIR = APP_DIR / "web"
JOBS: dict[str, dict] = {}
STATE_LOCK = threading.Lock()
LOCAL_API_TOKEN = secrets.token_urlsafe(32)
ACTIVE_JOB_STATUSES = {"queued", "running", "cancelling"}
IMAGE_SIZE_DIMENSIONS = {
    "portrait": (832, 1216),
    "landscape": (1216, 832),
    "square": (1024, 1024),
}


def dataclass_from_dict(cls, data: dict):
    valid = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in (data or {}).items() if k in valid})


def state_from_dict(data: dict) -> AppState:
    base_data = data.get("base_presets", [])
    quality_override = data.get("quality_override_prompt", "")
    if not quality_override.strip():
        selected_base_name = (data.get("generation", {}) or {}).get("base_preset", "")
        selected_base = next((item for item in base_data if item.get("name") == selected_base_name), None)
        fallback_base = (
            selected_base
            if selected_base and selected_base.get("quality_override_prompt")
            else next((item for item in base_data if item.get("quality_override_prompt")), None)
        )
        quality_override = (fallback_base or {}).get("quality_override_prompt", "")
    return AppState(
        categories=[dataclass_from_dict(Category, item) for item in data.get("categories", [])],
        base_presets=[dataclass_from_dict(PromptPreset, item) for item in base_data],
        character_presets=[dataclass_from_dict(CharacterPreset, item) for item in data.get("character_presets", [])],
        quality_override_prompt=quality_override,
        negative_prompt=data.get("negative_prompt", ""),
        uc_prompt=data.get("uc_prompt", data.get("negative_prompt", "")),
        api=dataclass_from_dict(ApiSettings, data.get("api", {})),
        generation=dataclass_from_dict(GenerationSettings, data.get("generation", {})),
        batting_scenes=[dataclass_from_dict(BattingScene, item) for item in data.get("batting_scenes", [])],
        history=data.get("history", []),
    )


def media_url(path: str) -> str:
    resolved = resolve_output_path(path)
    if not resolved:
        return ""
    try:
        rel = resolved.relative_to(OUTPUT_DIR.resolve())
    except (ValueError, OSError):
        return ""
    return "/media/" + urllib.parse.quote(str(rel).replace("\\", "/"))


def resolve_output_path(path: str, expect_dir: bool = False) -> Path | None:
    raw = str(path or "").strip()
    if not raw:
        return None
    candidate = Path(raw)
    try:
        if candidate.is_absolute():
            resolved = candidate.resolve()
            resolved.relative_to(OUTPUT_DIR.resolve())
            return resolved
        resolved = (OUTPUT_DIR / candidate).resolve()
        resolved.relative_to(OUTPUT_DIR.resolve())
        if resolved.exists() or not expect_dir:
            return resolved
    except (ValueError, OSError):
        return None
    return None


def safe_child_path(root: Path, rel: str) -> Path | None:
    try:
        root_resolved = root.resolve()
        child = (root_resolved / urllib.parse.unquote(rel)).resolve()
        child.relative_to(root_resolved)
        return child
    except (ValueError, OSError):
        return None


def open_in_file_manager(path: Path) -> None:
    if os.name == "nt":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def state_payload(state: AppState) -> dict:
    data = asdict(state)
    data.setdefault("api", {})["token"] = ""
    data["api"]["token_saved"] = has_saved_api_token()
    data["history"] = [sanitize_history_entry(item) for item in data.get("history", [])]
    for category in data.get("categories", []):
        category["recognized_tags"] = parse_artist_tags(category.get("tags", []))
    for history in data.get("history", []):
        for item in history.get("items", []):
            item["image_url"] = media_url(item.get("path", ""))
    return data


def item_payload(item: dict) -> dict:
    data = sanitize_history_item(item)
    data["image_url"] = media_url(data.get("path", ""))
    return data


def selected_base(state: AppState) -> PromptPreset | None:
    name = state.generation.base_preset
    return next((item for item in state.base_presets if item.name == name), None) or (
        state.base_presets[0] if state.base_presets else None
    )


def selected_character(state: AppState) -> CharacterPreset | None:
    name = state.generation.character_preset
    return next((item for item in state.character_presets if item.name == name), None) or (
        state.character_presets[0] if state.character_presets else None
    )


def random_artist_tags(state: AppState) -> list[dict]:
    result = []
    for category in state.categories:
        tags = parse_artist_tags(category.tags)
        if not tags:
            continue
        weights = float_range(category.min_weight, category.max_weight, category.granule)
        pick_count = len(tags) if category.picks <= 0 else min(category.picks, len(tags))
        for tag in random.sample(tags, pick_count):
            weight = random.choice(weights) if weights else category.min_weight
            result.append(
                {
                    "category": category.name,
                    "tag": tag,
                    "weight": weight,
                    "prompt": weight_tag(tag, weight),
                }
            )
    return result


def fixed_artist_tags(state: AppState) -> list[dict]:
    result = []
    for item in getattr(state.generation, "fixed_artists", []) or []:
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
                "tag": tag,
                "weight": weight,
                "prompt": item.get("prompt") or weight_tag(tag, weight),
            }
        )
    return result


def build_prompt(state: AppState) -> tuple[str, str, str, list[dict]]:
    base = selected_base(state)
    character = selected_character(state)
    artists = fixed_artist_tags(state) or random_artist_tags(state)
    base_chunks = []
    if base and base.prompt.strip():
        base_chunks.append(base.prompt.strip())
    if artists:
        base_chunks.append(", ".join(item["prompt"] for item in artists))
    quality_prompt = ""
    if state.quality_override_prompt.strip():
        quality_prompt = state.quality_override_prompt.strip()
    elif base and base.quality_prompt.strip():
        quality_prompt = base.quality_prompt.strip()
    if quality_prompt:
        base_chunks.append(quality_prompt)

    prompt_parts = []
    base_prompt = ", ".join(base_chunks)
    if base_prompt:
        prompt_parts.append(base_prompt)
    if character:
        prompt_parts.extend(prompt.strip() for prompt in character.prompts if prompt.strip())

    negative = [state.negative_prompt.strip()]
    if character:
        negative.extend(item.strip() for item in character.negatives if item.strip())
    negative_prompt = ", ".join(item for item in negative if item)
    uc_prompt = state.uc_prompt.strip() or negative_prompt
    return " | ".join(prompt_parts), negative_prompt, uc_prompt, artists


def save_incoming_state(data: dict) -> AppState:
    state = state_from_dict(data)
    incoming_token = str((data.get("api", {}) or {}).get("token", "") or "").strip()
    if incoming_token:
        save_api_token(incoming_token)
        state.api.token = incoming_token
    else:
        state.api.token = load_api_token()
    with STATE_LOCK:
        current = load_state()
        state.history = current.history
        save_state(state)
    return state


def delete_history_entries(ids: list[str], delete_files: bool) -> AppState:
    ids_set = set(ids)
    with STATE_LOCK:
        state = load_state()
        removed = [item for item in state.history if item.get("id") in ids_set]
        state.history = [item for item in state.history if item.get("id") not in ids_set]
        save_state(state)
    if delete_files:
        output_root = OUTPUT_DIR.resolve()
        for history in removed:
            raw_dir = history.get("output_dir", "")
            if not raw_dir:
                continue
            target = resolve_output_path(raw_dir, expect_dir=True)
            if not target:
                continue
            if target == output_root or output_root not in target.parents:
                continue
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
    return load_state()


def history_by_id(history_id: str) -> dict | None:
    state = load_state()
    return next((item for item in state.history if item.get("id") == history_id), None)


def clear_history(delete_files: bool) -> AppState:
    with STATE_LOCK:
        state = load_state()
        ids = [item.get("id", "") for item in state.history]
    return delete_history_entries(ids, delete_files)


def active_job() -> dict | None:
    return next((job for job in JOBS.values() if job.get("status") in ACTIVE_JOB_STATUSES), None)


def run_generation(job_id: str, state: AppState) -> None:
    base = selected_base(state)
    character = selected_character(state)
    count = max(1, int(state.generation.count or 1))
    run_id = now_id()
    out_dir = OUTPUT_DIR / f"{run_id}_{safe_path_name(base.name if base else 'base')}_{safe_path_name(character.name if character else 'character')}"
    out_dir.mkdir(parents=True, exist_ok=True)
    client = NovelAIClient(state.api)
    items = []

    JOBS[job_id].update({"status": "running", "progress": 0, "total": count, "output_dir": str(out_dir), "items": []})
    cancelled = False
    for idx in range(count):
        if JOBS.get(job_id, {}).get("cancel_requested"):
            cancelled = True
            JOBS[job_id]["log"].append("중지 요청으로 남은 생성을 건너뜁니다.")
            break
        prompt, negative, uc_prompt, artists = build_prompt(state)
        path = out_dir / f"image_{idx + 1:03}.png"
        metadata = {
            "path": output_ref(str(path)),
            "artists": artists,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        try:
            client.generate(prompt, negative, uc_prompt, path)
            JOBS[job_id]["log"].append(f"{idx + 1}/{count} 완료: {path.name}")
        except Exception as exc:
            metadata["error"] = str(exc)
            JOBS[job_id]["log"].append(f"{idx + 1}/{count} 실패: {exc}")
        items.append(metadata)
        JOBS[job_id].update({"progress": idx + 1, "items": [item_payload(item) for item in items]})

    history = {
        "id": out_dir.name,
        "base_preset": base.name if base else "",
        "character_preset": character.name if character else "",
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "output_dir": output_ref(str(out_dir)),
        "items": items,
    }
    update = {
        "status": "cancelled" if cancelled or JOBS.get(job_id, {}).get("cancel_requested") else "done",
        "log": JOBS[job_id]["log"] + ["생성 작업이 중지되었습니다." if cancelled else "생성 작업이 끝났습니다."],
    }
    if items:
        with STATE_LOCK:
            latest = load_state()
            latest.history.insert(0, history)
            save_state(latest)
        update["history"] = history
    JOBS[job_id].update(update)


def scene_state(state: AppState, scene: BattingScene) -> AppState:
    request_state = deepcopy(state)
    request_state.generation.base_preset = scene.base_preset
    request_state.generation.character_preset = scene.character_preset
    image_size = scene.image_size if scene.image_size in IMAGE_SIZE_DIMENSIONS else request_state.generation.image_size
    if image_size in IMAGE_SIZE_DIMENSIONS:
        width, height = IMAGE_SIZE_DIMENSIONS[image_size]
        request_state.generation.image_size = image_size
        request_state.api.width = width
        request_state.api.height = height
    request_state.generation.count = scene_count(scene)
    return request_state


def scene_count(scene: BattingScene) -> int:
    try:
        return max(1, int(scene.count or 2))
    except (TypeError, ValueError):
        return 2


def run_batting_test(job_id: str, state: AppState) -> None:
    scenes = [scene for scene in state.batting_scenes if scene.base_preset and scene.character_preset]
    if not scenes:
        JOBS[job_id].update({"status": "done", "progress": 0, "total": 0, "items": [], "log": ["타율 테스트에 사용할 씬이 없습니다."]})
        return

    total = sum(scene_count(scene) for scene in scenes)
    run_id = now_id()
    out_dir = OUTPUT_DIR / f"{run_id}_타율테스트_{len(scenes)}씬"
    out_dir.mkdir(parents=True, exist_ok=True)
    client = NovelAIClient(state.api)
    items = []
    progress = 0
    JOBS[job_id].update(
        {
            "status": "running",
            "progress": 0,
            "total": total,
            "output_dir": str(out_dir),
            "items": [],
            "log": [f"타율 테스트 시작: {len(scenes)}개 씬, 총 {total}장"],
        }
    )

    cancelled = False
    for scene_index, scene in enumerate(scenes, start=1):
        if JOBS.get(job_id, {}).get("cancel_requested"):
            cancelled = True
            JOBS[job_id]["log"].append("중지 요청으로 남은 씬을 건너뜁니다.")
            break
        current = scene_state(state, scene)
        base = selected_base(current)
        character = selected_character(current)
        count = scene_count(scene)
        scene_name = scene.name.strip() or f"Scene {scene_index}"
        scene_dir = out_dir / f"{scene_index:02}_{safe_path_name(scene_name)}"
        scene_dir.mkdir(parents=True, exist_ok=True)
        JOBS[job_id]["log"].append(
            f"[{scene_index}/{len(scenes)}] {scene_name}: {base.name if base else ''} + {character.name if character else ''}"
        )

        for image_index in range(count):
            if JOBS.get(job_id, {}).get("cancel_requested"):
                cancelled = True
                JOBS[job_id]["log"].append(f"{scene_name}: 중지 요청으로 남은 이미지를 건너뜁니다.")
                break
            prompt, negative, uc_prompt, artists = build_prompt(current)
            path = scene_dir / f"image_{image_index + 1:03}.png"
            metadata = {
                "path": output_ref(str(path)),
                "artists": artists,
                "scene_name": scene_name,
                "scene_index": scene_index,
                "source_base_preset": base.name if base else "",
                "source_character_preset": character.name if character else "",
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            try:
                client.generate(prompt, negative, uc_prompt, path)
                JOBS[job_id]["log"].append(f"{scene_name} {image_index + 1}/{count} 완료: {path.name}")
            except Exception as exc:
                metadata["error"] = str(exc)
                JOBS[job_id]["log"].append(f"{scene_name} {image_index + 1}/{count} 실패: {exc}")
            items.append(metadata)
            progress += 1
            JOBS[job_id].update({"progress": progress, "items": [item_payload(item) for item in items]})
        if cancelled:
            break

    history = {
        "id": out_dir.name,
        "type": "batting_test",
        "base_preset": "타율 테스트",
        "character_preset": f"{len(scenes)}개 씬",
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "output_dir": output_ref(str(out_dir)),
        "scenes": [asdict(scene) for scene in scenes],
        "items": items,
    }
    update = {
        "status": "cancelled" if cancelled or JOBS.get(job_id, {}).get("cancel_requested") else "done",
        "log": JOBS[job_id]["log"] + ["타율 테스트가 중지되었습니다." if cancelled else "타율 테스트가 끝났습니다."],
    }
    if items:
        with STATE_LOCK:
            latest = load_state()
            latest.history.insert(0, history)
            save_state(latest)
        update["history"] = history
    JOBS[job_id].update(update)


class Handler(BaseHTTPRequestHandler):
    server_version = "NAIArtistWeb/0.1"

    def log_message(self, format: str, *args) -> None:
        return

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_index(self) -> None:
        path = WEB_DIR / "index.html"
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        token_script = f"<script>window.__NAI_ACLAB_TOKEN__ = {json.dumps(LOCAL_API_TOKEN)};</script>"
        html = path.read_text(encoding="utf-8").replace("</head>", f"    {token_script}\n  </head>")
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized_api_request(self) -> bool:
        return self.headers.get("X-NAI-ACLAB-Token", "") == LOCAL_API_TOKEN

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        if route == "/":
            self.send_index()
        elif route.startswith("/web/"):
            path = safe_child_path(WEB_DIR, route.removeprefix("/web/"))
            if not path:
                self.send_error(403)
                return
            self.send_file(path)
        elif route == "/api/state":
            if not self.authorized_api_request():
                self.send_error(403)
                return
            self.send_json({"state": state_payload(load_state())})
        elif route == "/api/preview":
            if not self.authorized_api_request():
                self.send_error(403)
                return
            state = load_state()
            prompt, negative, uc_prompt, artists = build_prompt(state)
            self.send_json({"prompt": prompt, "negative": negative, "uc": uc_prompt, "artists": artists})
        elif route == "/api/job":
            if not self.authorized_api_request():
                self.send_error(403)
                return
            query = urllib.parse.parse_qs(parsed.query)
            job_id = query.get("id", [""])[0]
            self.send_json({"job": JOBS.get(job_id, {"status": "missing"})})
        elif route.startswith("/media/"):
            path = safe_child_path(OUTPUT_DIR, route.removeprefix("/media/"))
            if not path:
                self.send_error(403)
                return
            self.send_file(path)
        else:
            self.send_error(404)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        if route.startswith("/api/") and not self.authorized_api_request():
            self.send_error(403)
            return
        data = self.read_json()
        if route == "/api/state":
            state = save_incoming_state(data.get("state", data))
            self.send_json({"state": state_payload(state)})
        elif route == "/api/preview":
            state = save_incoming_state(data.get("state", data))
            prompt, negative, uc_prompt, artists = build_prompt(state)
            self.send_json({"prompt": prompt, "negative": negative, "uc": uc_prompt, "artists": artists})
        elif route == "/api/generate":
            if active_job():
                self.send_json({"error": "이미 생성 작업이 진행 중입니다."}, status=409)
                return
            state = save_incoming_state(data.get("state", data))
            job_id = f"job_{int(time.time() * 1000)}"
            JOBS[job_id] = {"id": job_id, "status": "queued", "progress": 0, "total": state.generation.count, "log": []}
            thread = threading.Thread(target=run_generation, args=(job_id, state), daemon=True)
            thread.start()
            self.send_json({"job_id": job_id})
        elif route == "/api/batting/generate":
            if active_job():
                self.send_json({"error": "이미 생성 작업이 진행 중입니다."}, status=409)
                return
            state = save_incoming_state(data.get("state", data))
            total = sum(scene_count(scene) for scene in state.batting_scenes)
            job_id = f"job_{int(time.time() * 1000)}"
            JOBS[job_id] = {"id": job_id, "status": "queued", "progress": 0, "total": total, "log": []}
            thread = threading.Thread(target=run_batting_test, args=(job_id, state), daemon=True)
            thread.start()
            self.send_json({"job_id": job_id})
        elif route == "/api/job/cancel":
            job_id = str(data.get("job_id", ""))
            job = JOBS.get(job_id)
            if not job:
                self.send_json({"job": {"status": "missing"}}, status=404)
                return
            if job.get("status") not in ("done", "cancelled", "missing"):
                job["cancel_requested"] = True
                job["status"] = "cancelling"
                if "중지 요청을 받았습니다. 현재 처리 중인 이미지가 끝나면 멈춥니다." not in job.setdefault("log", []):
                    job["log"].append("중지 요청을 받았습니다. 현재 처리 중인 이미지가 끝나면 멈춥니다.")
            self.send_json({"job": job})
        elif route == "/api/history/delete":
            state = delete_history_entries(data.get("ids", []), bool(data.get("delete_files", False)))
            self.send_json({"state": state_payload(state)})
        elif route == "/api/history/clear":
            state = clear_history(bool(data.get("delete_files", False)))
            self.send_json({"state": state_payload(state)})
        elif route == "/api/history/open":
            history = history_by_id(str(data.get("id", "")))
            target = resolve_output_path((history or {}).get("output_dir", ""), expect_dir=True)
            if not history or not target or not target.exists() or not target.is_dir():
                self.send_json({"error": "저장 폴더를 찾을 수 없습니다."}, status=404)
                return
            open_in_file_manager(target)
            self.send_json({"ok": True})
        else:
            self.send_error(404)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("NAI Artist Combination Web UI")
    print(f"http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
