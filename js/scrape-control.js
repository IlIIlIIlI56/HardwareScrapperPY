/**
 * Botao "Coletar dados agora" na pagina de builds. Um navegador nao pode
 * executar o scraper Python diretamente (sem API para rodar processos
 * locais) -- por isso este modulo fala com um servidor local minimo
 * (scraper/trigger_server.py, so biblioteca padrao do Python) que roda o
 * scraper em segundo piano e devolve o progresso. Se esse servidor nao
 * estiver de pe, mostramos o comando exato para iniciar.
 */

const TRIGGER_BASE = "http://127.0.0.1:8787";
const POLL_INTERVAL_MS = 1500;

let pollHandle = null;

async function fetchStatus() {
  try {
    const res = await fetch(`${TRIGGER_BASE}/status`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function renderIdle(refs, serverReachable) {
  refs.btn.disabled = false;
  refs.btn.textContent = "Coletar dados agora";
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

function renderFinished(refs, state) {
  refs.btn.disabled = false;
  refs.btn.textContent = "Coletar dados agora";
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

function startPolling(refs, onFinishedOnce) {
  stopPolling();
  let notified = false;
  pollHandle = setInterval(async () => {
    const state = await fetchStatus();
    if (!state) return;
    if (state.running) {
      renderRunning(refs, state);
    } else {
      renderFinished(refs, state);
      stopPolling();
      if (!notified && (state.result || state.error)) {
        notified = true;
        onFinishedOnce(state);
      }
    }
  }, POLL_INTERVAL_MS);
}

async function handleClick(refs) {
  refs.btn.disabled = true;
  refs.btn.textContent = "Iniciando...";
  try {
    await fetch(`${TRIGGER_BASE}/scrape`, { method: "POST" });
  } catch {
    refs.btn.disabled = false;
    refs.btn.textContent = "Coletar dados agora";
    refs.help.hidden = false;
    return;
  }
  startPolling(refs, (state) => {
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
    renderIdle(refs, false);
    return;
  }
  if (initial.running) {
    renderRunning(refs, initial);
    startPolling(refs, (state) => {
      if (state.result) setTimeout(() => window.location.reload(), 1200);
    });
  } else if (initial.result || initial.error) {
    renderFinished(refs, initial);
  } else {
    renderIdle(refs, true);
  }
}

initScrapeControl();
