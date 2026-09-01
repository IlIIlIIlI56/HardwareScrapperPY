"""
Sequencia de inicializacao do backend, compartilhada entre a janela Windows
(app.py) e o app Android (android_entry.py): garantir `dados/`, importar o
scraper, e subir o servidor local. Extraido de app.py para as duas cascas
nativas chamarem a mesma logica em vez de duas copias divergindo com o tempo.
"""

import sys

from . import paths
from .scrape_job import ScrapeJob
from . import server as server_module


def load_scraper():
    """
    Importa scraper/scrape_comprasparaguai.py. Os arquivos de scraper/ se
    importam entre si por nome solto (`from spec_extractor import ...`), entao
    a pasta precisa estar no sys.path -- transforma-los num pacote quebraria a
    execucao deles pela linha de comando, que continua sendo o caminho de
    depuracao.
    """
    scraper_dir = str(paths.scraper_dir())
    if scraper_dir not in sys.path:
        sys.path.insert(0, scraper_dir)
    import scrape_comprasparaguai

    return scrape_comprasparaguai


def start_backend(version):
    """
    Garante `dados/`, importa o scraper e sobe o AppServer. Devolve
    (app_server, url, seeded) -- `seeded` e a lista de arquivos copiados na
    primeira execucao, para quem chama decidir como logar isso.
    """
    seeded = paths.ensure_user_data()
    scraper = load_scraper()
    job = ScrapeJob(scraper, paths.products_path())
    app_server = server_module.AppServer(job, version=version)
    url = app_server.start()
    return app_server, url, seeded
