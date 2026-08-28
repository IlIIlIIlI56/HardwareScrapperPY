/**
 * Tema claro/escuro.
 *
 * Tres estados possiveis, na mesma ordem de precedencia que o CSS usa:
 *   "light" / "dark" -> escolha explicita, gravada em localStorage e refletida
 *                       no atributo data-theme do <html> (vence o sistema);
 *   "system"         -> sem data-theme, o CSS segue prefers-color-scheme.
 *
 * Este arquivo e carregado no <head>, ANTES do <body>, de proposito: aplicar o
 * data-theme so depois que a pagina pintou causaria um flash branco em quem
 * usa tema escuro. Por isso ele nao depende de nenhum outro modulo e nao toca
 * no DOM alem do elemento raiz -- a ligacao com o botao acontece depois, em
 * initThemeToggle(), chamada quando o <header> ja existe.
 */
(function () {
  const STORAGE_KEY = "hw-theme-v1";
  const ORDER = ["system", "light", "dark"];

  function stored() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return ORDER.includes(v) ? v : "system";
    } catch {
      return "system"; // localStorage bloqueado (modo privado, politica do navegador)
    }
  }

  function apply(mode) {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
  }

  function set(mode) {
    if (!ORDER.includes(mode)) mode = "system";
    try {
      if (mode === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* sem persistencia: o tema ainda vale para esta aba */
    }
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
