from __future__ import annotations

import socket
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


def main() -> None:
    port = find_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"

    webbrowser.open(url)
    print(f"{APP_NAME} is running at {url}")
    print("Keep this terminal open while using the app. Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
