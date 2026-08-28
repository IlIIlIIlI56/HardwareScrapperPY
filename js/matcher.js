/**
 * Casamento entre a `model_key` extraida de um produto raspado e as chaves da
 * base de benchmarks. Tudo roda no navegador, sobre os JSONs locais -- nenhuma
 * rede envolvida.
 *
 * Sao tres caminhos, nesta ordem:
 *   1. chave exata;
 *   2. apelido cadastrado pelo usuario (ver setBenchmarkAlias em overrides.js);
 *   3. similaridade textual (coeficiente de Dice sobre bigramas), com duas
 *      travas descritas em `compatibleModel` que impedem os erros que o Dice
 *      cru cometia sozinho.
 */

function normalizeKey(text) {
  if (!text) return "";
  return text
    .toString()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // marcas de acentuacao separadas pelo NFKD
    .toLowerCase()
    // hifen e ponto NAO sao removidos: as chaves da base sao literais
    // ("i5-10400", "80+ gold") e a busca exata compara com elas diretamente.
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

/** Todas as sequencias de digitos, na ordem: "i5-12400f" -> ["5","12400"]. */
function digitRuns(key) {
  return (key.match(/\d+/g) || []).join("-");
}

/**
 * Sufixos que mudam a peca de verdade, nao so o texto do anuncio. Um "F"
 * (Intel sem video integrado), um "Ti", um "XT" ou um "X3D" valem centenas de
 * pontos de diferenca -- e sao exatamente o tipo de coisa que a similaridade
 * textual cruza sem hesitar, porque a diferenca sao duas letras num nome de
 * dez. Comparamos o CONJUNTO desses tokens dos dois lados.
 */
const MODEL_MODIFIERS = ["ti super", "ti", "super", "xtx", "xt", "gre", "x3d", "ks", "kf", "hx", "3d", "k", "f", "x", "ge", "g", "t"];

function modifierSet(key) {
  const found = new Set();
  let rest = ` ${key} `;
  for (const mod of MODEL_MODIFIERS) {
    // o caractere anterior entra no match (para exigir que o sufixo venha
    // colado num digito ou depois de um espaco) mas e devolvido pelo $1 --
    // sem isso, remover "f" de "12400f" comeria o "0" e bagunçaria os
    // sufixos checados nas voltas seguintes.
    const re = new RegExp(`(^|\\s|\\d)${mod}(?=\\s|$)`, "g");
    if (re.test(rest)) {
      found.add(mod);
      rest = rest.replace(re, "$1 ");
    }
  }
  // "ti super" ja cobre "ti" e "super": evita contar o mesmo sufixo duas vezes
  if (found.has("ti super")) {
    found.delete("ti");
    found.delete("super");
  }
  return found;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Duas travas antes de aceitar um casamento aproximado:
 *
 *   - os numeros do modelo tem que ser IDENTICOS. Uma RTX 4060 e uma RTX 4070
 *     sao 92% parecidas como texto e ~40% diferentes em performance; nenhum
 *     limiar de similaridade separa as duas de forma confiavel, mas "4060" !=
 *     "4070" separa sempre.
 *   - os sufixos de modelo (Ti / XT / F / X3D ...) tem que bater.
 *
 * Com isso, a similaridade passa a resolver so o que ela e boa em resolver:
 * ruido de formatacao ("rtx4060" vs "rtx 4060", "ryzen5 5600" vs "ryzen 5 5600").
 */
function compatibleModel(a, b) {
  if (digitRuns(a) !== digitRuns(b)) return false;
  return sameSet(modifierSet(a), modifierSet(b));
}

const FUZZY_THRESHOLD = 0.72;

/**
 * Encontra a entrada mais provavel da base para uma model_key.
 *
 * `aliases` (opcional) e o mapa `{ chaveNormalizada: { target } }` da secao
 * correspondente, vindo dos apelidos cadastrados pelo usuario -- ele vem antes
 * do fuzzy porque e uma afirmacao explicita ("este anuncio e esta peca"),
 * enquanto o fuzzy e um palpite.
 */
function matchBenchmark(modelKey, brand, dbSection, aliases) {
  if (!modelKey || !dbSection) return null;

  const key = normalizeKey(modelKey);
  if (dbSection[key]) {
    return { key, entry: dbSection[key], matchType: "exact" };
  }

  const alias = aliases && aliases[key];
  if (alias && dbSection[alias.target]) {
    return { key: alias.target, entry: dbSection[alias.target], matchType: "alias", aliasFrom: key };
  }

  let best = null;
  let bestScore = 0;
  for (const [dbKey, entry] of Object.entries(dbSection)) {
    if (brand && entry.brand && entry.brand.toLowerCase() !== brand.toLowerCase()) continue;
    if (!compatibleModel(key, dbKey)) continue;
    const score = diceSimilarity(key, dbKey);
    if (score > bestScore) {
      bestScore = score;
      best = { key: dbKey, entry, matchType: "fuzzy", similarity: score };
    }
  }

  if (best && bestScore >= FUZZY_THRESHOLD) return best;
  return null;
}

/**
 * Chipsets nao passam por similaridade: a chave e curta e estruturada ("B550",
 * "Z790"), entao um fuzzy erraria entre B550 e B650 com facilidade. Aqui so
 * existem chave exata e apelido.
 */
function matchChipset(chipset, chipsetTable, aliases) {
  if (!chipset || !chipsetTable) return null;
  const key = String(chipset).trim().toUpperCase();
  if (chipsetTable[key]) return { key, entry: chipsetTable[key], matchType: "exact" };
  const alias = aliases && aliases[normalizeKey(chipset)];
  if (alias && chipsetTable[alias.target]) {
    return { key: alias.target, entry: chipsetTable[alias.target], matchType: "alias", aliasFrom: key };
  }
  return null;
}

/**
 * Sugestoes de chave da base para um modelo que nao casou -- alimenta o seletor
 * de apelido na revisao manual, para o usuario apontar o anuncio a uma entrada
 * que ja existe em vez de cadastrar um score novo (e provavelmente divergente)
 * para a mesma peca.
 */
function suggestKeys(modelKey, brand, dbSection, limit = 8) {
  if (!dbSection) return [];
  const key = normalizeKey(modelKey);
  const scored = [];
  for (const [dbKey, entry] of Object.entries(dbSection)) {
    if (brand && entry.brand && entry.brand.toLowerCase() !== brand.toLowerCase()) continue;
    const sim = diceSimilarity(key, normalizeKey(dbKey));
    if (sim > 0.3) scored.push({ key: dbKey, entry, similarity: sim });
  }
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// exposto no escopo global (scripts carregados via <script> simples, sem bundler)
window.HWMatch = {
  normalizeKey,
  diceSimilarity,
  matchBenchmark,
  matchChipset,
  suggestKeys,
  compatibleModel,
  FUZZY_THRESHOLD,
};
