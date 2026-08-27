/**
 * Formatacao de preco compartilhada entre as paginas de builds e de base de
 * dados. Envolvida numa IIFE de proposito: scripts classicos (sem type=
 * "module") compartilham um unico escopo global de pagina, entao qualquer
 * `function nome(...)` aqui declarada global colidiria (SyntaxError) com um
 * `const { nome } = ...` feito em outro arquivo -- ja aconteceu uma vez
 * entre este arquivo e render.js. Mantendo tudo dentro da IIFE, o unico
 * nome exposto globalmente e `window.HWFormat`.
 */
(function () {
  function fmtUsd(v) {
    return v == null ? "--" : `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtBrl(v) {
    return v == null || v === 0 ? "" : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  window.HWFormat = { fmtUsd, fmtBrl };
})();
