/**
 * Formatacao compartilhada entre as paginas de builds e de base de dados.
 * Envolvida numa IIFE de proposito: scripts classicos (sem type="module")
 * compartilham um unico escopo global de pagina, entao qualquer
 * `function nome(...)` aqui declarada global colidiria (SyntaxError) com um
 * `const { nome } = ...` feito em outro arquivo -- ja aconteceu uma vez entre
 * este arquivo e render.js. Mantendo tudo dentro da IIFE, o unico nome exposto
 * globalmente e `window.HWFormat`.
 */
(function () {
  const PT = "pt-BR";

  function fmtUsd(v) {
    return v == null ? "--" : `US$ ${v.toLocaleString(PT, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtBrl(v) {
    return v == null || v === 0 ? "" : `R$ ${v.toLocaleString(PT, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtInt(v) {
    return v == null ? "--" : Math.round(v).toLocaleString(PT);
  }

  /**
   * Numero com casas decimais adaptativas. Os scores desta ferramenta variam
   * de ~0.3 (indice de valor de uma GPU cara) a ~40000 (PassMark de um CPU de
   * ponta) -- uma casa fixa deixaria metade da escala ilegivel, entao a
   * precisao acompanha a magnitude.
   */
  function fmtScore(v) {
    if (v == null || Number.isNaN(v)) return "--";
    const abs = Math.abs(v);
    if (abs >= 1000) return Math.round(v).toLocaleString(PT);
    if (abs >= 10) return v.toLocaleString(PT, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return v.toLocaleString(PT, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function fmtDate(iso) {
    if (!iso) return "--";
    try {
      return new Date(iso).toLocaleString(PT, { dateStyle: "short", timeStyle: "short" });
    } catch {
      return String(iso);
    }
  }

  function fmtBytes(n) {
    if (n == null) return "--";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  window.HWFormat = { fmtUsd, fmtBrl, fmtInt, fmtScore, fmtDate, fmtBytes };
})();
