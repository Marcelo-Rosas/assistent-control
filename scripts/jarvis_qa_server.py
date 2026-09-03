"""
JARVIS-Q — thin local HTTP shell over ask().

Run (PowerShell):
  cd C:\\Users\\marce\\assistent-control
  .\\.venv\\Scripts\\python.exe scripts/jarvis_qa_server.py
  # open http://127.0.0.1:8765/

Env overrides: JARVIS_Q_HOST (default 127.0.0.1), JARVIS_Q_PORT (default 8765).
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
UI_PATH = ROOT / "public" / "jarvis-q.html"

# Import ask() without package install (same pattern as jarvis_qa_test.py).
sys.path.insert(0, str(SCRIPTS))
from jarvis_qa import ask  # noqa: E402

try:
    import jarvis_tts  # noqa: E402
except Exception:  # noqa: BLE001 — TTS e opcional; o HUD cai para Web Speech
    jarvis_tts = None  # type: ignore[assignment]

HOST = os.environ.get("JARVIS_Q_HOST", "127.0.0.1")
PORT = int(os.environ.get("JARVIS_Q_PORT", "8765"))


class JarvisQHandler(BaseHTTPRequestHandler):
    server_version = "JARVIS-Q/1.0"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _handle_tts(self) -> None:
        """Sintetiza uma fala e devolve WAV. Erro aqui nao pode derrubar a
        resposta: o HUD trata 4xx/5xx caindo para a Web Speech API."""
        if jarvis_tts is None or not jarvis_tts.disponivel():
            self._json(503, {"ok": False, "error": "TTS local indisponível"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "JSON inválido"})
            return
        texto = data.get("texto") if isinstance(data, dict) else None
        if not isinstance(texto, str) or not texto.strip():
            self._json(400, {"ok": False, "error": 'campo "texto" obrigatório'})
            return
        voz = data.get("voz") if isinstance(data, dict) else None
        voz = voz if isinstance(voz, str) else None
        try:
            # O backend escolhido decide o formato: edge-tts devolve MP3,
            # Piper e SAPI devolvem WAV. Anunciar "audio/wav" para todos
            # deixava o Content-Type mentindo sobre metade dos casos.
            if hasattr(jarvis_tts, "sintetizar_audio"):
                out = jarvis_tts.sintetizar_audio(texto.strip(), voz)
                audio, mime, backend = out.data, out.content_type, out.backend
            else:  # modulo antigo, so WAV
                audio = jarvis_tts.sintetizar(texto.strip(), voz)
                mime, backend = "audio/wav", "piper"
        except Exception as exc:  # noqa: BLE001 — local debug
            self._json(500, {"ok": False, "error": str(exc)})
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("X-Jarvis-TTS-Backend", backend)
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(audio)

    def _json(self, code: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, code: int, data: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            # `tts` diz ao HUD se ha voz neural local; sem isso ele teria de
            # descobrir por tentativa e erro no meio da primeira fala.
            tts_ok = bool(jarvis_tts and jarvis_tts.disponivel())
            self._json(
                200,
                {
                    "ok": True,
                    "service": "jarvis-q",
                    "tts": tts_ok,
                    "vozes": jarvis_tts.vozes_disponiveis() if tts_ok else [],
                    "tts_prefer": "edge:pt-BR-AntonioNeural",
                    "tts_backend": (
                        jarvis_tts.last_backend()
                        if tts_ok and hasattr(jarvis_tts, "last_backend")
                        else None
                    ),
                },
            )
            return
        if path in ("/", "/index.html", "/jarvis-q.html"):
            if not UI_PATH.is_file():
                self._json(404, {"ok": False, "error": "UI missing: public/jarvis-q.html"})
                return
            html = UI_PATH.read_bytes()
            self._bytes(200, html, "text/html; charset=utf-8")
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        # /speak = alias de /tts (HUD e docs)
        if path in ("/tts", "/speak"):
            self._handle_tts()
            return
        if path != "/ask":
            self._json(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "JSON inválido"})
            return
        texto = data.get("texto") if isinstance(data, dict) else None
        if not isinstance(texto, str) or not texto.strip():
            self._json(400, {"ok": False, "error": 'campo "texto" obrigatório'})
            return
        # Contexto de conversa viaja no payload (o cliente devolve o que
        # recebeu). Manter no servidor misturaria conversas de clientes
        # diferentes — o handler e ThreadingHTTPServer, sem sessao.
        contexto = data.get("contexto") if isinstance(data, dict) else None
        if not isinstance(contexto, dict):
            contexto = None
        try:
            result = ask(texto.strip(), contexto=contexto)
        except Exception as exc:  # noqa: BLE001 — surface to client for local debug
            self._json(500, {"ok": False, "error": str(exc)})
            return
        self._json(200, result)


def _aquecer() -> None:
    """Paga o custo de inicializacao no boot, nao na primeira pergunta.

    Medido no HUD: o primeiro POST /ask levava 23s porque o treino do reasoner
    (~200 steps) e o load do modelo de voz (~60 MB) rodavam sob demanda. O
    usuario via "Pensando..." por 23 segundos na primeira interacao.
    """
    try:
        ask("aquecimento")
        print("reasoner pronto", flush=True)
    except Exception as exc:  # noqa: BLE001 — aquecimento e best-effort
        print(f"aviso: reasoner nao aqueceu ({exc})", flush=True)
    if jarvis_tts is not None and jarvis_tts.disponivel():
        try:
            # Nao referenciar constante de voz: o modulo e um cascade e o nome
            # da voz depende do backend que atender. Quem respondeu so se sabe
            # DEPOIS de sintetizar.
            jarvis_tts.sintetizar("Pronto.")
            usado = (
                jarvis_tts.last_backend()
                if hasattr(jarvis_tts, "last_backend")
                else "?"
            )
            print(f"voz pronta (backend={usado})", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"aviso: voz nao aqueceu ({exc})", flush=True)


def main() -> int:
    server = ThreadingHTTPServer((HOST, PORT), JarvisQHandler)
    print(f"JARVIS-Q listening on http://{HOST}:{PORT}/", flush=True)
    print("POST /ask  POST /tts|/speak  GET /health  UI /", flush=True)
    _aquecer()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
