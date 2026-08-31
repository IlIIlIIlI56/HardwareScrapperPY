/**
 * Orquestracao da pagina de builds: carrega os JSONs locais (produtos raspados
 * + base de benchmarks), aplica as decisoes salvas na Base de Dados, roda o
 * pipeline de pontuacao e montagem, e manda tudo para render.js exibir.
 * Nenhuma etapa aqui e manual -- e o codigo que escolhe as pecas TOP de cada
 * categoria e monta as builds.
 */
(function () {
  const DATA_DIR = "./data";

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${path}: HTTP ${res.status}`);
    return res.json();
  }

  function groupByCategory(products) {
    const groups = {};
    for (const cat of HWBuilder.CATEGORY_ORDER) groups[cat] = [];
    for (const p of products) {
      if (groups[p.category]) groups[p.category].push(p);
    }
    return groups;
  }

  async function main() {
    HWUi.initThemeToggleAndNav();

    const statusEl = document.getElementById("status-panel");
    const topStripEl = document.getElementById("top-strip");
    const buildsEl = document.getElementById("builds-container");
    const metaEl = document.getElementById("data-meta");

    const statusLines = [{ text: "Carregando dados/products.json e dados/benchmarks.json...", level: "info" }];
    HWRender.renderStatus(statusEl, statusLines);

    let productsData, benchmarks;
    try {
      [productsData, benchmarks] = await Promise.all([
        loadJson(`${DATA_DIR}/products.json`),
        loadJson(`${DATA_DIR}/benchmarks.json`),
      ]);
    } catch (err) {
      statusLines.push({ text: `Erro: ${err.message}`, level: "error" });
      statusLines.push({
        text: 'Rode a coleta primeiro -- use o botao "Coletar dados agora" no topo desta pagina.',
        level: "warn",
      });
      HWRender.renderStatus(statusEl, statusLines);
      metaEl.textContent = "sem dados coletados ainda";
      return;
    }

    statusLines.push({
      text: `${productsData.total_products} produtos carregados (coleta de ${HWFormat.fmtDate(productsData.scraped_at)}).`,
      level: "ok",
    });

    metaEl.textContent = productsData.total_products
      ? `${productsData.total_products} produtos · coleta de ${HWFormat.fmtDate(productsData.scraped_at)} · ` +
        `fonte: ${productsData.source}`
      : "nenhum dado coletado ainda -- use o botao \"Coletar dados agora\" acima";

    const { added, ignored } = HWOverrides.overrideCounts();
    if (added || ignored) {
      statusLines.push({
        text: `Decisoes manuais aplicadas: ${added} revisados, ${ignored} ignorados.`,
        level: "info",
      });
    }

    const bench = HWOverrides.benchmarkCounts();
    if (bench.total) {
      const bits = [];
      if (bench.cpu + bench.gpu + bench.chipsets) bits.push(`${bench.cpu + bench.gpu + bench.chipsets} entradas`);
      if (bench.aliases) bits.push(`${bench.aliases} apelidos`);
      if (bench.tuning) bits.push(`${bench.tuning} ajustes de parametro`);
      statusLines.push({ text: `Base de performance estendida pelo usuario: ${bits.join(", ")}.`, level: "info" });
    }
    const effectiveBenchmarks = HWOverrides.applyBenchmarkOverrides(benchmarks);

    const workingProducts = HWOverrides.applyOverridesToProducts(productsData.products);
    const rawByCategory = groupByCategory(workingProducts);
    const scoredByCategory = {};
    for (const cat of HWBuilder.CATEGORY_ORDER) {
      const scored = HWScoring.scoreProducts(cat, rawByCategory[cat], effectiveBenchmarks);
      scoredByCategory[cat] = scored.filter((p) => p.scored);
      const label = HWRender.CATEGORY_META[cat].label;
      const pct = scored.length ? Math.round((scoredByCategory[cat].length / scored.length) * 100) : 0;
      statusLines.push({
        text: `${label}: ${scoredByCategory[cat].length}/${scored.length} produtos pontuados (${pct}%).`,
        level: scoredByCategory[cat].length === 0 ? "warn" : "info",
      });
    }
    HWRender.renderStatus(statusEl, statusLines);

    const emptyCats = HWBuilder.CATEGORY_ORDER.filter((cat) => scoredByCategory[cat].length === 0);
    if (emptyCats.length) {
      statusLines.push({
        text: `Sem produtos pontuaveis em: ${emptyCats.map((c) => HWRender.CATEGORY_META[c].label).join(", ")}. Uma build precisa das seis categorias -- verifique se a coleta cobriu todas.`,
        level: "error",
      });
      HWRender.renderStatus(statusEl, statusLines);
      HWRender.renderTopStrip(topStripEl, {});
      HWRender.renderBuilds(buildsEl, []);
      return;
    }

    const { tops, builds } = HWBuilder.buildAllOptions(scoredByCategory, effectiveBenchmarks);
    HWRender.renderTopStrip(topStripEl, tops);

    statusLines.push({
      text: `${builds.length} builds montadas e ranqueadas por indice de custo-beneficio.`,
      level: "ok",
    });
    HWRender.renderStatus(statusEl, statusLines);
    HWRender.renderBuilds(buildsEl, builds);
  }

  main().catch((err) => {
    console.error(err);
    const statusEl = document.getElementById("status-panel");
    if (statusEl) HWRender.renderStatus(statusEl, [{ text: `Erro inesperado: ${err.message}`, level: "error" }]);
  });
})();
