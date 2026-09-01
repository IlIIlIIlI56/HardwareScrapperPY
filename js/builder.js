/**
 * Algoritmo de montagem automatica das builds de custo-beneficio.
 *
 * Para cada uma das 6 categorias (CPU, Placa-Mae, RAM, GPU, PSU,
 * Armazenamento), o item "TOP Custo-Beneficio" daquela categoria vira a
 * "semente" (ancora) de uma build. As demais 5 pecas sao escolhidas
 * automaticamente entre as opcoes compativeis (socket, tipo de memoria,
 * wattagem minima de fonte) e dentro de uma faixa de preco/performance
 * ("tier") proxima a da peca ancora -- para nao misturar, por exemplo,
 * uma GPU de entrada com um CPU de ponta.
 *
 * Todo o processo e deterministico e roda 100% no navegador, em cima dos
 * produtos ja pontuados por scoring.js.
 */

const CATEGORY_ORDER = ["cpu", "motherboard", "ram", "gpu", "psu", "storage"];
const BUILD_WEIGHTS = { cpu: 0.3, gpu: 0.3, ram: 0.12, storage: 0.12, psu: 0.08, motherboard: 0.08 };
const TIER_COUNT = 5;

function assignPriceTiers(scoredProducts) {
  const sorted = [...scoredProducts].sort((a, b) => a.price_usd - b.price_usd);
  const n = sorted.length;
  sorted.forEach((p, i) => {
    const pct = n <= 1 ? 0 : i / (n - 1);
    p.priceTier = Math.min(TIER_COUNT - 1, Math.floor(pct * TIER_COUNT));
  });
  return sorted;
}

/** Melhor custo-beneficio de uma categoria, ignorando o quartil de performance mais fraco. */
function findTopValue(scoredProducts) {
  if (scoredProducts.length === 0) return null;
  const byPerf = [...scoredProducts].sort((a, b) => a.perfScore - b.perfScore);
  const floorIdx = Math.floor(byPerf.length * 0.25);
  const floorScore = byPerf[floorIdx].perfScore;
  const eligible = scoredProducts.filter((p) => p.perfScore >= floorScore);
  return eligible.reduce((best, p) => (!best || p.valueRatio > best.valueRatio ? p : best), null);
}

function bestByValue(candidates, rankFn = (p) => p.valueRatio) {
  return candidates.reduce((best, p) => (!best || rankFn(p) > rankFn(best) ? p : best), null);
}

/**
 * Escolhe o melhor custo-beneficio de uma categoria respeitando restricoes
 * obrigatorias (filterFn) e preferindo a faixa de preco (tier) mais proxima
 * da peca ancora, expandindo a janela ate encontrar alguma opcao. rankFn
 * (opcional) permite substituir o criterio de "melhor" -- usado para RAM,
 * que precisa levar em conta a velocidade que a plataforma aproveita (ver
 * effectiveRamRank), nao so o valueRatio intrinseco do produto.
 */
function pickCompatible(scoredProducts, tierTarget, filterFn, rankFn) {
  const hardFiltered = scoredProducts.filter(filterFn);
  if (hardFiltered.length === 0) return null;

  for (let window = 0; window < TIER_COUNT; window++) {
    const inWindow = hardFiltered.filter((p) => Math.abs((p.priceTier ?? 2) - tierTarget) <= window);
    if (inWindow.length > 0) return bestByValue(inWindow, rankFn);
  }
  return bestByValue(hardFiltered, rankFn);
}

/**
 * Como pickCompatible, mas tenta primeiro um filtro estrito; so recorre ao
 * filtro permissivo (fallback) se a busca estrita nao encontrar nada.
 * Usado para RAM: nunca deveria misturar DDR2 com um socket que exige DDR5,
 * mas se o catalogo raspado nao tiver nenhuma RAM com o tipo identificado,
 * e melhor sugerir alguma opcao (com aviso) do que deixar a build incompleta.
 */
function pickCompatibleStrict(scoredProducts, tierTarget, strictFn, fallbackFn, rankFn) {
  const strictPick = pickCompatible(scoredProducts, tierTarget, strictFn, rankFn);
  if (strictPick) return { item: strictPick, wasFallback: false };
  const fallbackPick = pickCompatible(scoredProducts, tierTarget, fallbackFn, rankFn);
  return fallbackPick ? { item: fallbackPick, wasFallback: true } : { item: null, wasFallback: false };
}

/**
 * Score "efetivo" de uma RAM dada a plataforma que vai recebe-la: se o kit
 * e mais rapido do que a placa-mae/CPU tipicamente aproveita (max_ram_mhz,
 * com uma folga de 10% para XMP/EXPO), o score e reduzido proporcionalmente
 * -- pagar por 6000MHz numa plataforma que so tira proveito ate ~3600MHz e
 * desperdicio de orcamento, mesmo que a RAM em si tenha um score intrinseco
 * otimo. RAM mais lenta que o recomendado NAO e penalizada aqui: ela ja
 * pontua naturalmente mais baixo pela formula de scoring.js (score e linear
 * em speed_mhz), e pode ser uma escolha legitima de custo-beneficio se o
 * preco compensar.
 */
function cappedRamScore(ramItem, recommendedMhz) {
  if (!ramItem) return null;
  const actualMhz = ramItem.specs.speed_mhz;
  if (!recommendedMhz || !actualMhz) return ramItem.perfScore;
  const HEADROOM = 1.1;
  const cappedMhz = Math.min(actualMhz, recommendedMhz * HEADROOM);
  if (cappedMhz >= actualMhz) return ramItem.perfScore;
  return ramItem.perfScore * (cappedMhz / actualMhz);
}

/** Como cappedRamScore, mas ja dividido pelo preco -- usado para RANKEAR opcoes de RAM. */
function effectiveRamRank(ramItem, recommendedMhz) {
  if (!ramItem.price_usd) return ramItem.valueRatio;
  return cappedRamScore(ramItem, recommendedMhz) / ramItem.price_usd;
}

function estimateCpuTdp(cpuItem) {
  const cores = cpuItem?.performance?.cores;
  if (!cores) return 95;
  if (cores <= 6) return 65;
  if (cores <= 10) return 95;
  if (cores <= 16) return 125;
  return 170;
}

function recommendedWattage(cpuItem, gpuItem) {
  const cpuTdp = estimateCpuTdp(cpuItem);
  const gpuTdp = gpuItem?.performance?.tdpW || 150;
  const raw = (cpuTdp + gpuTdp + 100) * 1.2;
  return Math.ceil(raw / 50) * 50;
}

/**
 * Monta uma build inteira a partir de uma peca-ancora (ja escolhida como
 * TOP Custo-Beneficio de sua categoria).
 */
function assembleBuild(anchorCategory, anchorItem, byCategory, benchmarks) {
  const tierTarget = anchorItem.priceTier ?? 2;
  const items = {};
  const notes = [];
  items[anchorCategory] = anchorItem;

  // 1) CPU + Placa-Mae (mutuamente dependentes pelo socket -- e, quando a
  // ancora e a propria RAM, tambem pelo tipo de memoria que ela exige).
  if (anchorCategory === "cpu") {
    items.motherboard = pickCompatible(
      byCategory.motherboard,
      tierTarget,
      (p) => !anchorItem.performance.socket || p.performance.socket === anchorItem.performance.socket
    );
  } else if (anchorCategory === "motherboard") {
    items.cpu = pickCompatible(
      byCategory.cpu,
      tierTarget,
      (p) => !anchorItem.performance.socket || p.performance.socket === anchorItem.performance.socket
    );
  } else if (anchorCategory === "ram") {
    // a RAM ancora ja tem um tipo (DDR4/DDR5) fixo -- a placa-mae precisa
    // aceitar esse tipo, e so entao o CPU e escolhido pelo socket dela.
    const requiredRam = anchorItem.specs.ddr_gen || null;
    items.motherboard = pickCompatible(
      byCategory.motherboard,
      tierTarget,
      (p) => !requiredRam || !p.performance.ramType || p.performance.ramType === requiredRam
    );
    const moboSocket = items.motherboard?.performance?.socket || null;
    items.cpu = pickCompatible(
      byCategory.cpu,
      tierTarget,
      (p) => !moboSocket || p.performance.socket === moboSocket
    );
  } else {
    items.cpu = pickCompatible(byCategory.cpu, tierTarget, () => true);
    const cpuSocket = items.cpu?.performance?.socket || null;
    items.motherboard = pickCompatible(
      byCategory.motherboard,
      tierTarget,
      (p) => !cpuSocket || p.performance.socket === cpuSocket
    );
  }

  if (!items.cpu || !items.motherboard) {
    notes.push("Não foi possível encontrar CPU + Placa-Mãe compatíveis no catálogo raspado.");
  }

  // 2) RAM -- precisa bater com o tipo de memoria da placa-mae escolhida, e
  // idealmente rodar perto da velocidade que a plataforma (CPU+placa-mae)
  // realmente aproveita -- ver effectiveRamRank.
  const ramType =
    items.motherboard?.performance?.ramType ||
    (benchmarks.socket_default_ram || {})[items.cpu?.performance?.socket] ||
    null;
  const recommendedRamMhz =
    items.motherboard?.performance?.maxRamMhz ||
    (benchmarks.socket_max_ram_mhz || {})[items.cpu?.performance?.socket] ||
    null;
  const ramRankFn = (p) => effectiveRamRank(p, recommendedRamMhz);

  if (anchorCategory === "ram") {
    // ja definido em items.ram = anchorItem -- so avisa se a RAM ancora for
    // bem mais rapida do que a plataforma escolhida depois dela aproveita.
    if (recommendedRamMhz && anchorItem.specs.speed_mhz > recommendedRamMhz * 1.15) {
      notes.push(
        `RAM roda a ${anchorItem.specs.speed_mhz}MHz, acima do que essa plataforma costuma aproveitar (~${recommendedRamMhz}MHz) — a velocidade extra pode ficar sem uso.`
      );
    }
  } else if (!ramType) {
    items.ram = pickCompatible(byCategory.ram, tierTarget, () => true, ramRankFn);
  } else {
    const { item, wasFallback } = pickCompatibleStrict(
      byCategory.ram,
      tierTarget,
      (p) => p.specs.ddr_gen === ramType,
      (p) => !p.specs.ddr_gen,
      ramRankFn
    );
    items.ram = item;
    if (wasFallback) {
      notes.push(`Nenhuma RAM ${ramType} identificada com confiança no catálogo — verifique compatibilidade antes de comprar.`);
    }
  }
  if (!items.ram) notes.push("Nenhuma memória RAM compatível encontrada.");

  // 3) GPU -- sem restricao de compatibilidade dura, so faixa de preco/tier
  if (anchorCategory !== "gpu") {
    items.gpu = pickCompatible(byCategory.gpu, tierTarget, () => true);
  }
  if (!items.gpu) notes.push("Nenhuma GPU disponível na categoria.");

  // 4) Armazenamento -- sem restricao dura
  if (anchorCategory !== "storage") {
    items.storage = pickCompatible(byCategory.storage, tierTarget, () => true);
  }
  if (!items.storage) notes.push("Nenhum SSD/HD disponível na categoria.");

  // 5) Fonte -- precisa suportar a wattagem estimada de CPU+GPU com folga
  const minWattage = recommendedWattage(items.cpu, items.gpu);
  if (anchorCategory !== "psu") {
    items.psu = pickCompatible(
      byCategory.psu,
      tierTarget,
      (p) => !p.specs.wattage || p.specs.wattage >= minWattage
    );
  }
  // vale tambem quando a fonte E a ancora: nesse caso ela foi eleita pelo
  // custo-beneficio da propria categoria, antes de existir um CPU e uma GPU
  // para alimentar -- e pode nao dar conta da dupla escolhida depois.
  if (items.psu && items.psu.specs.wattage && items.psu.specs.wattage < minWattage) {
    notes.push(
      `Fonte de ${items.psu.specs.wattage}W abaixo do recomendado para esta combinação (>= ${minWattage}W).`
    );
  }
  if (!items.psu) notes.push("Nenhuma fonte compatível encontrada.");

  const complete = CATEGORY_ORDER.every((cat) => !!items[cat]);
  if (!complete) return { anchorCategory, complete: false, notes };

  const totalUsd = CATEGORY_ORDER.reduce((sum, cat) => sum + items[cat].price_usd, 0);
  const totalBrl = CATEGORY_ORDER.reduce((sum, cat) => sum + (items[cat].price_brl || 0), 0);

  // usado por scoreBuild: garante que uma RAM anchor mais rapida do que a
  // plataforma aproveita nao infle o indice de performance/valor da build
  // com velocidade que na pratica fica sem uso (mesma logica de effectiveRamRank).
  const ramEffectiveScore = cappedRamScore(items.ram, recommendedRamMhz);

  return {
    anchorCategory,
    anchorCategories: [anchorCategory],
    complete: true,
    items,
    totalUsd,
    totalBrl,
    minWattage,
    ramEffectiveScore,
    recommendedRamMhz,
    ramType,
    notes,
  };
}

function computeNormalizers(byCategory) {
  const norm = {};
  for (const cat of CATEGORY_ORDER) {
    const scores = byCategory[cat].map((p) => p.perfScore);
    norm[cat] = scores.length ? Math.max(...scores) : 1;
  }
  return norm;
}

function scoreBuild(build, normalizers) {
  let performanceIndex = 0;
  // guardado para a UI: quanto cada peca contribuiu do indice final e quanto do
  // orcamento ela consumiu -- e o que mostra, sem abrir o codigo, por que uma
  // build "boa no papel" gasta metade do dinheiro num item de peso 0.08.
  const perCategory = {};
  for (const cat of CATEGORY_ORDER) {
    // RAM usa o score "efetivo" (capado pela velocidade que a plataforma
    // escolhida nessa build realmente aproveita), nao o score bruto/intrinseco.
    const rawScore = cat === "ram" && build.ramEffectiveScore != null ? build.ramEffectiveScore : build.items[cat].perfScore;
    const normalized = (rawScore / (normalizers[cat] || 1)) * 100;
    const contribution = normalized * BUILD_WEIGHTS[cat];
    performanceIndex += contribution;
    perCategory[cat] = {
      normalized,
      contribution,
      weight: BUILD_WEIGHTS[cat],
      priceShare: build.totalUsd ? build.items[cat].price_usd / build.totalUsd : 0,
    };
  }
  build.perCategory = perCategory;
  build.performanceIndex = performanceIndex;
  build.valueIndex = performanceIndex / build.totalUsd;
  return build;
}

function buildSignature(build) {
  return CATEGORY_ORDER.map((cat) => build.items[cat].url).join("|");
}

/**
 * Remove do pool de CPU/Placa-Mae qualquer item cujo soquete nao tenha
 * nenhuma contraparte na outra categoria -- por exemplo, uma placa-mae de
 * soquete antigo (LGA1150) que nao tem mais nenhum processador a venda no
 * catalogo raspado. Sem isso, o "TOP Custo-Beneficio" de Placa-Mae poderia
 * ser uma peca tecnicamente barata mas impossivel de montar em uma build.
 */
function restrictToBuildableSockets(byCategory) {
  const cpuSockets = new Set(byCategory.cpu.map((p) => p.performance.socket).filter(Boolean));
  const moboSockets = new Set(byCategory.motherboard.map((p) => p.performance.socket).filter(Boolean));
  const common = new Set([...cpuSockets].filter((s) => moboSockets.has(s)));

  byCategory.cpu = byCategory.cpu.filter((p) => common.has(p.performance.socket));
  byCategory.motherboard = byCategory.motherboard.filter((p) => common.has(p.performance.socket));
}

/**
 * Ponto de entrada principal: recebe produtos ja pontuados (agrupados por
 * categoria) e a base de benchmarks, devolve a lista final de builds
 * ordenada por indice de custo-beneficio (melhor primeiro).
 */
function buildAllOptions(byCategory, benchmarks) {
  restrictToBuildableSockets(byCategory);

  const tops = {};
  for (const cat of CATEGORY_ORDER) {
    assignPriceTiers(byCategory[cat]);
  }
  for (const cat of CATEGORY_ORDER) {
    tops[cat] = findTopValue(byCategory[cat]);
  }

  const normalizers = computeNormalizers(byCategory);

  const rawBuilds = [];
  for (const cat of CATEGORY_ORDER) {
    if (!tops[cat]) continue;
    const build = assembleBuild(cat, tops[cat], byCategory, benchmarks);
    if (build.complete) rawBuilds.push(scoreBuild(build, normalizers));
  }

  // dedup: duas ancoras diferentes podem convergir para o mesmo conjunto de pecas
  const merged = new Map();
  for (const build of rawBuilds) {
    const sig = buildSignature(build);
    if (merged.has(sig)) {
      merged.get(sig).anchorCategories.push(build.anchorCategory);
    } else {
      merged.set(sig, build);
    }
  }

  const builds = [...merged.values()].sort((a, b) => b.valueIndex - a.valueIndex).slice(0, 7);
  builds.forEach((b, i) => (b.rank = i + 1));

  return { tops, builds, normalizers };
}

window.HWBuilder = {
  buildAllOptions,
  CATEGORY_ORDER,
  findTopValue,
  assignPriceTiers,
  recommendedWattage,
  estimateCpuTdp,
};
