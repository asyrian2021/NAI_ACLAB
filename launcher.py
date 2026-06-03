from __future__ import annotations

import socket
import threading
import sys
import webbrowser
import ctypes
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


def main() -> None:
    port = find_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    webbrowser.open(url)

    try:
        if sys.platform.startswith("win"):
            ctypes.windll.user32.MessageBoxW(
                None,
                f"브라우저에서 {APP_NAME}가 실행 중입니다.\n\n{url}\n\n앱 사용을 마친 뒤 확인을 누르면 서버가 종료됩니다.",
                APP_NAME,
                0,
            )
        else:
            print(f"{APP_NAME} is running at {url}")
            input("Press Enter to stop the server...")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
