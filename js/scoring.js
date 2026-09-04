/**
 * Calculo do indice de performance e do indice de custo-beneficio
 * (performance / preco) de cada produto, categoria por categoria.
 *
 * CPU e GPU: performance vem da base curada de benchmarks (PassMark-like),
 * casada por model_key -- exata, por apelido do usuario ou por similaridade
 * (ver matcher.js).
 *
 * RAM / PSU / Armazenamento / Placa-Mae: performance vem de formulas aplicadas
 * sobre as specs extraidas do nome do produto pelo scraper (capacidade,
 * velocidade, wattagem, selo 80 PLUS, interface, tier de chipset). Cada formula
 * e uma heuristica simples e monotonica (mais capacidade/velocidade/eficiencia
 * = mais score), nao uma medicao de laboratorio.
 */

/* ==========================================================================
   motivos de exclusao
   --------------------------------------------------------------------------
   Antes, tudo que nao pontuava recebia a mesma frase ("specs insuficientes /
   sem match na base"), o que juntava problemas de naturezas bem diferentes:
   um anuncio sem preco, uma RAM de notebook, um modelo que o regex leu certo
   mas que falta na base. Sao acoes distintas para o usuario -- ignorar,
   corrigir um campo, cadastrar um benchmark -- entao cada caso agora tem um
   codigo proprio, e a UI decide o que oferecer a partir dele.
   ========================================================================== */

const REASON = {
  NO_PRICE: "no_price",
  MISSING_FIELDS: "missing_fields",
  NO_BENCHMARK: "no_benchmark",
  UNKNOWN_CHIPSET: "unknown_chipset",
  SODIMM: "sodimm",
  PRICE_OUTLIER: "price_outlier",
};

const REASON_TEXT = {
  [REASON.NO_PRICE]: "Anúncio sem preço válido em USD.",
  [REASON.MISSING_FIELDS]: "Faltam especificações que o nome do produto não permitiu extrair.",
  [REASON.NO_BENCHMARK]: "O modelo foi identificado, mas não existe na base de performance.",
  [REASON.UNKNOWN_CHIPSET]: "Chipset não reconhecido e sem soquete identificado.",
  [REASON.SODIMM]: "Memória SO-DIMM (notebook) — não encaixa numa placa-mãe desktop.",
  [REASON.PRICE_OUTLIER]: "Índice desempenho/preço muito fora do padrão da categoria (provável erro de preço na fonte).",
};

/** Campos que cada categoria precisa ter para o scorer conseguir rodar. */
const REQUIRED_FIELDS = {
  cpu: [["model_key", "Modelo"]],
  gpu: [["model_key", "Modelo"]],
  ram: [
    ["capacity_gb", "Capacidade"],
    ["speed_mhz", "Velocidade"],
  ],
  psu: [["wattage", "Wattagem"]],
  storage: [
    ["capacity_gb", "Capacidade"],
    ["interface", "Interface"],
  ],
  motherboard: [],
};

/* ==========================================================================
   scorers por categoria
   ========================================================================== */

function scoreCpu(product, benchmarks) {
  const specs = product.specs || {};
  if (!specs.model_key) return null;
  const match = HWMatch.matchBenchmark(specs.model_key, specs.brand, benchmarks.cpu, (benchmarks.aliases || {}).cpu);
  if (!match) return null;
  return {
    score: match.entry.score,
    matchType: match.matchType,
    matchedKey: match.key,
    similarity: match.similarity ?? null,
    socket: match.entry.socket || specs.socket || null,
    cores: match.entry.cores || null,
  };
}

function scoreGpu(product, benchmarks) {
  const specs = product.specs || {};
  if (!specs.model_key) return null;
  const match = HWMatch.matchBenchmark(specs.model_key, specs.brand, benchmarks.gpu, (benchmarks.aliases || {}).gpu);
  if (!match) return null;
  return {
    score: match.entry.score,
    matchType: match.matchType,
    matchedKey: match.key,
    similarity: match.similarity ?? null,
    tdpW: match.entry.tdp_w || null,
    vramGb: specs.vram_gb || match.entry.vram_default || null,
  };
}

/**
 * Memoria SO-DIMM (formato de notebook) nao serve numa build desktop --
 * fisicamente incompativel com o encaixe DIMM de uma placa-mae de mesa,
 * independente de capacidade/velocidade estarem corretas. Exportada (nao so
 * usada dentro de scoreRam) para que a pagina Database possa mostrar o
 * motivo real da exclusao em vez do generico "specs insuficientes" quando na
 * verdade as specs estao completas e validas.
 */
function isNotebookRam(specs, name) {
  return specs.form_factor === "SODIMM" || (specs.form_factor !== "DIMM" && /notebook|so-?dimm/i.test(name || ""));
}

function scoreRam(product, benchmarks) {
  const specs = product.specs || {};
  // se o usuario confirmar explicitamente form_factor "DIMM" (revisao manual),
  // isso corrige um falso positivo do regex.
  if (isNotebookRam(specs, product.name)) return null;
  if (!specs.capacity_gb || !specs.speed_mhz) return null;

  // MT/s (o "MHz" anunciado) ja e comparavel entre geracoes DDR2/3/4/5 --
  // largura de banda = MT/s x 8 bytes, independente da geracao. O que NAO e
  // comparavel entre geracoes e o numero cru de CAS Latency (CL): um DDR5-6000
  // CL36 tem latencia real bem diferente de um DDR4-3200 CL16 apesar do CL
  // parecido. A forma correta e converter para nanossegundos: ns = CL x 2000 / MT/s.
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

  // capacidade x velocidade (normalizada por 32) x fator de latencia real
  const score = specs.capacity_gb * (specs.speed_mhz / 32) * latencyMultiplier;
  return { score, matchType: "formula", latencyMultiplier, trueLatencyNs };
}

function scorePsu(product, benchmarks) {
  const specs = product.specs || {};
  if (!specs.wattage) return null;
  const mult = (benchmarks.psu_efficiency_multiplier || {})[specs.efficiency || "none"] ?? 1.0;
  return { score: specs.wattage * mult, matchType: "formula", efficiencyMultiplier: mult };
}

function scoreStorage(product, benchmarks) {
  const specs = product.specs || {};
  if (!specs.capacity_gb || !specs.interface) return null;
  const mult = (benchmarks.storage_interface_multiplier || {})[specs.interface] ?? 1.0;
  return { score: specs.capacity_gb * mult, matchType: "formula", interfaceMultiplier: mult };
}

/**
 * Teto de performance de cada soquete: o maior score de CPU que a base conhece
 * para ele. Calculado uma vez por objeto de benchmarks (o WeakMap segue o
 * objeto mesclado que applyBenchmarkOverrides devolve, entao cadastrar uma CPU
 * nova recalcula sozinho na proxima passada).
 */
const socketCeilingCache = new WeakMap();

function socketCeilings(benchmarks) {
  const cached = socketCeilingCache.get(benchmarks);
  if (cached) return cached;
  const bySocket = {};
  let max = 1;
  for (const entry of Object.values(benchmarks.cpu || {})) {
    if (!entry.socket || !entry.score) continue;
    bySocket[entry.socket] = Math.max(bySocket[entry.socket] || 0, entry.score);
    if (entry.score > max) max = entry.score;
  }
  const known = Object.values(bySocket);
  const min = known.length ? Math.min(...known) : max;
  const result = { bySocket, max, min };
  socketCeilingCache.set(benchmarks, result);
  return result;
}

function scoreMotherboard(product, benchmarks) {
  const specs = product.specs || {};
  const match = HWMatch.matchChipset(specs.chipset, benchmarks.chipsets, (benchmarks.aliases || {}).chipsets);
  const chipsetInfo = match ? match.entry : null;
  const tier = chipsetInfo ? chipsetInfo.tier : specs.socket ? 1 : null;
  if (tier === null) return null;

  const socket = specs.socket || (chipsetInfo && chipsetInfo.socket) || null;
  const ramType = (chipsetInfo && chipsetInfo.ram) || (benchmarks.socket_default_ram || {})[socket] || null;
  // uma entrada de chipset cadastrada a mao pode nao trazer max_ram_mhz; cair
  // para a tabela por soquete e melhor do que deixar o montador sem referencia
  // e escolher uma RAM que a plataforma nao aproveita.
  const maxRamMhz =
    (chipsetInfo && chipsetInfo.max_ram_mhz) || (benchmarks.socket_max_ram_mhz || {})[socket] || null;

  // O score da placa-mae era `tier * 10` e mais nada -- ou seja, cego a
  // plataforma. Uma B85 (LGA1150, DDR3, PCIe 3.0, teto no i7-4790) recebia
  // exatamente a mesma nota de uma B550 (AM4, DDR4, PCIe 4.0, teto no Ryzen 9
  // 5950X) por serem as duas "tier 2", e como custa um terco do preco ela vencia
  // o custo-beneficio da categoria e ancorava a build inteira numa plataforma
  // morta. O quartil de performance mais fraco que findTopValue descarta tambem
  // nao ajudava: com so quatro valores possiveis (10/20/30/40), quase nada cai
  // fora dele.
  //
  // O fator de plataforma corrige isso usando um dado que ja existe na base: o
  // maior score de CPU disponivel para aquele soquete. E uma medida direta do
  // teto que a placa destrava, ela se atualiza sozinha conforme a base de CPUs
  // cresce, e nao exige nenhum campo novo em benchmarks.json.
  const { bySocket, max, min } = socketCeilings(benchmarks);
  const ceiling = socket ? bySocket[socket] : null;
  // Soquete sem NENHUMA CPU na base (FM2+, LGA775 e afins) nao pode receber o
  // fator neutro 1.0: isso premiaria justamente a plataforma sobre a qual nao
  // se sabe nada, e placas de LGA775 a US$ 19 iam parar no topo do indice de
  // valor da categoria. Como a base nao conhece nenhum processador para elas,
  // o teto assumido e o menor teto conhecido -- pessimista de proposito. Essas
  // placas ja saem das builds por restrictToBuildableSockets; o fator so
  // conserta a ordenacao mostrada na Database.
  const platformFactor = (ceiling || min) / max;

  return {
    score: tier * 10 * platformFactor,
    matchType: chipsetInfo ? (match.matchType === "alias" ? "chipset-alias" : "chipset-table") : "socket-fallback",
    matchedKey: match ? match.key : null,
    tier,
    platformFactor,
    socketCeiling: ceiling,
    ramType,
    maxRamMhz,
    socket,
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

/* ==========================================================================
   diagnostico
   ========================================================================== */

/**
 * Explica por que um produto nao pontuou, com codigo + texto + a lista exata
 * dos campos que faltam. E o que a tela de revisao usa para dizer "falta
 * Capacidade e Velocidade" em vez de "specs insuficientes".
 */
function diagnoseUnscored(category, product, benchmarks) {
  const specs = product.specs || {};
  if (!product.price_usd || product.price_usd <= 0) {
    return { code: REASON.NO_PRICE, message: REASON_TEXT[REASON.NO_PRICE], missing: [] };
  }
  if (category === "ram" && isNotebookRam(specs, product.name)) {
    return { code: REASON.SODIMM, message: REASON_TEXT[REASON.SODIMM], missing: [] };
  }

  const missing = (REQUIRED_FIELDS[category] || [])
    .filter(([key]) => specs[key] === null || specs[key] === undefined || specs[key] === "")
    .map(([, label]) => label);
  if (missing.length) {
    return {
      code: REASON.MISSING_FIELDS,
      message: `Falta preencher: ${missing.join(", ")}.`,
      missing,
    };
  }

  if (category === "cpu" || category === "gpu") {
    return {
      code: REASON.NO_BENCHMARK,
      message: `Modelo "${specs.model_key}" não encontrado na base de performance.`,
      missing: [],
      modelKey: specs.model_key,
    };
  }
  if (category === "motherboard") {
    return {
      code: REASON.UNKNOWN_CHIPSET,
      message: specs.chipset
        ? `Chipset "${specs.chipset}" não está na base e o anúncio não traz soquete reconhecível.`
        : "Nem chipset nem soquete foram reconhecidos no nome do anúncio.",
      missing: specs.chipset ? [] : ["Soquete ou chipset"],
    };
  }
  return { code: REASON.MISSING_FIELDS, message: REASON_TEXT[REASON.MISSING_FIELDS], missing: [] };
}

/* ==========================================================================
   pontuacao em lote
   ========================================================================== */

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Descarta outliers estatisticos de indice performance/preco (valueRatio),
 * tipicamente causados por erro de preco na fonte (ex: um produto de US$ 200+
 * listado por engano a US$ 10) em vez de uma pechincha real. Usa desvio
 * absoluto mediano (MAD) com margem generosa: so casos extremos saem.
 *
 * A isencao olha `priceConfirmed`, nao "foi revisado a mao": corrigir a
 * capacidade de um SSD e confirmar que um preco absurdo esta correto sao duas
 * afirmacoes diferentes, e antes a primeira desligava silenciosamente esta
 * protecao para aquele item (ver setOverride em overrides.js).
 */
function flagValueOutliers(scoredList) {
  if (scoredList.length < 5) return scoredList;
  const ratios = scoredList.map((p) => p.valueRatio);
  const med = median(ratios);
  const mad = median(ratios.map((r) => Math.abs(r - med))) || med * 0.25 || 1;
  const upperFence = med + 8 * mad;

  return scoredList.map((p) => {
    if (!p.priceConfirmed && p.valueRatio > upperFence) {
      return {
        ...p,
        scored: false,
        reasonCode: REASON.PRICE_OUTLIER,
        reason: REASON_TEXT[REASON.PRICE_OUTLIER],
        outlierFence: upperFence,
        categoryMedianValue: med,
      };
    }
    return p;
  });
}

/**
 * Enriquece uma lista de produtos de UMA categoria com performance/preco.
 * Produtos sem specs suficientes para pontuar continuam no array (para
 * transparencia na UI) marcados com scored:false, e nao entram nas builds.
 */
function scoreProducts(category, products, benchmarks) {
  const scorer = SCORERS[category];
  if (!scorer) return products.map((p) => ({ ...p, scored: false, reasonCode: REASON.MISSING_FIELDS, reason: `Categoria desconhecida: ${category}` }));

  const initial = products.map((p) => {
    const result = p.price_usd > 0 ? scorer(p, benchmarks) : null;
    if (!result) {
      const diag = diagnoseUnscored(category, p, benchmarks);
      return { ...p, scored: false, reasonCode: diag.code, reason: diag.message, missingFields: diag.missing };
    }
    return {
      ...p,
      scored: true,
      reasonCode: null,
      reason: null,
      performance: result,
      perfScore: result.score,
      valueRatio: result.score / p.price_usd,
    };
  });

  const scored = initial.filter((p) => p.scored);
  const unscored = initial.filter((p) => !p.scored);
  return [...flagValueOutliers(scored), ...unscored];
}

window.HWScoring = {
  scoreProducts,
  SCORERS,
  isNotebookRam,
  diagnoseUnscored,
  REASON,
  REASON_TEXT,
  REQUIRED_FIELDS,
};
