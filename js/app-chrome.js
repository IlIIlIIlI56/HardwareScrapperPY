/**
 * Pequenos elementos que so existem porque isto virou um aplicativo, e nao
 * mais um site: o rodape mostra a versao e da acesso a pasta de dados.
 *
 * Num site, "onde ficam meus arquivos" nao e uma pergunta que a pagina precisa
 * responder -- o navegador cuida disso. Num app portatil e a pergunta central,
 * porque a pasta `dados/` E o dado: ela guarda os produtos coletados, a base de
 * benchmarks, as exportacoes e o perfil da janela onde vivem as suas decisoes
 * de revisao. Copiar essa pasta e o backup completo, e sem um caminho ate ela
 * o usuario nao teria como fazer isso.
 *
 * Fora do aplicativo nada disso aparece: os botoes ficam ocultos como estao no
 * HTML.
 */
(function () {
  if (!window.HWApp || !HWApp.isApp()) return;

  const versionEl = document.getElementById("app-version");
  if (versionEl) versionEl.textContent = `v${HWApp.version}`;

  const folderBtn = document.getElementById("open-data-folder");
  if (folderBtn) {
    folderBtn.hidden = false;
    folderBtn.title = HWApp.dataDir;
    folderBtn.addEventListener("click", () => HWApp.openFolder("data"));
  }

  /**
   * Reset de fabrica, ao lado do botao de tema. So aparece dentro do app
   * porque apagar dados/*.json exige o backend Python (appcore/server.py) --
   * uma pagina fora do app nao tem como fazer isso.
   *
   * A confirmacao lista exatamente o que sera apagado em vez de um generico
   * "tem certeza?": e uma acao irreversivel que custa produtos coletados,
   * curadoria e builds manuais, e quem clica precisa saber isso antes, nao
   * descobrir depois.
   */
  const resetBtn = document.getElementById("reset-all-btn");
  if (resetBtn) {
    resetBtn.hidden = false;
    resetBtn.addEventListener("click", () => {
      HWUi.openModal({
        title: "Resetar todos os dados?",
        subtitle: "Essa acao nao pode ser desfeita.",
        render: (body) => {
          body.appendChild(HWUi.el("p", null, "Isto apaga tudo o que o aplicativo guardou ate agora:"));
          const list = document.createElement("ul");
          list.className = "reset-all-list";
          [
            "Produtos coletados (dados/products.json) -- vai ser preciso coletar de novo.",
            "Base de performance (dados/benchmarks.json) -- volta para a versao padrao que acompanha o app; edicoes ja mescladas no arquivo se perdem.",
            "Toda a curadoria (dados/decisoes.json): revisoes de produtos, apelidos, ajustes de pontuacao e as builds manuais salvas na pagina Build.",
          ].forEach((text) => {
            const item = document.createElement("li");
            item.textContent = text;
            list.appendChild(item);
          });
          body.appendChild(list);
          body.appendChild(HWUi.el("p", "decision-note", "As exportacoes em dados/exportacoes/ nao sao afetadas."));
        },
        actions: [
          { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
          {
            label: "Apagar tudo",
            className: "btn-danger-ghost",
            onClick: async (close) => {
              const res = await HWApp.api("/api/reset-all", { method: "POST" });
              close();
              if (res && res.ok) {
                HWUi.toast(
                  "Dados resetados",
                  "O aplicativo volta ao estado de primeira instalacao. Recarregando...",
                  "ok",
                  4000
                );
                setTimeout(() => window.location.reload(), 900);
              } else {
                HWUi.toast("Nao foi possivel resetar", (res && res.error) || "Tente novamente.", "error", 8000);
              }
            },
          },
        ],
      });
    });
  }
})();
