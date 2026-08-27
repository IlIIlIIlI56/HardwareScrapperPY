/**
 * Renderizacao pura em DOM das builds calculadas. Nao ha nenhum passo
 * manual aqui -- este modulo apenas exibe o que builder.js decidiu.
 */

const CATEGORY_META = {
  cpu: { label: "Processador" },
  motherboard: { label: "Placa-Mae" },
  ram: { label: "Memoria RAM" },
  gpu: { label: "Placa de Video" },
  psu: { label: "Fonte" },
  storage: { label: "Armazenamento" },
};

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function renderStatus(container, lines) {
  container.innerHTML = "";
  const list = el("ul", "status-log");
  lines.forEach((line) => {
    const li = el("li", `status-line status-${line.level || "info"}`, line.text);
    list.appendChild(li);
  });
  container.appendChild(list);
}

function renderPartRow(category, item) {
  const meta = CATEGORY_META[category];
  const row = el("a", "part-row", "");
  row.href = item.url;
  row.target = "_blank";
  row.rel = "noopener noreferrer";

  const left = el("div", "part-left");
  const info = el("div", "part-info");
  const categoryLine = el("div", "part-category", meta.label);
  if (item.manuallyAdded) categoryLine.appendChild(el("span", "part-manual-tag", "revisado manualmente"));
  info.appendChild(categoryLine);
  info.appendChild(el("div", "part-name", item.name));
  left.appendChild(info);

  const right = el("div", "part-right");
  right.appendChild(el("div", "part-price-usd", HWFormat.fmtUsd(item.price_usd)));
  if (item.price_brl) right.appendChild(el("div", "part-price-brl", HWFormat.fmtBrl(item.price_brl)));

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function renderBuildCard(build, options = {}) {
  const { highlight = false } = options;
  const card = el("article", `build-card${highlight ? " build-card--best" : ""}`);

  if (highlight) {
    card.appendChild(el("div", "best-badge", "Melhor custo-beneficio geral"));
  }

  const header = el("div", "build-header");
  const anchorLabels = build.anchorCategories.map((c) => CATEGORY_META[c].label).join(" + ");
  header.appendChild(el("div", "build-rank", `#${build.rank}`));
  const titleWrap = el("div", "build-title-wrap");
  titleWrap.appendChild(el("h3", "build-title", `Build ancorada em: ${anchorLabels}`));
  titleWrap.appendChild(
    el(
      "div",
      "build-subtitle",
      `Indice de performance: ${build.performanceIndex.toFixed(1)} · Indice de valor: ${build.valueIndex.toFixed(3)}`
    )
  );
  header.appendChild(titleWrap);
  card.appendChild(header);

  const partsList = el("div", "parts-list");
  HWBuilder.CATEGORY_ORDER.forEach((cat) => {
    partsList.appendChild(renderPartRow(cat, build.items[cat]));
  });
  card.appendChild(partsList);

  const footer = el("div", "build-footer");
  const totals = el("div", "build-totals");
  totals.appendChild(el("span", "total-usd", `Total: ${HWFormat.fmtUsd(build.totalUsd)}`));
  if (build.totalBrl) totals.appendChild(el("span", "total-brl", HWFormat.fmtBrl(build.totalBrl)));
  footer.appendChild(totals);
  footer.appendChild(el("div", "psu-note", `Fonte recomendada: ${build.minWattage}W+`));
  card.appendChild(footer);

  if (build.notes && build.notes.length) {
    const notesBox = el("div", "build-notes");
    build.notes.forEach((n) => notesBox.appendChild(el("div", "build-note", n)));
    card.appendChild(notesBox);
  }

  return card;
}

function renderBuilds(container, builds) {
  container.innerHTML = "";
  if (builds.length === 0) {
    container.appendChild(
      el("div", "empty-state", "Nenhuma build completa pode ser montada com os dados atuais. Rode o scraper para coletar mais produtos.")
    );
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
  container.innerHTML = "";
  HWBuilder.CATEGORY_ORDER.forEach((cat) => {
    const top = tops[cat];
    const meta = CATEGORY_META[cat];
    const box = el("div", "top-chip");
    box.appendChild(el("div", "top-chip-label", `Top ${meta.label}`));
    if (top) {
      box.appendChild(el("div", "top-chip-name", top.name));
      box.appendChild(el("div", "top-chip-price", HWFormat.fmtUsd(top.price_usd)));
    } else {
      box.appendChild(el("div", "top-chip-name muted", "sem dados suficientes"));
    }
    container.appendChild(box);
  });
}

window.HWRender = { renderStatus, renderBuilds, renderTopStrip, CATEGORY_META };
