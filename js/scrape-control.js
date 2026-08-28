/**
 * Botao "Coletar dados agora" na pagina de builds. Um navegador nao pode
 * executar o scraper Python diretamente (sem API para rodar processos
 * locais) -- por isso este modulo fala com um servidor local minimo
 * (scraper/trigger_server.py, so biblioteca padrao do Python) que roda o
 * scraper em segundo piano e devolve o progresso. Se esse servidor nao
 * estiver de pe, mostramos o comando exato para iniciar.
 *
 * Uma vez que ja existam dados coletados em data/products.json, o mesmo
 * botao vira "Reiniciar coleta": pede confirmacao, avisa o servidor para
 * apagar o arquivo atual antes de raspar de novo (`POST /scrape?reset=1`,
 * ver trigger_server.py) e so entao comeca uma coleta nova do zero.
 */

/*
 * Envolvido numa IIFE pelo mesmo motivo dos outros modulos: scripts classicos
 * dividem um unico escopo global de pagina, e nomes soltos aqui colidiriam com
 * os de app.js. Este arquivo nao expoe nada -- ele so se liga ao botao.
 */
(function () {
  const TRIGGER_BASE = "http://127.0.0.1:8787";
  const POLL_INTERVAL_MS = 1500;
  const DATA_PRODUCTS_PATH = "./data/products.json";

  let pollHandle = null;

  /**
   * Se ja existem dados coletados (data/products.json com produtos), o botao
   * vira "Reiniciar coleta" -- clicar nele apaga tudo e comeca do zero, em vez
   * de meramente atualizar por cima. Checado direto no arquivo (nao no estado
   * em memoria do trigger_server, que reseta quando o servidor e reiniciado)
   * para refletir o que realmente esta em disco.
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

  function idleLabel(hasData) {
    return hasData ? "Reiniciar coleta" : "Coletar dados agora";
  }

  async function fetchStatus() {
    try {
      const res = await fetch(`${TRIGGER_BASE}/status`, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function renderIdle(refs, serverReachable, hasData) {
    refs.btn.disabled = false;
    refs.btn.textContent = idleLabel(hasData);
    refs.indicator.textContent = "";
    refs.indicator.className = "scrape-indicator";
    refs.log.hidden = true;
    refs.help.hidden = serverReachable;
  }

  function renderRunning(refs, state) {
    refs.btn.disabled = true;
    refs.btn.textContent = "Coletando...";
    refs.indicator.textContent = "rodando";
    refs.indicator.className = "scrape-indicator scrape-indicator--running";
    refs.help.hidden = true;
    refs.log.hidden = false;
    refs.log.textContent = (state.log || []).slice(-12).join("\n");
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  async function renderFinished(refs, state) {
    refs.btn.disabled = false;
    refs.btn.textContent = idleLabel(await hasExistingData());
    refs.log.hidden = false;
    refs.log.textContent = (state.log || []).slice(-12).join("\n");

    if (state.error) {
      refs.indicator.textContent = "erro";
      refs.indicator.className = "scrape-indicator scrape-indicator--error";
    } else if (state.result) {
      refs.indicator.textContent = `concluido -- ${state.result.total_products} produtos`;
      refs.indicator.className = "scrape-indicator scrape-indicator--ok";
    }
  }

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  /**
   * Tenta capturar o `started_at` da execucao que ACABAMOS de disparar,
   * repetindo /status ate ve-la "running" (o thread de fundo grava isso sob
   * lock antes de qualquer outra coisa, entao normalmente aparece ja na
   * primeira tentativa). Sem isso, se o POST /scrape nao chegou a iniciar uma
   * nova coleta de verdade (servidor desatualizado, erro, etc.), a primeira
   * leitura de /status pode ainda trazer o `result` de uma coleta ANTERIOR --
   * e o polling abaixo confundiria isso com "a coleta que acabei de pedir ja
   * terminou", recarregando a pagina sem os dados terem mudado de fato.
   */
  async function captureRunBaseline() {
    for (let i = 0; i < 5; i++) {
      const s = await fetchStatus();
      if (s && s.running) return s.started_at;
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
      // so trata como "terminou" se for a MESMA execucao que baselineStartedAt
      // identificou (ou se nao foi possivel capturar um baseline) -- evita
      // reagir a um resultado antigo que ja estava ali antes deste clique.
      if (baselineStartedAt != null && state.started_at !== baselineStartedAt) return;
      renderFinished(refs, state);
      stopPolling();
      if (!notified && (state.result || state.error)) {
        notified = true;
        onFinishedOnce(state);
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleClick(refs) {
    const isReset = await hasExistingData();
    if (isReset) {
      const confirmed = window.confirm(
        "Isso vai apagar todos os dados coletados atualmente (data/products.json) e iniciar uma nova coleta do zero. Continuar?"
      );
      if (!confirmed) return;
    }

    const query = isReset ? "?reset=1" : "";
    refs.btn.disabled = true;
    refs.btn.textContent = "Iniciando...";
    let res;
    try {
      res = await fetch(`${TRIGGER_BASE}/scrape${query}`, { method: "POST" });
    } catch {
      refs.btn.disabled = false;
      refs.btn.textContent = idleLabel(isReset);
      refs.help.hidden = false;
      return;
    }
    if (!res.ok) {
      // endpoint nao respondeu como esperado (ex: servidor rodando uma versao
      // antiga do trigger_server.py, sem suporte a "?reset=1") -- avisa em vez
      // de seguir como se a coleta tivesse comecado.
      refs.btn.disabled = false;
      refs.btn.textContent = idleLabel(isReset);
      refs.log.hidden = false;
      refs.log.textContent =
        `[erro] POST /scrape${query} respondeu HTTP ${res.status}. O servidor de coleta ` +
        `provavelmente esta rodando uma versao antiga -- pare-o (Ctrl+C) e rode ` +
        `"python trigger_server.py" de novo.`;
      return;
    }

    const baselineStartedAt = await captureRunBaseline();
    startPolling(refs, baselineStartedAt, (state) => {
      if (state.result) {
        // recarrega a pagina para reprocessar o pipeline com os dados novos
        setTimeout(() => window.location.reload(), 1200);
      }
    });
  }

  async function initScrapeControl() {
    const refs = {
      btn: document.getElementById("scrape-btn"),
      indicator: document.getElementById("scrape-indicator"),
      log: document.getElementById("scrape-log"),
      help: document.getElementById("scrape-help"),
    };
    if (!refs.btn) return;

    refs.btn.addEventListener("click", () => handleClick(refs));

    const initial = await fetchStatus();
    if (!initial) {
      renderIdle(refs, false, await hasExistingData());
      return;
    }
    if (initial.running) {
      renderRunning(refs, initial);
      // ja estava rodando quando a pagina abriu (ex: outra aba disparou) --
      // nao ha um "baseline" desta pagina para comparar, so observa o que
      // aparecer quando terminar.
      startPolling(refs, null, (state) => {
        if (state.result) setTimeout(() => window.location.reload(), 1200);
      });
    } else if (initial.result || initial.error) {
      await renderFinished(refs, initial);
    } else {
      renderIdle(refs, true, await hasExistingData());
    }
  }

  initScrapeControl();
})();
