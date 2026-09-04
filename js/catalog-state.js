/**
 * Estado compartilhado da pagina "Database" e as pecas que os tres
 * modulos de UI dela (catalog.js, review.js, benchdb.js, backup.js) precisam
 * dividir: os produtos carregados, a pontuacao em lote, os esquemas de
 * formulario e um mini "pubsub" para redesenhar quem depende do que mudou.
 *
 * A regra central da pagina esta aqui: a pontuacao exibida vem de
 * HWScoring.scoreProducts -- exatamente a mesma funcao que a pagina de builds
 * usa. Quem decide se um item pontua continua sendo o codigo; a revisao manual
 * so corrige os dados de entrada que o regex do scraper nao conseguiu extrair.
 */
(function () {
  const { el } = window.HWUi;

  const CATEGORIES = [
    { key: "cpu", label: "Processador" },
    { key: "motherboard", label: "Placa-Mãe" },
    { key: "ram", label: "Memória RAM" },
    { key: "gpu", label: "Placa de Vídeo" },
    { key: "psu", label: "Fonte" },
    { key: "storage", label: "Armazenamento" },
  ];
  const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

  const STATUS_TABS = [
    { key: "pending", label: "Pendentes" },
    { key: "scored", label: "Pontuados" },
    { key: "added", label: "Revisados" },
    { key: "ignored", label: "Ignorados" },
    { key: "all", label: "Todos" },
  ];

  const SORTS = [
    { key: "value", label: "Melhor índice de valor" },
    { key: "perf", label: "Maior desempenho" },
    { key: "price-asc", label: "Menor preço" },
    { key: "price-desc", label: "Maior preço" },
    { key: "name", label: "Nome (A-Z)" },
  ];

  const EFFICIENCY_OPTIONS = ["none", "80+ white", "80+ bronze", "80+ silver", "80+ gold", "80+ platinum", "80+ titanium"];
  const INTERFACE_OPTIONS = ["hdd", "sata_ssd", "nvme", "nvme_gen4"];

  /**
   * Campos editaveis no formulario de revisao, por categoria.
   *
   * `allowEmpty` num select cria a opcao "(vazio)": sem ela nao havia como
   * APAGAR uma spec que o regex extraiu errado -- so trocar por outro valor
   * igualmente errado. Um campo deixado vazio grava `null` no override, que
   * sobrescreve o valor do scraper (ver applyOverridesToProducts).
   */
  const FIELD_SCHEMAS = {
    cpu: [
      { key: "brand", label: "Marca", type: "select", options: ["Intel", "AMD"], allowEmpty: true },
      { key: "model_key", label: "Modelo (ex: i5-12400, ryzen 5 5600)", type: "text" },
      { key: "socket", label: "Soquete", type: "text", listId: "list-sockets" },
    ],
    motherboard: [
      { key: "socket", label: "Soquete (ex: AM4, LGA1700)", type: "text", listId: "list-sockets" },
      { key: "chipset", label: "Chipset (ex: B550, Z790)", type: "text", listId: "list-chipsets" },
      { key: "form_factor", label: "Formato", type: "select", options: ["ATX", "MICROATX", "MINIITX", "EATX"], allowEmpty: true },
    ],
    ram: [
      { key: "capacity_gb", label: "Capacidade (GB)", type: "number" },
      { key: "speed_mhz", label: "Velocidade (MHz)", type: "number" },
      { key: "cas_latency", label: "CAS Latency / CL (opcional)", type: "number" },
      { key: "ddr_gen", label: "Geração", type: "select", options: ["DDR2", "DDR3", "DDR4", "DDR5"], allowEmpty: true },
      { key: "form_factor", label: "Formato", type: "select", options: ["DIMM", "SODIMM"] },
    ],
    gpu: [
      { key: "brand", label: "Marca", type: "select", options: ["NVIDIA", "AMD", "Intel"], allowEmpty: true },
      { key: "model_key", label: "Modelo (ex: rtx 4060, rx 6600)", type: "text" },
      { key: "vram_gb", label: "VRAM (GB, opcional)", type: "number" },
    ],
    psu: [
      { key: "wattage", label: "Wattagem (W)", type: "number" },
      { key: "efficiency", label: "Selo 80 PLUS", type: "select", options: EFFICIENCY_OPTIONS },
    ],
    storage: [
      { key: "capacity_gb", label: "Capacidade (GB)", type: "number" },
      { key: "interface", label: "Interface", type: "select", options: INTERFACE_OPTIONS, allowEmpty: true },
      { key: "form_factor", label: "Formato", type: "select", options: ['M.2', '2.5"', '3.5"'], allowEmpty: true },
    ],
  };

  /**
   * Filtros extras exibidos apenas com uma unica categoria selecionada e a aba
   * "Pontuados" ativa -- operam sobre campos que so existem depois da
   * pontuacao (nucleos, VRAM, soquete resolvido) ou que so uma categoria tem.
   * `field` e um caminho tipo "specs.speed_mhz" resolvido contra o item pontuado.
   */
  const EXTRA_FILTER_SCHEMAS = {
    cpu: [
      { key: "brand", label: "Marca", type: "select", options: ["Intel", "AMD"], field: "specs.brand" },
      { key: "socket", label: "Soquete", type: "select", field: "performance.socket" },
      { key: "cores_min", label: "Núcleos (mínimo)", type: "number-min", field: "performance.cores" },
    ],
    motherboard: [
      { key: "socket", label: "Soquete", type: "select", field: "performance.socket" },
      { key: "ram_type", label: "Tipo de RAM", type: "select", options: ["DDR3", "DDR4", "DDR5"], field: "performance.ramType" },
      { key: "tier_min", label: "Tier (mínimo)", type: "number-min", field: "performance.tier" },
    ],
    ram: [
      { key: "speed_min", label: "Velocidade mínima (MHz)", type: "number-min", field: "specs.speed_mhz" },
      { key: "capacity_min", label: "Capacidade mínima (GB)", type: "number-min", field: "specs.capacity_gb" },
      { key: "ddr_gen", label: "Geração", type: "select", options: ["DDR2", "DDR3", "DDR4", "DDR5"], field: "specs.ddr_gen" },
      { key: "cl_max", label: "CAS Latency máxima", type: "number-max", field: "specs.cas_latency" },
    ],
    gpu: [
      { key: "brand", label: "Marca", type: "select", options: ["NVIDIA", "AMD", "Intel"], field: "specs.brand" },
      { key: "vram_min", label: "VRAM mínima (GB)", type: "number-min", field: "performance.vramGb" },
    ],
    psu: [
      { key: "wattage_min", label: "Wattagem mínima (W)", type: "number-min", field: "specs.wattage" },
      { key: "efficiency", label: "Selo 80 PLUS", type: "select", options: EFFICIENCY_OPTIONS, field: "specs.efficiency" },
    ],
    storage: [
      { key: "interface", label: "Interface", type: "select", options: INTERFACE_OPTIONS, field: "specs.interface" },
      { key: "capacity_min", label: "Capacidade mínima (GB)", type: "number-min", field: "specs.capacity_gb" },
    ],
  };

  const state = {
    products: [],
    benchmarks: null,
    meta: null,
    category: "all",
    status: "pending",
    search: "",
    sort: "value",
    expanded: new Set(),
    extraFilters: {},
    page: 1,
    pageSize: 60,
    statusMap: new Map(),
    counts: { scored: 0, pending: 0, added: 0, ignored: 0 },
  };

  /* ---------------------------------------------------------- pubsub ----- */

  const listeners = new Set();

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * `dirty` marca que as decisoes mudaram e a pontuacao precisa ser refeita.
   * Sem isso, cada tecla digitada na busca re-pontuava os ~1500 produtos das
   * seis categorias -- o custo real da lista nao era desenhar, era recalcular
   * uma coisa que nao tinha mudado.
   */
  let dirty = true;

  function invalidate() {
    dirty = true;
  }

  function emit(reason) {
    listeners.forEach((fn) => fn(reason));
  }

  /** Invalida a pontuacao e redesenha -- use depois de gravar qualquer override. */
  function refresh(reason = "data") {
    invalidate();
    emit(reason);
  }

  /* ----------------------------------------------------- pontuacao ------- */

  function effectiveBenchmarks() {
    return HWOverrides.applyBenchmarkOverrides(state.benchmarks);
  }

  function recompute() {
    if (!dirty) return state.statusMap;
    const working = HWOverrides.applyOverridesToProducts(state.products);
    const byCategory = {};
    for (const p of working) (byCategory[p.category] = byCategory[p.category] || []).push(p);

    const benchmarks = effectiveBenchmarks();
    const map = new Map();
    for (const category of Object.keys(byCategory)) {
      HWScoring.scoreProducts(category, byCategory[category], benchmarks).forEach((p) => map.set(p.url, p));
    }
    state.statusMap = map;

    const counts = { scored: 0, pending: 0, added: 0, ignored: 0 };
    for (const p of state.products) counts[statusOf(p)]++;
    state.counts = counts;

    dirty = false;
    return map;
  }

  function statusOf(product) {
    const ov = HWOverrides.getOverrides()[product.url];
    if (ov && ov.decision === "ignored") return "ignored";
    if (ov && ov.decision === "added") return "added";
    const entry = state.statusMap.get(product.url);
    return entry && entry.scored ? "scored" : "pending";
  }

  function entryOf(product) {
    return state.statusMap.get(product.url) || null;
  }

  /** Roda o scorer real sobre specs candidatas, so para preview -- nao grava nada. */
  function previewScore(product, candidateSpecs) {
    const scorer = HWScoring.SCORERS[product.category];
    if (!product.price_usd || product.price_usd <= 0) {
      return { ok: false, reason: HWScoring.REASON_TEXT[HWScoring.REASON.NO_PRICE] };
    }
    const probe = { ...product, specs: candidateSpecs };
    const result = scorer(probe, effectiveBenchmarks());
    if (!result) {
      const diag = HWScoring.diagnoseUnscored(product.category, probe, effectiveBenchmarks());
      return { ok: false, reason: diag.message, code: diag.code };
    }
    return { ok: true, result, ratio: result.score / product.price_usd };
  }

  /* --------------------------------------------------- formularios ------- */

  const CLEARED = "__cleared__";

  function buildFieldInput(field, currentValue) {
    const wrapper = el("div", "field");
    wrapper.appendChild(el("label", null, field.label));
    let input;
    if (field.type === "select") {
      input = document.createElement("select");
      if (field.allowEmpty) {
        const blank = document.createElement("option");
        blank.value = CLEARED;
        blank.textContent = "(vazio)";
        input.appendChild(blank);
      }
      field.options.forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (String(currentValue) === opt) o.selected = true;
        input.appendChild(o);
      });
      if (field.allowEmpty && (currentValue === null || currentValue === undefined || currentValue === "")) {
        input.value = CLEARED;
      }
    } else {
      input = document.createElement("input");
      input.type = field.type;
      if (field.listId) input.setAttribute("list", field.listId);
      if (currentValue !== undefined && currentValue !== null) input.value = currentValue;
    }
    input.dataset.key = field.key;
    input.dataset.type = field.type;
    wrapper.appendChild(input);
    return { wrapper, input, field };
  }

  /**
   * Le o formulario de revisao. Campo em branco vira `null` explicito -- e nao
   * "campo ausente" -- para que a spec extraida errada pelo scraper seja de
   * fato apagada quando o override for aplicado por cima dela.
   */
  function readFormSpecs(fieldEls) {
    const specs = {};
    for (const { input, field } of fieldEls) {
      const raw = input.value;
      if (raw === "" || raw === CLEARED) {
        specs[field.key] = null;
        continue;
      }
      if (field.type === "number") {
        const num = parseFloat(String(raw).replace(",", "."));
        specs[field.key] = Number.isNaN(num) ? null : num;
      } else {
        specs[field.key] = raw;
      }
    }
    return specs;
  }

  function getPath(obj, path) {
    return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  /** Valores distintos de um campo entre os itens pontuados da categoria ativa. */
  function dynamicFilterOptions(field) {
    const values = new Set();
    for (const entry of state.statusMap.values()) {
      if (!entry.scored || entry.category !== state.category) continue;
      const v = getPath(entry, field);
      if (v !== null && v !== undefined && v !== "") values.add(v);
    }
    return [...values].sort();
  }

  window.HWCat = {
    state,
    CATEGORIES,
    CATEGORY_LABEL,
    STATUS_TABS,
    SORTS,
    FIELD_SCHEMAS,
    EXTRA_FILTER_SCHEMAS,
    CLEARED,
    onChange,
    emit,
    refresh,
    invalidate,
    recompute,
    statusOf,
    entryOf,
    effectiveBenchmarks,
    previewScore,
    buildFieldInput,
    readFormSpecs,
    getPath,
    dynamicFilterOptions,
  };
})();
