/**
 * Decisoes do usuario sobre itens nao pontuados (adicionar a base com
 * specs corrigidas/completadas, ou continuar ignorando). Como a pagina e
 * 100% estatica (sem backend), essas decisoes vivem no localStorage do
 * navegador -- persistem entre visitas na mesma maquina, mas nao alteram
 * data/products.json. Usado tanto por app.js (pagina de builds, para
 * aplicar as decisoes antes de pontuar) quanto por catalog.js (pagina de
 * base de dados, para ler/gravar as decisoes).
 */

const OVERRIDES_KEY = "hw-overrides-v1";

function getOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveOverrides(map) {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map));
}

/** decision: 'added' (specs deve vir preenchido) ou 'ignored' */
function setOverride(url, decision, specs) {
  const all = getOverrides();
  all[url] = { decision, specs: specs || null, updatedAt: new Date().toISOString() };
  saveOverrides(all);
  return all[url];
}

function clearOverride(url) {
  const all = getOverrides();
  delete all[url];
  saveOverrides(all);
}

/**
 * Aplica as decisoes salvas sobre uma lista de produtos crus (antes da
 * pontuacao): itens ignorados saem da lista; itens adicionados recebem as
 * specs corrigidas pelo usuario por cima das specs extraidas pelo scraper.
 */
function applyOverridesToProducts(rawProducts) {
  const overrides = getOverrides();
  const result = [];
  for (const p of rawProducts) {
    const ov = overrides[p.url];
    if (ov && ov.decision === "ignored") continue;
    if (ov && ov.decision === "added" && ov.specs) {
      result.push({ ...p, specs: { ...p.specs, ...ov.specs }, manuallyAdded: true });
    } else {
      result.push(p);
    }
  }
  return result;
}

/**
 * Entradas de benchmark adicionadas manualmente (CPU/GPU sem correspondencia
 * na base curada, ou chipset de placa-mae desconhecido). Guardadas
 * separadamente das decisoes de produto porque uma entrada de benchmark
 * beneficia QUALQUER produto com aquela model_key/chipset, nao so o item que
 * estava sendo revisado quando foi cadastrada.
 */
const BENCHMARK_OVERRIDES_KEY = "hw-benchmark-overrides-v1";

function getBenchmarkOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BENCHMARK_OVERRIDES_KEY) || "{}");
    return { cpu: {}, gpu: {}, chipsets: {}, ...parsed };
  } catch {
    return { cpu: {}, gpu: {}, chipsets: {} };
  }
}

function saveBenchmarkOverrides(map) {
  localStorage.setItem(BENCHMARK_OVERRIDES_KEY, JSON.stringify(map));
}

/** section: 'cpu' | 'gpu' | 'chipsets' */
function setBenchmarkOverride(section, key, entry) {
  const all = getBenchmarkOverrides();
  all[section][key] = { ...entry, addedAt: new Date().toISOString() };
  saveBenchmarkOverrides(all);
  return all[section][key];
}

function clearBenchmarkOverride(section, key) {
  const all = getBenchmarkOverrides();
  delete all[section][key];
  saveBenchmarkOverrides(all);
}

/** Devolve uma COPIA de benchmarks.json com as entradas manuais mescladas por cima. */
function applyBenchmarkOverrides(benchmarks) {
  const custom = getBenchmarkOverrides();
  return {
    ...benchmarks,
    cpu: { ...benchmarks.cpu, ...custom.cpu },
    gpu: { ...benchmarks.gpu, ...custom.gpu },
    chipsets: { ...benchmarks.chipsets, ...custom.chipsets },
  };
}

/**
 * Empacota as duas gavetas do localStorage (decisoes de produto + entradas
 * de benchmark) num unico objeto para download -- serve como backup/forma
 * de levar as decisoes para outro navegador ou maquina, ja que elas nunca
 * tocam data/products.json.
 */
function exportAllData() {
  return {
    exported_at: new Date().toISOString(),
    source: "HardwareScrapperPY - Base de Dados",
    product_overrides: getOverrides(),
    benchmark_overrides: getBenchmarkOverrides(),
  };
}

/**
 * Le um objeto no formato de exportAllData() e MESCLA no que ja esta salvo
 * (entradas do arquivo importado tem prioridade em caso de mesma chave).
 * Nao apaga decisoes existentes que nao estejam no arquivo.
 */
function importAllData(data) {
  if (!data || typeof data !== "object" || (!data.product_overrides && !data.benchmark_overrides)) {
    throw new Error("Arquivo nao parece ser um backup valido desta pagina.");
  }

  const importedProducts = data.product_overrides && typeof data.product_overrides === "object" ? data.product_overrides : {};
  const importedBench = data.benchmark_overrides && typeof data.benchmark_overrides === "object" ? data.benchmark_overrides : {};

  const mergedProducts = { ...getOverrides(), ...importedProducts };
  const currentBench = getBenchmarkOverrides();
  const mergedBench = {
    cpu: { ...currentBench.cpu, ...(importedBench.cpu || {}) },
    gpu: { ...currentBench.gpu, ...(importedBench.gpu || {}) },
    chipsets: { ...currentBench.chipsets, ...(importedBench.chipsets || {}) },
  };

  saveOverrides(mergedProducts);
  saveBenchmarkOverrides(mergedBench);

  return {
    productCount: Object.keys(importedProducts).length,
    benchmarkCount:
      Object.keys(importedBench.cpu || {}).length +
      Object.keys(importedBench.gpu || {}).length +
      Object.keys(importedBench.chipsets || {}).length,
  };
}

window.HWOverrides = {
  getOverrides,
  setOverride,
  clearOverride,
  applyOverridesToProducts,
  getBenchmarkOverrides,
  setBenchmarkOverride,
  clearBenchmarkOverride,
  applyBenchmarkOverrides,
  exportAllData,
  importAllData,
};
