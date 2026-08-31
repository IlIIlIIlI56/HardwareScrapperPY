"""
Coleta em segundo plano, por tras do botao "Coletar dados agora".

Herdeiro direto do antigo scraper/trigger_server.py, com tres diferencas que
so fazem sentido dentro de um aplicativo:

  * nao ha mais um servidor separado para o usuario esquecer de iniciar -- a
    coleta e uma thread do proprio processo da janela, entao o botao nunca
    mais mostra "servidor nao encontrado";
  * da para CANCELAR. Uma coleta completa sao algumas centenas de requisicoes
    e alguns minutos; antes, desistir no meio significava fechar o terminal;
  * "Reiniciar coleta" nao apaga mais nada antes da hora. A versao anterior
    apagava products.json ANTES de raspar, entao uma falha de rede no meio
    deixava o usuario sem os dados novos E sem os antigos. Agora o arquivo so
    e substituido quando a coleta nova termina inteira e com sucesso.
"""

import contextlib
import io
import sys
import threading
from datetime import datetime, timezone

MAX_LOG_LINES = 500


class _LiveLogStream(io.TextIOBase):
    """
    Captura os prints do scraper linha a linha, para a UI mostrar o progresso
    ao vivo, e repassa tudo para o console.

    O repasse importa por dois motivos. `contextlib.redirect_stdout` troca
    `sys.stdout` do PROCESSO inteiro, nao da thread -- entao, enquanto a coleta
    roda, qualquer print de outra parte do programa tambem cai aqui. Sem o
    passthrough esses prints simplesmente sumiriam. E, no modo --headless, o
    console e a unica janela que existe: engolir o progresso da coleta deixaria
    a tela parada por minutos sem sinal nenhum de vida.
    """

    def __init__(self, sink, passthrough=None):
        self._sink = sink
        self._passthrough = passthrough

    def write(self, chunk):
        if chunk and chunk.strip():
            for line in chunk.splitlines():
                if line.strip():
                    self._sink(line)
        if self._passthrough is not None:
            try:
                self._passthrough.write(chunk)
            except (OSError, ValueError):
                # Sem console anexado (o executavel e compilado como GUI, entao
                # stdout pode ser um handle invalido) -- o log da UI basta.
                self._passthrough = None
        return len(chunk)

    def flush(self):
        if self._passthrough is not None:
            try:
                self._passthrough.flush()
            except (OSError, ValueError):
                self._passthrough = None


class ScrapeJob:
    """
    Uma coleta por vez. O estado inteiro e devolvido cru para o front-end em
    GET /api/status; o polling la e o unico consumidor.
    """

    def __init__(self, scraper_module, products_path):
        self._scraper = scraper_module
        self._products_path = products_path
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._thread = None
        self._state = {
            "running": False,
            "cancelling": False,
            "cancelled": False,
            "log": [],
            "error": None,
            "result": None,
            "started_at": None,
            "finished_at": None,
        }

    # ------------------------------------------------------------- estado --

    def snapshot(self):
        with self._lock:
            state = dict(self._state)
            state["log"] = list(state["log"])
            return state

    def _log(self, line):
        with self._lock:
            self._state["log"].append(line)
            del self._state["log"][:-MAX_LOG_LINES]

    # ------------------------------------------------------------ controle --

    def start(self, reset=False):
        """
        Dispara a coleta. Devolve (iniciou?, ja_rodando?) -- nunca enfileira
        uma segunda: dois scrapers gravando o mesmo arquivo se atropelariam.
        """
        with self._lock:
            if self._state["running"]:
                return False, True
            self._cancel.clear()
            self._state.update(
                running=True,
                cancelling=False,
                cancelled=False,
                log=[],
                error=None,
                result=None,
                started_at=datetime.now(timezone.utc).isoformat(),
                finished_at=None,
            )
        self._thread = threading.Thread(target=self._run, args=(reset,), daemon=True)
        self._thread.start()
        return True, False

    def cancel(self):
        """Pede parada. O scraper so olha isso entre paginas, entao pode levar
        alguns segundos ate a requisicao em voo terminar."""
        with self._lock:
            if not self._state["running"]:
                return False
            self._state["cancelling"] = True
        self._cancel.set()
        self._log("[cancelando] aguardando a pagina atual terminar...")
        return True

    # -------------------------------------------------------------- worker --

    def _run(self, reset):
        error = None
        result = None
        cancelled = False

        if reset:
            # Diferente da versao antiga, "reiniciar" nao apaga o arquivo aqui:
            # ele so anuncia a intencao. run_scrape sobrescreve products.json
            # inteiro no final, entao apagar antes so criaria uma janela em que
            # uma falha de rede custaria os dados antigos tambem.
            self._log("[reiniciar] coletando tudo de novo do zero; os dados atuais so serao substituidos no fim.")

        try:
            with contextlib.redirect_stdout(_LiveLogStream(self._log, sys.stdout)):
                data = self._scraper.run_scrape(
                    delay=0.5,
                    output_path=str(self._products_path),
                    should_stop=self._cancel.is_set,
                )
            result = {
                "total_products": data["total_products"],
                "counts_by_category": data["counts_by_category"],
                "scraped_at": data["scraped_at"],
            }
        except self._scraper.ScrapeCancelled:
            cancelled = True
            self._log("[cancelado] nada foi gravado -- os dados anteriores continuam intactos.")
        except Exception as exc:  # rede, parsing, disco: tudo vira mensagem na UI
            error = f"{type(exc).__name__}: {exc}"
            self._log(f"[erro] {error}")
        finally:
            with self._lock:
                self._state.update(
                    running=False,
                    cancelling=False,
                    cancelled=cancelled,
                    error=error,
                    result=result,
                    finished_at=datetime.now(timezone.utc).isoformat(),
                )
