/**
 * Calculo do indice de performance e do indice de custo-beneficio
 * (performance / preco) de cada produto, categoria por categoria.
 *
 * CPU e GPU: performance vem da base curada de benchmarks (PassMark-like),
 * casada por model_key (exato ou fuzzy) -- ver matcher.js.
 *
 * RAM / PSU / Armazenamento / Placa-Mae: performance vem de formulas
 * aplicadas diretamente sobre as specs extraidas do nome do produto pelo
 * scraper (capacidade, velocidade, wattagem, selo 80 PLUS, interface,
 * tier de chipset). Documentadas abaixo, cada formula e uma heuristica
 * simples e monotonica (mais capacidade/velocidade/eficiencia = mais
 * score), nao uma medicao real de laboratorio.
 */

function scoreCpu(product, benchmarks) {
  const specs = product.specs || {};
  if (!specs.model_key) return null;
  const match = HWMatch.matchBenchmark(specs.model_key, specs.brand, benchmarks.cpu);
  if (!match) return null;
  return {
    score: match.entry.score,
    matchType: match.matchType,
    matchedKey: match.key,
    socket: match.entry.socket || specs.socket || null,
    cores: match.entry.cores || null,
  };
}

function scoreGpu(product, benchmarks) {
  const specs = product.specs || {};
  if (!specs.model_key) return null;
  const match = HWMatch.matchBenchmark(specs.model_key, specs.brand, benchmarks.gpu);
  if (!match) return null;
  return {
    score: match.entry.score,
    matchType: match.matchType,
    matchedKey: match.key,
    tdpW: match.entry.tdp_w || null,
    vramGb: specs.vram_gb || match.entry.vram_default || null,
  };
}

function scoreRam(product, benchmarks) {
  const specs = product.specs || {};
  // memoria SO-DIMM de notebook nao serve numa build desktop -- descarta.
  // se o usuario confirmar explicitamente form_factor "DIMM" (revisao manual
  // na pagina de base de dados), isso corrige um falso positivo do regex.
  const looksNotebook =
    specs.form_factor === "SODIMM" ||
    (specs.form_factor !== "DIMM" && /notebook|so-?dimm/i.test(product.name || ""));
  if (looksNotebook) return null;
  if (!specs.capacity_gb || !specs.speed_mhz) return null;

  // MT/s (o "MHz" anunciado) ja e comparavel entre geracoes DDR2/3/4/5 --
  // largura de banda = MT/s x 8 bytes, independente da geracao. O que NAO
  // e comparavel entre geracoes e o numero cru de CAS Latency (CL): um
  // DDR5-6000 CL36 tem uma latencia real muito diferente de um DDR4-3200
  // CL16 mesmo com CL numerico parecido. A forma correta de comparar e
  // converter para latencia real em nanossegundos: ns = (CL x 2000) / MT/s.
  const ramConfig = (benchmarks && benchmarks.ram_scoring) || {};
  const referenceNs = ramConfig.reference_latency_ns ?? 10;
  const minMultiplier = ramConfig.min_latency_multiplier ?? 0.6;
  const maxMultiplier = ramConfig.max_latency_multiplier ?? 1.4;

  let latencyMultiplier = 1;
  let trueLatencyNs = null;
  if (specs.cas_latency) {
    trueLatencyNs = (specs.cas_latency * 2000) / specs.speed_mhz;
    latencyMultiplier = Math.min(maxMultiplier, Math.max(minMultiplier, referenceNs / trueLatencyNs));
  }

  // heuristica: capacidade x velocidade (normalizado por 32) x fator de latencia real
  // (DDR4-3200 CL16 8GB, sem CL informado -> score 800; com CL, ajustado para cima/baixo)
  const score = specs.capacity_gb * (specs.speed_mhz / 32) * latencyMultiplier;
  return { score, matchType: "formula", latencyMultiplier, trueLatencyNs };
}

function scorePsu(product, benchmarks) {
  const specs = product.specs || {};
  if (!specs.wattage) return null;
  const mult = benchmarks.psu_efficiency_multiplier[specs.efficiency || "none"] ?? 1.0;
  const score = specs.wattage * mult;
  return { score, matchType: "formula" };
}

function scoreStorage(product, benchmarks) {
  const specs = product.specs || {};
  if (!specs.capacity_gb || !specs.interface) return null;
  const mult = benchmarks.storage_interface_multiplier[specs.interface] ?? 1.0;
  const score = specs.capacity_gb * mult;
  return { score, matchType: "formula" };
}

function scoreMotherboard(product, benchmarks) {
  const specs = product.specs || {};
  const chipsetInfo = specs.chipset ? benchmarks.chipsets[specs.chipset] : null;
  const tier = chipsetInfo ? chipsetInfo.tier : specs.socket ? 1 : null;
  if (tier === null) return null;
  const score = tier * 10;
  const ramType = chipsetInfo ? chipsetInfo.ram : benchmarks.socket_default_ram[specs.socket] || null;
  const maxRamMhz = chipsetInfo ? chipsetInfo.max_ram_mhz : (benchmarks.socket_max_ram_mhz || {})[specs.socket] || null;
  return {
    score,
    matchType: chipsetInfo ? "chipset-table" : "socket-fallback",
    tier,
    ramType,
    maxRamMhz,
    socket: specs.socket || (chipsetInfo && chipsetInfo.socket) || null,
  };
}

const SCORERS = {
  cpu: scoreCpu,
  gpu: scoreGpu,
  ram: scoreRam,
  psu: scorePsu,
  storage: scoreStorage,
  motherboard: scoreMotherboard,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Descarta outliers estatisticos de indice performance/preco (valueRatio),
 * tipicamente causados por erro de preco na fonte (ex: um produto de US$
 * 200+ listado por engano a US$ 10) em vez de uma pechincha real. Usa
 * desvio absoluto mediano (MAD) com margem generosa para nao descartar
 * ofertas legitimamente boas -- so casos extremos.
 */
function flagValueOutliers(scoredList) {
  if (scoredList.length < 5) return scoredList;
  const ratios = scoredList.map((p) => p.valueRatio);
  const med = median(ratios);
  const mad = median(ratios.map((r) => Math.abs(r - med))) || med * 0.25 || 1;
  const upperFence = med + 8 * mad;

  return scoredList.map((p) => {
    if (p.valueRatio > upperFence) {
      return { ...p, scored: false, reason: "outlier estatistico de preco (provavel erro na fonte)" };
    }
    return p;
  });
}

/**
 * Enriquece uma lista de produtos de UMA categoria com performance/preco.
 * Produtos sem specs suficientes para pontuar sao mantidos no array
 * (para transparencia na UI) mas marcados com scored:false e nao entram
 * no calculo de builds.
 */
function scoreProducts(category, products, benchmarks) {
  const scorer = SCORERS[category];
  const initial = products.map((p) => {
    if (!p.price_usd || p.price_usd <= 0) {
      return { ...p, scored: false, reason: "sem preco valido" };
    }
    const result = scorer(p, benchmarks);
    if (!result) {
      return { ...p, scored: false, reason: "specs insuficientes / sem match na base" };
    }
    return {
      ...p,
      scored: true,
      performance: result,
      perfScore: result.score,
      valueRatio: result.score / p.price_usd,
    };
  });

  const scored = initial.filter((p) => p.scored);
  const unscored = initial.filter((p) => !p.scored);
  return [...flagValueOutliers(scored), ...unscored];
}

window.HWScoring = { scoreProducts, SCORERS };
