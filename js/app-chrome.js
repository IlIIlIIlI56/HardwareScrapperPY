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
})();
