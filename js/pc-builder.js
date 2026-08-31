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

  const PICKER_SORTERS = {
    value: (a, b) => b.valueRatio - a.valueRatio,
    perf: (a, b) => b.perfScore - a.perfScore,
    "price-asc": (a, b) => a.price_usd - b.price_usd,
    "price-desc": (a, b) => b.price_usd - a.price_usd,
    name: (a, b) => a.name.localeCompare(b.name, "pt-BR"),
  };

  const state = {
    productsByCategory: {},
    items: {},
    compatFilterEnabled: true,
    openStep: STEP_ORDER[0],
    query: "",
    sort: "value",
    visibleLimit: PAGE_SIZE,
    saved: {},
  };

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

  function psuSufficient(psu, cpu, gpu) {
    const wattage = psu && psu.specs && psu.specs.wattage;
    if (!wattage) return true;
    return wattage >= HWBuilder.recommendedWattage(cpu, gpu);
  }

  /** Um candidato de `category` e compativel com o que ja esta escolhido nas outras etapas? */
  function isCompatibleCandidate(category, candidate) {
    const items = state.items;
    if (category === "cpu") return cpuMoboCompatible(candidate, items.motherboard);
    if (category === "motherboard") return cpuMoboCompatible(items.cpu, candidate) && ramMoboCompatible(items.ram, candidate);
    if (category === "ram") return ramMoboCompatible(candidate, items.motherboard);
    if (category === "psu") return psuSufficient(candidate, items.cpu, items.gpu);
    return true; // GPU e armazenamento nao tem restricao dura de compatibilidade
  }

  /**
   * Incompatibilidades REAIS entre as pecas ja escolhidas -- usado para o
   * aviso na build atual. So aparece algo aqui quando o filtro foi desligado
   * em algum momento (com o filtro ligado, a lista nunca oferece uma peca que
   * caia numa destas regras).
   */
  function computeConflicts(items) {
    const msgs = [];
    if (items.cpu && items.motherboard && !cpuMoboCompatible(items.cpu, items.motherboard)) {
      msgs.push(
        `Soquete incompativel: CPU (${items.cpu.performance.socket}) e placa-mae (${items.motherboard.performance.socket}) nao encaixam.`
      );
    }
    if (items.ram && items.motherboard && !ramMoboCompatible(items.ram, items.motherboard)) {
      msgs.push(
        `Memoria incompativel: RAM ${items.ram.specs.ddr_gen} nao e suportada pela placa-mae escolhida (aceita ${items.motherboard.performance.ramType}).`
      );
    }
    if (items.psu && !psuSufficient(items.psu, items.cpu, items.gpu)) {
      const needed = HWBuilder.recommendedWattage(items.cpu, items.gpu);
      msgs.push(
        `Fonte insuficiente: ${items.psu.specs.wattage}W abaixo do recomendado (>= ${needed}W) para esta CPU + GPU.`
      );
    }
    return msgs;
  }

  function candidatesFor(category) {
    let list = state.productsByCategory[category] || [];
    if (state.compatFilterEnabled) list = list.filter((p) => isCompatibleCandidate(category, p));
    if (state.query) {
      const needle = HWMatch.normalizeKey(state.query);
      list = list.filter((p) => HWMatch.normalizeKey(p.name).includes(needle));
    }
    return [...list].sort(PICKER_SORTERS[state.sort] || PICKER_SORTERS.value);
  }

  /* =========================================================== selecao ==== */

  function selectItem(category, product) {
    state.items[category] = product;

    // Com o filtro ligado, a lista nunca deveria ter oferecido isto -- mas
    // reabrir uma etapa ANTERIOR (trocar a placa-mae depois de ja ter uma RAM
    // escolhida) pode invalidar uma escolha posterior que era valida antes.
    if (state.compatFilterEnabled) {
      const cleared = [];
      for (const laterCat of STEP_ORDER) {
        if (laterCat === category) continue;
        const chosen = state.items[laterCat];
        if (chosen && !isCompatibleCandidate(laterCat, chosen)) {
          delete state.items[laterCat];
          cleared.push(HWRender.CATEGORY_META[laterCat].label);
        }
      }
      if (cleared.length) {
        toast(
          "Selecao ajustada",
          `${cleared.join(", ")} deixou de ser compativel com a nova escolha e precisa ser selecionado(a) de novo.`,
          "warn",
          7000
        );
      }
    }

    state.openStep = STEP_ORDER.find((cat) => !state.items[cat]) || null;
    state.query = "";
    state.visibleLimit = PAGE_SIZE;
    persistDraft();
    renderAll();
  }

  function removeItem(category) {
    delete state.items[category];
    persistDraft();
    renderAll();
  }

  function resetDraft() {
    state.items = {};
    state.openStep = STEP_ORDER[0];
    state.query = "";
    state.visibleLimit = PAGE_SIZE;
    persistDraft();
    renderAll();
  }

  function confirmResetDraft() {
    if (!STEP_ORDER.some((c) => state.items[c])) {
      resetDraft();
      return;
    }
    openModal({
      title: "Comecar uma build nova?",
      subtitle: "As pecas escolhidas agora serao descartadas.",
      render: (body) => body.appendChild(el("p", null, "Builds ja salvas na lista abaixo nao sao afetadas.")),
      actions: [
        { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
        { label: "Comecar de novo", className: "btn-danger-ghost", onClick: (close) => { resetDraft(); close(); } },
      ],
    });
  }

  /* ====================================================== persistencia ==== */

  function persistDraft() {
    const items = {};
    for (const cat of STEP_ORDER) if (state.items[cat]) items[cat] = state.items[cat].url;
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
      const p = state.items[cat];
      out[cat] = { category: cat, name: p.name, url: p.url, price_usd: p.price_usd, price_brl: p.price_brl || null };
    }
    return out;
  }

  function saveCurrentBuild(name) {
    const id = generateId();
    const items = snapshotItems();
    const totalUsd = STEP_ORDER.reduce((sum, c) => sum + items[c].price_usd, 0);
    const totalBrl = STEP_ORDER.reduce((sum, c) => sum + (items[c].price_brl || 0), 0);
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
      subtitle: "De um nome para achar esta build depois, na lista de builds salvas.",
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
      subtitle: "Nao da para desfazer.",
      render: (body) =>
        body.appendChild(el("p", null, "As pecas em si continuam a venda normalmente -- so esta lista salva sera removida.")),
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
            toast("Build excluida", `"${saved.name}" foi removida.`, "ok");
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
      state.items = {};
      for (const cat of STEP_ORDER) state.items[cat] = resolveSnapshotItem(cat, saved.items[cat]);
      state.openStep = null;
      state.query = "";
      state.visibleLimit = PAGE_SIZE;
      persistDraft();
      renderAll();
      toast("Build carregada", `"${saved.name}" foi carregada para edicao.`, "ok");
    };

    if (!STEP_ORDER.some((c) => state.items[c])) {
      proceed();
      return;
    }
    openModal({
      title: "Substituir a build em andamento?",
      subtitle: `As pecas escolhidas agora serao trocadas pelas de "${saved.name}".`,
      render: (body) =>
        body.appendChild(el("p", null, "A build em andamento ainda nao foi salva -- se quiser mante-la, salve-a antes de continuar.")),
      actions: [
        { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
        { label: "Carregar", className: "btn-primary", onClick: (close) => { proceed(); close(); } },
      ],
    });
  }

  function buildTxtContent(saved) {
    const lines = [`Build: ${saved.name}`, `Gerada em: ${HWFormat.fmtDate(saved.createdAt)}`, ""];
    STEP_ORDER.forEach((cat) => {
      const item = saved.items[cat];
      const priceBits = [HWFormat.fmtUsd(item.price_usd)];
      if (item.price_brl) priceBits.push(HWFormat.fmtBrl(item.price_brl));
      lines.push(HWRender.CATEGORY_META[cat].label, `  ${item.name}`, `  ${priceBits.join(" / ")}`, `  ${item.url}`, "");
    });
    const totalBits = [HWFormat.fmtUsd(saved.totalUsd)];
    if (saved.totalBrl) totalBits.push(HWFormat.fmtBrl(saved.totalBrl));
    lines.push(`Total: ${totalBits.join(" / ")}`);
    if (saved.hadConflicts && saved.conflicts.length) {
      lines.push("", "Atencao -- incompatibilidades detectadas no momento em que a build foi salva:");
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

  function renderSteps() {
    const container = document.getElementById("pcb-steps");
    clear(container);
    STEP_ORDER.forEach((cat, idx) => {
      const meta = HWRender.CATEGORY_META[cat];
      const chosen = state.items[cat];
      const isOpen = state.openStep === cat;
      const cls = ["pcb-step", isOpen && "pcb-step--open", chosen && "pcb-step--done"].filter(Boolean).join(" ");

      const btn = el("button", cls);
      btn.type = "button";
      btn.appendChild(el("span", "pcb-step-index", String(idx + 1)));

      const text = el("span", "pcb-step-text");
      text.appendChild(el("span", "pcb-step-label", meta.short));
      text.appendChild(
        el("span", `pcb-step-value${chosen ? "" : " pcb-step-value--empty"}`, chosen ? chosen.name : "Selecionar")
      );
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

    const metaBits = [describeSpecs(category, product.specs), `valor ${HWFormat.fmtScore(product.valueRatio)}`].filter(Boolean);
    main.appendChild(el("div", "pcb-picker-item-meta", metaBits.join(" · ")));
    row.appendChild(main);

    const priceBox = el("div", "pcb-picker-item-price");
    priceBox.appendChild(el("div", "part-price-usd", HWFormat.fmtUsd(product.price_usd)));
    if (product.price_brl) priceBox.appendChild(el("div", "part-price-brl", HWFormat.fmtBrl(product.price_brl)));
    row.appendChild(priceBox);

    const selectBtn = el("button", "btn btn-primary btn-sm", "Selecionar");
    selectBtn.addEventListener("click", () => selectItem(category, product));
    row.appendChild(selectBtn);
    return row;
  }

  function renderPicker() {
    const container = document.getElementById("pcb-picker");
    clear(container);
    container.className = "pcb-picker";

    const category = state.openStep;
    if (!category) {
      const done = el("div", "empty-state");
      done.appendChild(el("strong", null, "Build completa"));
      done.appendChild(el("div", null, "Clique em qualquer etapa acima para trocar a peca escolhida."));
      container.appendChild(done);
      return;
    }

    const meta = HWRender.CATEGORY_META[category];
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
        renderPicker();
      })
    );
    searchWrap.appendChild(input);
    toolbar.appendChild(searchWrap);

    const sortSelect = document.createElement("select");
    sortSelect.className = "select-inline";
    [
      ["value", "Indice de valor"],
      ["perf", "Desempenho"],
      ["price-asc", "Menor preco"],
      ["price-desc", "Maior preco"],
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
      renderPicker();
    });
    toolbar.appendChild(sortSelect);
    container.appendChild(toolbar);

    const all = candidatesFor(category);
    const visible = all.slice(0, state.visibleLimit);

    if (all.length === 0) {
      const empty = el("div", "empty-state");
      empty.appendChild(el("strong", null, "Nenhuma peca compativel encontrada"));
      empty.appendChild(
        el(
          "div",
          null,
          state.compatFilterEnabled
            ? 'Desligue "Filtrar por compatibilidade", no topo da secao, para ver todas as pecas desta categoria.'
            : "Nao ha produtos pontuados nesta categoria com os dados atuais -- tente ajustar a busca ou revisar itens pendentes na Base de dados."
        )
      );
      container.appendChild(empty);
      return;
    }

    const list = el("div", "pcb-picker-list");
    visible.forEach((p) => list.appendChild(renderPickerItem(category, p)));
    container.appendChild(list);

    if (all.length > visible.length) {
      const more = el("button", "btn btn-ghost pcb-picker-more", `Mostrar mais (${all.length - visible.length} restantes)`);
      more.addEventListener("click", () => {
        state.visibleLimit += PAGE_SIZE;
        renderPicker();
      });
      container.appendChild(more);
    }
  }

  function renderCurrentRow(cat) {
    const meta = HWRender.CATEGORY_META[cat];
    const item = state.items[cat];
    if (!item) return el("div", "pcb-current-row pcb-current-row--empty", `${meta.label}: nao selecionado`);

    const row = el("div", "pcb-current-row");
    row.appendChild(thumb(item, "thumb--sm"));

    const info = el("div", "part-info");
    info.appendChild(el("div", "part-category", meta.label));
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
    const changeBtn = el("button", "btn btn-ghost btn-sm", "Trocar");
    changeBtn.addEventListener("click", () => {
      state.openStep = cat;
      state.query = "";
      state.visibleLimit = PAGE_SIZE;
      renderSteps();
      renderPicker();
      document.getElementById("pcb-picker").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    const removeBtn = el("button", "btn btn-ghost btn-sm", "Remover");
    removeBtn.addEventListener("click", () => removeItem(cat));
    actions.appendChild(changeBtn);
    actions.appendChild(removeBtn);
    row.appendChild(actions);

    return row;
  }

  function renderCurrent() {
    const container = document.getElementById("pcb-current");
    clear(container);

    const list = el("div", "pcb-current-list");
    STEP_ORDER.forEach((cat) => list.appendChild(renderCurrentRow(cat)));
    container.appendChild(list);

    const chosenCount = STEP_ORDER.filter((c) => state.items[c]).length;
    const totalUsd = STEP_ORDER.reduce((sum, c) => sum + (state.items[c] ? state.items[c].price_usd : 0), 0);
    const totalBrl = STEP_ORDER.reduce((sum, c) => sum + (state.items[c] && state.items[c].price_brl ? state.items[c].price_brl : 0), 0);

    const totals = el("div", "pcb-current-totals");
    totals.appendChild(el("span", "total-usd", HWFormat.fmtUsd(totalUsd)));
    if (totalBrl) totals.appendChild(el("span", "total-brl", HWFormat.fmtBrl(totalBrl)));
    totals.appendChild(el("span", "psu-note", `${chosenCount}/${STEP_ORDER.length} pecas escolhidas`));
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
    const canSave = chosenCount === STEP_ORDER.length;
    const saveBtn = el("button", "btn btn-primary", "Salvar build");
    saveBtn.disabled = !canSave;
    saveBtn.title = canSave ? "" : "Escolha as 6 categorias antes de salvar.";
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
      metaEl.textContent = 'nenhum dado coletado ainda -- use o botao "Coletar dados agora" na pagina Analise';
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
        const url = draft.items && draft.items[cat];
        if (!url) continue;
        const found = state.productsByCategory[cat].find((p) => p.url === url);
        if (found) state.items[cat] = found;
        else droppedAny = true;
      }
      if (droppedAny) {
        toast(
          "Build em andamento atualizada",
          "Uma ou mais pecas escolhidas nao estao mais no catalogo atual e precisam ser trocadas.",
          "warn",
          8000
        );
      }
    }
    state.openStep = STEP_ORDER.find((cat) => !state.items[cat]) || null;

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
