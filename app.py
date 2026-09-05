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
import ctypes
import os
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from appcore import bootstrap, paths

APP_VERSION = "1.2.4"
WINDOW_TITLE = "Builds de Custo-Beneficio"

# Nome da janela no Windows: "HardwareScrapper - <aba atual>". O mapeamento e
# pelo nome do arquivo HTML porque cada aba e uma pagina servida de verdade
# (nao uma SPA), entao trocar de aba dispara um novo evento `loaded`.
APP_NAME = "HardwareScrapper"
TAB_TITLES = {
    "index.html": "Análise",
    "catalogo.html": "Database",
    "build.html": "Build",
}


def _tab_title_for_url(url):
    if not url:
        return None
    page = urlsplit(url).path.rsplit("/", 1)[-1] or "index.html"
    return TAB_TITLES.get(page)


def _debug_log(message):
    """
    Diagnostico temporario para o bug do titulo da janela errado em alguns
    Windows (mostra o <title> cru da pagina em vez de "HardwareScrapper - X").
    Duas tentativas de correcao as cegas (reforcar a atribuicao, reaplicar
    depois de meio segundo) nao resolveram, entao em vez de arriscar uma
    terceira este build grava evidencia de verdade em dados/debug-titulo.log
    -- sem precisar rodar nenhum script, basta abrir o arquivo. Remover depois
    que o caso for entendido.
    """
    try:
        line = f"{datetime.now(timezone.utc).isoformat()} {message}\n"
        with (paths.data_dir() / "debug-titulo.log").open("a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError:
        pass


def _native_titles_for_this_process():
    """
    Le de volta, direto do Win32 (GetWindowText), os titulos de todas as
    janelas visiveis deste PROPRIO processo -- ao contrario de `window.title`
    do pywebview, que so devolve o ultimo valor que NOS escrevemos em Python e
    nao percebe se algo por baixo trocou a legenda de novo depois.
    """
    user32 = ctypes.windll.user32
    pid = ctypes.c_ulong()
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def enum_proc(hwnd, _lparam):
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == _CURRENT_PID and user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                found.append(buf.value)
        return True

    user32.EnumWindows(enum_proc, 0)
    return found


_CURRENT_PID = os.getpid()


def _sync_window_title(window):
    """
    Chamado no evento `loaded` do pywebview. Duas correcoes anteriores
    (reforcar a atribuicao logo em seguida, reaplicar meio segundo depois)
    nao resolveram o titulo errado observado em builds publicadas -- entao
    esta versao, alem de continuar reaplicando, GRAVA evidencia de verdade em
    dados/debug-titulo.log a cada tentativa: a URL que o pywebview acha que
    esta carregada, o titulo que mandamos escrever, e o titulo REAL da janela
    lido de volta via Win32 logo em seguida. Ver _debug_log.
    """

    def apply(tag):
        tab = _tab_title_for_url(window.get_current_url())
        new_title = f"{APP_NAME} - {tab}" if tab else APP_NAME
        window.title = new_title
        _debug_log(
            f"[{tag}] get_current_url={window.get_current_url()!r} "
            f"tab={tab!r} title_escrito={new_title!r} "
            f"titulo_real_apos_escrever={_native_titles_for_this_process()!r}"
        )

    apply("imediato")
    for delay in (0.5, 2.0, 5.0):
        timer = threading.Timer(delay, apply, args=(f"reforco+{delay}s",))
        timer.daemon = True
        timer.start()


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


def _acquire_single_instance_lock():
    """
    Impede uma segunda copia da janela de abrir por cima da primeira.

    O WebView2 pode levar alguns segundos para subir na primeira vez
    (cold start), e sem essa trava um duplo-clique impaciente durante essa
    espera nao reabre a janela existente -- abre uma copia INTEIRA nova, com
    seu proprio servidor local e sua propria janela. Clicar mais de uma vez
    empilha 3, 4 processos "HardwareScrapper.exe" independentes, a maioria
    escondida atras da primeira janela, e o usuario so descobre isso quando
    o Gerenciador de Tarefas mostra varios e a pasta se recusa a ser movida
    ou apagada porque um deles ainda esta com ela aberta.

    Um Mutex nomeado do Windows (e nao um arquivo de lock em dados/) e a
    escolha certa: o proprio SO libera automaticamente quando o processo
    termina, inclusive num crash -- um arquivo ficaria "preso" apontando para
    um PID que nao existe mais, e teria que lidar com esse caso a mao.
    """
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW(None, False, "Global\\HardwareScrapper-SingleInstance")
    already_running = ctypes.get_last_error() == 183  # ERROR_ALREADY_EXISTS
    return already_running


def main():
    parser = argparse.ArgumentParser(description=WINDOW_TITLE)
    parser.add_argument("--headless", action="store_true",
                        help="so o servidor local, sem abrir janela")
    parser.add_argument("--debug", action="store_true",
                        help="habilita o DevTools na janela")
    args = parser.parse_args()

    if not args.headless and _acquire_single_instance_lock():
        message = "O HardwareScrapper ja esta aberto -- feche a janela existente antes de abrir outra."
        print(message)
        ctypes.windll.user32.MessageBoxW(None, message, WINDOW_TITLE, 0x40)  # MB_ICONINFORMATION
        return 1

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
