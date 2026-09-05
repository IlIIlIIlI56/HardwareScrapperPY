"""
Servidor local do aplicativo: serve a interface E a API de coleta na MESMA
origem, num unico processo.

Antes eram dois: o Live Server do VSCode (arquivos, porta 5500) e o
trigger_server.py (coleta, porta 8787). Isso obrigava a liberar CORS, fixava
uma porta que podia estar ocupada, e fazia o botao "Coletar dados agora" falhar
com "servidor nao encontrado" sempre que o usuario esquecia o segundo terminal.
Uma origem so elimina os tres problemas de uma vez.

O que e servido:

    GET  /                      -> index.html
    GET  /index.html, /css/*,
         /js/*, /catalogo.html  -> arquivos que acompanham o app (so leitura)
    GET  /data/<arquivo>.json   -> pasta de dados do usuario (dados/)
    GET  /app-bootstrap.js      -> gerado na hora: entrega o token da sessao e
                                   os caminhos reais para a interface
    GET  /api/state             -> decisoes de revisao e curadoria do usuario
    POST /api/state             -> grava essas decisoes
    GET  /api/status            -> estado da coleta
    POST /api/scrape[?reset=1]  -> inicia a coleta
    POST /api/cancel            -> aborta a coleta em andamento
    POST /api/reset-all         -> reset de fabrica: apaga produtos, restaura
                                   a base de benchmarks padrao e apaga a
                                   curadoria inteira (decisoes.json)
    POST /api/save              -> grava uma exportacao em dados/exportacoes/
    POST /api/open              -> abre uma pasta no Explorer
    POST /api/quit              -> encerra o app
    GET  /api/update/status     -> resultado da ultima checagem de versao
    POST /api/update/check      -> checa por uma versao nova (?force=1 ignora
                                   o cache de 24h)
    POST /api/update/download   -> baixa o APK da versao nova (so Android)
    POST /api/update/cancel     -> aborta esse download

A porta e escolhida pelo sistema (bind em 0) em vez de fixada: duas copias do
app abertas ao mesmo tempo, ou qualquer outro programa ja usando a porta, nao
se atrapalham mais.

Seguranca: o servidor escuta so em 127.0.0.1 e toda chamada a /api/ exige o
cabecalho X-HW-Token, sorteado a cada execucao e entregue apenas pelo
/app-bootstrap.js. Sem isso, qualquer pagina web aberta no computador poderia
varrer as portas locais e disparar coletas ou descobrir o caminho dos seus
arquivos.
"""

import json
import mimetypes
import re
import secrets
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

from . import paths

# Extensoes servidas a partir dos recursos do app. Uma lista fechada em vez de
# "tudo que estiver na pasta": o executavel empacotado carrega .dll e .pyd ao
# lado dos arquivos da interface, e nao ha motivo nenhum para expo-los.
STATIC_SUFFIXES = {".html", ".css", ".js", ".svg", ".png", ".ico", ".woff2", ".map"}

SAFE_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}$")

# Decisoes de revisao e curadoria de benchmarks. Antes viviam no localStorage
# da pagina, o que aqui seria uma armadilha: o WebView2 separa o localStorage
# POR ORIGEM, e a origem inclui a porta -- que este servidor sorteia a cada
# abertura. Meses de curadoria desapareceriam a cada vez que o app fosse
# fechado e reaberto. Num arquivo dentro de `dados/` elas ainda ganham o que
# importava num app portatil: viajam junto quando a pasta e copiada, entram no
# backup por um simples Ctrl+C na pasta, e nao esbarram na cota de ~5 MB.
STATE_FILENAME = "decisoes.json"

EMPTY_PRODUCTS = {
    "scraped_at": None,
    "source": "https://www.comprasparaguai.com.br/informatica/",
    "counts_by_category": {},
    "total_products": 0,
    "products": [],
}


class AppServer:
    def __init__(self, job, updates, version="1.0.0"):
        self.job = job
        self.updates = updates
        self.version = version
        self.token = secrets.token_urlsafe(24)
        self.resource_root = paths.resource_dir().resolve()
        self.data_root = paths.data_dir().resolve()
        self.exports_root = paths.exports_dir().resolve()
        self.state_path = self.data_root / STATE_FILENAME
        self._state_lock = threading.Lock()
        self.quit_event = threading.Event()
        self._httpd = None
        self._thread = None

    # -------------------------------------------------------------- ciclo --

    def start(self):
        handler = _make_handler(self)
        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self._httpd.daemon_threads = True
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self.url

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None

    @property
    def port(self):
        return self._httpd.server_address[1] if self._httpd else None

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}/index.html"

    # ---------------------------------------------------------- resolucao --

    def resolve_static(self, url_path):
        """
        Traduz um caminho de URL para um arquivo dentro dos recursos do app,
        recusando qualquer coisa que escape da pasta (../, caminhos absolutos)
        ou cuja extensao nao esteja na lista.
        """
        relative = unquote(url_path).lstrip("/")
        if not relative or relative.endswith("/"):
            relative = "index.html"
        candidate = (self.resource_root / relative).resolve()
        try:
            candidate.relative_to(self.resource_root)
        except ValueError:
            return None
        if not candidate.is_file():
            return None
        if candidate.suffix.lower() not in STATIC_SUFFIXES:
            return None
        return candidate

    def resolve_data(self, url_path):
        """
        /data/<arquivo>.json -> dados/<arquivo>.json. So JSON e so um nivel:
        esta pasta tambem guarda o perfil da janela (cookies, localStorage), e
        nada disso deve ser alcancavel por URL.
        """
        name = unquote(url_path)[len("/data/"):]
        if not name.endswith(".json") or not SAFE_FILENAME.match(name):
            return None
        return self.data_root / name

    def bootstrap_js(self):
        """
        Ponte minima entre o processo Python e a interface. Existe como arquivo
        gerado (e nao como texto injetado no HTML) para que index.html e
        catalogo.html continuem sendo arquivos estaticos comuns, editaveis e
        legiveis sem placeholders.
        """
        payload = {
            "token": self.token,
            "version": self.version,
            "appDir": str(paths.app_dir()),
            "dataDir": str(self.data_root),
            "exportsDir": str(self.exports_root),
            "canOpenFolder": paths.can_reveal(),
            # "install" (o app baixa o APK e chama o instalador do sistema) ou
            # "link" (so avisa e manda para a pagina de download). Decidido
            # aqui para a interface nao ter que inferir plataforma.
            "updateMode": self.updates.snapshot()["mode"],
        }
        return (
            "/* gerado por appcore/server.py a cada execucao -- nao editar */\n"
            "window.HW_APP = Object.freeze(" + json.dumps(payload, ensure_ascii=False) + ");\n"
        )

    # -------------------------------------------------------------- estado --

    def read_state(self):
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            # Arquivo ausente (primeiro uso) ou corrompido: comecar vazio e
            # deixar o usuario recomecar e melhor do que travar a interface
            # inteira, que so o le para aplicar decisoes por cima do pipeline.
            return {}
        return data if isinstance(data, dict) else {}

    def write_state(self, data):
        if not isinstance(data, dict):
            raise ValueError("estado deve ser um objeto")
        payload = json.dumps(data, ensure_ascii=False, indent=2)
        with self._state_lock:
            self.data_root.mkdir(parents=True, exist_ok=True)
            # Grava num temporario e troca: uma queda de energia no meio da
            # escrita deixaria o arquivo pela metade, e um JSON truncado aqui
            # significa perder toda a curadoria em vez de so a ultima decisao.
            temporary = self.state_path.with_suffix(".json.tmp")
            temporary.write_text(payload, encoding="utf-8")
            temporary.replace(self.state_path)
        return len(payload)

    # -------------------------------------------------------------- acoes --

    def save_export(self, filename, content):
        if not SAFE_FILENAME.match(filename or ""):
            raise ValueError("nome de arquivo invalido")
        self.exports_root.mkdir(parents=True, exist_ok=True)
        destination = self.exports_root / filename
        if destination.exists():
            # Nao sobrescreve silenciosamente: dois backups do mesmo dia sao o
            # caso normal, e o segundo nao deve apagar o primeiro.
            stamp = datetime.now(timezone.utc).strftime("%H%M%S")
            destination = self.exports_root / f"{destination.stem}-{stamp}{destination.suffix}"
        # newline="" desliga a traducao de fim de linha do modo texto do Python.
        # Sem isso, no Windows cada "\n" gravado vira "\r\n" -- e o conteudo que
        # a pagina manda ja usa "\r\n" (a lista .txt de uma build e o CSV do
        # catalogo), entao o arquivo saia com "\r\r\n" em cada quebra.
        with destination.open("w", encoding="utf-8", newline="") as handle:
            handle.write(content)
        return destination

    def reset_all(self):
        """
        Reset de fabrica: apaga os produtos coletados, restaura a base de
        benchmarks para a versao que acompanha o app (paths.ensure_user_data
        so reseeda o que estiver faltando) e apaga toda a curadoria --
        decisoes de revisao, apelidos, ajustes e as builds manuais salvas na
        pagina Build, que vivem todas em `decisoes.json`.

        `dados/exportacoes/` nao e tocada: sao arquivos que o usuario gerou de
        proposito (backups, listas de compra), nao estado do app, e apagar
        arquivos que a pessoa pediu para salvar seria surpreendente demais
        para um botao chamado so de "resetar dados".

        Recusa rodar com uma coleta em andamento -- apagar products.json por
        baixo do proprio scraper que esta escrevendo nele deixaria o arquivo
        num estado inconsistente pela metade.
        """
        if self.job.snapshot()["running"]:
            raise ValueError("não é possível resetar com uma coleta em andamento — cancele-a primeiro")

        removed = []
        for name in ("products.json", "benchmarks.json"):
            target = self.data_root / name
            if target.exists():
                target.unlink()
                removed.append(name)

        if self.state_path.exists():
            self.state_path.unlink()
            removed.append(STATE_FILENAME)

        seeded = paths.ensure_user_data()
        return {"removed": removed, "seeded": seeded}


def _make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "HardwareScrapper"

        # -------------------------------------------------------- respostas --

        def _send(self, code, body=b"", content_type="text/plain; charset=utf-8"):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            # Os JSONs de dados sao reescritos pela coleta enquanto a janela
            # esta aberta -- um cache aqui mostraria a base antiga depois de um
            # reload.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, code, payload):
            self._send(
                code,
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                "application/json; charset=utf-8",
            )

        def _authorized(self):
            return secrets.compare_digest(self.headers.get("X-HW-Token", ""), app.token)

        def _body(self, limit=32 * 1024 * 1024):
            length = int(self.headers.get("Content-Length") or 0)
            if length > limit:
                raise ValueError("corpo grande demais")
            return self.rfile.read(length) if length else b""

        # ------------------------------------------------------------- GET --

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = urlparse(self.path).path

            if path == "/app-bootstrap.js":
                self._send(
                    HTTPStatus.OK,
                    app.bootstrap_js().encode("utf-8"),
                    "application/javascript; charset=utf-8",
                )
                return

            if path.startswith("/api/"):
                self._api_get(path)
                return

            if path.startswith("/data/"):
                self._serve_data(path)
                return

            target = app.resolve_static(path)
            if target is None:
                self._send(HTTPStatus.NOT_FOUND, b"nao encontrado")
                return
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if content_type.startswith(("text/", "application/javascript")):
                content_type += "; charset=utf-8"
            self._send(HTTPStatus.OK, target.read_bytes(), content_type)

        def _serve_data(self, path):
            target = app.resolve_data(path)
            if target is None:
                self._send(HTTPStatus.NOT_FOUND, b"nao encontrado")
                return
            if not target.is_file():
                # products.json so existe depois da primeira coleta. Devolver
                # uma base vazia em vez de 404 faz a janela abrir mostrando
                # "0 produtos, colete agora" -- com 404 ela abriria num erro de
                # carregamento, que parece defeito e nao primeiro uso.
                if target.name == "products.json":
                    self._json(HTTPStatus.OK, EMPTY_PRODUCTS)
                else:
                    self._send(HTTPStatus.NOT_FOUND, b"nao encontrado")
                return
            self._send(HTTPStatus.OK, target.read_bytes(), "application/json; charset=utf-8")

        def _api_get(self, path):
            if not self._authorized():
                self._json(HTTPStatus.FORBIDDEN, {"error": "token invalido"})
                return
            if path == "/api/state":
                self._json(HTTPStatus.OK, app.read_state())
            elif path == "/api/status":
                self._json(HTTPStatus.OK, app.job.snapshot())
            elif path == "/api/ping":
                self._json(HTTPStatus.OK, {"app": True, "version": app.version})
            elif path == "/api/update/status":
                # So le memoria. A rede vive nas threads do UpdateJob, disparadas
                # pelos POSTs: este metodo nao tem try/except, entao uma excecao
                # aqui derrubaria a conexao sem resposta nenhuma.
                self._json(HTTPStatus.OK, app.updates.snapshot())
            else:
                self._json(HTTPStatus.NOT_FOUND, {"error": "endpoint desconhecido"})

        # ------------------------------------------------------------ POST --

        def do_POST(self):
            parsed = urlparse(self.path)
            if not parsed.path.startswith("/api/"):
                self._send(HTTPStatus.NOT_FOUND, b"nao encontrado")
                return
            if not self._authorized():
                self._json(HTTPStatus.FORBIDDEN, {"error": "token invalido"})
                return

            try:
                if parsed.path == "/api/state":
                    written = app.write_state(json.loads(self._body() or b"{}"))
                    self._json(HTTPStatus.OK, {"saved": True, "bytes": written})

                elif parsed.path == "/api/scrape":
                    reset = parse_qs(parsed.query).get("reset", ["0"])[0] == "1"
                    started, already = app.job.start(reset=reset)
                    self._json(
                        HTTPStatus.ACCEPTED,
                        {"started": started, "already_running": already, "reset": reset},
                    )

                elif parsed.path == "/api/cancel":
                    self._json(HTTPStatus.OK, {"cancelling": app.job.cancel()})

                elif parsed.path == "/api/reset-all":
                    self._json(HTTPStatus.OK, app.reset_all())

                elif parsed.path == "/api/save":
                    payload = json.loads(self._body() or b"{}")
                    destination = app.save_export(payload.get("filename"), payload.get("content", ""))
                    self._json(HTTPStatus.OK, {"path": str(destination), "name": destination.name})

                elif parsed.path == "/api/open":
                    targets = {
                        "exports": app.exports_root,
                        "data": app.data_root,
                        "app": paths.app_dir(),
                    }
                    payload = json.loads(self._body() or b"{}")
                    target = targets.get(payload.get("target", "exports"))
                    self._json(HTTPStatus.OK, {"opened": bool(target and paths.reveal(target))})

                elif parsed.path == "/api/update/check":
                    force = parse_qs(parsed.query).get("force", ["0"])[0] == "1"
                    started, already = app.updates.check(force=force)
                    self._json(
                        HTTPStatus.OK,
                        {"started": started, "already_running": already},
                    )

                elif parsed.path == "/api/update/download":
                    started, already = app.updates.download()
                    self._json(
                        HTTPStatus.ACCEPTED,
                        {"started": started, "already_running": already},
                    )

                elif parsed.path == "/api/update/cancel":
                    self._json(HTTPStatus.OK, {"cancelling": app.updates.cancel()})

                elif parsed.path == "/api/quit":
                    self._json(HTTPStatus.OK, {"quitting": True})
                    app.quit_event.set()

                else:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "endpoint desconhecido"})

            except ValueError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            except OSError as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

        def log_message(self, fmt, *args):
            pass  # uma linha por requisicao poluiria o console sem informar nada

    return Handler
