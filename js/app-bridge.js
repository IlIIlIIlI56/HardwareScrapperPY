/**
 * Ponte entre a interface e o processo Python do aplicativo.
 *
 * O servidor local entrega /app-bootstrap.js antes deste arquivo; e ele que
 * define `window.HW_APP` com o token da sessao e os caminhos reais das pastas.
 * Toda chamada a /api/ precisa desse token -- sem ele, qualquer pagina web
 * aberta no computador poderia varrer as portas locais e disparar uma coleta
 * ou descobrir onde ficam os seus arquivos.
 *
 * As duas paginas continuam sendo HTML estatico comum: se por algum motivo
 * forem abertas fora do app (um servidor estatico qualquer, para depurar o
 * CSS), `HW_APP` simplesmente nao existe, `isApp()` devolve false e cada
 * recurso que depende do Python se degrada sozinho -- a coleta some da tela e
 * as exportacoes voltam a ser downloads do navegador.
 */
(function () {
  const config = window.HW_APP || null;

  function isApp() {
    return Boolean(config && config.token);
  }

  /**
   * Chamada a API do app. Devolve o JSON da resposta, ou null quando o app nao
   * esta presente / a chamada falhou -- quem chama trata "null" como "essa
   * funcionalidade nao esta disponivel agora", que e o unico tratamento util
   * do lado da interface.
   */
  async function api(path, { method = "GET", body = null } = {}) {
    if (!isApp()) return null;
    try {
      const res = await fetch(path, {
        method,
        cache: "no-store",
        headers: {
          "X-HW-Token": config.token,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return { ok: false, status: res.status, ...(await res.json().catch(() => ({}))) };
      return { ok: true, ...(await res.json()) };
    } catch {
      return null;
    }
  }

  /**
   * Grava um arquivo gerado pela pagina (backup, benchmarks mesclado, CSV).
   *
   * Dentro do app isso NAO e um download: o WebView2 nao tem barra de
   * downloads visivel, entao um <a download> ou nao abre caixa nenhuma ou
   * deposita o arquivo em Downloads, longe da pasta portatil. Gravar em
   * `dados/exportacoes/` mantem tudo junto do app -- copiar a pasta leva as
   * exportacoes junto. Fora do app, o download normal do navegador continua
   * valendo.
   *
   * Devolve { mode: "app", path } ou { mode: "download" }.
   */
  async function saveFile(filename, content, type = "application/json") {
    if (isApp()) {
      const res = await api("/api/save", { method: "POST", body: { filename, content } });
      if (res && res.ok) return { mode: "app", path: res.path, name: res.name };
    }
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return { mode: "download" };
  }

  /* ------------------------------------------------- ponte do Android ---- */

  /**
   * Ponte injetada pelo Kotlin (addJavascriptInterface(..., "HWAndroid")), que
   * so existe na casca Android. Consultada por funcao a cada uso, e nao
   * capturada num booleano no carregamento: o WebView injeta o objeto antes de
   * qualquer script rodar, mas depender dessa ordem seria fragilidade de graca.
   */
  function androidBridge() {
    const bridge = window.HWAndroid;
    return bridge && typeof bridge.shareTextFile === "function" ? bridge : null;
  }

  /** Se esta plataforma tem um menu nativo de compartilhamento de arquivo. */
  function canShareFile() {
    return androidBridge() !== null;
  }

  /**
   * Entrega um arquivo de texto gerado pela pagina pelo caminho que faz sentido
   * na plataforma.
   *
   * No Android o filesDir do app e privado: gravar em dados/exportacoes/ ali
   * produz um arquivo que NENHUM gerenciador de arquivos alcanca -- o usuario
   * pediria "baixar" e nao acharia nada depois. O caminho util la e o menu de
   * compartilhamento do sistema, que deixa ele escolher o destino (WhatsApp,
   * Drive, e-mail). Nas outras plataformas nada muda: delega para o saveFile de
   * sempre, que grava em dados/exportacoes/ dentro do app ou baixa pelo
   * navegador fora dele.
   *
   * E um wrapper por composicao, de proposito: saveFile continua servindo os
   * backups e CSVs da Database sem nenhuma mudanca de comportamento.
   *
   * Devolve { mode: "share" } | { mode: "app", path, name } |
   *         { mode: "download" } | { mode: "error", error }.
   */
  async function shareFile(filename, content, { mimeType = "text/plain", subject = null } = {}) {
    const bridge = androidBridge();
    if (!bridge) return saveFile(filename, content, `${mimeType};charset=utf-8`);

    let failure = "ponte indisponível";
    try {
      // Contrato do lado Kotlin: "" quer dizer que deu certo, e qualquer outra
      // string e a mensagem do erro. Um booleano esconderia o motivo justamente
      // no caso em que o usuario precisa dele (cache cheio, nome recusado).
      failure = String(bridge.shareTextFile(filename, content, mimeType, subject || filename) || "");
    } catch (err) {
      failure = (err && err.message) || String(err);
    }
    return failure ? { mode: "error", error: failure } : { mode: "share" };
  }

  /** Abre uma das pastas do app no Explorer ("exports", "data" ou "app"). */
  function openFolder(target = "exports") {
    return api("/api/open", { method: "POST", body: { target } });
  }

  function quit() {
    return api("/api/quit", { method: "POST" });
  }

  /**
   * Marca <html> com data-app="1" quando rodando dentro do aplicativo, para o
   * CSS poder esconder o que so faz sentido num navegador (e vice-versa) sem
   * cada modulo precisar consultar o JS.
   */
  if (isApp()) document.documentElement.setAttribute("data-app", "1");

  /* ======================================================== HWStore ====== */

  /*
   * Onde as decisoes do usuario ficam guardadas.
   *
   * Historicamente isto era o localStorage direto, e num site estatico era a
   * unica opcao possivel. Dentro do aplicativo o localStorage vira uma
   * armadilha: o WebView2 o separa POR ORIGEM, e a origem inclui a porta --
   * que o servidor local sorteia a cada abertura, justamente para nao brigar
   * por uma porta fixa. Meses de curadoria evaporariam a cada vez que o app
   * fosse fechado e reaberto, sem erro nenhum na tela.
   *
   * Entao, dentro do app, a fonte da verdade e dados/decisoes.json: lido de uma
   * vez na abertura para um objeto em memoria, e regravado inteiro a cada
   * escrita. Fora do app (paginas abertas num servidor estatico qualquer), o
   * localStorage segue valendo.
   *
   * A leitura inicial e a gravacao usam XMLHttpRequest SINCRONO de proposito.
   * A API que isto substitui -- localStorage -- e sincrona, e todo o codigo que
   * a consome (js/overrides.js e as telas da Database) foi escrito em
   * cima disso: torna-la assincrona espalharia async/await por praticamente
   * todos os modulos. O custo real e desprezivel, porque do outro lado nao ha
   * rede nenhuma, so um arquivo local nesta mesma maquina -- e, no caso da
   * gravacao, ser sincrona ainda garante que uma decisao salva sobrevive a um
   * F5 imediato, coisa que um fetch em voo nao garante.
   */

  const memory = {};
  let hydrated = false;

  function requestSync(method, path, payload) {
    const request = new XMLHttpRequest();
    request.open(method, path, false); // sincrono -- ver o comentario acima
    request.setRequestHeader("X-HW-Token", config.token);
    if (payload !== undefined) request.setRequestHeader("Content-Type", "application/json");
    request.send(payload === undefined ? null : JSON.stringify(payload));
    if (request.status < 200 || request.status >= 300) {
      throw new Error(`HTTP ${request.status} em ${path}`);
    }
    return request.responseText ? JSON.parse(request.responseText) : null;
  }

  function hydrate() {
    if (hydrated || !isApp()) return;
    hydrated = true;
    try {
      const loaded = requestSync("GET", "/api/state");
      if (loaded && typeof loaded === "object") Object.assign(memory, loaded);
    } catch (err) {
      // Comecar vazio e ruim, mas travar a interface inteira e pior: ela ainda
      // roda o pipeline automatico sem nenhuma decisao aplicada.
      console.error("nao foi possivel carregar dados/decisoes.json:", err);
    }
  }

  function persist() {
    try {
      requestSync("POST", "/api/state", memory);
    } catch (err) {
      throw new Error(`Não foi possível gravar em dados/decisoes.json: ${err.message}`);
    }
  }

  const store = {
    /** Objeto guardado sob `key`, ou `fallback` se nao houver nenhum valido. */
    get(key, fallback) {
      if (isApp()) {
        const value = memory[key];
        return value && typeof value === "object" ? value : fallback;
      }
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : fallback;
      } catch {
        return fallback;
      }
    },

    set(key, value) {
      if (isApp()) {
        memory[key] = value;
        persist();
        return;
      }
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        // Silenciar isto seria o pior caso possivel: a tela atualizaria como
        // se a decisao tivesse sido salva, e ela sumiria no F5.
        const isQuota =
          err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22);
        throw new Error(
          isQuota
            ? "Armazenamento do navegador cheio — gere um backup e remova decisões antigas antes de continuar."
            : `Não foi possível salvar: ${err && err.message ? err.message : err}`
        );
      }
    },

    remove(key) {
      if (isApp()) {
        delete memory[key];
        persist();
        return;
      }
      try {
        localStorage.removeItem(key);
      } catch {
        /* armazenamento bloqueado: nao ha o que remover */
      }
    },

    /** Preferencia simples (texto), usada pelo seletor de tema. */
    getString(key) {
      if (isApp()) return typeof memory[key] === "string" ? memory[key] : null;
      try {
        return localStorage.getItem(key);
      } catch {
        return null; // armazenamento bloqueado (modo privado, politica do navegador)
      }
    },

    setString(key, value) {
      if (isApp()) {
        memory[key] = value;
        persist();
        return;
      }
      try {
        localStorage.setItem(key, value);
      } catch {
        /* preferencia de tema nao vale um erro na tela */
      }
    },

    /** Tamanho aproximado, em bytes, do que esta guardado sob `key`. */
    sizeOf(key) {
      if (isApp()) {
        const value = memory[key];
        return value === undefined ? 0 : JSON.stringify(value).length;
      }
      try {
        return (localStorage.getItem(key) || "").length * 2; // UTF-16
      } catch {
        return 0;
      }
    },

    /** Onde as decisoes estao sendo guardadas, para as telas explicarem ao usuario. */
    describe() {
      return isApp() ? "dados/decisoes.json" : "armazenamento do navegador";
    },
  };

  hydrate();

  window.HWStore = store;
  window.HWApp = {
    isApp,
    api,
    saveFile,
    shareFile,
    canShareFile,
    openFolder,
    quit,
    version: config ? config.version : null,
    dataDir: config ? config.dataDir : null,
    exportsDir: config ? config.exportsDir : null,
    canOpenFolder: Boolean(config && config.canOpenFolder),
  };
})();
