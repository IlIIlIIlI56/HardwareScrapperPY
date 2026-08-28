/**
 * Renderizacao em DOM das builds calculadas. Nao ha nenhum passo manual aqui:
 * este modulo apenas exibe o que builder.js decidiu.
 */

/*
 * Todo o arquivo vive dentro de uma IIFE: os scripts sao classicos (sem
 * type="module") e dividem um unico escopo global de pagina, entao um
 * `const el = ...` aqui colidiria com o mesmo nome em outro arquivo carregado
 * na mesma pagina. So `window.HWRender` sai daqui.
 */
(function () {
  const CATEGORY_META = {
    cpu: { label: "Processador", short: "CPU" },
    motherboard: { label: "Placa-Mae", short: "MB" },
    ram: { label: "Memoria RAM", short: "RAM" },
    gpu: { label: "Placa de Video", short: "GPU" },
    psu: { label: "Fonte", short: "PSU" },
    storage: { label: "Armazenamento", short: "SSD" },
  };

  const { el, elHtml, clear, icon, thumb, describeSpecs } = window.HWUi;

  function renderStatus(container, lines) {
    clear(container);
    const list = el("ul", "status-log");
    lines.forEach((line) => {
      list.appendChild(el("li", `status-line status-${line.level || "info"}`, line.text));
    });
    container.appendChild(list);
  }

  function renderPartRow(category, item) {
    const meta = CATEGORY_META[category];
    const row = el("a", "part-row");
    row.href = item.url;
    row.target = "_blank";
    row.rel = "noopener noreferrer";

    const left = el("div", "part-left");
    left.appendChild(thumb(item, "thumb--sm"));

    const info = el("div", "part-info");
    const categoryLine = el("div", "part-category", meta.label);
    if (item.manuallyAdded) categoryLine.appendChild(el("span", "part-manual-tag", "revisado"));
    info.appendChild(categoryLine);
    info.appendChild(el("div", "part-name", item.name));

    // as specs relevantes ficam visiveis na linha da peca: sem elas, comparar
    // duas builds exigia abrir os seis anuncios de cada uma numa aba nova.
    const specs = describeSpecs(category, item.specs);
    if (specs) info.appendChild(el("div", "part-specs", specs));

    left.appendChild(info);

    const right = el("div", "part-right");
    right.appendChild(el("div", "part-price-usd", HWFormat.fmtUsd(item.price_usd)));
    if (item.price_brl) right.appendChild(el("div", "part-price-brl", HWFormat.fmtBrl(item.price_brl)));

    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  function metric(label, value, accent) {
    const box = el("div", "metric");
    box.appendChild(el("div", "metric-label", label));
    box.appendChild(el("div", `metric-value${accent ? " accent" : ""}`, value));
    return box;
  }

  function renderBuildCard(build, options = {}) {
    const { highlight = false } = options;
    const card = el("article", `build-card${highlight ? " build-card--best" : ""}`);

    if (highlight) {
      const badge = elHtml("div", "best-badge", icon("award"));
      badge.appendChild(document.createTextNode("Melhor custo-beneficio geral"));
      card.appendChild(badge);
    }

    const header = el("div", "build-header");
    header.appendChild(el("div", "build-rank", `#${build.rank}`));
    const titleWrap = el("div", "build-title-wrap");
    const anchorLabels = build.anchorCategories.map((c) => CATEGORY_META[c].label).join(" + ");
    titleWrap.appendChild(el("h3", "build-title", `Ancorada em ${anchorLabels}`));
    titleWrap.appendChild(
      el("div", "build-subtitle", `Fonte recomendada: ${build.minWattage}W+${build.ramType ? ` · plataforma ${build.ramType}` : ""}`)
    );
    header.appendChild(titleWrap);
    card.appendChild(header);

    const metrics = el("div", "build-metrics");
    metrics.appendChild(metric("Total", HWFormat.fmtUsd(build.totalUsd)));
    metrics.appendChild(metric("Performance", HWFormat.fmtScore(build.performanceIndex)));
    metrics.appendChild(metric("Indice de valor", HWFormat.fmtScore(build.valueIndex), true));
    card.appendChild(metrics);

    const partsList = el("div", "parts-list");
    HWBuilder.CATEGORY_ORDER.forEach((cat) => {
      partsList.appendChild(renderPartRow(cat, build.items[cat]));
    });
    card.appendChild(partsList);

    const footer = el("div", "build-footer");
    const totals = el("div", "build-totals");
    totals.appendChild(el("span", "total-usd", HWFormat.fmtUsd(build.totalUsd)));
    if (build.totalBrl) totals.appendChild(el("span", "total-brl", HWFormat.fmtBrl(build.totalBrl)));
    footer.appendChild(totals);
    footer.appendChild(el("div", "psu-note", `${build.anchorCategories.length} ancora(s) · fonte ${build.minWattage}W+`));
    card.appendChild(footer);

    if (build.notes && build.notes.length) {
      const notesBox = el("div", "build-notes");
      build.notes.forEach((n) => {
        const note = elHtml("div", "build-note", icon("alert"));
        note.appendChild(el("span", null, n));
        notesBox.appendChild(note);
      });
      card.appendChild(notesBox);
    }

    return card;
  }

  function renderBuilds(container, builds) {
    clear(container);
    if (builds.length === 0) {
      const empty = el("div", "empty-state");
      empty.appendChild(el("strong", null, "Nenhuma build completa com os dados atuais"));
      empty.appendChild(el("div", null, "Rode a coleta para trazer mais produtos, ou revise itens pendentes na Base de dados."));
      container.appendChild(empty);
      return;
    }

    const [best, ...rest] = builds;
    const bestWrap = el("div", "best-build-wrap");
    bestWrap.appendChild(renderBuildCard(best, { highlight: true }));
    container.appendChild(bestWrap);

    if (rest.length) {
      const grid = el("div", "builds-grid");
      rest.forEach((b) => grid.appendChild(renderBuildCard(b)));
      container.appendChild(grid);
    }
  }

  function renderTopStrip(container, tops) {
    clear(container);
    HWBuilder.CATEGORY_ORDER.forEach((cat) => {
      const top = tops[cat];
      const meta = CATEGORY_META[cat];

      // o card so vira link quando ha um produto de verdade por tras
      const box = top ? el("a", "top-chip") : el("div", "top-chip");
      if (top) {
        box.href = top.url;
        box.target = "_blank";
        box.rel = "noopener noreferrer";
        box.appendChild(thumb(top, "thumb--sm"));
      }

      const body = el("div", "top-chip-body");
      body.appendChild(el("div", "top-chip-label", `Top ${meta.label}`));
      if (top) {
        body.appendChild(el("div", "top-chip-name", top.name));
        body.appendChild(
          el("div", "top-chip-price", `${HWFormat.fmtUsd(top.price_usd)} · valor ${HWFormat.fmtScore(top.valueRatio)}`)
        );
      } else {
        body.appendChild(el("div", "top-chip-name muted", "sem dados suficientes"));
      }
      box.appendChild(body);
      container.appendChild(box);
    });
  }

  window.HWRender = { renderStatus, renderBuilds, renderTopStrip, CATEGORY_META };
})();
