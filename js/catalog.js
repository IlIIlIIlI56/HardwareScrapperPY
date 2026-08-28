/**
 * Pagina "Base de Dados": orquestracao das tres abas (produtos, base de
 * performance, backup) e a lista de produtos em si -- filtros, ordenacao,
 * paginacao, acoes em lote e o painel de revisao de cada item.
 *
 * O status exibido aqui roda a MESMA pontuacao em lote da pagina de builds
 * (ver catalog-state.js), entao um item nunca aparece como "Pontuado" aqui e
 * de fora das builds ao mesmo tempo.
 */
(function () {
  const { el, elHtml, clear, icon, thumb, toast, openModal } = window.HWUi;
  const DATA_DIR = "./data";

  const TABS = [
    { key: "products", label: "Produtos" },
    { key: "benchmarks", label: "Base de performance" },
    { key: "backup", label: "Backup e exportacao" },
  ];
  let activeTab = "products";

  const STATUS_LABEL = { scored: "Pontuado", pending: "Pendente", added: "Revisado", ignored: "Ignorado" };

  /* ======================================================== filtragem ==== */

  function matchesExtraFilters(product) {
    const schema = HWCat.EXTRA_FILTER_SCHEMAS[HWCat.state.category];
    if (!schema) return true;
    const entry = HWCat.entryOf(product);
    if (!entry) return true;
    for (const f of schema) {
      const filterValue = HWCat.state.extraFilters[f.key];
      if (filterValue === undefined || filterValue === "") continue;
      const actual = HWCat.getPath(entry, f.field);
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
    const s = HWCat.state;
    if (s.category !== "all" && product.category !== s.category) return false;
    if (s.status !== "all" && status !== s.status) return false;
    if (s.search) {
      const needle = HWMatch.normalizeKey(s.search);
      if (!HWMatch.normalizeKey(product.name).includes(needle)) return false;
    }
    if (s.status === "scored" && s.category !== "all" && !matchesExtraFilters(product)) return false;
    return true;
  }

  const SORTERS = {
    value: (a, b) => (b.entry?.valueRatio ?? -1) - (a.entry?.valueRatio ?? -1),
    perf: (a, b) => (b.entry?.perfScore ?? -1) - (a.entry?.perfScore ?? -1),
    "price-asc": (a, b) => (a.product.price_usd ?? Infinity) - (b.product.price_usd ?? Infinity),
    "price-desc": (a, b) => (b.product.price_usd ?? -1) - (a.product.price_usd ?? -1),
    name: (a, b) => a.product.name.localeCompare(b.product.name, "pt-BR"),
  };

  function currentRows() {
    HWCat.recompute();
    const rows = HWCat.state.products
      .map((product) => ({ product, status: HWCat.statusOf(product), entry: HWCat.entryOf(product) }))
      .filter(({ product, status }) => matchesFilters(product, status));
    rows.sort(SORTERS[HWCat.state.sort] || SORTERS.value);
    return rows;
  }

  /* ============================================================ item ===== */

  function renderCatalogItem(row) {
    const { product, status, entry } = row;
    const isOpen = HWCat.state.expanded.has(product.url);
    const item = el("article", `catalog-item${isOpen ? " catalog-item--open" : ""}`);

    const head = el("div", "catalog-item-head");
    const left = el("div", "catalog-item-left");
    left.appendChild(thumb(product));

    const main = el("div", "catalog-item-main");
    const badges = el("div", "catalog-badges");
    badges.appendChild(el("span", `status-badge ${status}`, STATUS_LABEL[status]));
    badges.appendChild(el("span", "cat-badge", HWCat.CATEGORY_LABEL[product.category]));
    if (entry && entry.scored && entry.performance && entry.performance.matchType === "fuzzy") {
      const tag = el("span", "cat-badge", "match aproximado");
      tag.title = `Casou com "${entry.performance.matchedKey}" por similaridade textual (${(entry.performance.similarity * 100).toFixed(0)}%).`;
      badges.appendChild(tag);
    }
    if (entry && entry.scored && entry.performance && entry.performance.matchType === "alias") {
      const tag = el("span", "cat-badge", "apelido");
      tag.title = `Apontado por voce para "${entry.performance.matchedKey}".`;
      badges.appendChild(tag);
    }
    main.appendChild(badges);

    const nameLink = el("a", "catalog-item-name", product.name);
    nameLink.href = product.url;
    nameLink.target = "_blank";
    nameLink.rel = "noopener noreferrer";
    main.appendChild(nameLink);

    const specsText = HWUi.describeSpecs(product.category, (entry && entry.specs) || product.specs);
    main.appendChild(
      el(
        "div",
        "catalog-item-meta",
        [specsText, product.offers != null ? `${product.offers} ofertas` : null].filter(Boolean).join(" · ") || "sem specs reconhecidas"
      )
    );

    if (entry && entry.scored) {
      const score = el("div", "catalog-item-score");
      score.appendChild(elHtml("span", null, `Desempenho <b>${HWFormat.fmtScore(entry.perfScore)}</b>`));
      score.appendChild(elHtml("span", null, `Indice de valor <b>${HWFormat.fmtScore(entry.valueRatio)}</b>`));
      main.appendChild(score);
    } else if (entry && entry.reason && !isOpen) {
      main.appendChild(el("div", "catalog-item-score", entry.reason));
    }

    left.appendChild(main);
    head.appendChild(left);

    const priceBox = el("div", "catalog-item-price");
    priceBox.appendChild(el("div", "price-usd", HWFormat.fmtUsd(product.price_usd)));
    if (product.price_brl) priceBox.appendChild(el("div", "price-brl", HWFormat.fmtBrl(product.price_brl)));
    head.appendChild(priceBox);
    item.appendChild(head);

    /* --- acoes --- */
    const actions = el("div", "catalog-actions");
    const reviewBtn = el(
      "button",
      "btn btn-sm",
      isOpen ? "Fechar" : status === "pending" ? "Revisar item" : "Corrigir specs"
    );
    reviewBtn.addEventListener("click", () => {
      if (isOpen) HWCat.state.expanded.delete(product.url);
      else HWCat.state.expanded.add(product.url);
      HWCat.emit("expand");
    });
    actions.appendChild(reviewBtn);

    if (status !== "ignored") {
      const ignoreBtn = el("button", "btn btn-sm btn-ghost", "Ignorar");
      ignoreBtn.addEventListener("click", () => {
        try {
          HWOverrides.setOverride(product.url, "ignored");
          HWCat.refresh();
        } catch (err) {
          toast("Nao foi possivel salvar", err.message, "error");
        }
      });
      actions.appendChild(ignoreBtn);
    }

    const record = HWOverrides.getOverrideRecord(product.url);
    if (record) {
      const undo = el("button", "btn btn-sm btn-danger-ghost", "Desfazer");
      undo.addEventListener("click", () => {
        HWOverrides.clearOverride(product.url);
        HWCat.refresh();
      });
      actions.appendChild(undo);
      actions.appendChild(
        el(
          "span",
          "decision-note",
          `${record.decision === "added" ? "Revisado" : "Ignorado"} em ${HWFormat.fmtDate(record.updatedAt)}` +
            (record.priceConfirmed ? " · preco confirmado" : "")
        )
      );
    }
    item.appendChild(actions);

    if (isOpen) {
      item.appendChild(
        HWReview.renderReviewPanel(product, {
          status,
          entry,
          onClose: () => {
            HWCat.state.expanded.delete(product.url);
            HWCat.emit("expand");
          },
        })
      );
    }

    return item;
  }

  /* ========================================================== filtros ==== */

  function renderFilters() {
    const catBox = document.getElementById("category-filter");
    clear(catBox);
    [{ key: "all", label: "Todas" }, ...HWCat.CATEGORIES].forEach((c) => {
      const btn = el("button", `chip-btn${HWCat.state.category === c.key ? " active" : ""}`, c.label);
      btn.addEventListener("click", () => {
        HWCat.state.category = c.key;
        HWCat.state.extraFilters = {}; // os campos extras mudam por categoria
        HWCat.state.page = 1;
        HWCat.emit("filters");
      });
      catBox.appendChild(btn);
    });

    const statusBox = document.getElementById("status-filter");
    clear(statusBox);
    HWCat.STATUS_TABS.forEach((s) => {
      const btn = el("button", `chip-btn${HWCat.state.status === s.key ? " active" : ""}`, s.label);
      const count = s.key === "all" ? HWCat.state.products.length : HWCat.state.counts[s.key];
      btn.appendChild(el("span", "chip-count", count));
      btn.addEventListener("click", () => {
        HWCat.state.status = s.key;
        HWCat.state.page = 1;
        HWCat.emit("filters");
      });
      statusBox.appendChild(btn);
    });

    const sortSel = document.getElementById("sort-select");
    if (sortSel && !sortSel.dataset.ready) {
      HWCat.SORTS.forEach((s) => {
        const o = document.createElement("option");
        o.value = s.key;
        o.textContent = s.label;
        sortSel.appendChild(o);
      });
      sortSel.value = HWCat.state.sort;
      sortSel.addEventListener("change", () => {
        HWCat.state.sort = sortSel.value;
        HWCat.state.page = 1;
        HWCat.emit("filters");
      });
      sortSel.dataset.ready = "1";
    }

    renderExtraFilters();
  }

  function renderExtraFilters() {
    const container = document.getElementById("extra-filters");
    if (!container) return;
    clear(container);

    const schema = HWCat.EXTRA_FILTER_SCHEMAS[HWCat.state.category];
    const show = HWCat.state.status === "scored" && HWCat.state.category !== "all" && schema;
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
        (f.options || HWCat.dynamicFilterOptions(f.field)).forEach((opt) => {
          const o = document.createElement("option");
          o.value = opt;
          o.textContent = opt;
          if (String(HWCat.state.extraFilters[f.key]) === String(opt)) o.selected = true;
          input.appendChild(o);
        });
      } else {
        input = document.createElement("input");
        input.type = "number";
        input.placeholder = "qualquer";
        if (HWCat.state.extraFilters[f.key] !== undefined) input.value = HWCat.state.extraFilters[f.key];
      }
      input.addEventListener("change", () => {
        if (input.value === "") delete HWCat.state.extraFilters[f.key];
        else HWCat.state.extraFilters[f.key] = input.value;
        HWCat.state.page = 1;
        HWCat.emit("filters");
      });
      wrapper.appendChild(input);
      container.appendChild(wrapper);
    });

    const clearBtn = el("button", "btn btn-ghost btn-sm", "Limpar filtros extras");
    clearBtn.addEventListener("click", () => {
      HWCat.state.extraFilters = {};
      HWCat.emit("filters");
    });
    container.appendChild(clearBtn);
  }

  /* ============================================================ lista ==== */

  /**
   * Acoes em lote sobre EXATAMENTE o que o filtro atual mostra. Existem porque
   * a fila de pendentes tem centenas de itens e boa parte deles e a mesma
   * decisao repetida (todo o SO-DIMM de uma vez, por exemplo) -- clicar item a
   * item nao era so lento, era um convite a desistir da curadoria no meio.
   */
  function renderBulkBar(rows) {
    const bar = el("div", "toolbar");
    if (rows.length === 0) return bar;

    const urls = rows.map((r) => r.product.url);
    const withDecision = rows.filter((r) => HWOverrides.getOverrideRecord(r.product.url)).length;

    const ignoreAll = el("button", "btn btn-sm btn-ghost", `Ignorar os ${rows.length} filtrados`);
    ignoreAll.addEventListener("click", () => {
      openModal({
        title: `Ignorar ${rows.length} itens?`,
        subtitle: "Vale so para os itens que o filtro atual esta mostrando.",
        render: (body) => {
          body.appendChild(el("p", null, "Eles saem do calculo de builds ate voce desfazer. Da para reverter item a item ou em lote depois."));
        },
        actions: [
          { label: "Cancelar", className: "btn-ghost", onClick: (close) => close() },
          {
            label: "Ignorar todos",
            className: "btn-primary",
            onClick: (close) => {
              try {
                const n = HWOverrides.setOverridesBulk(urls, "ignored");
                close();
                toast("Itens ignorados", `${n} itens saiu(ram) do calculo.`, "ok");
                HWCat.refresh();
              } catch (err) {
                toast("Nao foi possivel salvar", err.message, "error", 9000);
              }
            },
          },
        ],
      });
    });
    bar.appendChild(ignoreAll);

    if (withDecision) {
      const undoAll = el("button", "btn btn-sm btn-danger-ghost", `Desfazer ${withDecision} decisao(oes)`);
      undoAll.addEventListener("click", () => {
        const n = HWOverrides.clearOverridesBulk(urls);
        toast("Decisoes desfeitas", `${n} itens voltaram ao pipeline automatico.`, "ok");
        HWCat.refresh();
      });
      bar.appendChild(undoAll);
    }
    return bar;
  }

  function renderList() {
    const container = document.getElementById("catalog-list");
    if (!container) return;
    clear(container);

    const rows = currentRows();
    const s = HWCat.state;

    document.getElementById("catalog-summary").textContent =
      `${rows.length} de ${s.products.length} produtos · ` +
      `${s.counts.scored} pontuados · ${s.counts.pending} pendentes · ${s.counts.added} revisados · ${s.counts.ignored} ignorados`;

    if (rows.length === 0) {
      const empty = el("div", "empty-state");
      empty.appendChild(el("strong", null, "Nenhum produto com esses filtros"));
      empty.appendChild(el("div", null, "Troque a categoria, a aba de status ou limpe a busca."));
      container.appendChild(empty);
      return;
    }

    container.appendChild(renderBulkBar(rows));

    const visible = rows.slice(0, s.page * s.pageSize);
    visible.forEach((row) => container.appendChild(renderCatalogItem(row)));

    if (rows.length > visible.length) {
      const more = el("div", "toolbar");
      more.style.justifyContent = "center";
      const btn = el("button", "btn", `Carregar mais (${rows.length - visible.length} restantes)`);
      btn.addEventListener("click", () => {
        s.page += 1;
        HWCat.emit("page");
      });
      more.appendChild(btn);
      container.appendChild(more);
    }
  }

  /* ======================================================== datalists ==== */

  function buildDatalists() {
    const existing = document.getElementById("datalists");
    if (existing) existing.remove();
    const wrap = el("div");
    wrap.id = "datalists";
    wrap.hidden = true;

    const sockets = new Set();
    for (const p of HWCat.state.products) {
      if (p.specs && p.specs.socket) sockets.add(p.specs.socket);
    }
    for (const entry of Object.values(HWCat.effectiveBenchmarks().chipsets || {})) {
      if (entry.socket) sockets.add(entry.socket);
    }

    const socketList = document.createElement("datalist");
    socketList.id = "list-sockets";
    [...sockets].sort().forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      socketList.appendChild(o);
    });

    const chipsetList = document.createElement("datalist");
    chipsetList.id = "list-chipsets";
    Object.keys(HWCat.effectiveBenchmarks().chipsets || {})
      .sort()
      .forEach((v) => {
        const o = document.createElement("option");
        o.value = v;
        chipsetList.appendChild(o);
      });

    wrap.appendChild(socketList);
    wrap.appendChild(chipsetList);
    document.body.appendChild(wrap);
  }

  /* ============================================================= abas ==== */

  function renderTabs() {
    const nav = document.getElementById("tabs");
    clear(nav);
    TABS.forEach((t) => {
      const btn = el("button", `tab-btn${activeTab === t.key ? " active" : ""}`, t.label);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(activeTab === t.key));
      btn.addEventListener("click", () => {
        activeTab = t.key;
        renderAll();
      });
      nav.appendChild(btn);
    });
  }

  function renderAll() {
    renderTabs();
    document.getElementById("tab-products").hidden = activeTab !== "products";
    document.getElementById("tab-benchmarks").hidden = activeTab !== "benchmarks";
    document.getElementById("tab-backup").hidden = activeTab !== "backup";

    if (activeTab === "products") {
      renderFilters();
      renderList();
    } else if (activeTab === "benchmarks") {
      HWCat.recompute();
      HWBenchDb.render();
    } else {
      HWCat.recompute();
      HWBackup.render();
    }
  }

  /* ============================================================= main ==== */

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function main() {
    HWUi.initThemeToggleAndNav();
    const metaEl = document.getElementById("data-meta");

    try {
      const [productsData, benchmarks] = await Promise.all([
        loadJson(`${DATA_DIR}/products.json`),
        loadJson(`${DATA_DIR}/benchmarks.json`),
      ]);
      HWCat.state.products = productsData.products;
      HWCat.state.benchmarks = benchmarks;
      HWCat.state.meta = productsData;
      metaEl.textContent = `${productsData.total_products} produtos · coleta de ${HWFormat.fmtDate(productsData.scraped_at)} · fonte: ${productsData.source}`;
    } catch (err) {
      metaEl.textContent = `Erro ao carregar dados: ${err.message}`;
      const list = document.getElementById("catalog-list");
      const empty = el("div", "empty-state");
      empty.appendChild(el("strong", null, "Sem dados coletados"));
      empty.appendChild(el("div", null, "Rode a coleta na pagina de Builds (ou pelo scraper) antes de usar esta tela."));
      list.appendChild(empty);
      return;
    }

    buildDatalists();

    // um unico ponto de redesenho: qualquer modulo que grave algo chama
    // HWCat.refresh() e a tela inteira se reconstroi a partir do estado.
    HWCat.onChange(() => renderAll());

    const search = document.getElementById("search-input");
    search.addEventListener(
      "input",
      HWUi.debounce((e) => {
        HWCat.state.search = e.target.value;
        HWCat.state.page = 1;
        renderList();
      }, 200)
    );

    renderAll();
  }

  main().catch((err) => {
    console.error(err);
    toast("Erro inesperado", err.message, "error", 0);
  });
})();
