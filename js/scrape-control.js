/**
 * Painel "Coleta de dados" da pagina de builds.
 *
 * A coleta roda numa thread do proprio processo do aplicativo
 * (appcore/scrape_job.py) e este modulo so a comanda e mostra o progresso.
 * Antes ele falava com um segundo servidor Python, em porta fixa, que o
 * usuario tinha que lembrar de iniciar num terminal separado -- dai todo o
 * codigo que existia aqui para detectar "servidor nao encontrado" e ensinar o
 * comando certo. Dentro do app isso nao pode acontecer: se a pagina carregou,
 * o Python que raspa esta rodando.
 *
 * O que sobrou de logica real:
 *
 *   - "Coletar dados agora" na primeira vez; "Reiniciar coleta" (com
 *     confirmacao) depois que ja existem dados;
 *   - "Cancelar", que nao existia. Uma coleta completa sao centenas de
 *     requisicoes e alguns minutos, e desistir no meio exigia fechar o
 *     terminal;
 *   - o baseline de `started_at`, que continua necessario: sem ele o primeiro
 *     /api/status depois do clique pode devolver o resultado da coleta
 *     ANTERIOR, e o polling recarregaria a pagina achando que a nova ja
 *     terminou.
 */
(function () {
  const POLL_INTERVAL_MS = 1200;
  // Caminho de URL, nao de disco: o servidor do app mapeia /data/ para a
  // pasta dados/ do usuario (ver appcore/server.py).
  const DATA_PRODUCTS_PATH = "/data/products.json";
  const LOG_LINES = 14;

  let pollHandle = null;

  /**
   * Ja existem dados coletados? Checado no arquivo, e nao no estado em memoria
   * do processo -- este ultimo zera quando o app e reaberto, e o rotulo do
   * botao ficaria dizendo "Coletar dados agora" sobre uma base cheia.
   */
  async function hasExistingData() {
    try {
      const res = await fetch(DATA_PRODUCTS_PATH, { cache: "no-store" });
      if (!res.ok) return false;
      const data = await res.json();
      return (data.total_products || 0) > 0;
    } catch {
      return false;
    }
  }

  const idleLabel = (hasData) => (hasData ? "Reiniciar coleta" : "Coletar dados agora");

  async function fetchStatus() {
    const state = await HWApp.api("/api/status");
    return state && state.ok ? state : null;
  }

  function setIndicator(refs, text, modifier) {
    refs.indicator.textContent = text;
    refs.indicator.className = modifier ? `scrape-indicator scrape-indicator--${modifier}` : "scrape-indicator";
  }

  function showLog(refs, state) {
    const lines = state.log || [];
    refs.log.hidden = lines.length === 0;
    refs.log.textContent = lines.slice(-LOG_LINES).join("\n");
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  function renderIdle(refs, hasData) {
    refs.btn.disabled = false;
    refs.btn.textContent = idleLabel(hasData);
    refs.cancel.hidden = true;
    setIndicator(refs, "", null);
    refs.log.hidden = true;
  }

  function renderRunning(refs, state) {
    refs.btn.disabled = true;
    refs.btn.textContent = "Coletando...";
    refs.cancel.hidden = false;
    refs.cancel.disabled = Boolean(state.cancelling);
    refs.cancel.textContent = state.cancelling ? "Cancelando..." : "Cancelar";
    setIndicator(refs, state.cancelling ? "cancelando" : "rodando", "running");
    showLog(refs, state);
  }

  async function renderFinished(refs, state) {
    refs.btn.disabled = false;
    refs.btn.textContent = idleLabel(await hasExistingData());
    refs.cancel.hidden = true;
    showLog(refs, state);

    if (state.error) {
      setIndicator(refs, "erro na coleta", "error");
    } else if (state.cancelled) {
      // Cancelar nao grava nada, entao a base anterior segue valida -- dizer
      // isso aqui evita a duvida de "perdi os dados?".
      setIndicator(refs, "cancelado — dados anteriores mantidos", null);
    } else if (state.result) {
      setIndicator(refs, `concluído — ${state.result.total_products} produtos`, "ok");
    }
  }

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  /**
   * Tenta capturar o `started_at` da execucao que acabamos de disparar,
   * repetindo /api/status ate ve-la "running" (o worker grava isso sob lock
   * antes de qualquer outra coisa, entao normalmente aparece ja na primeira
   * tentativa). Ver o comentario do cabecalho para o porque.
   */
  async function captureRunBaseline() {
    for (let i = 0; i < 5; i++) {
      const state = await fetchStatus();
      if (state && state.running) return state.started_at;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return null; // nao deu para confirmar -- segue sem a garantia extra
  }

  function startPolling(refs, baselineStartedAt, onFinishedOnce) {
    stopPolling();
    let notified = false;
    pollHandle = setInterval(async () => {
      const state = await fetchStatus();
      if (!state) return;
      if (state.running) {
        renderRunning(refs, state);
        return;
      }
      if (baselineStartedAt != null && state.started_at !== baselineStartedAt) return;
      renderFinished(refs, state);
      stopPolling();
      if (!notified && (state.result || state.error || state.cancelled)) {
        notified = true;
        onFinishedOnce(state);
      }
    }, POLL_INTERVAL_MS);
  }

  /** Recarrega so quando a coleta gravou dados novos de verdade. */
  function reloadIfChanged(state) {
    if (state.result) setTimeout(() => window.location.reload(), 1000);
  }

  async function runScrape(refs, isReset) {
    refs.btn.disabled = true;
    refs.btn.textContent = "Iniciando...";
    const res = await HWApp.api(`/api/scrape${isReset ? "?reset=1" : ""}`, { method: "POST" });
    if (!res || !res.ok) {
      refs.btn.disabled = false;
      refs.btn.textContent = idleLabel(isReset);
      refs.log.hidden = false;
      refs.log.textContent = `[erro] não foi possível iniciar a coleta${res ? ` (HTTP ${res.status})` : ""}.`;
      return;
    }

    startPolling(refs, await captureRunBaseline(), reloadIfChanged);
  }

  /**
   * Modal customizado em vez de `window.confirm()`: a WebView do Android so
   * mostra dialogos nativos de JS (confirm/alert/prompt) se o app anfitriao
   * registrar um WebChromeClient para eles, o que o MainActivity.kt nao faz --
   * sem isso `confirm()` e descartado na hora, sempre devolvendo `false`, e o
   * botao parece simplesmente nao fazer nada. `HWUi.openModal` e HTML/CSS
   * comum, entao funciona identico em qualquer WebView (e e o mesmo padrao ja
   * usado pelos outros dialogos de confirmacao do app -- ver app-chrome.js e
   * pc-builder.js).
   */
  async function handleStart(refs) {
    const isReset = await hasExistingData();
    if (!isReset) {
      await runScrape(refs, false);
      return;
    }

    HWUi.openModal({
      title: "Reiniciar a coleta?",
      subtitle: "Isso vai coletar tudo de novo do zero.",
      render: (body) => {
        body.appendChild(
          HWUi.el(
            "p",
            null,
            "A base atual só é substituída quando a coleta nova terminar com sucesso. Suas revisões e entradas de benchmark não são afetadas."
          )
        );
      },
      actions: [
        { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
        {
          label: "Reiniciar coleta",
          className: "btn-primary",
          onClick: (close) => {
            close();
            runScrape(refs, true);
          },
        },
      ],
    });
  }

  async function handleCancel(refs) {
    refs.cancel.disabled = true;
    refs.cancel.textContent = "Cancelando...";
    await HWApp.api("/api/cancel", { method: "POST" });
  }

  async function initScrapeControl() {
    const refs = {
      panel: document.getElementById("scrape-panel"),
      btn: document.getElementById("scrape-btn"),
      cancel: document.getElementById("scrape-cancel"),
      indicator: document.getElementById("scrape-indicator"),
      log: document.getElementById("scrape-log"),
      outside: document.getElementById("scrape-outside-app"),
    };
    if (!refs.btn) return;

    if (!HWApp.isApp()) {
      // Pagina aberta fora do aplicativo (depuracao de CSS num servidor
      // estatico, por exemplo): sem processo Python, nao ha coleta possivel.
      // Esconder o painel inteiro seria pior -- o usuario procuraria o botao.
      refs.panel.hidden = false;
      refs.btn.hidden = true;
      refs.cancel.hidden = true;
      refs.outside.hidden = false;
      return;
    }

    refs.btn.addEventListener("click", () => handleStart(refs));
    refs.cancel.addEventListener("click", () => handleCancel(refs));

    const initial = await fetchStatus();
    if (!initial) {
      renderIdle(refs, await hasExistingData());
      return;
    }
    if (initial.running) {
      // Ja estava rodando quando a pagina abriu (um F5 no meio da coleta):
      // nao ha baseline desta sessao para comparar, so observa ate terminar.
      renderRunning(refs, initial);
      startPolling(refs, null, reloadIfChanged);
    } else if (initial.result || initial.error || initial.cancelled) {
      await renderFinished(refs, initial);
    } else {
      renderIdle(refs, await hasExistingData());
    }
  }

  initScrapeControl();
})();
