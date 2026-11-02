from __future__ import annotations

import json
import mimetypes
import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from copy import deepcopy
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Queue

from app import (APP_DIR, OUTPUT_DIR, STATE_PATH, NovelAIClient, AppState, PromptPreset,
                 artist_tags_for_prompt, character_negative_prompt, has_saved_api_token,
                 load_api_token, load_state, save_state, save_api_token, output_ref,
                 parse_artist_tags, safe_path_name, sanitize_history_entry)
from models import state_from_dict, validate_state
from guidance import SETTING_KEYS, grid_values

WEB_DIR = APP_DIR / "web"
LOCAL_API_TOKEN = secrets.token_urlsafe(32)
STATE_LOCK = threading.RLock()
JOBS_LOCK = threading.RLock()
JOBS: dict[str, dict] = {}
COMPLETED_JOB_LIMIT = 50
WORK: Queue = Queue()
WORKER = None
IMAGE_SIZE_DIMENSIONS = {"portrait": (832, 1216), "landscape": (1216, 832), "square": (1024, 1024)}


def safe_child_path(root: Path, rel: str) -> Path | None:
    try:
        path = (root / urllib.parse.unquote(rel)).resolve()
        path.relative_to(root.resolve())
        return path
    except (ValueError, OSError):
        return None


def resolve_output_path(path: str, expect_dir: bool = False) -> Path | None:
    if not path:
        return None
    return safe_child_path(OUTPUT_DIR, path)


def media_url(path: str) -> str:
    resolved = resolve_output_path(path)
    if not resolved:
        return ""
    rel = str(resolved.relative_to(OUTPUT_DIR.resolve())).replace('\\', '/')
    return "/media/" + urllib.parse.quote(rel) + "?token=" + LOCAL_API_TOKEN


def state_payload(state: AppState) -> dict:
    data = asdict(state)
    data["api"]["token"] = ""
    data["api"]["token_saved"] = has_saved_api_token()
    data["history"] = [sanitize_history_entry(h) for h in data["history"]]
    for history in data["history"]:
        for item in history.get("items", []):
            item["image_url"] = media_url(item.get("path", ""))
            item["history_id"] = history["id"]
    return data


def selected_preset(state: AppState) -> PromptPreset | None:
    return next((p for p in state.prompt_presets if p.name == state.generation.preset), None)


def build_prompt(state: AppState, artists_override=None):
    preset = selected_preset(state)
    artists = artist_tags_for_prompt(state) if artists_override is None else artists_override
    chunks = [preset.base_prompt.strip() if preset else "", ", ".join(a["prompt"] for a in artists), state.quality_prompt.strip()]
    # Keep an empty base section when only character captions are populated.
    parts = [", ".join(c for c in chunks if c)]
    if preset:
        parts.extend(c.prompt.strip() for c in preset.characters if c.prompt.strip())
    return " | ".join(parts), character_negative_prompt(state.negative_prompt, preset), artists


def save_incoming_state(data):
    state = state_from_dict(data)
    validate_state(state)
    for category in state.categories:
        category.tags = parse_artist_tags(category.tags)
        category.disabled_tags = [t for t in parse_artist_tags(category.disabled_tags) if t in category.tags]
    with STATE_LOCK:
        current = load_state()
        state.history = current.history
        token = str(data.get("api", {}).get("token", "") or "").strip()
        if token:
            save_api_token(token)
        state.api.token = load_api_token()
        save_state(state)
    return state


def scene_state(state, scene):
    current = deepcopy(state)
    current.generation.preset = scene.preset
    current.generation.count = scene.count
    current.generation.image_size = scene.image_size
    if scene.image_size in IMAGE_SIZE_DIMENSIONS:
        current.api.width, current.api.height = IMAGE_SIZE_DIMENSIONS[scene.image_size]
    return current


def prune_completed_jobs():
    # Caller holds JOBS_LOCK. Active jobs are never discarded.
    finished = [key for key, job in JOBS.items() if job['status'] not in {'queued', 'running', 'cancelling'}]
    for key in finished[:-COMPLETED_JOB_LIMIT]:
        del JOBS[key]


def update_job(job_id, **changes):
    with JOBS_LOCK:
        JOBS[job_id].update(changes)
        if changes.get('status') in {'done', 'failed', 'cancelled'}:
            prune_completed_jobs()


def cancelled(job_id):
    with JOBS_LOCK:
        return JOBS[job_id].get("cancel_requested", False)


def run_job(job_id, state, batting=False, sweep=None):
    scenes = [(s.preset, scene_state(state, s)) for s in state.batting_scenes] if batting else [(state.generation.preset, state)]
    history = {"id": job_id, "type": "batting_test" if batting else "generation", "preset": state.generation.preset,
               "created_at": time.strftime("%Y-%m-%d %H:%M:%S"), "output_dir": job_id, "items": []}
    if sweep:
        source, x_values, y_values, settings_source = sweep
        history.update(type="guidance_test", preset=source.get('preset', ''), sweep={
            'source_path': source['path'], 'source_seed': source['seed'], 'x_values': x_values,
            'y_values': y_values, 'settings_source': settings_source})
        scenes = []
        for y_index, rescale in enumerate(y_values):
            for x_index, scale in enumerate(x_values):
                cell = deepcopy(state)
                cell.generation.count = 1
                cell.generation.preset = source.get('preset', '')
                cell.api.scale, cell.api.guidance_rescale = scale, rescale
                scenes.append(((x_index, y_index), cell))
        with STATE_LOCK:
            latest = load_state()
            latest.history.insert(0, deepcopy(history))
            save_state(latest)
    out_dir = OUTPUT_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    progress, failures = 0, 0
    update_job(job_id, status="running")
    for scene_name, current in scenes:
        for _ in range(current.generation.count):
            if cancelled(job_id):
                break
            if sweep:
                prompt, negative, artists = source['prompt'], source['negative_prompt'], deepcopy(source.get('artists', []))
            else:
                prompt, negative, artists = build_prompt(current)
            path = out_dir / f"image_{progress + 1:04}.png"
            settings = deepcopy(current.api)
            if settings.seed < 0:
                settings.seed = secrets.randbelow(2**32)
            item = {"path": output_ref(str(path)), "artists": artists, "prompt": prompt, "negative_prompt": negative,
                    "preset": current.generation.preset, "scene_name": current.generation.preset if sweep else scene_name,
                    "seed": settings.seed, "width": settings.width, "height": settings.height,
                    "mock": settings.mock_mode, "created_at": time.strftime("%Y-%m-%d %H:%M:%S")}
            item['generation_settings'] = {key: getattr(settings, key) for key in SETTING_KEYS}
            item['scale'], item['guidance_rescale'] = settings.scale, settings.guidance_rescale
            if sweep:
                item['sweep_x'], item['sweep_y'] = scene_name
            try:
                NovelAIClient(settings).generate(prompt, negative, path)
            except Exception as exc:
                item["error"] = str(exc)
                failures += 1
            history["items"].append(item)
            progress += 1
            # Checkpoint each result so an unexpected app exit does not lose completed work.
            with STATE_LOCK:
                latest = load_state()
                latest.history = [h for h in latest.history if h["id"] != job_id]
                latest.history.insert(0, deepcopy(history))
                save_state(latest)
            update_job(job_id, progress=progress, failures=failures, last_error=item.get("error", ""))
        if cancelled(job_id):
            break
    update_job(job_id, status="cancelled" if cancelled(job_id) else "failed" if failures else "done")


def worker_loop():
    while True:
        job_id, state, batting, sweep = WORK.get()
        try:
            if not cancelled(job_id):
                run_job(job_id, state, batting, sweep)
            else:
                update_job(job_id, status="cancelled")
        except Exception as exc:
            update_job(job_id, status="failed", last_error=str(exc))
        finally:
            WORK.task_done()


def enqueue(state, batting=False, sweep=None):
    global WORKER
    if not state.api.mock_mode and not state.api.token:
        raise ValueError("API 토큰을 입력하거나 체험 모드를 켜세요.")
    if batting and not state.batting_scenes:
        raise ValueError("타율 테스트에 사용할 씬을 추가하세요.")
    if not batting and not sweep and not selected_preset(state):
        raise ValueError("프롬프트 프리셋을 선택하세요.")
    job_id = time.strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:8]
    total = sum(s.count for s in state.batting_scenes) if batting else state.generation.count
    if sweep:
        total = len(sweep[1]) * len(sweep[2])
    with JOBS_LOCK:
        if sum(j["status"] in {"queued", "running", "cancelling"} for j in JOBS.values()) >= 20:
            raise ValueError("대기열은 최대 20개까지 추가할 수 있습니다.")
        JOBS[job_id] = {"id": job_id, "name": "가이던스 테스트" if sweep else "타율 테스트" if batting else state.generation.preset,
                        "status": "queued", "progress": 0, "total": total}
        if WORKER is None or not WORKER.is_alive():
            WORKER = threading.Thread(target=worker_loop, daemon=True)
            WORKER.start()
        WORK.put((job_id, deepcopy(state), batting, deepcopy(sweep)))
    return job_id


def prepare_guidance(state):
    source = next((item for history in state.history for item in history.get('items', [])
                   if item.get('path') == state.guidance_test.source_path), None)
    if not source or source.get('error') or not all(key in source for key in ('prompt', 'negative_prompt', 'seed', 'width', 'height')):
        raise ValueError('프롬프트·시드·크기가 기록된 이미지를 선택하세요.')
    if type(source['seed']) is not int or not 0 <= source['seed'] < 2**32:
        raise ValueError('원본 이미지의 시드가 유효하지 않습니다.')
    x_values, y_values = grid_values(state.guidance_test)
    current = deepcopy(state)
    snapshot = source.get('generation_settings', {})
    recorded = all(key in snapshot for key in SETTING_KEYS)
    if recorded:
        for key in SETTING_KEYS:
            setattr(current.api, key, snapshot[key])
    current.api.seed = source['seed']
    current.api.width, current.api.height = source['width'], source['height']
    validate_state(current)
    return current, (deepcopy(source), x_values, y_values, 'recorded' if recorded else 'current')


class Handler(BaseHTTPRequestHandler):
    server_version = "NAI-ACLAB/2.0"

    def log_message(self, *_):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        return secrets.compare_digest(self.headers.get("X-NAI-ACLAB-Token", ""), LOCAL_API_TOKEN)

    def do_GET(self):
        try:
            self.get_route()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as exc:
            self.send_json({"error": str(exc)}, 500)

    def get_route(self):
        url = urllib.parse.urlparse(self.path)
        route = url.path
        if route.startswith('/api/') and not self.authorized():
            return self.send_json({"error": "인증이 필요합니다."}, 403)
        if route == '/api/state':
            with STATE_LOCK:
                return self.send_json({"state": state_payload(load_state())})
        if route == '/api/jobs':
            with JOBS_LOCK:
                return self.send_json({"jobs": list(JOBS.values())})
        if route == '/api/quota':
            with STATE_LOCK:
                state = load_state()
            return self.send_json({"quota": NovelAIClient(state.api).subscription_quota()})
        if route.startswith('/media/'):
            token = urllib.parse.parse_qs(url.query).get('token', [''])[0]
            if not secrets.compare_digest(token, LOCAL_API_TOKEN):
                return self.send_json({"error": "인증이 필요합니다."}, 403)
            path = safe_child_path(OUTPUT_DIR, route[len('/media/'):])
        elif route.startswith('/web/'):
            path = safe_child_path(WEB_DIR, route[len('/web/'):])
        elif route == '/':
            path = WEB_DIR / 'index.html'
        else:
            return self.send_error(404)
        if not path or not path.is_file():
            return self.send_error(404)
        body = path.read_bytes()
        if route == '/':
            body = body.decode('utf-8').replace('</head>', '<script>window.__NAI_ACLAB_TOKEN__='+json.dumps(LOCAL_API_TOKEN)+'</script></head>').encode()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store' if route == '/' else 'private, max-age=3600')
        if route == '/':
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.authorized():
            return self.send_json({"error": "인증이 필요합니다."}, 403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length > 16 * 1024 * 1024:
                return self.send_json({"error": "요청이 너무 큽니다."}, 413)
            data = json.loads(self.rfile.read(length) or b'{}')
            self.post_route(urllib.parse.urlparse(self.path).path, data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except (ValueError, TypeError, KeyError) as exc:
            self.send_json({"error": str(exc)}, 400)
        except Exception as exc:
            self.send_json({"error": str(exc)}, 500)

    def post_route(self, route, data):
        if route == '/api/guidance/generate':
            state = save_incoming_state(data.get('state', data))
            current, sweep = prepare_guidance(state)
            return self.send_json({'job_id': enqueue(current, sweep=sweep)})
        if route in {'/api/state', '/api/preview', '/api/generate', '/api/batting/generate'}:
            state = save_incoming_state(data.get('state', data))
            if route == '/api/state':
                return self.send_json({"state": state_payload(state)})
            if route == '/api/preview':
                prompt, negative, artists = build_prompt(state)
                return self.send_json({"prompt": prompt, "negative": negative, "artists": artists})
            return self.send_json({"job_id": enqueue(state, route == '/api/batting/generate')})
        if route == '/api/job/cancel':
            with JOBS_LOCK:
                job = JOBS.get(data.get('job_id'))
                if not job:
                    return self.send_json({"error": "작업을 찾을 수 없습니다."}, 404)
                if job['status'] in {'queued', 'running', 'cancelling'}:
                    job['cancel_requested'] = True
                    job['status'] = 'cancelled' if job['status'] == 'queued' else 'cancelling'
                return self.send_json({"ok": True})
        if route == '/api/history/favorite':
            with STATE_LOCK:
                state = load_state()
                for h in state.history:
                    for item in h.get('items', []):
                        if h['id'] == data.get('history_id') and item['path'] == data.get('path'):
                            item['favorite'] = bool(data.get('favorite'))
                save_state(state)
                return self.send_json({"state": state_payload(state)})
        if route == '/api/history/delete':
            with JOBS_LOCK:
                active = {k for k, j in JOBS.items() if j['status'] in {'queued', 'running', 'cancelling'}}
            ids = set(data.get('ids', []))
            if ids & active:
                raise ValueError('진행 중인 작업은 완료 후 삭제하세요.')
            with STATE_LOCK:
                state = load_state()
                state.history = [h for h in state.history if h['id'] not in ids]
                save_state(state)
                return self.send_json({"state": state_payload(state)})
        if route == '/api/history/open':
            with STATE_LOCK:
                state = load_state()
            history = next((h for h in state.history if h['id'] == data.get('id')), None)
            path = resolve_output_path(history.get('output_dir', '')) if history else None
            if not path or not path.is_dir():
                raise ValueError('저장 폴더를 찾을 수 없습니다.')
            if os.name == 'nt':
                os.startfile(str(path))
            else:
                subprocess.Popen(['open' if sys.platform == 'darwin' else 'xdg-open', str(path)])
            return self.send_json({"ok": True})
        self.send_error(404)


def serve(port=0, desktop=False):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}/"}), flush=True)
    if desktop:
        # The Rust parent owns stdin. EOF (including parent crash) stops this process.
        def watch_parent():
            sys.stdin.buffer.read()
            os._exit(0)
        threading.Thread(target=watch_parent, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    serve(int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 0, '--desktop' in sys.argv)
