/**
 * Tema claro/escuro.
 *
 * Tres estados possiveis, na mesma ordem de precedencia que o CSS usa:
 *   "light" / "dark" -> escolha explicita, gravada pelo HWStore e refletida
 *                       no atributo data-theme do <html> (vence o sistema);
 *   "system"         -> sem data-theme, o CSS segue prefers-color-scheme.
 *
 * Este arquivo e carregado no <head>, ANTES do <body>, de proposito: aplicar o
 * data-theme so depois que a pagina pintou causaria um flash branco em quem
 * usa tema escuro. Por isso ele so toca no elemento raiz -- a ligacao com o
 * botao acontece depois, em initThemeToggle(), quando o <header> ja existe.
 *
 * O unico modulo de que depende e js/app-bridge.js, carregado logo acima dele
 * no <head>: dentro do aplicativo a preferencia mora em dados/decisoes.json, e
 * nao no localStorage, que ali seria apagado a cada abertura (a porta do
 * servidor local muda, e com ela a origem da pagina).
 */
(function () {
  const STORAGE_KEY = "hw-theme-v1";
  const ORDER = ["system", "light", "dark"];

  function stored() {
    const value = HWStore.getString(STORAGE_KEY);
    return ORDER.includes(value) ? value : "system";
  }

  function apply(mode) {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
  }

  function set(mode) {
    if (!ORDER.includes(mode)) mode = "system";
    if (mode === "system") HWStore.remove(STORAGE_KEY);
    else HWStore.setString(STORAGE_KEY, mode);
    apply(mode);
    return mode;
  }

  /** O que o usuario esta REALMENTE vendo agora (resolve "system"). */
  function effective() {
    const mode = stored();
    if (mode !== "system") return mode;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  /**
   * O botao alterna entre claro e escuro a partir do que esta visivel agora.
   * Nao expomos "system" no ciclo do clique porque um terceiro estado invisivel
   * confunde (o botao mostraria o mesmo icone em dois estados diferentes); quem
   * quiser voltar ao automatico limpa os dados do site.
   */
  function toggle() {
    return set(effective() === "dark" ? "light" : "dark");
  }

  function initThemeToggle() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const sync = () => {
      const now = effective();
      btn.setAttribute("aria-label", now === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro");
      btn.setAttribute("title", now === "dark" ? "Tema claro" : "Tema escuro");
    };
    btn.addEventListener("click", () => {
      toggle();
      sync();
    });
    sync();
  }

  apply(stored());

  window.HWTheme = { apply, set, stored, effective, toggle, initThemeToggle };
})();
