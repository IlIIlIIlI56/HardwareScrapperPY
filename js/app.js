/**
 * Orquestracao principal: carrega os JSONs locais (produtos raspados +
 * base de benchmarks), roda o pipeline de pontuacao e montagem de builds,
 * e manda tudo para render.js exibir. Nenhuma etapa aqui e manual --
 * e o codigo quem escolhe as pecas TOP de cada categoria e monta as builds.
 */

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

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

async function main() {
  const statusEl = document.getElementById("status-panel");
  const topStripEl = document.getElementById("top-strip");
  const buildsEl = document.getElementById("builds-container");
  const metaEl = document.getElementById("data-meta");

  const statusLines = [{ text: "Carregando data/products.json e data/benchmarks.json...", level: "info" }];
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
      text: "Rode o scraper primeiro: cd scraper && pip install -r requirements.txt && python scrape_comprasparaguai.py",
      level: "warn",
    });
    HWRender.renderStatus(statusEl, statusLines);
    return;
  }

  statusLines.push({
    text: `${productsData.total_products} produtos carregados (raspados em ${formatDate(productsData.scraped_at)}).`,
    level: "ok",
  });

  const overrides = HWOverrides.getOverrides();
  const addedCount = Object.values(overrides).filter((o) => o.decision === "added").length;
  const ignoredCount = Object.values(overrides).filter((o) => o.decision === "ignored").length;
  if (addedCount || ignoredCount) {
    statusLines.push({
      text: `Decisoes manuais aplicadas (pagina Base de Dados): ${addedCount} adicionados, ${ignoredCount} ignorados.`,
      level: "info",
    });
  }

  const benchOverrides = HWOverrides.getBenchmarkOverrides();
  const customBenchCount = Object.keys(benchOverrides.cpu).length + Object.keys(benchOverrides.gpu).length + Object.keys(benchOverrides.chipsets).length;
  if (customBenchCount) {
    statusLines.push({
      text: `${customBenchCount} entradas de benchmark adicionadas manualmente estao em uso.`,
      level: "info",
    });
  }
  const effectiveBenchmarks = HWOverrides.applyBenchmarkOverrides(benchmarks);

  const workingProducts = HWOverrides.applyOverridesToProducts(productsData.products);

  const rawByCategory = groupByCategory(workingProducts);
  const scoredByCategory = {};
  for (const cat of HWBuilder.CATEGORY_ORDER) {
    const scored = HWScoring.scoreProducts(cat, rawByCategory[cat], effectiveBenchmarks);
    scoredByCategory[cat] = scored.filter((p) => p.scored);
    const label = HWRender.CATEGORY_META[cat].label;
    statusLines.push({
      text: `${label}: ${scoredByCategory[cat].length}/${scored.length} produtos pontuados (specs reconhecidas + match de performance).`,
      level: "info",
    });
  }
  HWRender.renderStatus(statusEl, statusLines);

  const anyEmpty = HWBuilder.CATEGORY_ORDER.some((cat) => scoredByCategory[cat].length === 0);
  if (anyEmpty) {
    statusLines.push({
      text: "Alguma categoria ficou sem produtos pontuaveis -- verifique se o scraper coletou todas as categorias.",
      level: "error",
    });
    HWRender.renderStatus(statusEl, statusLines);
    return;
  }

  const { tops, builds } = HWBuilder.buildAllOptions(scoredByCategory, effectiveBenchmarks);
  HWRender.renderTopStrip(topStripEl, tops);

  statusLines.push({ text: `${builds.length} builds montadas e ranqueadas por indice de custo-beneficio.`, level: "ok" });
  HWRender.renderStatus(statusEl, statusLines);

  HWRender.renderBuilds(buildsEl, builds);

  metaEl.textContent = `Fonte: ${productsData.source} · dados raspados em ${formatDate(productsData.scraped_at)} · ${productsData.total_products} produtos analisados`;
}

main().catch((err) => {
  console.error(err);
  const statusEl = document.getElementById("status-panel");
  HWRender.renderStatus(statusEl, [{ text: `Erro inesperado: ${err.message}`, level: "error" }]);
});
