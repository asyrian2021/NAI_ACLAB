from __future__ import annotations

import os
import socket
import subprocess
import sys
import webbrowser
from http.server import ThreadingHTTPServer

from web_app import Handler


APP_NAME = "NAI Artist Combination Lab"


def find_port(start: int = 8777) -> int:
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError("No available local port found.")


def open_browser(url: str) -> bool:
    if os.environ.get("NAI_ARTIST_LAB_NO_BROWSER", "").lower() in {"1", "true", "yes"}:
        return False

    try:
        if sys.platform.startswith("win"):
            os.startfile(url)  # type: ignore[attr-defined]
            return True
        if sys.platform == "darwin":
            subprocess.Popen(["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        pass

    try:
        return bool(webbrowser.open(url, new=2))
    except Exception:
        return False


def main() -> None:
    port = find_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"

    print(f"{APP_NAME} is running at {url}", flush=True)
    print("Keep this terminal open while using the app. Press Ctrl+C to stop.", flush=True)
    if open_browser(url):
        print("Opening your browser now...", flush=True)
    else:
        print("Could not open a browser automatically. Copy and paste the URL above into your browser.", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
