/**
 * Botao "Buscar atualizacoes" do rodape.
 *
 * O comportamento e diferente nas duas plataformas de proposito, e o Python
 * decide qual (window.HW_APP.updateMode) para esta camada nao ter que adivinhar
 * sistema operacional:
 *
 *   "link"     Windows. So avisa e manda para a pagina de download. O zip da
 *              release tem uma pasta raiz com o .exe e _internal/ dentro, entao
 *              extrair por cima da pasta do app troca exatamente o que precisa
 *              ser trocado -- `dados/` nem existe la dentro. Trocar arquivo
 *              sozinho nao valeria o que custaria (ver appcore/updater.py).
 *
 *   "install"  Android. Baixa o APK e entrega ao instalador do sistema pela
 *              ponte Kotlin, que faz a troca preservando os dados do app.
 *
 * A checagem silenciosa da abertura NUNCA abre modal: o botao so aparece ja
 * destacado. Um modal ao abrir o aplicativo e a forma mais rapida de fazer
 * alguem odiar um recurso de atualizacao.
 */
(function () {
  const POLL_MS = 500;

  let btn = null;
  let snap = null;
  let timer = null;
  // Só um clique do usuário autoriza modal ou toast. A checagem automática da
  // abertura corre com isto em false e, portanto, em silêncio -- inclusive
  // quando falha: sem internet não é um erro que alguém precise ver.
  let announce = false;

  function isAndroidInstall() {
    return HWApp.updateMode === "install" && bridge() !== null;
  }

  function bridge() {
    const android = window.HWAndroid;
    return android && typeof android.installApk === "function" ? android : null;
  }

  async function refresh() {
    const res = await HWApp.api("/api/update/status");
    if (res && res.ok) snap = res;
    return snap;
  }

  // -------------------------------------------------------------- render --

  function render() {
    if (!snap) return;
    btn.disabled = false;
    btn.classList.remove("btn-primary", "btn-ghost");

    if (snap.phase === "checking") {
      btn.textContent = "Verificando...";
      btn.disabled = true;
      btn.classList.add("btn-ghost");
      return;
    }
    if (snap.phase === "downloading") {
      const pct = snap.asset_size
        ? Math.round((snap.downloaded_bytes / snap.asset_size) * 100)
        : 0;
      btn.textContent = `Baixando ${pct}% — cancelar`;
      btn.classList.add("btn-primary");
      return;
    }
    if (snap.phase === "ready") {
      btn.textContent = "Instalar atualização";
      btn.classList.add("btn-primary");
      return;
    }
    if (snap.update_available) {
      btn.textContent = `Atualizar para v${snap.latest}`;
      btn.classList.add("btn-primary");
      return;
    }
    btn.textContent = "Buscar atualizações";
    btn.classList.add("btn-ghost");
  }

  // ------------------------------------------------------------- polling --

  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(async () => {
      await refresh();
      render();
      if (!snap || snap.phase === "checking" || snap.phase === "downloading") return;
      stopPolling();
      if (snap.phase === "ready") install();
      else settle();
    }, POLL_MS);
  }

  /** Desfecho de uma checagem que o usuário pediu explicitamente. */
  function settle() {
    if (!announce) return;
    announce = false;
    if (snap.phase === "error") {
      HWUi.toast(
        snap.rate_limited ? "Muitas consultas" : "Não foi possível verificar",
        snap.error || "Tente novamente mais tarde.",
        "error",
        8000
      );
      return;
    }
    if (snap.update_available) {
      openUpdateModal();
      return;
    }
    HWUi.toast(
      "Tudo em dia",
      `Você já está na versão mais recente (v${snap.current}).`,
      "ok",
      5000
    );
  }

  // --------------------------------------------------------------- modal --

  function renderNotes(body) {
    if (!snap.notes) return;
    const box = HWUi.el("pre", "update-notes", snap.notes);
    body.appendChild(HWUi.el("p", "decision-note", "O que mudou:"));
    body.appendChild(box);
  }

  function openUpdateModal() {
    if (isAndroidInstall()) openAndroidModal();
    else openWindowsModal();
  }

  function openWindowsModal() {
    HWUi.openModal({
      title: `Versão ${snap.latest} disponível`,
      subtitle: `Você está na ${snap.current}.`,
      render: (body) => {
        renderNotes(body);
        const steps = document.createElement("ol");
        steps.className = "update-steps";
        [
          "Baixe o arquivo .zip da nova versão e extraia numa pasta separada — não precisa ser por cima da atual.",
          "Na pasta ATUAL do app (botão \"Abrir pasta do app\", logo abaixo), copie a pasta dados inteira.",
          "Cole essa pasta dados dentro da pasta nova, ao lado do HardwareScrapper.exe que você acabou de extrair.",
          "Abra o HardwareScrapper.exe de dentro da pasta nova.",
        ].forEach((text) => {
          const item = document.createElement("li");
          item.textContent = text;
          steps.appendChild(item);
        });
        body.appendChild(steps);
        body.appendChild(
          HWUi.el(
            "p",
            "decision-note",
            "A pasta dados carrega tudo que você coletou e revisou até agora — produtos, base de performance, curadoria e exportações. Copiá-la para a pasta nova é o que leva todo esse trabalho junto; sem esse passo, a versão nova abre do zero."
          )
        );

        // Link de verdade, e nao window.open: o pywebview manda um
        // target="_blank" para o navegador do sistema, e no Android o
        // LocalOnlyWebViewClient faz o mesmo. Um window.open dependeria de
        // tratamento de nova janela na WebView, que ninguem configurou.
        const cta = HWUi.el("div", "update-cta");
        const link = HWUi.el("a", "btn btn-primary", "Abrir página de download");
        link.href = snap.release_url;
        link.target = "_blank";
        link.rel = "noopener";
        cta.appendChild(link);
        body.appendChild(cta);
      },
      actions: [
        { label: "Fechar", className: "btn-ghost", onClick: (close) => close() },
        ...(HWApp.canOpenFolder
          ? [
              {
                label: "Abrir pasta do app",
                className: "btn-ghost",
                onClick: () => HWApp.openFolder("app"),
              },
            ]
          : []),
      ],
    });
  }

  function openAndroidModal() {
    HWUi.openModal({
      title: `Versão ${snap.latest} disponível`,
      subtitle: `Você está na ${snap.current}.`,
      render: (body) => {
        renderNotes(body);
        if (snap.asset_size) {
          body.appendChild(
            HWUi.el(
              "p",
              null,
              `O download tem ${HWFormat.fmtBytes(snap.asset_size)} — prefira uma rede Wi-Fi.`
            )
          );
        }
        body.appendChild(
          HWUi.el(
            "p",
            "decision-note",
            "Seus dados são preservados: a atualização é instalada por cima da atual e a curadoria continua no lugar. O Android vai pedir confirmação para instalar — é o normal para aplicativos que não vêm da Play Store."
          )
        );
        body.appendChild(
          HWUi.el(
            "p",
            "decision-note",
            "Se o aplicativo que você tem hoje veio de uma build de teste, o Android vai recusar a instalação por cima, e a única saída será desinstalar — o que apaga seus dados. Nesse caso, gere um backup na aba \"Backup e exportação\" ANTES de desinstalar."
          )
        );
      },
      actions: [
        { label: "Agora não", className: "btn-ghost", onClick: (close) => close() },
        {
          label: "Baixar e instalar",
          className: "btn-primary",
          onClick: async (close) => {
            close();
            const res = await HWApp.api("/api/update/download", { method: "POST" });
            if (!res || !res.ok) {
              HWUi.toast(
                "Não foi possível baixar",
                (res && res.error) || "Tente novamente.",
                "error",
                8000
              );
              return;
            }
            await refresh();
            render();
            startPolling();
          },
        },
      ],
    });
  }

  // ------------------------------------------------------------ instalar --

  function install() {
    const android = bridge();
    if (!android || !snap.file) return;

    if (typeof android.canInstall === "function" && !android.canInstall()) {
      HWUi.openModal({
        title: "Permissão necessária",
        subtitle: "O Android precisa da sua autorização.",
        render: (body) => {
          body.appendChild(
            HWUi.el(
              "p",
              null,
              "Para instalar uma atualização que não vem da Play Store, o Android exige que você libere este aplicativo como fonte confiável. A tela de configurações vai abrir; depois de liberar, volte aqui e toque em \"Instalar atualização\" de novo."
            )
          );
        },
        actions: [
          { label: "Agora não", className: "btn-ghost", onClick: (close) => close() },
          {
            label: "Abrir configurações",
            className: "btn-primary",
            onClick: (close) => {
              close();
              if (typeof android.requestInstallPermission === "function") {
                android.requestInstallPermission();
              }
            },
          },
        ],
      });
      return;
    }

    const error = android.installApk(snap.file);
    if (error) {
      HWUi.toast("Não foi possível instalar", error, "error", 9000);
    }
  }

  // --------------------------------------------------------------- clique --

  async function onClick() {
    if (!snap) return;

    if (snap.phase === "downloading") {
      await HWApp.api("/api/update/cancel", { method: "POST" });
      return;
    }
    if (snap.phase === "ready") {
      install();
      return;
    }
    if (snap.update_available) {
      openUpdateModal();
      return;
    }

    announce = true;
    btn.disabled = true;
    btn.textContent = "Verificando...";
    const res = await HWApp.api("/api/update/check?force=1", { method: "POST" });
    if (!res || !res.ok) {
      announce = false;
      await refresh();
      render();
      HWUi.toast("Não foi possível verificar", "Tente novamente.", "error", 6000);
      return;
    }
    startPolling();
  }

  // ---------------------------------------------------------------- boot --

  async function mount(button) {
    btn = button;
    btn.hidden = false;
    btn.addEventListener("click", onClick);

    await refresh();
    render();

    // Sem ?force: o backend decide se a checagem vale a pena. O cache de 24h
    // mora la justamente porque este arquivo roda nas TRES paginas -- sem ele,
    // trocar de aba gastaria tres das 60 consultas por hora que o GitHub
    // permite sem autenticacao.
    const res = await HWApp.api("/api/update/check", { method: "POST" });
    if (res && res.ok && res.started) startPolling();
    else {
      await refresh();
      render();
    }
  }

  window.HWUpdate = { mount };
})();
