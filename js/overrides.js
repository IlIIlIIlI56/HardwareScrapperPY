/**
 * Camada de persistencia das decisoes do usuario. Nunca altera
 * dados/products.json nem dados/benchmarks.json: as decisoes ficam numa gaveta
 * a parte e sao aplicadas por cima, a cada carregamento. Usada por app.js
 * (aplica as decisoes antes de pontuar) e pelas telas da pagina Base de Dados
 * (leem e gravam).
 *
 * ONDE elas ficam e responsabilidade de HWStore (js/app-bridge.js): dentro do
 * aplicativo, no arquivo dados/decisoes.json; numa pagina aberta fora dele, no
 * localStorage, como sempre foi. Este arquivo nao precisa saber a diferenca --
 * os dois lados oferecem a mesma API sincrona.
 *
 * Duas gavetas separadas, por motivos diferentes:
 *
 *   hw-overrides-v1            decisoes POR PRODUTO (uma URL do anuncio).
 *   hw-benchmark-overrides-v1  conhecimento sobre HARDWARE, que vale para
 *                              qualquer anuncio do mesmo modelo. Perder essa
 *                              gaveta custa muito mais trabalho do que perder
 *                              a outra, e ela sobrevive a uma nova coleta
 *                              (produtos mudam de URL, modelos nao).
 *
 * As chaves do localStorage seguem sendo "-v1" de proposito, mesmo com o
 * conteudo tendo ganhado campos novos (aliases, tuning, proveniencia): as
 * leituras normalizam o que encontram, entao uma gaveta gravada pela versao
 * antiga da pagina continua sendo lida sem migracao nem perda de dados.
 */

const OVERRIDES_KEY = "hw-overrides-v1";
const BENCHMARK_OVERRIDES_KEY = "hw-benchmark-overrides-v1";
const EXPORT_SCHEMA_VERSION = 2;

/* ==========================================================================
   armazenamento cru -- delegado a HWStore (js/app-bridge.js)
   ========================================================================== */

function readJson(key, fallback) {
  return HWStore.get(key, fallback);
}

/**
 * Uma escrita que falha e deixada subir de proposito. Silencia-la seria o pior
 * caso possivel: o usuario veria a tela atualizar como se a decisao tivesse
 * sido salva, e a perderia no F5. HWStore ja traduz a falha (disco, cota do
 * localStorage) numa mensagem acionavel.
 */
function writeJson(key, value) {
  HWStore.set(key, value);
}

/** Tamanho aproximado das duas gavetas -- mostrado na UI de backup. */
function storageInfo() {
  const productBytes = HWStore.sizeOf(OVERRIDES_KEY);
  const benchmarkBytes = HWStore.sizeOf(BENCHMARK_OVERRIDES_KEY);
  return { productBytes, benchmarkBytes, totalBytes: productBytes + benchmarkBytes };
}

/* ==========================================================================
   decisoes por produto
   ========================================================================== */

/**
 * O mapa fica em cache entre gravacoes. A lista da Base de Dados consulta a
 * decisao de cada um dos ~1500 produtos a cada redesenho; sem cache, isso era
 * um JSON.parse do mapa inteiro por produto, e a pagina engasgava a cada tecla
 * digitada na busca. Toda escrita passa por saveOverrides, que renova o cache,
 * entao ele nunca fica velho dentro desta aba.
 */
let overridesCache = null;

function getOverrides() {
  if (!overridesCache) overridesCache = readJson(OVERRIDES_KEY, {});
  return overridesCache;
}

function saveOverrides(map) {
  writeJson(OVERRIDES_KEY, map);
  overridesCache = map;
}

function getOverrideRecord(url) {
  return getOverrides()[url] || null;
}

/**
 * decision: 'added' (revisado -- `specs` traz as correcoes) ou 'ignored'.
 *
 * `priceConfirmed` responde a uma pergunta diferente de "as specs estao
 * certas": ele isenta o item do filtro de outlier de preco (flagValueOutliers
 * em scoring.js). So marcamos quando o usuario resolveu explicitamente um item
 * que estava pendente POR causa do preco -- antes, qualquer revisao dava essa
 * isencao de brinde, o que fazia uma correcao de digitacao numa spec desligar
 * silenciosamente a protecao contra erro de preco na fonte.
 */
function setOverride(url, decision, specs, options = {}) {
  const all = getOverrides();
  const previous = all[url];
  all[url] = {
    decision,
    specs: specs || null,
    priceConfirmed: options.priceConfirmed === true,
    note: options.note || (previous && previous.note) || null,
    createdAt: (previous && previous.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveOverrides(all);
  return all[url];
}

/** Mesma decisao para varias URLs de uma vez (acoes em lote da lista filtrada). */
function setOverridesBulk(urls, decision) {
  const all = getOverrides();
  const now = new Date().toISOString();
  let changed = 0;
  for (const url of urls) {
    const previous = all[url];
    if (previous && previous.decision === decision && !previous.specs) continue;
    all[url] = {
      decision,
      specs: decision === "ignored" ? null : previous ? previous.specs : null,
      priceConfirmed: previous ? previous.priceConfirmed === true : false,
      note: (previous && previous.note) || null,
      createdAt: (previous && previous.createdAt) || now,
      updatedAt: now,
    };
    changed++;
  }
  saveOverrides(all);
  return changed;
}

function clearOverride(url) {
  const all = getOverrides();
  delete all[url];
  saveOverrides(all);
}

function clearOverridesBulk(urls) {
  const all = getOverrides();
  let changed = 0;
  for (const url of urls) {
    if (all[url]) {
      delete all[url];
      changed++;
    }
  }
  saveOverrides(all);
  return changed;
}

function overrideCounts() {
  const values = Object.values(getOverrides());
  return {
    added: values.filter((o) => o.decision === "added").length,
    ignored: values.filter((o) => o.decision === "ignored").length,
    total: values.length,
  };
}

/**
 * Aplica as decisoes salvas sobre a lista de produtos crus, antes da
 * pontuacao: itens ignorados saem da lista; itens revisados recebem as specs
 * corrigidas por cima das extraidas pelo scraper.
 *
 * Um valor `null` numa spec revisada e intencional e significa "apague o que o
 * regex extraiu" (ex: um CL16 que na verdade era parte do codigo do produto).
 * Como `{...a, ...b}` deixa o null de `b` vencer, isso funciona sem nenhum
 * tratamento especial -- e o scorer ja trata null como ausente.
 */
function applyOverridesToProducts(rawProducts) {
  const overrides = getOverrides();
  const result = [];
  for (const p of rawProducts) {
    const ov = overrides[p.url];
    if (!ov) {
      result.push(p);
      continue;
    }
    if (ov.decision === "ignored") continue;
    if (ov.decision === "added") {
      result.push({
        ...p,
        specs: { ...p.specs, ...(ov.specs || {}) },
        manuallyAdded: true,
        // registros gravados antes deste campo existir davam a isencao sempre;
        // manter esse default preserva o comportamento de quem ja usava a pagina.
        priceConfirmed: ov.priceConfirmed !== undefined ? ov.priceConfirmed === true : true,
      });
      continue;
    }
    result.push(p);
  }
  return result;
}

/* ==========================================================================
   base de benchmarks: entradas manuais, apelidos e ajustes do modelo
   ========================================================================== */

const EMPTY_BENCH = () => ({
  cpu: {},
  gpu: {},
  chipsets: {},
  aliases: { cpu: {}, gpu: {}, chipsets: {} },
  tuning: {},
});

/** Le a gaveta ja normalizada -- secoes que faltarem (gravadas por versoes antigas) viram {}. */
let benchmarkCache = null;

function getBenchmarkOverrides() {
  if (benchmarkCache) return benchmarkCache;
  const raw = readJson(BENCHMARK_OVERRIDES_KEY, {});
  const base = EMPTY_BENCH();
  benchmarkCache = {
    cpu: { ...base.cpu, ...(raw.cpu || {}) },
    gpu: { ...base.gpu, ...(raw.gpu || {}) },
    chipsets: { ...base.chipsets, ...(raw.chipsets || {}) },
    aliases: {
      cpu: { ...((raw.aliases || {}).cpu || {}) },
      gpu: { ...((raw.aliases || {}).gpu || {}) },
      chipsets: { ...((raw.aliases || {}).chipsets || {}) },
    },
    tuning: { ...(raw.tuning || {}) },
  };
  return benchmarkCache;
}

function saveBenchmarkOverrides(map) {
  writeJson(BENCHMARK_OVERRIDES_KEY, map);
  benchmarkCache = map;
}

/* ------------------------------------------------------------- validacao -- */

const NUMERIC_LIMITS = {
  "cpu.score": { min: 1, max: 400000, label: "Score de CPU" },
  "cpu.cores": { min: 1, max: 256, label: "Nucleos" },
  "gpu.score": { min: 1, max: 400000, label: "Score de GPU" },
  "gpu.tdp_w": { min: 1, max: 1000, label: "TDP" },
  "gpu.vram_default": { min: 1, max: 256, label: "VRAM" },
  "chipsets.tier": { min: 1, max: 4, label: "Tier" },
  "chipsets.max_ram_mhz": { min: 400, max: 16000, label: "Velocidade maxima de RAM" },
};

function checkNumber(errors, path, value, { required = false } = {}) {
  const limits = NUMERIC_LIMITS[path];
  if (value === null || value === undefined || value === "") {
    if (required) errors.push(`${limits.label}: obrigatorio.`);
    return null;
  }
  const num = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(num)) {
    errors.push(`${limits.label}: precisa ser um numero.`);
    return null;
  }
  if (num < limits.min || num > limits.max) {
    errors.push(`${limits.label}: fora da faixa plausivel (${limits.min}-${limits.max}).`);
    return null;
  }
  return num;
}

/**
 * Valida e normaliza uma entrada de benchmark antes de grava-la. Existe porque
 * o campo de score e digitado a mao a partir de um site externo: um "40000"
 * colado com um zero a mais numa CPU vira, sem aviso nenhum, a peca "TOP
 * Custo-Beneficio" de todas as builds. As faixas sao generosas -- servem para
 * pegar erro de digitacao, nao para julgar hardware.
 *
 * section: 'cpu' | 'gpu' | 'chipsets'
 * Devolve { ok, errors: string[], value } com `value` ja com tipos corretos.
 */
function validateBenchmarkEntry(section, input) {
  const errors = [];
  const src = input || {};
  let value = null;

  if (section === "cpu") {
    value = {
      score: checkNumber(errors, "cpu.score", src.score, { required: true }),
      brand: src.brand || null,
      socket: src.socket ? String(src.socket).trim().toUpperCase() : null,
      cores: checkNumber(errors, "cpu.cores", src.cores),
    };
  } else if (section === "gpu") {
    value = {
      score: checkNumber(errors, "gpu.score", src.score, { required: true }),
      brand: src.brand || null,
      tdp_w: checkNumber(errors, "gpu.tdp_w", src.tdp_w),
      vram_default: checkNumber(errors, "gpu.vram_default", src.vram_default),
    };
  } else if (section === "chipsets") {
    const tier = checkNumber(errors, "chipsets.tier", src.tier, { required: true });
    value = {
      tier,
      ram: src.ram || null,
      socket: src.socket ? String(src.socket).trim().toUpperCase() : null,
      max_ram_mhz: checkNumber(errors, "chipsets.max_ram_mhz", src.max_ram_mhz),
    };
    if (!value.ram) errors.push("Tipo de memoria: obrigatorio (o montador precisa dele para casar a RAM).");
  } else {
    errors.push(`Secao desconhecida: ${section}`);
  }

  if (value) {
    // proveniencia: livre, mas util meses depois para saber de onde veio o numero
    if (src.source) value.source = String(src.source).slice(0, 300);
    if (src.note) value.note = String(src.note).slice(0, 300);
  }
  return { ok: errors.length === 0, errors, value };
}

/* ------------------------------------------------------------- gravacao -- */

/** section: 'cpu' | 'gpu' | 'chipsets'. Lanca se a entrada nao passar na validacao. */
function setBenchmarkOverride(section, key, entry) {
  const { ok, errors, value } = validateBenchmarkEntry(section, entry);
  if (!ok) throw new Error(errors.join(" "));
  const all = getBenchmarkOverrides();
  const previous = all[section][key];
  all[section][key] = {
    ...value,
    createdAt: (previous && previous.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveBenchmarkOverrides(all);
  return all[section][key];
}

function clearBenchmarkOverride(section, key) {
  const all = getBenchmarkOverrides();
  delete all[section][key];
  saveBenchmarkOverrides(all);
}

/**
 * Apelido: aponta uma model_key extraida do anuncio para uma chave que JA
 * existe na base. Resolve o caso mais comum de "modelo nao encontrado" sem
 * inventar numero nenhum -- o anuncio escreve "RTX 4060 8G OC" e a base tem
 * "rtx 4060"; duplicar a entrada criaria duas fontes de verdade para a mesma
 * GPU, que depois divergem quando so uma for corrigida.
 */
function setBenchmarkAlias(section, fromKey, targetKey) {
  const from = HWMatch.normalizeKey(fromKey);
  const target = section === "chipsets" ? String(targetKey).trim().toUpperCase() : HWMatch.normalizeKey(targetKey);
  if (!from || !target) throw new Error("Apelido precisa de origem e destino.");
  if (from === target) throw new Error("O apelido nao pode apontar para ele mesmo.");
  const all = getBenchmarkOverrides();
  all.aliases[section][from] = { target, createdAt: new Date().toISOString() };
  saveBenchmarkOverrides(all);
  return all.aliases[section][from];
}

function clearBenchmarkAlias(section, fromKey) {
  const all = getBenchmarkOverrides();
  delete all.aliases[section][HWMatch.normalizeKey(fromKey)];
  saveBenchmarkOverrides(all);
}

/**
 * Ajustes dos parametros globais do modelo de pontuacao (latencia de
 * referencia da RAM, multiplicadores de eficiencia de fonte e de interface de
 * armazenamento, velocidade maxima de RAM por soquete). Antes so davam para
 * mudar editando dados/benchmarks.json na mao -- o que some num `git pull` e
 * nao da para experimentar rapido. `group` e o nome do bloco em
 * benchmarks.json; passar null como valor volta ao padrao do arquivo.
 */
const TUNABLE_GROUPS = ["ram_scoring", "psu_efficiency_multiplier", "storage_interface_multiplier", "socket_max_ram_mhz"];

function setTuning(group, key, value) {
  if (!TUNABLE_GROUPS.includes(group)) throw new Error(`Grupo de ajuste desconhecido: ${group}`);
  const all = getBenchmarkOverrides();
  all.tuning[group] = all.tuning[group] || {};
  if (value === null || value === undefined || value === "") delete all.tuning[group][key];
  else {
    const num = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
    if (!Number.isFinite(num) || num <= 0) throw new Error("O ajuste precisa ser um numero maior que zero.");
    all.tuning[group][key] = num;
  }
  if (all.tuning[group] && Object.keys(all.tuning[group]).length === 0) delete all.tuning[group];
  saveBenchmarkOverrides(all);
  return all.tuning;
}

function clearTuning() {
  const all = getBenchmarkOverrides();
  all.tuning = {};
  saveBenchmarkOverrides(all);
}

function benchmarkCounts() {
  const c = getBenchmarkOverrides();
  const aliases =
    Object.keys(c.aliases.cpu).length + Object.keys(c.aliases.gpu).length + Object.keys(c.aliases.chipsets).length;
  const tuning = Object.values(c.tuning).reduce((sum, group) => sum + Object.keys(group || {}).length, 0);
  return {
    cpu: Object.keys(c.cpu).length,
    gpu: Object.keys(c.gpu).length,
    chipsets: Object.keys(c.chipsets).length,
    aliases,
    tuning,
    total: Object.keys(c.cpu).length + Object.keys(c.gpu).length + Object.keys(c.chipsets).length + aliases + tuning,
  };
}

/**
 * Devolve uma COPIA de benchmarks.json com tudo do usuario mesclado por cima:
 * entradas manuais, apelidos e ajustes de parametro. E o objeto que scoring.js
 * e builder.js realmente consomem -- nenhum dos dois sabe que overrides existem.
 */
function applyBenchmarkOverrides(benchmarks) {
  const custom = getBenchmarkOverrides();
  const merged = {
    ...benchmarks,
    cpu: { ...benchmarks.cpu, ...custom.cpu },
    gpu: { ...benchmarks.gpu, ...custom.gpu },
    chipsets: { ...benchmarks.chipsets, ...custom.chipsets },
    aliases: custom.aliases,
  };
  for (const group of TUNABLE_GROUPS) {
    if (custom.tuning[group]) merged[group] = { ...(benchmarks[group] || {}), ...custom.tuning[group] };
  }
  return merged;
}

/**
 * Monta o conteudo de um dados/benchmarks.json COMPLETO ja com as entradas e
 * ajustes do usuario aplicados, pronto para substituir o arquivo do repositorio.
 *
 * Isto fecha o unico caminho que faltava na curadoria: sem ele, o trabalho de
 * cadastrar dezenas de modelos ficava preso na gaveta de decisoes --
 * sobrevivia a um F5, mas nao a uma troca de maquina nem virava parte do
 * projeto para as proximas pessoas. Apelidos viram entradas de verdade (copia
 * do alvo), ja que o arquivo nao tem um conceito de apelido.
 */
function buildMergedBenchmarksFile(benchmarks) {
  const merged = applyBenchmarkOverrides(benchmarks);
  const out = { ...merged };
  delete out.aliases;

  for (const section of ["cpu", "gpu"]) {
    for (const [from, alias] of Object.entries(merged.aliases[section] || {})) {
      const target = merged[section][alias.target];
      if (target && !out[section][from]) out[section][from] = { ...target, aliased_from: alias.target };
    }
  }
  for (const [from, alias] of Object.entries(merged.aliases.chipsets || {})) {
    const target = merged.chipsets[alias.target];
    if (target && !out.chipsets[from]) out.chipsets[from] = { ...target, aliased_from: alias.target };
  }

  out.generated_reference_date = new Date().toISOString().slice(0, 7);
  out._merged_from_browser_at = new Date().toISOString();
  return out;
}

/* ==========================================================================
   backup: exportacao, analise previa e importacao
   ========================================================================== */

function exportAllData() {
  const products = getOverrides();
  const bench = getBenchmarkOverrides();
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    app: "HardwareScrapperPY",
    source: `Base de Dados (${HWStore.describe()})`,
    exported_at: new Date().toISOString(),
    counts: { products: Object.keys(products).length, ...benchmarkCounts() },
    product_overrides: products,
    benchmark_overrides: bench,
  };
}

/** Um registro de produto so entra se for reconhecivel -- descartamos lixo em vez de gravar. */
function sanitizeProductRecord(record) {
  if (!record || typeof record !== "object") return null;
  if (record.decision !== "added" && record.decision !== "ignored") return null;
  return {
    decision: record.decision,
    specs: record.specs && typeof record.specs === "object" ? record.specs : null,
    priceConfirmed: record.priceConfirmed !== undefined ? record.priceConfirmed === true : record.decision === "added",
    note: typeof record.note === "string" ? record.note : null,
    createdAt: record.createdAt || record.updatedAt || null,
    updatedAt: record.updatedAt || record.createdAt || null,
  };
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Le um arquivo de backup e devolve um RELATORIO do que aconteceria, sem
 * gravar nada. A importacao antiga era um merge cego: o usuario clicava,
 * lia "importado: 137 decisoes" e nao tinha como saber que 12 delas
 * sobrescreveram revisoes locais mais recentes -- nem como desfazer. Agora a
 * tela mostra novos / conflitos / iguais / invalidos antes de confirmar.
 *
 * Aceita tanto o formato novo (schema_version 2) quanto o antigo (sem versao,
 * so product_overrides + benchmark_overrides), que continua sendo lido igual.
 */
function analyzeImport(data) {
  if (!data || typeof data !== "object" || (!data.product_overrides && !data.benchmark_overrides)) {
    throw new Error("Arquivo nao parece ser um backup desta pagina (faltam product_overrides / benchmark_overrides).");
  }

  const localProducts = getOverrides();
  const localBench = getBenchmarkOverrides();
  const incomingProducts = data.product_overrides && typeof data.product_overrides === "object" ? data.product_overrides : {};
  const incomingBench = data.benchmark_overrides && typeof data.benchmark_overrides === "object" ? data.benchmark_overrides : {};

  const report = {
    schemaVersion: data.schema_version || 1,
    exportedAt: data.exported_at || null,
    products: [],
    benchmarks: [],
    aliases: [],
    tuning: [],
    invalid: [],
    counts: { new: 0, conflict: 0, same: 0, invalid: 0 },
  };

  function push(list, kind, label, payload) {
    list.push({ kind, label, ...payload });
    report.counts[kind] = (report.counts[kind] || 0) + 1;
  }

  for (const [url, record] of Object.entries(incomingProducts)) {
    const clean = sanitizeProductRecord(record);
    if (!clean) {
      push(report.invalid, "invalid", url, { reason: "registro de produto ilegivel" });
      continue;
    }
    const local = localProducts[url];
    if (!local) push(report.products, "new", url, { incoming: clean });
    else if (sameValue(local.decision, clean.decision) && sameValue(local.specs, clean.specs))
      push(report.products, "same", url, { incoming: clean, local });
    else push(report.products, "conflict", url, { incoming: clean, local });
  }

  for (const section of ["cpu", "gpu", "chipsets"]) {
    for (const [key, entry] of Object.entries(incomingBench[section] || {})) {
      const { ok, errors, value } = validateBenchmarkEntry(section, entry);
      if (!ok) {
        push(report.invalid, "invalid", `${section}/${key}`, { reason: errors.join(" ") });
        continue;
      }
      const local = localBench[section][key];
      const label = `${section}/${key}`;
      if (!local) push(report.benchmarks, "new", label, { section, key, incoming: value });
      else if (sameValue(local.score ?? local.tier, value.score ?? value.tier))
        push(report.benchmarks, "same", label, { section, key, incoming: value, local });
      else push(report.benchmarks, "conflict", label, { section, key, incoming: value, local });
    }
  }

  for (const section of ["cpu", "gpu", "chipsets"]) {
    for (const [from, alias] of Object.entries((incomingBench.aliases || {})[section] || {})) {
      if (!alias || !alias.target) {
        push(report.invalid, "invalid", `alias ${section}/${from}`, { reason: "apelido sem destino" });
        continue;
      }
      const local = localBench.aliases[section][from];
      const label = `${section}: ${from} -> ${alias.target}`;
      if (!local) push(report.aliases, "new", label, { section, from, incoming: alias });
      else if (local.target === alias.target) push(report.aliases, "same", label, { section, from, incoming: alias });
      else push(report.aliases, "conflict", label, { section, from, incoming: alias, local });
    }
  }

  for (const [group, values] of Object.entries(incomingBench.tuning || {})) {
    if (!TUNABLE_GROUPS.includes(group)) {
      push(report.invalid, "invalid", `ajuste ${group}`, { reason: "grupo de ajuste desconhecido" });
      continue;
    }
    for (const [key, value] of Object.entries(values || {})) {
      const local = (localBench.tuning[group] || {})[key];
      const label = `${group}.${key} = ${value}`;
      if (local === undefined) push(report.tuning, "new", label, { group, key, incoming: value });
      else if (local === value) push(report.tuning, "same", label, { group, key, incoming: value });
      else push(report.tuning, "conflict", label, { group, key, incoming: value, local });
    }
  }

  return report;
}

/**
 * Aplica um backup ja analisado. `mode` decide o que fazer nos conflitos:
 *
 *   'incoming' o arquivo vence (era o unico comportamento da versao anterior);
 *   'local'    o que ja esta no navegador vence -- so entram chaves novas;
 *   'replace'  descarta tudo que esta no navegador e fica so com o arquivo.
 *
 * Entradas invalidas nunca sao gravadas, em nenhum modo.
 */
function applyImport(data, mode = "incoming") {
  const report = analyzeImport(data);
  const incomingBench = data.benchmark_overrides || {};

  let products = mode === "replace" ? {} : { ...getOverrides() };
  let bench = mode === "replace" ? EMPTY_BENCH() : getBenchmarkOverrides();

  for (const row of report.products) {
    if (row.kind === "conflict" && mode === "local") continue;
    products[row.label] = row.incoming;
  }

  for (const row of report.benchmarks) {
    if (row.kind === "conflict" && mode === "local") continue;
    const existing = bench[row.section][row.key];
    bench[row.section][row.key] = {
      ...row.incoming,
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  for (const row of report.aliases) {
    if (row.kind === "conflict" && mode === "local") continue;
    bench.aliases[row.section][row.from] = { target: row.incoming.target, createdAt: row.incoming.createdAt || new Date().toISOString() };
  }

  for (const row of report.tuning) {
    if (row.kind === "conflict" && mode === "local") continue;
    bench.tuning[row.group] = bench.tuning[row.group] || {};
    bench.tuning[row.group][row.key] = row.incoming;
  }

  // gravamos as duas gavetas so depois de montar as duas: se a segunda
  // estourar a cota, o backup nao fica pela metade em disco.
  saveOverrides(products);
  saveBenchmarkOverrides(bench);

  return {
    mode,
    applied: {
      products: report.products.filter((r) => r.kind !== "same" && !(r.kind === "conflict" && mode === "local")).length,
      benchmarks: report.benchmarks.filter((r) => !(r.kind === "conflict" && mode === "local")).length,
      aliases: report.aliases.filter((r) => !(r.kind === "conflict" && mode === "local")).length,
      tuning: report.tuning.filter((r) => !(r.kind === "conflict" && mode === "local")).length,
    },
    skippedInvalid: report.invalid.length,
    unusedIncomingBench: Object.keys(incomingBench).length,
  };
}

/** Apaga as duas gavetas -- so chamado atras de uma confirmacao explicita na UI. */
function resetAll() {
  HWStore.remove(OVERRIDES_KEY);
  HWStore.remove(BENCHMARK_OVERRIDES_KEY);
  overridesCache = null;
  benchmarkCache = null;
}

window.HWOverrides = {
  // produtos
  getOverrides,
  getOverrideRecord,
  setOverride,
  setOverridesBulk,
  clearOverride,
  clearOverridesBulk,
  overrideCounts,
  applyOverridesToProducts,
  // benchmarks
  getBenchmarkOverrides,
  setBenchmarkOverride,
  clearBenchmarkOverride,
  setBenchmarkAlias,
  clearBenchmarkAlias,
  validateBenchmarkEntry,
  setTuning,
  clearTuning,
  benchmarkCounts,
  applyBenchmarkOverrides,
  buildMergedBenchmarksFile,
  TUNABLE_GROUPS,
  // backup
  exportAllData,
  analyzeImport,
  applyImport,
  resetAll,
  storageInfo,
  EXPORT_SCHEMA_VERSION,
};
