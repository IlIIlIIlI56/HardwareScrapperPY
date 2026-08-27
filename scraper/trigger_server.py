"""
Servidor local minimo (so biblioteca padrao do Python -- sem dependencias
novas) que expoe dois endpoints HTTP para o botao "Coletar dados agora" na
pagina index.html:

    POST /scrape   -> dispara scrape_comprasparaguai.run_scrape() em uma
                       thread de fundo (nao bloqueia) e responde na hora.
    GET  /status   -> estado atual da coleta (rodando?, log recente,
                       resultado, erro).

Por que isso existe: um navegador NAO consegue executar um script Python
local por questoes de seguranca (nao existe API JS para rodar processos
arbitrarios da maquina). Este servidor e a ponte minima entre o clique no
botao e o scraper -- ele roda so em 127.0.0.1 (localhost), nao aceita
conexoes de fora da maquina, e nao substitui o Live Server (que continua
servindo os arquivos .html/.css/.js normalmente).

Uso:
    cd scraper
    python trigger_server.py

Deixe essa janela do terminal aberta enquanto usa o botao na pagina. Parar
com Ctrl+C a qualquer momento -- isso so encerra o servidor de coleta, nao
afeta o Live Server nem os dados ja salvos.
"""

import contextlib
import io
import json
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import scrape_comprasparaguai as scraper

PORT = 8787
MAX_LOG_LINES = 500

_lock = threading.Lock()
_state = {
    "running": False,
    "log": [],
    "error": None,
    "result": None,
    "started_at": None,
    "finished_at": None,
}


class _LiveLogStream(io.TextIOBase):
    """Recebe os prints do scraper e vai guardando as linhas em _state['log']."""

    def write(self, chunk):
        if chunk and chunk.strip():
            with _lock:
                for line in chunk.splitlines():
                    if line.strip():
                        _state["log"].append(line)
                _state["log"] = _state["log"][-MAX_LOG_LINES:]
        return len(chunk)

    def flush(self):
        pass


def _run_in_background():
    with _lock:
        _state.update(
            running=True,
            log=[],
            error=None,
            result=None,
            started_at=datetime.now(timezone.utc).isoformat(),
            finished_at=None,
        )

    try:
        with contextlib.redirect_stdout(_LiveLogStream()):
            result = scraper.run_scrape(delay=0.5)
        with _lock:
            _state["result"] = {
                "total_products": result["total_products"],
                "counts_by_category": result["counts_by_category"],
                "scraped_at": result["scraped_at"],
            }
    except Exception as exc:  # captura qualquer falha de rede/parsing e reporta na UI
        with _lock:
            _state["error"] = str(exc)
    finally:
        with _lock:
            _state["running"] = False
            _state["finished_at"] = datetime.now(timezone.utc).isoformat()


class Handler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        # Live Server normalmente roda em outra porta (5500), entao isso e
        # uma chamada cross-origin -- precisa liberar CORS explicitamente.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/status":
            with _lock:
                self._send_json(200, dict(_state))
        else:
            self._send_json(404, {"error": "endpoint desconhecido"})

    def do_POST(self):
        if self.path == "/scrape":
            with _lock:
                already_running = _state["running"]
            if not already_running:
                threading.Thread(target=_run_in_background, daemon=True).start()
            self._send_json(202, {"started": not already_running, "already_running": already_running})
        else:
            self._send_json(404, {"error": "endpoint desconhecido"})

    def log_message(self, format, *args):
        pass  # silencia o log padrao (uma linha por request) no terminal


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Servidor de coleta rodando em http://127.0.0.1:{PORT}")
    print("Deixe esta janela aberta e use o botao 'Coletar dados agora' na pagina.")
    print("Ctrl+C para parar (isso nao afeta o Live Server nem os dados ja salvos).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor de coleta encerrado.")


if __name__ == "__main__":
    main()
