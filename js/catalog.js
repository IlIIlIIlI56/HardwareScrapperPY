/**
 * Pagina "Base de Dados": lista todos os produtos raspados e deixa o
 * usuario revisar os que nao entraram no calculo de custo-beneficio por
 * falta de especificacoes reconheciveis. Decisoes (adicionar com specs
 * corrigidas, ou continuar ignorando) sao salvas via overrides.js e
 * aplicadas automaticamente da proxima vez que a pagina de builds rodar
 * o pipeline -- reaproveitando as MESMAS funcoes de pontuacao de
 * scoring.js, entao a decisao final de "pontua ou nao" continua sendo do
 * codigo, nao de uma afirmacao manual do usuario.
 */

const DATA_DIR = "./data";

const CATEGORIES = [
  { key: "cpu", label: "Processador" },
  { key: "motherboard", label: "Placa-Mae" },
  { key: "ram", label: "Memoria RAM" },
  { key: "gpu", label: "Placa de Video" },
  { key: "psu", label: "Fonte" },
  { key: "storage", label: "Armazenamento" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const STATUS_TABS = [
  { key: "pending", label: "Pendentes de revisao" },
  { key: "all", label: "Todos" },
  { key: "scored", label: "Pontuados" },
  { key: "added", label: "Adicionados manualmente" },
  { key: "ignored", label: "Ignorados" },
];

/** Campos editaveis no formulario de revisao, por categoria. */
const FIELD_SCHEMAS = {
  cpu: [
    { key: "brand", label: "Marca", type: "select", options: ["Intel", "AMD"] },
    { key: "model_key", label: "Modelo (ex: i5-12400, ryzen 5 5600)", type: "text" },
  ],
  motherboard: [
    { key: "socket", label: "Soquete (ex: AM4, LGA1700)", type: "text", listId: "list-sockets" },
    { key: "chipset", label: "Chipset (ex: B550, Z790)", type: "text", listId: "list-chipsets" },
  ],
  ram: [
    { key: "capacity_gb", label: "Capacidade (GB)", type: "number" },
    { key: "speed_mhz", label: "Velocidade (MHz)", type: "number" },
    { key: "cas_latency", label: "CAS Latency / CL (opcional)", type: "number" },
    { key: "ddr_gen", label: "Geracao", type: "select", options: ["DDR2", "DDR3", "DDR4", "DDR5"] },
    { key: "form_factor", label: "Formato", type: "select", options: ["DIMM", "SODIMM"] },
  ],
  gpu: [
    { key: "brand", label: "Marca", type: "select", options: ["NVIDIA", "AMD", "Intel"] },
    { key: "model_key", label: "Modelo (ex: rtx 4060, rx 6600)", type: "text" },
    { key: "vram_gb", label: "VRAM (GB, opcional)", type: "number" },
  ],
  psu: [
    { key: "wattage", label: "Wattagem (W)", type: "number" },
    {
      key: "efficiency",
      label: "Selo 80 PLUS",
      type: "select",
      options: ["none", "80+ white", "80+ bronze", "80+ silver", "80+ gold", "80+ platinum", "80+ titanium"],
    },
  ],
  storage: [
    { key: "capacity_gb", label: "Capacidade (GB)", type: "number" },
    { key: "interface", label: "Interface", type: "select", options: ["hdd", "sata_ssd", "nvme", "nvme_gen4"] },
  ],
};

const state = {
  products: [],
  benchmarks: null,
  category: "all",
  status: "pending",
  search: "",
  expanded: new Set(),
  statusMap: new Map(),
  extraFilters: {},
};

const PRICE_OUTLIER_REASON = "outlier estatistico de preco (provavel erro na fonte)";

/**
 * Filtros extras exibidos apenas quando ha uma unica categoria selecionada
 * e a aba "Pontuados" esta ativa -- cada um opera sobre um campo especifico
 * do item ja pontuado (specs extraidas ou performance calculada por
 * scoring.js), entao so fazem sentido para itens que de fato pontuaram.
 * `field` e um caminho tipo "specs.speed_mhz" ou "performance.cores"
 * resolvido contra o objeto pontuado guardado em state.statusMap.
 */
const EXTRA_FILTER_SCHEMAS = {
  cpu: [
    { key: "brand", label: "Marca", type: "select", options: ["Intel", "AMD"], field: "specs.brand" },
    { key: "cores_min", label: "Nucleos (minimo)", type: "number-min", field: "performance.cores" },
  ],
  motherboard: [
    { key: "socket", label: "Soquete", type: "select", field: "performance.socket" },
    { key: "ram_type", label: "Tipo de RAM", type: "select", options: ["DDR3", "DDR4", "DDR5"], field: "performance.ramType" },
    { key: "tier_min", label: "Tier (minimo)", type: "number-min", field: "performance.tier" },
  ],
  ram: [
    { key: "speed_min", label: "Velocidade minima (MHz)", type: "number-min", field: "specs.speed_mhz" },
    { key: "ddr_gen", label: "Geracao", type: "select", options: ["DDR2", "DDR3", "DDR4", "DDR5"], field: "specs.ddr_gen" },
    { key: "cl_max", label: "CAS Latency maxima", type: "number-max", field: "specs.cas_latency" },
  ],
  gpu: [
    { key: "brand", label: "Marca", type: "select", options: ["NVIDIA", "AMD", "Intel"], field: "specs.brand" },
    { key: "vram_min", label: "VRAM minima (GB)", type: "number-min", field: "performance.vramGb" },
  ],
  psu: [
    { key: "wattage_min", label: "Wattagem minima (W)", type: "number-min", field: "specs.wattage" },
    {
      key: "efficiency",
      label: "Selo 80 PLUS",
      type: "select",
      options: ["none", "80+ white", "80+ bronze", "80+ silver", "80+ gold", "80+ platinum", "80+ titanium"],
      field: "specs.efficiency",
    },
  ],
  storage: [
    { key: "interface", label: "Interface", type: "select", options: ["hdd", "sata_ssd", "nvme", "nvme_gen4"], field: "specs.interface" },
    { key: "capacity_min", label: "Capacidade minima (GB)", type: "number-min", field: "specs.capacity_gb" },
  ],
};

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function specSummary(specs) {
  return Object.entries(specs || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
}

/** Base de benchmarks + entradas adicionadas manualmente (localStorage) mescladas por cima. */
function getEffectiveBenchmarks() {
  return HWOverrides.applyBenchmarkOverrides(state.benchmarks);
}

/** Roda o mesmo scorer de scoring.js sobre specs candidatas, so para preview -- nao grava nada. */
function previewScore(product, candidateSpecs) {
  const scorer = HWScoring.SCORERS[product.category];
  if (!product.price_usd || product.price_usd <= 0) return { ok: false, reason: "Sem preco valido." };
  const probe = { ...product, specs: candidateSpecs };
  const result = scorer(probe, getEffectiveBenchmarks());
  if (!result) return { ok: false, reason: "Especificacoes ainda insuficientes / sem correspondencia na base de benchmarks." };
  const ratio = result.score / product.price_usd;
  return { ok: true, result, ratio };
}

/** Sugestao de termo de busca para o usuario achar o score de performance em sites confiaveis. */
function suggestSearchQuery(category, specs) {
  if (category === "cpu") return `${specs.brand || ""} ${specs.model_key || ""} passmark cpu mark score`.trim();
  if (category === "gpu") return `${specs.brand || ""} ${specs.model_key || ""} passmark g3d videocardbenchmark`.trim();
  if (category === "motherboard") return `chipset ${specs.chipset || ""} soquete especificacoes`.trim();
  return "";
}

function searchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Roda o MESMO HWScoring.scoreProducts usado pela pagina de builds (app.js),
 * categoria por categoria, sobre os produtos ja com as decisoes de
 * override aplicadas (added/ignored) -- para refletir corretamente aqui os
 * itens que o pipeline real exclui por serem outliers estatisticos de
 * preco (flagValueOutliers em scoring.js). Sem isso, um item com specs
 * perfeitamente validas mas preco fora do padrao aparecia como "Pontuado"
 * nesta pagina mesmo estando de fora do calculo de builds -- nao dava para
 * saber o motivo real, so "specs insuficientes" (que nao era o caso).
 *
 * Guarda o objeto pontuado INTEIRO (nao so scored/reason) -- ele ja traz
 * performance/perfScore/valueRatio calculados por scoring.js, reaproveitados
 * tanto para mostrar o score nos cards quanto para os filtros extras por
 * categoria (ver EXTRA_FILTER_SCHEMAS), sem recalcular nada.
 */
function computeStatusMap() {
  const working = HWOverrides.applyOverridesToProducts(state.products);
  const byCategory = {};
  for (const p of working) {
    (byCategory[p.category] = byCategory[p.category] || []).push(p);
  }
  const benchmarks = getEffectiveBenchmarks();
  const map = new Map();
  for (const category of Object.keys(byCategory)) {
    const scored = HWScoring.scoreProducts(category, byCategory[category], benchmarks);
    scored.forEach((p) => map.set(p.url, p));
  }
  return map;
}

function computeStatus(product) {
  const ov = HWOverrides.getOverrides()[product.url];
  if (ov && ov.decision === "ignored") return "ignored";
  if (ov && ov.decision === "added") return "added";
  const entry = state.statusMap.get(product.url);
  return entry && entry.scored ? "scored" : "pending";
}

function pendingReason(product) {
  const entry = state.statusMap.get(product.url);
  return entry ? entry.reason : null;
}

function scoreEntry(product) {
  return state.statusMap.get(product.url) || null;
}

/**
 * So se aplica quando ha uma categoria unica selecionada e a aba ativa e
 * "Pontuados" (renderExtraFilters so exibe os controles nessas condicoes).
 * Compara contra o objeto pontuado (scoreEntry), nao contra o produto cru,
 * porque os campos de performance (nucleos, VRAM, tier, soquete resolvido)
 * so existem depois da pontuacao.
 */
function matchesExtraFilters(product) {
  const schema = EXTRA_FILTER_SCHEMAS[state.category];
  if (!schema) return true;
  const entry = scoreEntry(product);
  if (!entry) return true;
  for (const f of schema) {
    const filterValue = state.extraFilters[f.key];
    if (filterValue === undefined || filterValue === "") continue;
    const actual = getPath(entry, f.field);
    if (f.type === "select") {
      if (actual == null || String(actual) !== String(filterValue)) return false;
    } else if (f.type === "number-min") {
      if (actual == null || Number(actual) < Number(filterValue)) return false;
    } else if (f.type === "number-max") {
      if (actual == null || Number(actual) > Number(filterValue)) return false;
    }
  }
  return true;
}

function matchesFilters(product, status) {
  if (state.category !== "all" && product.category !== state.category) return false;
  if (state.status !== "all" && status !== state.status) return false;
  if (state.search) {
    const needle = HWMatch.normalizeKey(state.search);
    if (!HWMatch.normalizeKey(product.name).includes(needle)) return false;
  }
  if (state.status === "scored" && state.category !== "all" && !matchesExtraFilters(product)) return false;
  return true;
}

function buildDatalists() {
  const container = document.getElementById("datalists");
  if (container) container.remove();
  const wrap = el("div");
  wrap.id = "datalists";
  wrap.style.display = "none";

  const sockets = new Set();
  const chipsets = Object.keys(getEffectiveBenchmarks().chipsets || {});
  for (const p of state.products) {
    if (p.category === "motherboard" && p.specs.socket) sockets.add(p.specs.socket);
  }

  const socketList = el("datalist");
  socketList.id = "list-sockets";
  socketList.innerHTML = [...sockets].sort().map((s) => `<option value="${s}"></option>`).join("");

  const chipsetList = el("datalist");
  chipsetList.id = "list-chipsets";
  chipsetList.innerHTML = chipsets.sort().map((c) => `<option value="${c}"></option>`).join("");

  wrap.appendChild(socketList);
  wrap.appendChild(chipsetList);
  document.body.appendChild(wrap);
}

function buildFieldInput(field, currentValue) {
  const wrapper = el("div", "field");
  wrapper.appendChild(el("label", null, field.label));
  let input;
  if (field.type === "select") {
    input = document.createElement("select");
    field.options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (String(currentValue) === opt) o.selected = true;
      input.appendChild(o);
    });
  } else {
    input = document.createElement("input");
    input.type = field.type;
    if (field.listId) input.setAttribute("list", field.listId);
    if (currentValue !== undefined && currentValue !== null) input.value = currentValue;
  }
  input.dataset.key = field.key;
  input.dataset.type = field.type;
  wrapper.appendChild(input);
  return { wrapper, input };
}

function readFormSpecs(inputs) {
  const specs = {};
  for (const input of inputs) {
    const key = input.dataset.key;
    let value = input.value;
    if (value === "") continue;
    if (input.type === "number") {
      const num = parseFloat(value);
      if (!Number.isNaN(num)) specs[key] = num;
    } else {
      specs[key] = value;
    }
  }
  return specs;
}

/**
 * Sub-formulario que aparece quando um CPU/GPU nao bate com nenhuma chave
 * da base de benchmarks, ou uma Placa-Mae usa um chipset desconhecido:
 * sugere um termo de busca em sites confiaveis (PassMark / TechPowerUp) e
 * deixa cadastrar a entrada na base local (localStorage), beneficiando
 * qualquer outro produto com a mesma model_key/chipset dali em diante.
 */
function renderBenchmarkAddSection(product, mergedSpecs, onSaved) {
  const category = product.category;
  const wrap = el("div", "benchmark-add-panel");
  wrap.appendChild(
    el(
      "div",
      "benchmark-add-title",
      category === "motherboard"
        ? "Chipset nao esta na base de benchmarks (tier usado por padrao: 1)"
        : "Modelo nao encontrado na base de benchmarks"
    )
  );

  const query = suggestSearchQuery(category, mergedSpecs);
  const searchLine = el("div", "benchmark-search-line");
  searchLine.appendChild(document.createTextNode("Pesquise: "));
  const link = document.createElement("a");
  link.href = searchUrl(query);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `"${query}"`;
  searchLine.appendChild(link);
  wrap.appendChild(searchLine);

  const grid = el("div", "review-form-grid");
  let scoreField;
  let extraFields = [];
  if (category === "cpu") {
    scoreField = buildFieldInput({ key: "_score", label: "Score (PassMark CPU Mark aprox.)", type: "number" });
    extraFields = [
      buildFieldInput({ key: "_socket", label: "Soquete", type: "text", listId: "list-sockets" }, mergedSpecs.socket),
      buildFieldInput({ key: "_cores", label: "Nucleos (opcional)", type: "number" }),
    ];
  } else if (category === "gpu") {
    scoreField = buildFieldInput({ key: "_score", label: "Score (aprox., estilo PassMark G3D)", type: "number" });
    extraFields = [buildFieldInput({ key: "_tdp", label: "TDP estimado em W (opcional)", type: "number" })];
  } else if (category === "motherboard") {
    scoreField = buildFieldInput({
      key: "_tier",
      label: "Tier (1=entrada .. 4=topo de linha)",
      type: "select",
      options: ["1", "2", "3", "4"],
    });
    extraFields = [
      buildFieldInput({ key: "_ram", label: "Tipo de memoria suportado", type: "select", options: ["DDR3", "DDR4", "DDR5"] }),
    ];
  }
  grid.appendChild(scoreField.wrapper);
  extraFields.forEach((f) => grid.appendChild(f.wrapper));
  wrap.appendChild(grid);

  const saveBtn = el("button", "btn btn-primary", "Salvar no benchmarks");
  wrap.appendChild(saveBtn);
  const confirmMsg = el("div", "decision-note", "");
  wrap.appendChild(confirmMsg);

  saveBtn.addEventListener("click", () => {
    if (category === "cpu" || category === "gpu") {
      const score = parseFloat(scoreField.input.value);
      if (Number.isNaN(score) || !mergedSpecs.model_key) {
        confirmMsg.textContent = "Informe ao menos o modelo (no formulario acima) e o score.";
        return;
      }
      const key = HWMatch.normalizeKey(mergedSpecs.model_key);
      const entry =
        category === "cpu"
          ? {
              score,
              brand: mergedSpecs.brand || null,
              socket: extraFields[0].input.value || mergedSpecs.socket || null,
              cores: extraFields[1].input.value ? parseFloat(extraFields[1].input.value) : null,
            }
          : {
              score,
              brand: mergedSpecs.brand || null,
              tdp_w: extraFields[0].input.value ? parseFloat(extraFields[0].input.value) : null,
            };
      HWOverrides.setBenchmarkOverride(category, key, entry);
    } else if (category === "motherboard") {
      if (!mergedSpecs.chipset) {
        confirmMsg.textContent = "Informe o chipset no formulario acima primeiro.";
        return;
      }
      HWOverrides.setBenchmarkOverride("chipsets", mergedSpecs.chipset, {
        tier: parseFloat(scoreField.input.value),
        ram: extraFields[0].input.value,
        socket: mergedSpecs.socket || null,
      });
    }
    confirmMsg.textContent = "Salvo na base de benchmarks. Reavaliando...";
    onSaved();
  });

  return wrap;
}

function renderReviewPanel(product) {
  const schema = FIELD_SCHEMAS[product.category] || [];
  const panel = el("div", "review-panel");

  const isPriceOutlier = pendingReason(product) === PRICE_OUTLIER_REASON;
  const isNotebookRam = product.category === "ram" && HWScoring.isNotebookRam(product.specs || {}, product.name);
  const reasonLine = el(
    "div",
    "review-reason",
    isPriceOutlier
      ? "Este item tem especificacoes validas e pontua normalmente, mas foi excluido do calculo de builds por ter um indice desempenho/preco muito fora do padrao da categoria (heuristica MAD em js/scoring.js) -- geralmente sinal de erro de preco na fonte. Confira o anuncio original: se o preco estiver correto, use \"Adicionar a base\" para forcar a inclusao; caso contrario, \"Ignorar\"."
      : isNotebookRam
      ? "Identificada como memoria SO-DIMM (formato de notebook) -- fisicamente incompativel com uma build desktop, entao fica de fora mesmo com capacidade/velocidade corretas. Se for um falso positivo do regex (o anuncio e de uma DIMM de desktop), mude \"Formato\" para DIMM abaixo; caso contrario, o correto e usar \"Ignorar item\"."
      : "Especificacoes insuficientes ou sem correspondencia na base de performance -- complete os campos abaixo."
  );
  panel.appendChild(reasonLine);

  if (specSummary(product.specs).length) {
    const tags = el("div", "spec-tags");
    specSummary(product.specs).forEach((t) => tags.appendChild(el("span", "spec-tag", t)));
    panel.appendChild(tags);
  }

  const grid = el("div", "review-form-grid");
  const fieldEls = schema.map((f) => buildFieldInput(f, product.specs ? product.specs[f.key] : undefined));
  fieldEls.forEach((f) => grid.appendChild(f.wrapper));
  panel.appendChild(grid);

  const preview = el("div", "review-preview fail", "Preencha os campos para ver se o item passa a pontuar.");
  panel.appendChild(preview);

  const actions = el("div", "review-actions");
  const addBtn = el("button", "btn btn-primary", "Adicionar a base");
  addBtn.disabled = true;
  const ignoreBtn = el("button", "btn btn-ghost", "Ignorar item");
  actions.appendChild(addBtn);
  actions.appendChild(ignoreBtn);
  panel.appendChild(actions);

  const benchSlot = el("div");
  panel.appendChild(benchSlot);

  let lastGoodSpecs = null;
  let lastBenchTriggerKey = null;

  function updateBenchmarkSlot(merged, probeOk) {
    const category = product.category;
    let triggerKey = null;

    if ((category === "cpu" || category === "gpu") && merged.model_key && merged.brand && !probeOk) {
      triggerKey = `${category}:${HWMatch.normalizeKey(merged.brand)}:${HWMatch.normalizeKey(merged.model_key)}`;
    } else if (category === "motherboard" && merged.chipset && !getEffectiveBenchmarks().chipsets[merged.chipset]) {
      triggerKey = `motherboard:${merged.chipset}`;
    }

    if (!triggerKey) {
      benchSlot.innerHTML = "";
      lastBenchTriggerKey = null;
      return;
    }
    if (triggerKey === lastBenchTriggerKey) return; // usuario ainda digitando o score -- nao reconstroi
    lastBenchTriggerKey = triggerKey;
    benchSlot.innerHTML = "";
    benchSlot.appendChild(
      renderBenchmarkAddSection(product, merged, () => {
        lastBenchTriggerKey = null;
        updatePreview();
        renderCustomBenchmarksList();
      })
    );
  }

  function updatePreview() {
    const edited = readFormSpecs(fieldEls.map((f) => f.input));
    const merged = { ...product.specs, ...edited };
    const probe = previewScore(product, merged);
    if (probe.ok) {
      preview.className = "review-preview ok";
      preview.textContent = `Pontuavel: performance ${probe.result.score.toFixed(1)} · valor ${probe.ratio.toFixed(3)} (performance/USD).`;
      addBtn.disabled = false;
      lastGoodSpecs = edited;
    } else {
      preview.className = "review-preview fail";
      preview.textContent =
        product.category === "ram" && HWScoring.isNotebookRam(merged, product.name)
          ? "Ainda identificada como SO-DIMM (notebook) -- mude \"Formato\" para DIMM se isso for um falso positivo do regex, ou use \"Ignorar item\" se for mesmo uma memoria de notebook."
          : probe.reason;
      addBtn.disabled = true;
      lastGoodSpecs = null;
    }
    updateBenchmarkSlot(merged, probe.ok);
  }

  fieldEls.forEach((f) => f.input.addEventListener("input", updatePreview));
  updatePreview();

  addBtn.addEventListener("click", () => {
    if (!lastGoodSpecs) return;
    HWOverrides.setOverride(product.url, "added", lastGoodSpecs);
    renderList();
  });

  ignoreBtn.addEventListener("click", () => {
    HWOverrides.setOverride(product.url, "ignored");
    renderList();
  });

  return panel;
}

function renderDecisionNote(product, status) {
  const ov = HWOverrides.getOverrides()[product.url];
  const wrap = el("div");
  const label = status === "added" ? "Adicionado a base em" : "Ignorado em";
  wrap.appendChild(el("div", "decision-note", `${label} ${formatDate(ov.updatedAt)}.`));
  const undoBtn = el("button", "btn btn-danger-ghost", "Desfazer decisao");
  undoBtn.style.marginTop = "6px";
  undoBtn.addEventListener("click", () => {
    HWOverrides.clearOverride(product.url);
    renderList();
  });
  wrap.appendChild(undoBtn);
  return wrap;
}

function renderCatalogItem(product) {
  const status = computeStatus(product);
  const item = el("article", "catalog-item");

  const head = el("div", "catalog-item-head");
  const main = el("div", "catalog-item-main");
  const badges = el("div");
  badges.appendChild(el("span", `status-badge ${status}`, statusLabel(status)));
  badges.appendChild(el("span", "spec-tag", CATEGORY_LABEL[product.category]));
  main.appendChild(badges);

  const nameLink = el("a", "catalog-item-name", product.name);
  nameLink.href = product.url;
  nameLink.target = "_blank";
  nameLink.rel = "noopener noreferrer";
  main.appendChild(nameLink);

  main.appendChild(
    el("div", "catalog-item-meta", `${product.offers != null ? product.offers + " ofertas" : "ofertas: --"}`)
  );

  const entry = scoreEntry(product);
  if (entry && entry.scored) {
    main.appendChild(
      el(
        "div",
        "catalog-item-score",
        `Desempenho: ${entry.perfScore.toFixed(1)} · Indice de valor: ${entry.valueRatio.toFixed(3)} (desempenho/USD)`
      )
    );
  }

  if (specSummary(product.specs).length && status !== "pending") {
    const tags = el("div", "spec-tags");
    specSummary(product.specs).forEach((t) => tags.appendChild(el("span", "spec-tag", t)));
    main.appendChild(tags);
  }

  head.appendChild(main);

  const priceBox = el("div", "catalog-item-price");
  priceBox.appendChild(el("div", "price-usd", HWFormat.fmtUsd(product.price_usd)));
  if (product.price_brl) priceBox.appendChild(el("div", "price-brl", HWFormat.fmtBrl(product.price_brl)));
  head.appendChild(priceBox);

  item.appendChild(head);

  if (status === "pending") {
    const toggleBtn = el("button", "review-toggle", state.expanded.has(product.url) ? "Fechar revisao" : "Revisar item");
    toggleBtn.addEventListener("click", () => {
      if (state.expanded.has(product.url)) state.expanded.delete(product.url);
      else state.expanded.add(product.url);
      renderList();
    });
    item.appendChild(toggleBtn);
    if (state.expanded.has(product.url)) {
      item.appendChild(renderReviewPanel(product));
    }
  } else if (status === "added" || status === "ignored") {
    item.appendChild(renderDecisionNote(product, status));
  }

  return item;
}

function statusLabel(status) {
  return { scored: "Pontuado", pending: "Pendente", added: "Adicionado", ignored: "Ignorado" }[status] || status;
}

const BENCH_SECTION_LABEL = { cpu: "CPU", gpu: "GPU", chipsets: "Chipset de Placa-Mae" };

function renderCustomBenchmarksList() {
  const container = document.getElementById("custom-benchmarks-list");
  if (!container) return;
  container.innerHTML = "";

  const custom = HWOverrides.getBenchmarkOverrides();
  const rows = [];
  for (const section of ["cpu", "gpu", "chipsets"]) {
    for (const [key, entry] of Object.entries(custom[section] || {})) {
      rows.push({ section, key, entry });
    }
  }

  if (rows.length === 0) {
    container.appendChild(el("div", "empty-state", "Nenhuma entrada manual de benchmark ainda."));
    return;
  }

  rows.forEach(({ section, key, entry }) => {
    const item = el("article", "catalog-item");
    const head = el("div", "catalog-item-head");
    const main = el("div", "catalog-item-main");
    main.appendChild(el("span", "spec-tag", BENCH_SECTION_LABEL[section]));
    main.appendChild(el("div", "catalog-item-name", key));
    const details = section === "chipsets" ? `tier ${entry.tier} · ${entry.ram || "?"}` : `score ${entry.score}`;
    main.appendChild(el("div", "catalog-item-meta", details));
    head.appendChild(main);

    const removeBtn = el("button", "btn btn-danger-ghost", "Remover");
    removeBtn.addEventListener("click", () => {
      HWOverrides.clearBenchmarkOverride(section, key);
      renderCustomBenchmarksList();
      renderList();
    });
    head.appendChild(removeBtn);

    item.appendChild(head);
    container.appendChild(item);
  });
}

function renderFilters() {
  const catBox = document.getElementById("category-filter");
  catBox.innerHTML = "";
  [{ key: "all", label: "Todas as categorias" }, ...CATEGORIES].forEach((c) => {
    const btn = el("button", `chip-btn${state.category === c.key ? " active" : ""}`, c.label);
    btn.addEventListener("click", () => {
      state.category = c.key;
      state.extraFilters = {}; // os campos de filtro extra mudam por categoria
      renderFilters();
      renderList();
    });
    catBox.appendChild(btn);
  });

  const statusBox = document.getElementById("status-filter");
  statusBox.innerHTML = "";
  STATUS_TABS.forEach((s) => {
    const btn = el("button", `chip-btn${state.status === s.key ? " active" : ""}`, s.label);
    btn.addEventListener("click", () => {
      state.status = s.key;
      renderFilters();
      renderList();
    });
    statusBox.appendChild(btn);
  });

  renderExtraFilters();
}

/** Valores distintos de um campo (ex: soquetes de placa-mae) entre os itens ja pontuados da categoria ativa. */
function dynamicFilterOptions(field) {
  const values = new Set();
  for (const entry of state.statusMap.values()) {
    if (!entry.scored || entry.category !== state.category) continue;
    const v = getPath(entry, field);
    if (v !== null && v !== undefined && v !== "") values.add(v);
  }
  return [...values].sort();
}

/**
 * Filtros especificos da categoria (velocidade/latencia de RAM, marca/VRAM
 * de GPU, marca/nucleos de CPU etc.) -- so exibidos com uma categoria
 * especifica selecionada e a aba "Pontuados" ativa, ja que operam sobre
 * campos de performance/specs que so existem para itens pontuados.
 */
function renderExtraFilters() {
  const container = document.getElementById("extra-filters");
  if (!container) return;
  container.innerHTML = "";

  const schema = EXTRA_FILTER_SCHEMAS[state.category];
  const show = state.status === "scored" && state.category !== "all" && schema;
  container.hidden = !show;
  if (!show) return;

  schema.forEach((f) => {
    const wrapper = el("div", "field extra-filter-field");
    wrapper.appendChild(el("label", null, f.label));
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Todos";
      input.appendChild(blank);
      (f.options || dynamicFilterOptions(f.field)).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (String(state.extraFilters[f.key]) === String(opt)) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = document.createElement("input");
      input.type = "number";
      input.placeholder = "qualquer";
      if (state.extraFilters[f.key] !== undefined) input.value = state.extraFilters[f.key];
    }
    input.addEventListener("input", () => {
      if (input.value === "") delete state.extraFilters[f.key];
      else state.extraFilters[f.key] = input.value;
      renderList();
    });
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  });

  const clearBtn = el("button", "btn btn-ghost", "Limpar filtros extras");
  clearBtn.addEventListener("click", () => {
    state.extraFilters = {};
    renderExtraFilters();
    renderList();
  });
  container.appendChild(clearBtn);
}

function renderList() {
  const container = document.getElementById("catalog-list");
  container.innerHTML = "";

  state.statusMap = computeStatusMap();
  const withStatus = state.products.map((p) => ({ product: p, status: computeStatus(p) }));
  const counts = { scored: 0, pending: 0, added: 0, ignored: 0 };
  withStatus.forEach(({ status }) => counts[status]++);

  const filtered = withStatus.filter(({ product, status }) => matchesFilters(product, status));

  document.getElementById("catalog-summary").textContent =
    `${filtered.length} de ${state.products.length} produtos exibidos · ` +
    `${counts.scored} pontuados · ${counts.pending} pendentes · ${counts.added} adicionados manualmente · ${counts.ignored} ignorados`;

  if (filtered.length === 0) {
    container.appendChild(el("div", "empty-state", "Nenhum produto encontrado com esses filtros."));
    return;
  }

  const MAX_RENDER = 400;
  filtered.slice(0, MAX_RENDER).forEach(({ product }) => container.appendChild(renderCatalogItem(product)));
  if (filtered.length > MAX_RENDER) {
    container.appendChild(
      el(
        "div",
        "empty-state",
        `Mostrando os primeiros ${MAX_RENDER} de ${filtered.length} resultados. Use os filtros ou a busca para refinar.`
      )
    );
  }
}

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar ${path}: HTTP ${res.status}`);
  return res.json();
}

function triggerDownload(filename, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function initBackupControls() {
  const exportBtn = document.getElementById("export-btn");
  const importInput = document.getElementById("import-input");
  const statusEl = document.getElementById("backup-status");
  if (!exportBtn || !importInput) return;

  exportBtn.addEventListener("click", () => {
    const data = HWOverrides.exportAllData();
    const stamp = data.exported_at.slice(0, 10);
    triggerDownload(`hw-database-backup-${stamp}.json`, JSON.stringify(data, null, 2));
    statusEl.textContent = "Backup baixado.";
  });

  importInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = HWOverrides.importAllData(parsed);
      statusEl.textContent =
        `Importado: ${result.productCount} decisao(oes) de produto e ${result.benchmarkCount} entrada(s) de benchmark, ` +
        `mescladas com o que ja estava salvo neste navegador.`;
      renderList();
      renderCustomBenchmarksList();
    } catch (err) {
      statusEl.textContent = `Erro ao importar: ${err.message}`;
    } finally {
      importInput.value = "";
    }
  });
}

async function main() {
  const metaEl = document.getElementById("data-meta");
  try {
    const [productsData, benchmarks] = await Promise.all([
      loadJson(`${DATA_DIR}/products.json`),
      loadJson(`${DATA_DIR}/benchmarks.json`),
    ]);
    state.products = productsData.products;
    state.benchmarks = benchmarks;
    metaEl.textContent = `Fonte: ${productsData.source} · dados raspados em ${formatDate(productsData.scraped_at)} · ${productsData.total_products} produtos`;
  } catch (err) {
    metaEl.textContent = `Erro ao carregar dados: ${err.message}. Rode o scraper primeiro (ver README).`;
    return;
  }

  buildDatalists();
  renderFilters();
  renderList();
  renderCustomBenchmarksList();
  initBackupControls();

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderList();
  });
}

main();
