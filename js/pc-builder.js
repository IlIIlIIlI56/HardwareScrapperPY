/**
 * Pagina "Build": montagem manual de uma configuracao, uma categoria de cada
 * vez (CPU > Placa-Mae > RAM > GPU > Armazenamento > Fonte), com cada etapa
 * pre-filtrada pelo que e compativel com o que ja foi escolhido.
 *
 * Diferente da pagina "Analise" (js/app.js + js/builder.js), aqui quem decide
 * cada peca e o usuario -- o codigo so restringe as opcoes (compatibilidade) e
 * calcula o total. As regras de compatibilidade (soquete, tipo de memoria,
 * wattagem minima de fonte) sao as MESMAS da montagem automatica: soquete e
 * tipo de RAM sao checados aqui direto contra as specs, e a wattagem minima
 * usa HWBuilder.recommendedWattage, exportado por builder.js de proposito para
 * as duas telas nunca divergirem sobre o que conta como compativel.
 *
 * Toda categoria guarda uma LISTA de pecas (nunca uma peca solta), mesmo as
 * que so aceitam uma -- isso evita ter dois formatos de dado (objeto solto vs
 * array) espalhados pelo arquivo. SLOT_LIMITS e quem decide, por categoria,
 * quantas cabem: CPU/Placa-Mae/GPU/Fonte ficam em 1 (uma build so tem um
 * soquete e uma fonte); RAM aceita ate 4 pentes e Armazenamento ate 2
 * unidades, o normal para uma configuracao de verdade.
 *
 * O filtro de compatibilidade pode ser desligado -- nesse caso a lista de cada
 * etapa mostra qualquer peca da categoria, e a build atual passa a exibir um
 * aviso (reaproveitando o estilo `.build-note` da pagina de Analise) sempre
 * que uma incompatibilidade real for detectada entre as pecas escolhidas.
 */
(function () {
  const { el, elHtml, clear, icon, thumb, describeSpecs, toast, openModal, debounce } = window.HWUi;

  const DATA_DIR = "./data";
  const STEP_ORDER = ["cpu", "motherboard", "ram", "gpu", "storage", "psu"];
  const DRAFT_KEY = "hw-pcbuild-draft-v1";
  const SAVED_KEY = "hw-pcbuild-saved-v1";
  const PAGE_SIZE = 40;

  /** Quantas pecas cada categoria aceita. Minimo 1 em todas -- so o teto muda. */
  const SLOT_LIMITS = {
    cpu: { min: 1, max: 1 },
    motherboard: { min: 1, max: 1 },
    ram: { min: 1, max: 4 },
    gpu: { min: 1, max: 1 },
    storage: { min: 1, max: 2 },
    psu: { min: 1, max: 1 },
  };

  const PICKER_SORTERS = {
    value: (a, b) => b.valueRatio - a.valueRatio,
    perf: (a, b) => b.perfScore - a.perfScore,
    "price-asc": (a, b) => a.price_usd - b.price_usd,
    "price-desc": (a, b) => b.price_usd - a.price_usd,
    name: (a, b) => a.name.localeCompare(b.name, "pt-BR"),
  };

  function emptyItems() {
    const items = {};
    for (const cat of STEP_ORDER) items[cat] = [];
    return items;
  }

  const state = {
    productsByCategory: {},
    items: emptyItems(),
    compatFilterEnabled: true,
    openStep: STEP_ORDER[0],
    query: "",
    sort: "value",
    visibleLimit: PAGE_SIZE,
    saved: {},
  };

  const single = (list) => (list && list[0]) || null;

  /** Aceita tanto uma lista (formato atual) quanto uma peca solta (builds salvas no formato antigo). */
  function toArray(value) {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  }

  /* ================================================== compatibilidade ==== */

  function cpuMoboCompatible(cpu, mobo) {
    const cpuSocket = cpu && cpu.performance && cpu.performance.socket;
    const moboSocket = mobo && mobo.performance && mobo.performance.socket;
    if (!cpuSocket || !moboSocket) return true; // soquete desconhecido de um lado -- nao ha base para bloquear
    return cpuSocket === moboSocket;
  }

  function ramMoboCompatible(ram, mobo) {
    const ramType = ram && ram.specs && ram.specs.ddr_gen;
    const moboRamType = mobo && mobo.performance && mobo.performance.ramType;
    if (!ramType || !moboRamType) return true;
    return ramType === moboRamType;
  }

  /** As RAMs de uma mesma build tem que ser da mesma geracao -- misturar DDR4 com DDR5 nao encaixa fisicamente. */
  function ramGroupCompatible(candidate, existingRam) {
    const candidateGen = candidate && candidate.specs && candidate.specs.ddr_gen;
    const referenceGen = existingRam.map((r) => r.specs && r.specs.ddr_gen).find(Boolean);
    if (!candidateGen || !referenceGen) return true;
    return candidateGen === referenceGen;
  }

  function psuSufficient(psu, cpu, gpu) {
    const wattage = psu && psu.specs && psu.specs.wattage;
    if (!wattage) return true;
    return wattage >= HWBuilder.recommendedWattage(cpu, gpu);
  }

  /**
   * Um candidato de `category` continua valido se uma peca de OUTRA categoria
   * mudar? Usado nos dois sentidos: para filtrar a lista da etapa (o que da
   * pra escolher agora) e para revalidar escolhas anteriores depois de trocar
   * algo (ver cascadeClearIncompatible). Nao inclui a checagem de RAM-com-RAM
   * (ramGroupCompatible) de proposito -- essa so faz sentido ao ADICIONAR uma
   * nova peca, nao ao revalidar pentes que ja eram consistentes entre si.
   */
  function matchesUpstream(category, candidate) {
    const items = state.items;
    if (category === "cpu") return cpuMoboCompatible(candidate, single(items.motherboard));
    if (category === "motherboard") {
      return (
        cpuMoboCompatible(single(items.cpu), candidate) &&
        (items.ram || []).every((ram) => ramMoboCompatible(ram, candidate))
      );
    }
    if (category === "ram") return ramMoboCompatible(candidate, single(items.motherboard));
    if (category === "psu") return psuSufficient(candidate, single(items.cpu), single(items.gpu));
    return true; // GPU e armazenamento nao tem restricao dura de compatibilidade
  }

  /** Filtro completo para a lista da etapa: compatibilidade a montante + consistencia entre RAMs. */
  function isCandidateSelectable(category, candidate) {
    if (!matchesUpstream(category, candidate)) return false;
    if (category === "ram") return ramGroupCompatible(candidate, state.items.ram || []);
    return true;
  }

  /**
   * Incompatibilidades REAIS entre as pecas ja escolhidas -- usado para o
   * aviso na build atual. So aparece algo aqui quando o filtro foi desligado
   * em algum momento (com o filtro ligado, a lista nunca oferece uma peca que
   * caia numa destas regras).
   */
  function computeConflicts(items) {
    const msgs = [];
    const cpu = single(items.cpu);
    const mobo = single(items.motherboard);
    const gpu = single(items.gpu);
    const psu = single(items.psu);
    const ramList = items.ram || [];

    if (cpu && mobo && !cpuMoboCompatible(cpu, mobo)) {
      msgs.push(`Soquete incompatível: CPU (${cpu.performance.socket}) e placa-mãe (${mobo.performance.socket}) não encaixam.`);
    }
    if (mobo) {
      ramList.forEach((ram, idx) => {
        if (!ramMoboCompatible(ram, mobo)) {
          const label = ramList.length > 1 ? `Memória ${idx + 1}` : "Memória";
          msgs.push(
            `${label} incompatível: RAM ${ram.specs.ddr_gen} não é suportada pela placa-mãe escolhida (aceita ${mobo.performance.ramType}).`
          );
        }
      });
    }
    const ramGens = new Set(ramList.map((r) => r.specs && r.specs.ddr_gen).filter(Boolean));
    if (ramGens.size > 1) {
      msgs.push(`Memórias de gerações diferentes misturadas na mesma build: ${[...ramGens].join(", ")}.`);
    }
    if (psu && !psuSufficient(psu, cpu, gpu)) {
      const needed = HWBuilder.recommendedWattage(cpu, gpu);
      msgs.push(`Fonte insuficiente: ${psu.specs.wattage}W abaixo do recomendado (>= ${needed}W) para esta CPU + GPU.`);
    }
    return msgs;
  }

  function candidatesFor(category) {
    let list = state.productsByCategory[category] || [];
    if (state.compatFilterEnabled) list = list.filter((p) => isCandidateSelectable(category, p));
    if (state.query) {
      const needle = HWMatch.normalizeKey(state.query);
      list = list.filter((p) => HWMatch.normalizeKey(p.name).includes(needle));
    }
    return [...list].sort(PICKER_SORTERS[state.sort] || PICKER_SORTERS.value);
  }

  /* =========================================================== selecao ==== */

  function nextIncompleteStep() {
    return STEP_ORDER.find((cat) => (state.items[cat] || []).length < SLOT_LIMITS[cat].min) || null;
  }

  /**
   * Revalida as OUTRAS categorias depois de mudar `changedCategory`, tirando
   * quem deixou de ser compativel. Reabrir uma etapa anterior (trocar a
   * placa-mae depois de ja ter RAM escolhida) pode invalidar uma escolha
   * posterior que era valida antes -- com varias RAMs, so os pentes que
   * realmente pararam de bater com a nova placa saem, os outros ficam.
   */
  function cascadeClearIncompatible(changedCategory) {
    if (!state.compatFilterEnabled) return [];
    const clearedLabels = [];
    for (const cat of STEP_ORDER) {
      if (cat === changedCategory) continue;
      const items = state.items[cat] || [];
      const kept = items.filter((item) => matchesUpstream(cat, item));
      if (kept.length !== items.length) {
        state.items[cat] = kept;
        clearedLabels.push(HWRender.CATEGORY_META[cat].label);
      }
    }
    return clearedLabels;
  }

  function openStepFor(cat) {
    state.openStep = cat;
    state.query = "";
    state.visibleLimit = PAGE_SIZE;
    renderSteps();
    renderPicker();
    document.getElementById("pcb-picker").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function addItem(category, product) {
    const limit = SLOT_LIMITS[category];
    const current = state.items[category] || [];

    if (limit.max === 1) {
      // Categoria de peca unica ("Trocar"): substitui sempre, mesmo ja
      // tendo uma escolhida -- e assim que o botao "Trocar" troca a peca.
      state.items[category] = [product];
    } else {
      if (current.length >= limit.max) return; // a UI ja desabilita isso; e so uma garantia
      state.items[category] = [...current, product];
    }

    const cleared = cascadeClearIncompatible(category);
    if (cleared.length) {
      toast(
        "Seleção ajustada",
        `${cleared.join(", ")} deixou de ser compatível com a nova escolha e precisa ser selecionado(a) de novo.`,
        "warn",
        7000
      );
    }

    // Categoria de varias pecas com espaco sobrando: continua aberta, para dar
    // pra adicionar a proxima sem reabrir a etapa -- e SEM apagar a busca, ja
    // que comprar duas unidades do mesmo produto (2 pentes iguais, por
    // exemplo) e o caso comum, e o usuario acabou de usa-la para achar essa
    // peca. So limpa busca/paginacao quando a etapa realmente muda.
    const stillHasRoom = limit.max > 1 && state.items[category].length < limit.max;
    if (stillHasRoom) {
      state.openStep = category;
    } else {
      state.openStep = nextIncompleteStep();
      state.query = "";
      state.visibleLimit = PAGE_SIZE;
    }
    persistDraft();
    renderAll();
  }

  function removeItemAt(category, index) {
    state.items[category] = (state.items[category] || []).filter((_, i) => i !== index);
    persistDraft();
    renderAll();
  }

  function resetDraft() {
    state.items = emptyItems();
    state.openStep = STEP_ORDER[0];
    state.query = "";
    state.visibleLimit = PAGE_SIZE;
    persistDraft();
    renderAll();
  }

  function confirmResetDraft() {
    if (!STEP_ORDER.some((c) => (state.items[c] || []).length > 0)) {
      resetDraft();
      return;
    }
    openModal({
      title: "Começar uma build nova?",
      subtitle: "As peças escolhidas agora serão descartadas.",
      render: (body) => body.appendChild(el("p", null, "Builds já salvas na lista abaixo não são afetadas.")),
      actions: [
        { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
        { label: "Começar de novo", className: "btn-danger-ghost", onClick: (close) => { resetDraft(); close(); } },
      ],
    });
  }

  /* ====================================================== persistencia ==== */

  function persistDraft() {
    const items = {};
    for (const cat of STEP_ORDER) {
      const list = state.items[cat] || [];
      if (list.length) items[cat] = list.map((p) => p.url);
    }
    HWStore.set(DRAFT_KEY, { items, compatFilterEnabled: state.compatFilterEnabled });
  }

  function persistSaved() {
    HWStore.set(SAVED_KEY, state.saved);
  }

  function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function slugify(name) {
    return (
      (name || "build")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "build"
    );
  }

  /* ========================================================= builds salvas */

  /** So os campos precisos para exibir e exportar depois -- nao a peca inteira. */
  function snapshotItems() {
    const out = {};
    for (const cat of STEP_ORDER) {
      out[cat] = (state.items[cat] || []).map((p) => ({
        category: cat,
        name: p.name,
        url: p.url,
        price_usd: p.price_usd,
        price_brl: p.price_brl || null,
      }));
    }
    return out;
  }

  function saveCurrentBuild(name) {
    const id = generateId();
    const items = snapshotItems();
    const flatSnapshots = STEP_ORDER.flatMap((c) => items[c]);
    const totalUsd = flatSnapshots.reduce((sum, s) => sum + s.price_usd, 0);
    const totalBrl = flatSnapshots.reduce((sum, s) => sum + (s.price_brl || 0), 0);
    const conflicts = computeConflicts(state.items);
    const finalName = name || "Build sem nome";

    state.saved[id] = {
      id,
      name: finalName,
      createdAt: new Date().toISOString(),
      items,
      totalUsd,
      totalBrl,
      hadConflicts: conflicts.length > 0,
      conflicts,
    };
    persistSaved();
    renderSaved();
    toast("Build salva", `"${finalName}" foi guardada em ${HWStore.describe()}.`, "ok");
  }

  function promptSaveCurrentBuild() {
    const suggested = `Build ${Object.keys(state.saved).length + 1}`;
    openModal({
      title: "Salvar build",
      subtitle: "Dê um nome para achar esta build depois, na lista de builds salvas.",
      render: (body) => {
        body.appendChild(el("label", "visually-hidden", "Nome da build"));
        const input = document.createElement("input");
        input.type = "text";
        input.className = "search-input";
        input.style.width = "100%";
        input.maxLength = 80;
        input.value = suggested;
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const primary = document.querySelector(".modal-foot .btn-primary");
            if (primary) primary.click();
          }
        });
        body.appendChild(input);
        setTimeout(() => {
          input.focus();
          input.select();
        }, 0);
      },
      actions: [
        { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
        {
          label: "Salvar",
          className: "btn-primary",
          onClick: (close) => {
            const input = document.querySelector(".modal-body input");
            saveCurrentBuild((input && input.value.trim()) || suggested);
            close();
          },
        },
      ],
    });
  }

  function confirmDeleteSaved(id) {
    const saved = state.saved[id];
    if (!saved) return;
    openModal({
      title: `Excluir "${saved.name}"?`,
      subtitle: "Não dá para desfazer.",
      render: (body) =>
        body.appendChild(el("p", null, "As peças em si continuam à venda normalmente — só esta lista salva será removida.")),
      actions: [
        { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
        {
          label: "Excluir",
          className: "btn-danger-ghost",
          onClick: (close) => {
            delete state.saved[id];
            persistSaved();
            renderSaved();
            close();
            toast("Build excluída", `"${saved.name}" foi removida.`, "ok");
          },
        },
      ],
    });
  }

  /**
   * Tenta reencontrar a peca salva no catalogo atual (pelo link do anuncio) --
   * assim a build carregada volta com specs e performance completos, prontos
   * para continuar a compatibilidade sendo checada normalmente. Se o produto
   * saiu do catalogo numa recoleta, mantem nome/preco/link (o suficiente para
   * ver e exportar a build), so sem dado para checar compatibilidade contra ele.
   */
  function resolveSnapshotItem(cat, snap) {
    const found = (state.productsByCategory[cat] || []).find((p) => p.url === snap.url);
    if (found) return found;
    return {
      category: cat,
      name: snap.name,
      url: snap.url,
      price_usd: snap.price_usd,
      price_brl: snap.price_brl,
      specs: {},
      performance: {},
      scored: true,
      notResolved: true,
    };
  }

  function loadSavedIntoDraft(id) {
    const saved = state.saved[id];
    if (!saved) return;

    const proceed = () => {
      state.items = emptyItems();
      for (const cat of STEP_ORDER) {
        state.items[cat] = toArray(saved.items[cat]).map((snap) => resolveSnapshotItem(cat, snap));
      }
      state.openStep = nextIncompleteStep();
      state.query = "";
      state.visibleLimit = PAGE_SIZE;
      persistDraft();
      renderAll();
      toast("Build carregada", `"${saved.name}" foi carregada para edição.`, "ok");
    };

    if (!STEP_ORDER.some((c) => (state.items[c] || []).length > 0)) {
      proceed();
      return;
    }
    openModal({
      title: "Substituir a build em andamento?",
      subtitle: `As peças escolhidas agora serão trocadas pelas de "${saved.name}".`,
      render: (body) =>
        body.appendChild(el("p", null, "A build em andamento ainda não foi salva — se quiser mantê-la, salve-a antes de continuar.")),
      actions: [
        { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
        { label: "Carregar", className: "btn-primary", onClick: (close) => { proceed(); close(); } },
      ],
    });
  }

  function buildTxtContent(saved) {
    const lines = [`Build: ${saved.name}`, `Gerada em: ${HWFormat.fmtDate(saved.createdAt)}`, ""];
    STEP_ORDER.forEach((cat) => {
      const list = toArray(saved.items[cat]);
      const label = HWRender.CATEGORY_META[cat].label;
      list.forEach((item, idx) => {
        const priceBits = [HWFormat.fmtUsd(item.price_usd)];
        if (item.price_brl) priceBits.push(HWFormat.fmtBrl(item.price_brl));
        lines.push(list.length > 1 ? `${label} ${idx + 1}` : label, `  ${item.name}`, `  ${priceBits.join(" / ")}`, `  ${item.url}`, "");
      });
    });
    const totalBits = [HWFormat.fmtUsd(saved.totalUsd)];
    if (saved.totalBrl) totalBits.push(HWFormat.fmtBrl(saved.totalBrl));
    lines.push(`Total: ${totalBits.join(" / ")}`);
    if (saved.hadConflicts && saved.conflicts.length) {
      lines.push("", "Atenção — incompatibilidades detectadas no momento em que a build foi salva:");
      saved.conflicts.forEach((c) => lines.push(`  - ${c}`));
    }
    return lines.join("\r\n");
  }

  async function downloadSavedBuild(id) {
    const saved = state.saved[id];
    if (!saved) return;
    const filename = `${slugify(saved.name)}.txt`;
    const outcome = await HWApp.saveFile(filename, buildTxtContent(saved), "text/plain;charset=utf-8");
    if (outcome.mode === "app") toast("Lista gerada", `Salva em dados/exportacoes/${outcome.name}.`, "ok", 8000);
    else toast("Lista baixada", `${filename} baixado.`, "ok");
  }

  /* ============================================================ render ==== */

  function stepStatusText(cat) {
    const items = state.items[cat] || [];
    const limit = SLOT_LIMITS[cat];
    if (items.length === 0) return { text: "Selecionar", empty: true };
    if (limit.max === 1) return { text: items[0].name, empty: false };
    return { text: `${items.length}/${limit.max} selecionadas`, empty: false };
  }

  function renderSteps() {
    const container = document.getElementById("pcb-steps");
    clear(container);
    STEP_ORDER.forEach((cat, idx) => {
      const meta = HWRender.CATEGORY_META[cat];
      const items = state.items[cat] || [];
      const isOpen = state.openStep === cat;
      const done = items.length >= SLOT_LIMITS[cat].min;
      const cls = ["pcb-step", isOpen && "pcb-step--open", done && "pcb-step--done"].filter(Boolean).join(" ");

      const btn = el("button", cls);
      btn.type = "button";
      btn.appendChild(el("span", "pcb-step-index", String(idx + 1)));

      const status = stepStatusText(cat);
      const text = el("span", "pcb-step-text");
      text.appendChild(el("span", "pcb-step-label", meta.short));
      text.appendChild(el("span", `pcb-step-value${status.empty ? " pcb-step-value--empty" : ""}`, status.text));
      btn.appendChild(text);

      btn.addEventListener("click", () => {
        state.openStep = isOpen ? null : cat;
        state.query = "";
        state.visibleLimit = PAGE_SIZE;
        renderSteps();
        renderPicker();
      });
      container.appendChild(btn);
    });
  }

  function renderPickerItem(category, product) {
    const row = el("div", "pcb-picker-item");
    row.appendChild(thumb(product, "thumb--sm"));

    const main = el("div", "pcb-picker-item-main");
    const link = el("a", "pcb-picker-item-name", product.name);
    link.href = product.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    main.appendChild(link);

    const alreadyIn = (state.items[category] || []).filter((p) => p.url === product.url).length;
    const metaBits = [describeSpecs(category, product.specs), `valor ${HWFormat.fmtScore(product.valueRatio)}`];
    if (alreadyIn > 0) metaBits.push(alreadyIn > 1 ? `já selecionada x${alreadyIn}` : "já selecionada");
    main.appendChild(el("div", "pcb-picker-item-meta", metaBits.filter(Boolean).join(" · ")));
    row.appendChild(main);

    const priceBox = el("div", "pcb-picker-item-price");
    priceBox.appendChild(el("div", "part-price-usd", HWFormat.fmtUsd(product.price_usd)));
    if (product.price_brl) priceBox.appendChild(el("div", "part-price-brl", HWFormat.fmtBrl(product.price_brl)));
    row.appendChild(priceBox);

    const selectBtn = el("button", "btn btn-primary btn-sm", "Selecionar");
    selectBtn.addEventListener("click", () => addItem(category, product));
    row.appendChild(selectBtn);
    return row;
  }

  /**
   * `renderPicker` so recria o campo de busca e o seletor de ordenacao
   * quando a etapa muda de verdade -- categoria diferente, ou a mesma
   * categoria cruzando a fronteira de cheia/com espaco. Antes, toda vez que o
   * usuario digitava, o `debounce` disparava um `renderPicker` que apagava e
   * recriava o `<input>` inteiro: o navegador troca o elemento e o foco (e o
   * cursor de digitacao) se perdem, entao cada pausa na digitacao exigia
   * clicar de novo na caixa para continuar. Buscar e ordenar agora so tocam
   * `renderPickerResults`, que redesenha unicamente a lista de baixo,
   * deixando o campo de busca (e o foco nele) intocado.
   */
  function pickerRenderKey(category) {
    if (!category) return "none";
    const limit = SLOT_LIMITS[category];
    const count = (state.items[category] || []).length;
    return `${category}:${count >= limit.max ? "full" : "open"}`;
  }

  function buildPickerShell(container, category) {
    const meta = HWRender.CATEGORY_META[category];
    const limit = SLOT_LIMITS[category];
    const currentCount = (state.items[category] || []).length;

    if (currentCount >= limit.max) {
      const full = el("div", "empty-state");
      full.appendChild(el("strong", null, `Limite de ${limit.max} ${meta.label.toLowerCase()} atingido`));
      full.appendChild(el("div", null, "Remova uma peça desta categoria, na build atual abaixo, para adicionar outra no lugar."));
      container.appendChild(full);
      return;
    }

    const toolbar = el("div", "toolbar");

    const searchWrap = el("div", "search-wrap");
    searchWrap.appendChild(elHtml("span", null, icon("search")));
    const input = document.createElement("input");
    input.type = "search";
    input.className = "search-input";
    input.placeholder = `Buscar ${meta.label.toLowerCase()}...`;
    input.value = state.query;
    input.addEventListener(
      "input",
      debounce(() => {
        state.query = input.value;
        state.visibleLimit = PAGE_SIZE;
        renderPickerResults(category);
      })
    );
    searchWrap.appendChild(input);
    toolbar.appendChild(searchWrap);

    const sortSelect = document.createElement("select");
    sortSelect.className = "select-inline";
    [
      ["value", "Índice de valor"],
      ["perf", "Desempenho"],
      ["price-asc", "Menor preço"],
      ["price-desc", "Maior preço"],
      ["name", "Nome"],
    ].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === state.sort;
      sortSelect.appendChild(opt);
    });
    sortSelect.addEventListener("change", () => {
      state.sort = sortSelect.value;
      state.visibleLimit = PAGE_SIZE;
      renderPickerResults(category);
    });
    toolbar.appendChild(sortSelect);
    container.appendChild(toolbar);
    container.appendChild(el("div", "pcb-picker-results"));
  }

  function renderPickerResults(category) {
    const results = document.querySelector("#pcb-picker .pcb-picker-results");
    if (!results) return; // a etapa mudou entre o debounce disparar e isto rodar
    clear(results);

    const all = candidatesFor(category);
    const visible = all.slice(0, state.visibleLimit);

    if (all.length === 0) {
      const empty = el("div", "empty-state");
      empty.appendChild(el("strong", null, "Nenhuma peça compatível encontrada"));
      empty.appendChild(
        el(
          "div",
          null,
          state.compatFilterEnabled
            ? 'Desligue "Filtrar por compatibilidade", no topo da seção, para ver todas as peças desta categoria.'
            : "Não há produtos pontuados nesta categoria com os dados atuais — tente ajustar a busca ou revisar itens pendentes na Base de dados."
        )
      );
      results.appendChild(empty);
      return;
    }

    const list = el("div", "pcb-picker-list");
    visible.forEach((p) => list.appendChild(renderPickerItem(category, p)));
    results.appendChild(list);

    if (all.length > visible.length) {
      const more = el("button", "btn btn-ghost pcb-picker-more", `Mostrar mais (${all.length - visible.length} restantes)`);
      more.addEventListener("click", () => {
        state.visibleLimit += PAGE_SIZE;
        renderPickerResults(category);
      });
      results.appendChild(more);
    }
  }

  function renderPicker() {
    const container = document.getElementById("pcb-picker");
    const category = state.openStep;
    const renderKey = pickerRenderKey(category);

    if (container.dataset.renderKey !== renderKey) {
      clear(container);
      container.className = "pcb-picker";
      container.dataset.renderKey = renderKey;

      if (!category) {
        const done = el("div", "empty-state");
        done.appendChild(el("strong", null, "Build completa"));
        done.appendChild(el("div", null, "Clique em qualquer etapa acima para adicionar ou trocar uma peça."));
        container.appendChild(done);
        return;
      }
      buildPickerShell(container, category);
    }

    // buildPickerShell so acrescenta .pcb-picker-results quando a categoria
    // nao esta cheia -- presente ou nao, e o sinal certo de que ha lista para
    // (re)desenhar (em vez de inspecionar o estado "cheio" de novo aqui).
    if (container.querySelector(".pcb-picker-results")) {
      renderPickerResults(category);
    }
  }

  /**
   * `hideChange` esconde o "Trocar" para categorias de mais de uma peca --
   * com 2+ ja escolhidas nao ha como saber qual delas o clique se refere, e
   * remover + reabrir a etapa resolve sem ambiguidade. `showIndex` numera a
   * linha (1, 2, ...) so quando ha MAIS de uma peca de fato selecionada nesta
   * categoria agora -- a mesma regra usada no .txt exportado, para os dois
   * lugares concordarem sobre quando vale a pena numerar.
   */
  function renderCurrentRow(cat, item, idx, hideChange, showIndex) {
    const meta = HWRender.CATEGORY_META[cat];
    const row = el("div", "pcb-current-row");
    row.appendChild(thumb(item, "thumb--sm"));

    const info = el("div", "part-info");
    info.appendChild(el("div", "part-category", showIndex ? `${meta.label} ${idx + 1}` : meta.label));
    const link = el("a", "part-name", item.name);
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    info.appendChild(link);
    const specsText = describeSpecs(cat, item.specs);
    if (specsText) info.appendChild(el("div", "part-specs", specsText));
    row.appendChild(info);

    const priceBox = el("div", "part-right");
    priceBox.appendChild(el("div", "part-price-usd", HWFormat.fmtUsd(item.price_usd)));
    if (item.price_brl) priceBox.appendChild(el("div", "part-price-brl", HWFormat.fmtBrl(item.price_brl)));
    row.appendChild(priceBox);

    const actions = el("div", "pcb-current-actions");
    if (!hideChange) {
      const changeBtn = el("button", "btn btn-ghost btn-sm", "Trocar");
      changeBtn.addEventListener("click", () => openStepFor(cat));
      actions.appendChild(changeBtn);
    }
    const removeBtn = el("button", "btn btn-ghost btn-sm", "Remover");
    removeBtn.addEventListener("click", () => removeItemAt(cat, idx));
    actions.appendChild(removeBtn);
    row.appendChild(actions);

    return row;
  }

  function renderCurrent() {
    const container = document.getElementById("pcb-current");
    clear(container);

    const list = el("div", "pcb-current-list");
    STEP_ORDER.forEach((cat) => {
      const meta = HWRender.CATEGORY_META[cat];
      const limit = SLOT_LIMITS[cat];
      const items = state.items[cat] || [];
      const isMulti = limit.max > 1;

      if (items.length === 0) {
        list.appendChild(el("div", "pcb-current-row pcb-current-row--empty", `${meta.label}: não selecionado`));
        return;
      }
      const hideChange = isMulti && items.length > 1;
      items.forEach((item, idx) => list.appendChild(renderCurrentRow(cat, item, idx, hideChange, items.length > 1)));

      if (isMulti && items.length < limit.max) {
        const addMore = el("button", "btn btn-ghost btn-sm pcb-add-more", `+ Adicionar ${meta.label.toLowerCase()}`);
        addMore.addEventListener("click", () => openStepFor(cat));
        list.appendChild(addMore);
      }
    });
    container.appendChild(list);

    const filledCategories = STEP_ORDER.filter((c) => (state.items[c] || []).length >= SLOT_LIMITS[c].min).length;
    const flatItems = STEP_ORDER.flatMap((c) => state.items[c] || []);
    const totalUsd = flatItems.reduce((sum, p) => sum + p.price_usd, 0);
    const totalBrl = flatItems.reduce((sum, p) => sum + (p.price_brl || 0), 0);

    const totals = el("div", "pcb-current-totals");
    totals.appendChild(el("span", "total-usd", HWFormat.fmtUsd(totalUsd)));
    if (totalBrl) totals.appendChild(el("span", "total-brl", HWFormat.fmtBrl(totalBrl)));
    totals.appendChild(
      el("span", "psu-note", `${filledCategories}/${STEP_ORDER.length} categorias preenchidas · ${flatItems.length} peças`)
    );
    container.appendChild(totals);

    const conflicts = computeConflicts(state.items);
    if (conflicts.length) {
      const box = el("div", "build-notes");
      conflicts.forEach((msg) => {
        const note = elHtml("div", "build-note", icon("alert"));
        note.appendChild(el("span", null, msg));
        box.appendChild(note);
      });
      container.appendChild(box);
    }

    const actions = el("div", "pcb-current-actions");
    const canSave = filledCategories === STEP_ORDER.length;
    const saveBtn = el("button", "btn btn-primary", "Salvar build");
    saveBtn.disabled = !canSave;
    saveBtn.title = canSave ? "" : "Escolha pelo menos uma peça de cada categoria antes de salvar.";
    saveBtn.addEventListener("click", promptSaveCurrentBuild);
    actions.appendChild(saveBtn);

    const resetBtn = el("button", "btn btn-ghost", "Nova build");
    resetBtn.addEventListener("click", confirmResetDraft);
    actions.appendChild(resetBtn);
    container.appendChild(actions);
  }

  function renderSavedCard(saved) {
    const card = el("div", "pcb-saved-card");

    const head = el("div", "pcb-saved-head");
    const left = el("div");
    left.appendChild(el("div", "pcb-saved-name", saved.name));
    const priceBits = [HWFormat.fmtUsd(saved.totalUsd)];
    if (saved.totalBrl) priceBits.push(HWFormat.fmtBrl(saved.totalBrl));
    left.appendChild(el("div", "pcb-saved-meta", `${priceBits.join(" · ")} · salva em ${HWFormat.fmtDate(saved.createdAt)}`));
    head.appendChild(left);
    if (saved.hadConflicts) head.appendChild(el("span", "status-badge pending", "com incompatibilidade"));
    card.appendChild(head);

    const actions = el("div", "pcb-saved-actions");
    const downloadBtn = el("button", "btn btn-primary btn-sm", "Baixar lista (.txt)");
    downloadBtn.addEventListener("click", () => downloadSavedBuild(saved.id));
    const loadBtn = el("button", "btn btn-ghost btn-sm", "Carregar para editar");
    loadBtn.addEventListener("click", () => loadSavedIntoDraft(saved.id));
    const deleteBtn = el("button", "btn btn-danger-ghost btn-sm", "Excluir");
    deleteBtn.addEventListener("click", () => confirmDeleteSaved(saved.id));
    actions.appendChild(downloadBtn);
    actions.appendChild(loadBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);

    return card;
  }

  function renderSaved() {
    const container = document.getElementById("pcb-saved");
    clear(container);
    const builds = Object.values(state.saved).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (builds.length === 0) {
      const empty = el("div", "empty-state");
      empty.appendChild(el("strong", null, "Nenhuma build salva ainda"));
      empty.appendChild(el("div", null, 'Monte uma build acima e clique em "Salvar build".'));
      container.appendChild(empty);
      return;
    }
    const list = el("div", "pcb-saved-list");
    builds.forEach((saved) => list.appendChild(renderSavedCard(saved)));
    container.appendChild(list);
  }

  function renderAll() {
    renderSteps();
    renderPicker();
    renderCurrent();
    renderSaved();
  }

  /* ============================================================== main ==== */

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function main() {
    HWUi.initThemeToggleAndNav();
    const metaEl = document.getElementById("data-meta");
    const emptyPanel = document.getElementById("pcb-empty-state");
    const wizardPanel = document.getElementById("pcb-wizard-panel");
    const currentPanel = document.getElementById("pcb-current-panel");
    const savedPanel = document.getElementById("pcb-saved-panel");

    let productsData, benchmarks;
    try {
      [productsData, benchmarks] = await Promise.all([
        loadJson(`${DATA_DIR}/products.json`),
        loadJson(`${DATA_DIR}/benchmarks.json`),
      ]);
    } catch (err) {
      metaEl.textContent = `Erro ao carregar dados: ${err.message}`;
      emptyPanel.hidden = false;
      return;
    }

    if (!productsData.total_products) {
      metaEl.textContent = 'nenhum dado coletado ainda — use o botão "Coletar dados agora" na página Análise';
      emptyPanel.hidden = false;
      return;
    }
    metaEl.textContent = `${productsData.total_products} produtos · coleta de ${HWFormat.fmtDate(productsData.scraped_at)} · fonte: ${productsData.source}`;

    const effectiveBenchmarks = HWOverrides.applyBenchmarkOverrides(benchmarks);
    const workingProducts = HWOverrides.applyOverridesToProducts(productsData.products);

    for (const cat of STEP_ORDER) state.productsByCategory[cat] = [];
    for (const p of workingProducts) if (state.productsByCategory[p.category]) state.productsByCategory[p.category].push(p);
    for (const cat of STEP_ORDER) {
      const scored = HWScoring.scoreProducts(cat, state.productsByCategory[cat], effectiveBenchmarks);
      state.productsByCategory[cat] = scored.filter((p) => p.scored);
    }

    state.saved = HWStore.get(SAVED_KEY, {});

    const draft = HWStore.get(DRAFT_KEY, null);
    if (draft) {
      state.compatFilterEnabled = draft.compatFilterEnabled !== false;
      let droppedAny = false;
      for (const cat of STEP_ORDER) {
        const urls = toArray(draft.items && draft.items[cat]);
        if (!urls.length) continue;
        const resolved = urls.map((url) => state.productsByCategory[cat].find((p) => p.url === url)).filter(Boolean);
        state.items[cat] = resolved;
        if (resolved.length !== urls.length) droppedAny = true;
      }
      if (droppedAny) {
        toast(
          "Build em andamento atualizada",
          "Uma ou mais peças escolhidas não estão mais no catálogo atual e precisam ser trocadas.",
          "warn",
          8000
        );
      }
    }
    state.openStep = nextIncompleteStep();

    const toggle = document.getElementById("pcb-compat-toggle");
    toggle.checked = state.compatFilterEnabled;
    toggle.addEventListener("change", () => {
      state.compatFilterEnabled = toggle.checked;
      state.visibleLimit = PAGE_SIZE;
      persistDraft();
      renderAll();
    });

    wizardPanel.hidden = false;
    currentPanel.hidden = false;
    savedPanel.hidden = false;
    renderAll();
  }

  main().catch((err) => {
    console.error(err);
    const metaEl = document.getElementById("data-meta");
    if (metaEl) metaEl.textContent = `Erro inesperado: ${err.message}`;
  });
})();
