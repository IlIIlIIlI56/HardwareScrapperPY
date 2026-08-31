"""
Descoberta de caminhos do aplicativo portatil.

Um app portatil tem duas arvores de arquivos que NAO podem ser a mesma:

  recursos (somente leitura)  index.html, css/, js/, data/ de exemplo. Quando
                              empacotado pelo PyInstaller isso vive dentro de
                              _internal/ (ou de um diretorio temporario, no
                              modo --onefile) e pode ser apagado/recriado a
                              cada atualizacao do app.

  dados do usuario (escrita)  produtos coletados, benchmarks curados e
                              exportacoes. Precisam sobreviver a uma troca de
                              versao e acompanhar a pasta do app quando ela e
                              copiada para outra maquina ou pendrive -- por
                              isso ficam em `dados/`, AO LADO do executavel, e
                              nunca em %APPDATA%.

Rodando pelo codigo-fonte (`python app.py`) as duas raizes coincidem com a
pasta do projeto, entao o comportamento e identico ao do app empacotado sem
precisar de um "modo de desenvolvimento" separado.
"""

import os
import shutil
import sys
from pathlib import Path

APP_NAME = "HardwareScrapper"
DATA_DIR_NAME = "dados"
EXPORTS_DIR_NAME = "exportacoes"
WEBVIEW_PROFILE_DIR_NAME = "perfil-janela"


def is_frozen():
    """True quando rodando a partir do executavel gerado pelo PyInstaller."""
    return getattr(sys, "frozen", False)


def resource_dir():
    """Raiz dos arquivos somente-leitura que acompanham o app."""
    if is_frozen():
        # _MEIPASS existe nos dois modos do PyInstaller: em --onedir aponta
        # para _internal/, em --onefile para a pasta temporaria extraida.
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def app_dir():
    """
    Pasta onde o usuario ve o app -- a que ele copia para levar embora. E ao
    lado dela que `dados/` e criada, o que e justamente o que torna o app
    portatil: mover a pasta move a curadoria junto.
    """
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def data_dir():
    return app_dir() / DATA_DIR_NAME


def exports_dir():
    return data_dir() / EXPORTS_DIR_NAME


def webview_profile_dir():
    """
    Perfil do WebView2 (onde mora o localStorage com as decisoes de revisao).
    Fica dentro de `dados/` de proposito: o padrao do pywebview e uma pasta em
    %LOCALAPPDATA%, que ficaria para tras quando a pasta do app fosse copiada
    para outra maquina -- e a curadoria inteira vive nesse localStorage.
    """
    return data_dir() / WEBVIEW_PROFILE_DIR_NAME


def products_path():
    return data_dir() / "products.json"


def benchmarks_path():
    return data_dir() / "benchmarks.json"


def scraper_dir():
    return resource_dir() / "scraper"


def ensure_user_data():
    """
    Cria `dados/` e semeia os arquivos que ainda nao existirem a partir dos
    que vieram junto com o app (`data/` nos recursos). So copia o que falta:
    um arquivo ja editado pelo usuario nunca e sobrescrito por uma
    atualizacao do app.

    Devolve a lista de arquivos semeados, para o log da primeira execucao.
    """
    target = data_dir()
    target.mkdir(parents=True, exist_ok=True)
    exports_dir().mkdir(parents=True, exist_ok=True)

    seeded = []
    seed_dir = resource_dir() / "data"
    if seed_dir.is_dir() and seed_dir.resolve() != target.resolve():
        for seed_file in sorted(seed_dir.glob("*.json")):
            destination = target / seed_file.name
            if not destination.exists():
                shutil.copy2(seed_file, destination)
                seeded.append(seed_file.name)
    return seeded


def reveal(path):
    """
    Abre um caminho no Explorer. Usado pelos botoes "abrir pasta" -- sem eles o
    usuario de um app portatil nao tem como saber onde as exportacoes foram
    parar, ja que nao houve uma caixa de dialogo de download.
    """
    path = Path(path)
    if not path.exists():
        return False
    os.startfile(str(path if path.is_dir() else path.parent))  # noqa: S606 - Windows
    return True
