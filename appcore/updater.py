"""
Checagem de novas versoes no GitHub, por tras do botao "Buscar atualizacoes".

O recurso e deliberadamente ASSIMETRICO entre as duas plataformas, e isso nao e
falta de acabamento:

  Windows   so avisa. O zip publicado pelo CI e gerado com
            `Compress-Archive -Path "dist/HardwareScrapper"`, entao ele contem
            uma pasta raiz com o .exe e _internal/ dentro -- e nada mais.
            Extrair por cima da pasta-mae substitui exatamente os dois itens
            certos e nao toca em `dados/`, que nem existe no zip. O caminho
            manual ja e seguro; trocar arquivos sozinho compraria heuristica de
            antivirus (um .exe nao assinado que baixa e substitui um executavel
            e a assinatura comportamental de um dropper), locks de DLL do
            processo vivo e rollback -- tudo na maquina de outra pessoa, sem
            telemetria.

  Android   baixa e instala. Ali nao ha loja por tras de um APK sideloaded: a
            alternativa e o usuario achar o GitHub no celular e baixar pelo
            navegador. O instalador do sistema faz a troca, e `filesDir/dados`
            sobrevive a atualizacao por garantia da plataforma.

Modelo de confianca: HTTPS validado pelo certifi que ja acompanha o app (o
scraper faz HTTPS de dentro do build hoje) mais a integridade da conta do
projeto no GitHub. Um SHA-256 no corpo da release NAO acrescentaria nada --
viria pelo mesmo canal, mesma conta, mesmo TLS que o binario, entao quem troca
o asset troca o hash junto. O que protegeria de verdade e assinar o executavel,
que esta fora de alcance. Contra download truncado, que e o defeito real, o
tamanho declarado e o magic do arquivo bastam.
"""

import json
import os
import re
import sys
import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import requests

from . import paths

# Sobrescritivel por variavel de ambiente para dar como testar o fluxo inteiro
# contra um repositorio de teste, sem precisar publicar uma release de verdade.
REPO = os.environ.get("HW_UPDATE_REPO", "IlIIlIIlI56/HardwareScrapperPY")

CACHE_TTL = timedelta(hours=24)
CHECK_TIMEOUT = (5, 15)
# Sem teto total de propósito: 50 MB numa conexao ruim levam minutos legitimos.
# O que importa e nao ficar preso num socket morto, e isso e o read timeout.
DOWNLOAD_TIMEOUT = (5, 30)
CHUNK_BYTES = 256 * 1024
MAX_ASSET_BYTES = 400 * 1024 * 1024

ASSET_SUFFIX = {"windows": "-windows.zip", "android": "-android.apk"}

# Sufixo em vez de lista fechada de hosts: o GitHub ja trocou o dominio do CDN
# de assets antes (objects. -> release-assets.), e um allowlist exato seria uma
# bomba-relogio de manutencao que so explode na maquina do usuario.
TRUSTED_HOST_SUFFIX = ".githubusercontent.com"
TRUSTED_HOSTS = {"github.com", "api.github.com"}

_VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$")


def platform_tag():
    """
    Qual artefato de release serve a esta plataforma. `getandroidapilevel` so
    existe num CPython compilado para Android, entao distingue o Chaquopy de um
    Linux comum -- ao contrario de sys.platform, que devolve "linux" nos dois.
    """
    if sys.platform == "win32":
        return "windows"
    if hasattr(sys, "getandroidapilevel"):
        return "android"
    return "outro"


def update_mode():
    """Como a interface deve oferecer a atualizacao. Decidido aqui, no Python:
    o JS nao deve inferir plataforma, so renderizar o modo."""
    return "install" if platform_tag() == "android" else "link"


def parse_version(raw):
    """
    (major, minor, patch, 1) -- ou 0 no lugar do 1 quando ha pre-release, para
    que 1.3.0-rc1 ordene ANTES de 1.3.0. Nao e SemVer completo (nao compara o
    conteudo do pre-release entre si), e nao precisa ser: as tags do projeto sao
    vX.Y.Z limpas. Devolve None para qualquer coisa ilegivel -- o "dev" que o
    workflow_dispatch produz, por exemplo -- e quem chama trata como "nao
    comparavel" em vez de adivinhar.
    """
    match = _VERSION_RE.match((raw or "").strip())
    if not match:
        return None
    major, minor, patch, prerelease = match.groups()
    return (int(major), int(minor), int(patch), 0 if prerelease else 1)


def is_newer(candidate, current):
    left = parse_version(candidate)
    right = parse_version(current)
    if left is None or right is None:
        return False
    return left > right


def _trusted(url):
    parsed = urlparse(url or "")
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    return host in TRUSTED_HOSTS or host.endswith(TRUSTED_HOST_SUFFIX)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


class UpdateCancelled(Exception):
    pass


class UpdateJob:
    """
    Uma operacao por vez (checagem ou download). O estado inteiro e devolvido
    cru em GET /api/update/status, no mesmo desenho do ScrapeJob -- inclusive a
    regra de ouro: a REDE NUNCA ACONTECE NUM HANDLER GET. `_api_get` em
    server.py nao tem try/except nenhum, entao uma excecao ali derrubaria a
    conexao sem resposta JSON, com o traceback indo para um stdout que no
    executavel GUI nem existe.
    """

    def __init__(self, current_version):
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._thread = None
        self._state = {
            "phase": "idle",  # idle | checking | downloading | ready | error
            "mode": update_mode(),
            "current": current_version,
            "latest": None,
            "update_available": False,
            "checked_at": None,
            "release_url": None,
            "notes": None,
            "asset_name": None,
            "asset_size": None,
            "downloaded_bytes": 0,
            "file": None,
            "error": None,
            "rate_limited": False,
        }
        self._asset_url = None
        self._load_cache()

    # -------------------------------------------------------------- estado --

    def snapshot(self):
        with self._lock:
            return dict(self._state)

    def _busy(self):
        return self._state["phase"] in ("checking", "downloading")

    # --------------------------------------------------------------- cache --

    def _load_cache(self):
        """
        Sem cache, trocar de aba dispararia tres requisicoes por sessao (o
        rodape existe nas tres paginas) e o limite nao autenticado do GitHub e
        de 60/h por IP.
        """
        try:
            data = json.loads(paths.update_cache_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if isinstance(data, dict):
            self._apply_release(data)

    def _save_cache(self, info):
        try:
            paths.data_dir().mkdir(parents=True, exist_ok=True)
            paths.update_cache_path().write_text(
                json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError:
            # Um cache que nao grava custa uma requisicao a mais na proxima
            # abertura. Nao e motivo para falhar a checagem que acabou de dar
            # certo.
            pass

    def _cache_is_fresh(self):
        stamp = self._state.get("checked_at")
        if not stamp:
            return False
        try:
            checked = datetime.fromisoformat(stamp)
        except ValueError:
            return False
        if checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - checked < CACHE_TTL

    def _apply_release(self, info):
        latest = info.get("latest")
        self._asset_url = info.get("asset_url")
        self._state.update(
            latest=latest,
            update_available=is_newer(latest, self._state["current"]),
            checked_at=info.get("checked_at"),
            release_url=info.get("release_url"),
            notes=info.get("notes"),
            asset_name=info.get("asset_name"),
            asset_size=info.get("asset_size"),
        )

    # ------------------------------------------------------------ controle --

    def check(self, force=False):
        """
        Devolve (iniciou?, ja_rodando?) -- mesmo contrato de duas respostas do
        ScrapeJob.start(). Com o cache fresco e sem force, nao ha rede nenhuma:
        devolve (False, False) e o snapshot ja carregado responde a interface.
        """
        with self._lock:
            if self._busy():
                return False, True
            if not force and self._cache_is_fresh():
                return False, False
            self._state.update(phase="checking", error=None, rate_limited=False)
        self._spawn(self._run_check)
        return True, False

    def download(self):
        with self._lock:
            if self._busy():
                return False, True
            if not self._state["update_available"] or not self._asset_url:
                raise ValueError("não há atualização para baixar")
            self._cancel.clear()
            self._state.update(
                phase="downloading", error=None, downloaded_bytes=0, file=None
            )
        self._spawn(self._run_download)
        return True, False

    def cancel(self):
        with self._lock:
            if self._state["phase"] != "downloading":
                return False
        self._cancel.set()
        return True

    def _spawn(self, target):
        self._thread = threading.Thread(target=target, daemon=True)
        self._thread.start()

    def _fail(self, message, rate_limited=False):
        with self._lock:
            self._state.update(phase="error", error=message, rate_limited=rate_limited)

    # ------------------------------------------------------------- worker --

    def _run_check(self):
        try:
            response = requests.get(
                f"https://api.github.com/repos/{REPO}/releases/latest",
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": f"HardwareScrapper/{self._state['current']}",
                },
                timeout=CHECK_TIMEOUT,
            )
        except requests.RequestException as exc:
            self._fail(f"falha de rede: {exc.__class__.__name__}")
            return

        if response.status_code == 403 and response.headers.get("X-RateLimit-Remaining") == "0":
            self._fail(
                "limite de consultas do GitHub atingido; tente de novo mais tarde",
                rate_limited=True,
            )
            return
        if response.status_code == 404:
            self._fail("nenhuma release publicada ainda")
            return
        if response.status_code != 200:
            self._fail(f"o GitHub respondeu HTTP {response.status_code}")
            return

        try:
            release = response.json()
        except ValueError:
            self._fail("resposta ilegível do GitHub")
            return

        info = self._describe(release)
        self._save_cache(info)
        with self._lock:
            self._apply_release(info)
            self._state.update(phase="idle", error=None)

    def _describe(self, release):
        tag = (release.get("tag_name") or "").strip()
        suffix = ASSET_SUFFIX.get(platform_tag())
        asset = None
        if suffix:
            for candidate in release.get("assets") or []:
                if str(candidate.get("name", "")).endswith(suffix):
                    asset = candidate
                    break
        notes = (release.get("body") or "").strip()
        return {
            "checked_at": _now_iso(),
            "latest": tag.lstrip("v") or None,
            "release_url": release.get("html_url"),
            "notes": notes[:800] or None,
            "asset_name": asset.get("name") if asset else None,
            "asset_url": asset.get("browser_download_url") if asset else None,
            "asset_size": asset.get("size") if asset else None,
        }

    def _run_download(self):
        target = paths.download_dir() / self._state["asset_name"]
        partial = target.with_name(target.name + ".part")
        try:
            paths.download_dir().mkdir(parents=True, exist_ok=True)
            self._prune(keep=target.name)
            self._stream_to(partial)
            self._verify(partial)
            partial.replace(target)
        except UpdateCancelled:
            partial.unlink(missing_ok=True)
            with self._lock:
                self._state.update(phase="idle", downloaded_bytes=0, file=None)
            return
        except requests.RequestException as exc:
            partial.unlink(missing_ok=True)
            self._fail(f"falha de rede: {exc.__class__.__name__}")
            return
        except (OSError, ValueError) as exc:
            partial.unlink(missing_ok=True)
            self._fail(str(exc))
            return

        with self._lock:
            self._state.update(phase="ready", file=str(target), error=None)

    def _stream_to(self, destination):
        with requests.get(
            self._asset_url,
            stream=True,
            timeout=DOWNLOAD_TIMEOUT,
            headers={"User-Agent": f"HardwareScrapper/{self._state['current']}"},
        ) as response:
            # Com stream=True so os cabecalhos chegaram ate aqui, entao a
            # checagem acontece ANTES de escrever um byte. `history` cobre cada
            # salto do redirecionamento: o requests segue https -> http sem
            # reclamar, e o destino final e o unico que resp.url mostraria.
            for hop in list(response.history) + [response]:
                if not _trusted(hop.url):
                    raise ValueError("o download foi redirecionado para um endereço não confiável")
            response.raise_for_status()

            declared = self._state["asset_size"]
            limit = min(int(declared * 1.1), MAX_ASSET_BYTES) if declared else MAX_ASSET_BYTES
            written = 0
            with destination.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=CHUNK_BYTES):
                    if self._cancel.is_set():
                        raise UpdateCancelled()
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > limit:
                        raise ValueError("o arquivo veio maior do que o anunciado")
                    handle.write(chunk)
                    with self._lock:
                        self._state["downloaded_bytes"] = written

    def _verify(self, downloaded):
        declared = self._state["asset_size"]
        actual = downloaded.stat().st_size
        if declared and actual != declared:
            raise ValueError("o download ficou incompleto")
        # APK e zip sao a mesma coisa por baixo; o magic pega o caso em que um
        # portal cativo de wi-fi devolveu uma pagina HTML com status 200.
        with downloaded.open("rb") as handle:
            if handle.read(4) != b"PK\x03\x04":
                raise ValueError("o arquivo baixado não é um pacote válido")

    def _prune(self, keep):
        """Uma atualizacao antiga baixada e lixo de dezenas de MB -- no Android,
        dentro do cache do app."""
        try:
            for leftover in paths.download_dir().iterdir():
                if leftover.is_file() and leftover.name != keep:
                    leftover.unlink(missing_ok=True)
        except OSError:
            pass
