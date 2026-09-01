"""
Ponto de entrada chamado pelo lado Kotlin do app Android (via Chaquopy), no
lugar do que `app.py` faz para a janela Windows.

Diferenca central para o Windows: os recursos somente-leitura (index.html,
css/, js/, scraper/) vivem numa arvore que o Chaquopy pode recriar a cada
atualizacao do app, entao os dados do usuario (`dados/`) nao podem ser
derivados dela por `__file__` como no modo "rodando por codigo-fonte" -- por
isso o Kotlin precisa informar explicitamente uma pasta estavel (o
`getFilesDir()` do Android, que sobrevive a atualizacoes e so some se o app
for desinstalado).

Mantido vivo enquanto o processo do app existir: guarda a instancia do
AppServer aqui no modulo para nao ser coletado pelo GC nem recriado a cada
rotacao de tela da Activity.
"""

from . import paths
from .bootstrap import start_backend

_app_server = None


def start(data_dir, version="1.0.0"):
    """
    Chamado uma unica vez por processo. Devolve a URL a carregar na WebView.
    Uma segunda chamada (ex.: Activity recriada por rotacao de tela) devolve a
    mesma URL do servidor ja em pe, em vez de subir um segundo servidor numa
    porta nova.
    """
    global _app_server
    if _app_server is not None:
        return _app_server.url

    paths.configure(data_dir=data_dir)
    _app_server, url, _seeded = start_backend(version)
    return url


def stop():
    global _app_server
    if _app_server is not None:
        _app_server.stop()
        _app_server = None
