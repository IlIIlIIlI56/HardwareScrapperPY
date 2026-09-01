/**
 * Aba "Backup e exportacao".
 *
 * Todas as decisoes vivem numa gaveta so (dados/decisoes.json dentro do app),
 * separada dos arquivos coletados. Esta tela e o caminho de saida e de volta
 * desses dados, com quatro saidas em vez da unica que existia antes:
 *
 *   backup .json        formato desta pagina, para restaurar/mesclar depois;
 *   benchmarks.json     dados/benchmarks.json COMPLETO com as suas entradas ja
 *                       aplicadas -- o unico jeito de a curadoria sair do
 *                       navegador e virar parte do repositorio;
 *   catalogo .csv       a lista pontuada inteira, para conferir numeros numa
 *                       planilha (ou para uma revisao rapida em massa);
 *   apagar tudo         reset explicito, atras de confirmacao.
 *
 * E a importacao deixou de ser um merge cego. A versao anterior mesclava dando
 * prioridade ao arquivo e so avisava "importado: N itens" -- se o arquivo era
 * antigo, ele sobrescrevia revisoes locais mais recentes sem dizer quais nem
 * deixar desfazer. Agora o arquivo e analisado primeiro (analyzeImport, sem
 * gravar nada), a tela mostra novos / conflitos / iguais / invalidos, e o
 * usuario escolhe quem vence os conflitos.
 */
(function () {
  const { el, elHtml, clear, icon, toast, openModal } = window.HWUi;

  /**
   * Entrega um arquivo gerado aqui ao usuario e avisa ONDE ele foi parar.
   *
   * Dentro do aplicativo isso nao e um download: a janela e um WebView2 sem
   * barra de downloads, entao um <a download> depositaria o arquivo em
   * Downloads -- fora da pasta portatil, que e justamente o lugar de onde a
   * curadoria nao deveria escapar. HWApp.saveFile grava em
   * dados/exportacoes/ e devolve o nome final; o botao "Abrir pasta de
   * exportacoes", ao lado, leva o usuario ate la. Fora do app, o download
   * comum do navegador continua valendo (ver js/app-bridge.js).
   */
  async function saveExport(filename, content, type, title, message) {
    const outcome = await HWApp.saveFile(filename, content, type);
    if (outcome.mode === "app") {
      toast(title, `${message} Salvo em dados/exportacoes/${outcome.name}.`, "ok", 9000);
    } else {
      toast(title, message, "ok");
    }
    return outcome;
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  /* ------------------------------------------------------------- CSV ----- */

  function csvCell(value) {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /**
   * Separador ";" e BOM UTF-8: e o que o Excel em portugues abre direto, sem a
   * caixa de dialogo de importacao e sem quebrar os acentos dos nomes dos
   * produtos.
   */
  function exportCatalogCsv() {
    HWCat.recompute();
    const header = [
      "categoria",
      "nome",
      "status",
      "preço_usd",
      "preço_brl",
      "ofertas",
      "desempenho",
      "índice_valor",
      "motivo_exclusão",
      "specs",
      "url",
    ];
    const lines = [header.join(";")];
    for (const p of HWCat.state.products) {
      const entry = HWCat.entryOf(p);
      const status = HWCat.statusOf(p);
      lines.push(
        [
          HWCat.CATEGORY_LABEL[p.category] || p.category,
          p.name,
          status,
          p.price_usd ?? "",
          p.price_brl ?? "",
          p.offers ?? "",
          entry && entry.scored ? Math.round(entry.perfScore * 100) / 100 : "",
          entry && entry.scored ? Math.round(entry.valueRatio * 10000) / 10000 : "",
          entry && !entry.scored ? entry.reason : "",
          HWUi.describeSpecs(p.category, (entry && entry.specs) || p.specs),
          p.url,
        ]
          .map(csvCell)
          .join(";")
      );
    }
    saveExport(
      `hw-catalogo-${stamp()}.csv`,
      "﻿" + lines.join("\r\n"),
      "text/csv;charset=utf-8",
      "CSV gerado",
      `${HWCat.state.products.length} produtos exportados.`
    );
  }

  /* ------------------------------------------------------ importacao ----- */

  const KIND_LABEL = { new: "novo", conflict: "conflito", same: "igual", invalid: "inválido" };

  function diffRow(kind, label, detail) {
    const row = el("li", "diff-row");
    row.appendChild(el("span", `diff-tag diff-tag--${kind}`, KIND_LABEL[kind]));
    const text = el("span", "diff-label", label);
    if (detail) text.title = detail;
    row.appendChild(text);
    return row;
  }

  function summaryCell(label, value) {
    const cell = el("div", "summary-cell");
    cell.appendChild(el("div", "metric-label", label));
    cell.appendChild(el("div", "metric-value", value));
    return cell;
  }

  function showImportPreview(data, report) {
    let mode = "incoming";

    openModal({
      title: "Confirmar importação",
      subtitle: report.exportedAt
        ? `Backup gerado em ${HWFormat.fmtDate(report.exportedAt)} (formato v${report.schemaVersion}).`
        : `Formato v${report.schemaVersion}.`,
      render: (body) => {
        const grid = el("div", "summary-grid");
        grid.appendChild(summaryCell("Novos", report.counts.new || 0));
        grid.appendChild(summaryCell("Conflitos", report.counts.conflict || 0));
        grid.appendChild(summaryCell("Já iguais", report.counts.same || 0));
        grid.appendChild(summaryCell("Inválidos", report.counts.invalid || 0));
        body.appendChild(grid);

        if (report.counts.conflict) {
          body.appendChild(el("h3", null, "Nos conflitos, o que vale?"));
          const list = el("div", "radio-list");
          [
            ["incoming", "O arquivo importado", "Sobrescreve a decisão local. Use quando o backup for mais recente."],
            ["local", "O que já está neste navegador", "Só entram chaves novas; nada do que você fez aqui é perdido."],
            ["replace", "Substituir tudo pelo arquivo", "Apaga todas as decisões locais antes de importar. Não dá para desfazer."],
          ].forEach(([value, title, desc]) => {
            const option = el("label", "radio-option");
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "import-mode";
            radio.value = value;
            radio.checked = value === mode;
            radio.addEventListener("change", () => (mode = value));
            option.appendChild(radio);
            const textBox = el("div");
            textBox.appendChild(el("div", "radio-option-title", title));
            textBox.appendChild(el("div", "radio-option-desc", desc));
            option.appendChild(textBox);
            list.appendChild(option);
          });
          body.appendChild(list);
        }

        const sections = [
          ["Decisões de produto", report.products],
          ["Entradas de benchmark", report.benchmarks],
          ["Apelidos", report.aliases],
          ["Ajustes do modelo", report.tuning],
          ["Descartados", report.invalid],
        ];
        for (const [title, rows] of sections) {
          const relevant = rows.filter((r) => r.kind !== "same");
          if (relevant.length === 0) continue;
          body.appendChild(el("h3", null, `${title} (${relevant.length})`));
          const list = el("ul", "diff-list");
          relevant.slice(0, 40).forEach((r) => list.appendChild(diffRow(r.kind, r.label, r.reason)));
          if (relevant.length > 40) list.appendChild(el("li", "decision-note", `+ ${relevant.length - 40} não listados.`));
          body.appendChild(list);
        }

        if (!report.products.length && !report.benchmarks.length && !report.aliases.length && !report.tuning.length) {
          body.appendChild(el("div", "empty-state", "O arquivo não trouxe nenhuma entrada aproveitável."));
        }
      },
      actions: [
        { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
        {
          label: "Importar",
          className: "btn-primary",
          onClick: (close) => {
            try {
              const result = HWOverrides.applyImport(data, mode);
              close();
              toast(
                "Backup importado",
                `${result.applied.products} decisões, ${result.applied.benchmarks} entradas, ` +
                  `${result.applied.aliases} apelidos e ${result.applied.tuning} ajustes aplicados` +
                  (result.skippedInvalid ? ` · ${result.skippedInvalid} descartados` : "") +
                  ".",
                "ok",
                8000
              );
              HWCat.refresh("import");
            } catch (err) {
              toast("Falha na importação", err.message, "error", 10000);
            }
          },
        },
      ],
    });
  }

  /* ------------------------------------------------------------- tela ---- */

  function render() {
    const container = document.getElementById("backup-panel");
    if (!container) return;
    clear(container);

    const counts = HWOverrides.overrideCounts();
    const bench = HWOverrides.benchmarkCounts();
    const usage = HWOverrides.storageInfo();

    container.appendChild(el("h2", null, "Backup e exportação"));
    container.appendChild(
      el(
        "p",
        "panel-hint",
        "Suas decisões e entradas de benchmark ficam em dados/decisoes.json — não alteram dados/products.json nem dados/benchmarks.json. Elas viajam junto quando você copia a pasta do app; um backup aqui protege contra apagar a pasta por engano."
      )
    );

    const grid = el("div", "summary-grid");
    grid.appendChild(summaryCell("Revisados", counts.added));
    grid.appendChild(summaryCell("Ignorados", counts.ignored));
    grid.appendChild(summaryCell("Entradas de bench.", bench.cpu + bench.gpu + bench.chipsets));
    grid.appendChild(summaryCell("Apelidos", bench.aliases));
    grid.appendChild(summaryCell("Ajustes", bench.tuning));
    grid.appendChild(summaryCell("Espaço usado", HWFormat.fmtBytes(usage.totalBytes)));
    container.appendChild(grid);

    /* ---- backup desta pagina ---- */
    const bar = el("div", "toolbar");

    const exportBtn = elHtml("button", "btn btn-primary", icon("download"));
    exportBtn.appendChild(document.createTextNode("Gerar backup (.json)"));
    exportBtn.addEventListener("click", () => {
      const data = HWOverrides.exportAllData();
      saveExport(
        `hw-database-backup-${stamp()}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
        "Backup gerado",
        `${data.counts.products} decisões e ${bench.total} itens de benchmark.`
      );
    });
    bar.appendChild(exportBtn);

    const importLabel = elHtml("label", "btn btn-ghost file-btn", icon("upload"));
    importLabel.appendChild(document.createTextNode("Importar backup"));
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.hidden = true;
    importInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        // analise primeiro, gravacao so depois da confirmacao na tela
        const report = HWOverrides.analyzeImport(parsed);
        showImportPreview(parsed, report);
      } catch (err) {
        toast("Arquivo recusado", err.message, "error", 9000);
      } finally {
        importInput.value = "";
      }
    });
    importLabel.appendChild(importInput);
    bar.appendChild(importLabel);
    container.appendChild(bar);

    container.appendChild(el("hr", "divider"));

    /* ---- exportacoes derivadas ---- */
    container.appendChild(el("h3", null, "Levar a curadoria para o repositório"));
    container.appendChild(
      el(
        "p",
        "panel-hint",
        "Gera um benchmarks.json completo com as suas entradas, edições e ajustes já aplicados. Copie-o por cima de dados/benchmarks.json para a curadoria virar a base do app — assim ela sobrevive a um \"apagar todas as decisões\" e já vale numa instalação nova."
      )
    );

    const bar2 = el("div", "toolbar");
    const mergeBtn = elHtml("button", "btn", icon("database"));
    mergeBtn.appendChild(document.createTextNode("Exportar benchmarks.json mesclado"));
    mergeBtn.disabled = !HWCat.state.benchmarks;
    mergeBtn.addEventListener("click", () => {
      const merged = HWOverrides.buildMergedBenchmarksFile(HWCat.state.benchmarks);
      saveExport(
        "benchmarks.json",
        JSON.stringify(merged, null, 2),
        "application/json",
        "benchmarks.json gerado",
        "Copie-o por cima de dados/benchmarks.json para a curadoria virar a base do app."
      );
    });
    bar2.appendChild(mergeBtn);

    const csvBtn = elHtml("button", "btn", icon("download"));
    csvBtn.appendChild(document.createTextNode("Exportar catálogo (.csv)"));
    csvBtn.addEventListener("click", exportCatalogCsv);
    bar2.appendChild(csvBtn);

    // Num app portatil nao ha caixa de dialogo de download dizendo onde o
    // arquivo caiu -- sem este botao o usuario ficaria procurando.
    if (HWApp.isApp()) {
      const folderBtn = elHtml("button", "btn btn-ghost", icon("folder"));
      folderBtn.appendChild(document.createTextNode("Abrir pasta de exportações"));
      folderBtn.addEventListener("click", () => HWApp.openFolder("exports"));
      bar2.appendChild(folderBtn);
    }
    container.appendChild(bar2);

    container.appendChild(el("hr", "divider"));

    /* ---- reset ---- */
    const dangerBar = el("div", "toolbar");
    const resetBtn = elHtml("button", "btn btn-danger-ghost", icon("trash"));
    resetBtn.appendChild(document.createTextNode("Apagar todas as decisões"));
    resetBtn.disabled = counts.total === 0 && bench.total === 0;
    resetBtn.addEventListener("click", () => {
      openModal({
        title: "Apagar todas as decisões?",
        subtitle: "Isso limpa as duas gavetas de decisões do app. Não dá para desfazer.",
        render: (body) => {
          body.appendChild(
            el(
              "p",
              null,
              `Serão apagadas ${counts.added} revisões, ${counts.ignored} itens ignorados e ${bench.total} itens de benchmark ` +
                `(entradas, apelidos e ajustes). Os arquivos em dados/ não são tocados.`
            )
          );
          body.appendChild(el("p", "decision-note", "Gere um backup antes se houver qualquer dúvida."));
        },
        actions: [
          { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
          {
            label: "Apagar tudo",
            className: "btn-danger-ghost",
            onClick: (close) => {
              HWOverrides.resetAll();
              close();
              toast("Decisões apagadas", "A página voltou ao resultado do pipeline automático puro.", "ok");
              HWCat.refresh("reset");
            },
          },
        ],
      });
    });
    dangerBar.appendChild(resetBtn);
    container.appendChild(dangerBar);
  }

  window.HWBackup = { render };
})();
