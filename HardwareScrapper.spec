# -*- mode: python ; coding: utf-8 -*-
"""
Receita do PyInstaller para a pasta portatil.

Gera `dist/HardwareScrapper/`, que e a pasta que o usuario copia para onde
quiser -- pendrive incluso. Modo --onedir e nao --onefile de proposito: o
--onefile descompactaria ~40 MB em %TEMP% a cada abertura (segundos de espera
antes da janela aparecer) e o backend .NET/WebView2 do pywebview e conhecido
por tropecar quando as DLLs vem de um diretorio temporario.

Rode pelo build.ps1, que cuida do venv e das dependencias:

    powershell -ExecutionPolicy Bypass -File build.ps1
"""

from PyInstaller.utils.hooks import collect_all

# A interface e um site estatico comum -- ela precisa ir junto como ARQUIVOS,
# nao como modulos, porque quem a le e o servidor HTTP local (appcore/server.py)
# e nao o importador do Python.
#
# `data/` entra so com benchmarks.json: e a base de performance curada, que
# semeia a pasta `dados/` do usuario na primeira execucao. products.json fica
# de fora de proposito -- sao ~1 MB de precos que envelhecem em dias, e a
# primeira coisa que o app faz numa instalacao nova e oferecer a coleta.
datas = [
    ("index.html", "."),
    ("catalogo.html", "."),
    ("build.html", "."),
    ("css", "css"),
    ("js", "js"),
    ("data/benchmarks.json", "data"),
    # Favicon das 3 paginas (<link rel="icon">). So aparece na barra de tarefas
    # do Windows 11 e no Alt+Tab: o icone.ico do proprio .exe (abaixo, via
    # icon=) cobre a janela nativa, mas o WebView2 busca o icone da PAGINA para
    # essas outras superficies -- sem este arquivo, ele cai no globo generico.
    ("assets/icon.ico", "assets"),
]

# O pywebview carrega as DLLs do WebView2 e os assemblies .NET por caminho, em
# tempo de execucao; o analisador estatico do PyInstaller nao tem como ve-los.
webview_datas, webview_binaries, webview_hidden = collect_all("webview")
datas += webview_datas

a = Analysis(
    ["app.py"],
    # Os modulos de scraper/ se importam entre si por nome solto
    # (`from spec_extractor import ...`), entao a pasta precisa ser uma raiz de
    # import -- e nao um pacote, o que quebraria roda-los pela linha de comando.
    pathex=["scraper"],
    binaries=webview_binaries,
    datas=datas,
    hiddenimports=[
        "scrape_comprasparaguai",
        "spec_extractor",
        *webview_hidden,
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Nada aqui e usado pelo app, e cada um custa alguns MB no resultado.
    # setuptools/distutils NAO entram nesta lista de proposito: o proprio
    # PyInstaller os inspeciona durante a analise, e exclui-los faz o build
    # abortar com "Target module already imported as ExcludedModule".
    excludes=[
        "tkinter",
        "unittest",
        "pydoc",
        "doctest",
        "test",
        "lib2to3",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="HardwareScrapper",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # console=False: a janela e a interface. Um console preto abrindo junto
    # denunciaria que isto e um script e nao um programa -- e, no Windows,
    # fecha-lo por engano mataria o app.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="assets/icon.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="HardwareScrapper",
)
