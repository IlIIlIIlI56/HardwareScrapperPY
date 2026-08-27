/**
 * Normalizacao de texto e casamento aproximado (fuzzy) entre a model_key
 * extraida de um produto raspado e as chaves da base de benchmarks.
 * Tudo roda no navegador, em cima dos JSONs locais -- nenhuma rede envolvida.
 */

function normalizeKey(text) {
  if (!text) return "";
  return text
    .toString()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(str) {
  const s = str.replace(/\s+/g, "");
  const grams = new Set();
  for (let i = 0; i < s.length - 1; i++) grams.add(s.slice(i, i + 2));
  return grams;
}

/** Coeficiente de Dice entre dois textos, baseado em bigramas de caracteres. */
function diceSimilarity(a, b) {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let intersection = 0;
  for (const g of ga) if (gb.has(g)) intersection++;
  return (2 * intersection) / (ga.size + gb.size);
}

/**
 * Encontra a entrada mais provavel na base de benchmarks para uma dada
 * model_key. Tenta chave exata primeiro; se nao houver, cai para
 * similaridade por bigramas (limiar 0.72) restrita a entradas da mesma
 * marca quando a marca for conhecida, para evitar falsos positivos
 * cruzando Intel/AMD ou NVIDIA/AMD.
 */
function matchBenchmark(modelKey, brand, dbSection) {
  if (!modelKey || !dbSection) return null;

  const key = normalizeKey(modelKey);
  if (dbSection[key]) {
    return { key, entry: dbSection[key], matchType: "exact" };
  }

  let best = null;
  let bestScore = 0;
  for (const [dbKey, entry] of Object.entries(dbSection)) {
    if (brand && entry.brand && entry.brand.toLowerCase() !== brand.toLowerCase()) continue;
    const score = diceSimilarity(key, dbKey);
    if (score > bestScore) {
      bestScore = score;
      best = { key: dbKey, entry, matchType: "fuzzy", similarity: score };
    }
  }

  if (best && bestScore >= 0.72) return best;
  return null;
}

// exposto no escopo global (scripts carregados via <script> simples, sem bundler)
window.HWMatch = { normalizeKey, diceSimilarity, matchBenchmark };
