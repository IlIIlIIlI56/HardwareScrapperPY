"""
Builds de Custo-Beneficio -- ponto de entrada do aplicativo.

Este arquivo e tudo que o usuario final executa. Ele:

  1. garante a pasta `dados/` ao lado do executavel (e a semeia, na primeira
     vez, com a base de benchmarks curada que acompanha o app);
  2. sobe o servidor local que serve a interface e a API de coleta;
  3. abre uma janela nativa apontada para esse servidor.

O que mudou em relacao ao formato anterior: a ferramenta era um site estatico
que exigia a extensao Live Server do VSCode para carregar os JSONs, mais um
segundo terminal rodando trigger_server.py para o botao de coleta funcionar.
Eram tres coisas para o usuario acertar antes de ver qualquer build. Agora e um
processo so, e nenhuma delas.

Modos:

    python app.py              abre a janela (o normal)
    python app.py --headless   so o servidor, imprime a URL e espera Ctrl+C.
                               Serve para depurar a interface num navegador de
                               verdade, com DevTools completo.
    python app.py --debug      janela com o DevTools do WebView2 habilitado
"""

import argparse
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

from appcore import bootstrap, paths

APP_VERSION = "1.1.0"
WINDOW_TITLE = "Builds de Custo-Beneficio"

# Nome da janela no Windows: "HardwareScrapper - <aba atual>". O mapeamento e
# pelo nome do arquivo HTML porque cada aba e uma pagina servida de verdade
# (nao uma SPA), entao trocar de aba dispara um novo evento `loaded`.
APP_NAME = "HardwareScrapper"
TAB_TITLES = {
    "index.html": "Análise",
    "catalogo.html": "Base de dados",
    "build.html": "Build",
}


def _tab_title_for_url(url):
    if not url:
        return None
    page = urlsplit(url).path.rsplit("/", 1)[-1] or "index.html"
    return TAB_TITLES.get(page)


def _sync_window_title(window):
    tab = _tab_title_for_url(window.get_current_url())
    window.title = f"{APP_NAME} - {tab}" if tab else APP_NAME


def open_window(url, debug=False):
    """
    Janela nativa via pywebview (WebView2, o motor do Edge, ja presente em
    qualquer Windows 10/11 atualizado).

    `private_mode=False` + `storage_path` dentro de `dados/` sao o par que
    torna a curadoria portatil: toda a revisao do usuario vive no localStorage
    da pagina, e o padrao do pywebview e guardar isso em %LOCALAPPDATA% -- que
    ficaria para tras assim que a pasta do app fosse copiada para outra
    maquina, justamente o caso de uso de um app portatil.
    """
    import webview

    window = webview.create_window(
        APP_NAME,
        url,
        width=1360,
        height=900,
        min_size=(960, 640),
        confirm_close=False,
    )
    window.events.loaded += _sync_window_title
    profile = paths.webview_profile_dir()
    profile.mkdir(parents=True, exist_ok=True)
    webview.start(private_mode=False, storage_path=str(profile), debug=debug)
    return window


def open_fallback_window(url):
    """
    Sem pywebview (ou com WebView2 ausente), o app ainda abre: o Edge em modo
    --app da uma janela sem barra de enderecos nem abas, o que fica bem perto
    de uma janela nativa. Se nem isso, cai no navegador padrao -- feio, mas
    funcional, e melhor que uma mensagem de erro.
    """
    import subprocess

    candidates = [
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    ]
    for edge in candidates:
        if edge.is_file():
            subprocess.Popen([str(edge), f"--app={url}", "--window-size=1360,900"])
            return True
    webbrowser.open(url)
    return False


def main():
    parser = argparse.ArgumentParser(description=WINDOW_TITLE)
    parser.add_argument("--headless", action="store_true",
                        help="so o servidor local, sem abrir janela")
    parser.add_argument("--debug", action="store_true",
                        help="habilita o DevTools na janela")
    args = parser.parse_args()

    app_server, url, seeded = bootstrap.start_backend(APP_VERSION)
    if seeded:
        print(f"Primeira execucao: {', '.join(seeded)} copiados para {paths.data_dir()}")

    print(f"{WINDOW_TITLE} v{APP_VERSION}")
    print(f"  interface: {url}")
    print(f"  dados:     {paths.data_dir()}")

    if args.headless:
        print("\nModo --headless: abra a URL acima no navegador. Ctrl+C para encerrar.")
        try:
            app_server.quit_event.wait()
        except KeyboardInterrupt:
            pass
        app_server.stop()
        return 0

    try:
        # O botao "Sair" da interface (POST /api/quit) so consegue sinalizar um
        # evento; quem sabe fechar a janela e o processo principal.
        def watch_quit():
            app_server.quit_event.wait()
            try:
                import webview

                for window in webview.windows:
                    window.destroy()
            except Exception:
                pass

        threading.Thread(target=watch_quit, daemon=True).start()
        open_window(url, debug=args.debug)
    except Exception as exc:
        print(f"[aviso] janela nativa indisponivel ({type(exc).__name__}: {exc}); abrindo no Edge.")
        open_fallback_window(url)
        try:
            app_server.quit_event.wait()
        except KeyboardInterrupt:
            pass

    app_server.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
