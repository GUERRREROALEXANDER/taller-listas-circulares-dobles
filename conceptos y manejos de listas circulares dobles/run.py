"""Entry point: start the roulette server and open the browser.

Usage: ``python run.py [--host HOST] [--port PORT] [--no-browser]``.
"""

from __future__ import annotations

import argparse
import webbrowser

from roulette.api.server import create_server
from roulette.game.roulette_game import RouletteGame


def main() -> None:
    """Parse arguments, seed the demo game and serve until Ctrl+C."""
    parser = argparse.ArgumentParser(description="European roulette demo server")
    parser.add_argument("--host", default="127.0.0.1", help="bind address")
    parser.add_argument("--port", type=int, default=8000, help="bind port")
    parser.add_argument("--no-browser", action="store_true",
                        help="do not open the browser on startup")
    args = parser.parse_args()

    game = RouletteGame()
    game.reset()
    game.add_player("Ana", 100)
    game.add_player("Luis", 100)

    server = create_server(args.host, args.port, game=game)
    url = f"http://{args.host}:{args.port}/"
    print(f"Serving roulette at {url} (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
