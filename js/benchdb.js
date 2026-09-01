/**
 * Aba "Base de performance": navegador e editor de dados/benchmarks.json.
 *
 * Antes, a base curada era invisivel pela interface -- so dava para ver o que o
 * usuario tinha cadastrado por cima dela. Isso deixava tres coisas impossiveis
 * sem abrir o arquivo no editor:
 *
 *   - conferir se um modelo ja existe (e com que score) antes de cadastra-lo
 *     de novo, do zero, com um numero diferente;
 *   - CORRIGIR um score errado da base curada. O formulario de revisao so
 *     aparecia quando nao havia match nenhum, entao uma entrada existente mas
 *     com valor equivocado nao tinha por onde ser consertada;
 *   - mexer nos parametros globais do modelo (latencia de referencia da RAM,
 *     multiplicadores de fonte e de interface de armazenamento), que ficavam
 *     so no JSON e voltavam ao padrao a cada `git pull`.
 *
 * A tabela mostra a base curada e as alteracoes do usuario juntas, marcando a
 * origem de cada linha -- editar uma entrada da base grava um override, nunca
 * altera o arquivo do repositorio.
 */
(function () {
  const { el, elHtml, clear, icon, toast } = window.HWUi;

  const SECTIONS = [
    { key: "cpu", label: "Processadores" },
    { key: "gpu", label: "Placas de vídeo" },
    { key: "chipsets", label: "Chipsets" },
    { key: "aliases", label: "Apelidos" },
  ];

  const view = { section: "cpu", search: "", onlyCustom: false };

  /* ----------------------------------------------------------- listagem -- */

  /**
   * Junta base curada + overrides numa lista unica, marcando a origem:
   *   base    veio so de dados/benchmarks.json;
   *   editada existe nos dois -- o usuario corrigiu um valor da base;
   *   manual  so existe nas suas decisoes (peca que faltava na base).
   */
  function mergedRows(section) {
    const base = HWCat.state.benchmarks[section] || {};
    const custom = HWOverrides.getBenchmarkOverrides()[section] || {};
    const keys = new Set([...Object.keys(base), ...Object.keys(custom)]);
    const rows = [];
    for (const key of keys) {
      const inBase = key in base;
      const inCustom = key in custom;
      rows.push({
        key,
        entry: inCustom ? custom[key] : base[key],
        baseEntry: inBase ? base[key] : null,
        origin: inCustom ? (inBase ? "edited" : "custom") : "base",
      });
    }
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }

  const ORIGIN_LABEL = { base: "base", edited: "editada", custom: "manual" };
  const ORIGIN_CLASS = { base: "", edited: " origin-tag--edited", custom: " origin-tag--custom" };

  function originTag(origin) {
    return el("span", `origin-tag${ORIGIN_CLASS[origin]}`, ORIGIN_LABEL[origin]);
  }

  /* ------------------------------------------------------------ edicao --- */

  /**
   * Campo de score/tier editavel direto na linha. Grava no Enter ou no blur --
   * um botao "salvar" por linha numa tabela de 200 entradas seria ruido, e a
   * validacao de faixa em overrides.js ja barra um numero absurdo.
   */
  function editableValue(section, row, valueKey) {
    const input = document.createElement("input");
    input.className = "bench-edit-input";
    input.type = "number";
    input.value = row.entry[valueKey] ?? "";
    input.setAttribute("aria-label", `${valueKey} de ${row.key}`);

    function commit() {
      const raw = input.value.trim();
      const baseValue = row.baseEntry ? row.baseEntry[valueKey] : null;
      if (raw === "" || (baseValue != null && Number(raw) === Number(baseValue) && row.origin === "edited")) {
        if (row.origin === "base") {
          // nao ha override para descartar; so devolve o valor do arquivo ao
          // campo, senao ele fica visualmente vazio ate o proximo redesenho.
          input.value = row.entry[valueKey] ?? "";
          return;
        }
        // voltou ao valor da base: descarta o override em vez de gravar uma
        // "edicao" identica ao arquivo, que so poluiria o backup.
        HWOverrides.clearBenchmarkOverride(section, row.key);
        toast("Override removido", `"${row.key}" voltou ao valor de dados/benchmarks.json.`, "ok");
        HWCat.refresh("benchmarks");
        return;
      }
      if (Number(raw) === Number(row.entry[valueKey])) return;
      try {
        HWOverrides.setBenchmarkOverride(section, row.key, { ...row.entry, [valueKey]: raw });
        toast("Base atualizada", `"${row.key}": ${valueKey} = ${raw}.`, "ok");
        HWCat.refresh("benchmarks");
      } catch (err) {
        toast("Valor recusado", err.message, "error", 8000);
        input.value = row.entry[valueKey] ?? "";
      }
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = row.entry[valueKey] ?? "";
        input.blur();
      }
    });
    return input;
  }

  function renderTable(container, section) {
    const rows = mergedRows(section).filter((r) => {
      if (view.onlyCustom && r.origin === "base") return false;
      if (!view.search) return true;
      const needle = HWMatch.normalizeKey(view.search);
      return HWMatch.normalizeKey(r.key).includes(needle) || HWMatch.normalizeKey(r.entry.brand || "").includes(needle);
    });

    if (rows.length === 0) {
      const empty = el("div", "empty-state");
      empty.appendChild(el("strong", null, "Nenhuma entrada com esse filtro"));
      container.appendChild(empty);
      return rows.length;
    }

    const wrap = el("div", "bench-table-wrap");
    const table = el("table", "bench-table");
    const thead = el("thead");
    const headRow = el("tr");
    // `align` acompanha as colunas numericas do corpo da tabela, montado abaixo
    const headers =
      section === "chipsets"
        ? [["Chipset"], ["Soquete"], ["Memória"], ["Tier", "col-num"], ["RAM max (MHz)", "col-num"], ["Origem"], ["", "col-actions"]]
        : [
            ["Modelo"],
            ["Marca"],
            [section === "cpu" ? "Soquete" : "TDP (W)"],
            [section === "cpu" ? "Núcleos" : "VRAM", "col-num"],
            ["Score", "col-num"],
            ["Origem"],
            ["", "col-actions"],
          ];
    headers.forEach(([label, cls]) => headRow.appendChild(el("th", cls || null, label)));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    const MAX = 250;
    rows.slice(0, MAX).forEach((row) => {
      const tr = el("tr");
      tr.appendChild(el("td", "col-key", row.key));

      if (section === "chipsets") {
        tr.appendChild(el("td", null, row.entry.socket || "--"));
        tr.appendChild(el("td", null, row.entry.ram || "--"));
        const tierCell = el("td", "col-num");
        tierCell.appendChild(editableValue(section, row, "tier"));
        tr.appendChild(tierCell);
        const mhzCell = el("td", "col-num");
        mhzCell.appendChild(editableValue(section, row, "max_ram_mhz"));
        tr.appendChild(mhzCell);
      } else {
        tr.appendChild(el("td", null, row.entry.brand || "--"));
        tr.appendChild(el("td", null, section === "cpu" ? row.entry.socket || "--" : row.entry.tdp_w ?? "--"));
        tr.appendChild(el("td", "col-num", section === "cpu" ? row.entry.cores ?? "--" : row.entry.vram_default ?? "--"));
        const scoreCell = el("td", "col-num");
        scoreCell.appendChild(editableValue(section, row, "score"));
        tr.appendChild(scoreCell);
      }

      const originCell = el("td");
      originCell.appendChild(originTag(row.origin));
      if (row.entry.source) {
        originCell.appendChild(document.createTextNode(" "));
        const src = el("span", "spec-tag", "fonte");
        src.title = row.entry.source;
        originCell.appendChild(src);
      }
      tr.appendChild(originCell);

      const actionsCell = el("td", "col-actions");
      if (row.origin !== "base") {
        const reset = el("button", "btn btn-sm btn-danger-ghost", row.origin === "edited" ? "Reverter" : "Remover");
        reset.addEventListener("click", () => {
          HWOverrides.clearBenchmarkOverride(section, row.key);
          toast(
            row.origin === "edited" ? "Edição revertida" : "Entrada removida",
            row.origin === "edited" ? `"${row.key}" voltou ao valor do arquivo.` : `"${row.key}" saiu da base local.`,
            "ok"
          );
          HWCat.refresh("benchmarks");
        });
        actionsCell.appendChild(reset);
      }
      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);

    if (rows.length > MAX) {
      container.appendChild(el("p", "decision-note", `Mostrando ${MAX} de ${rows.length} entradas — refine a busca.`));
    }
    return rows.length;
  }

  /* ----------------------------------------------------------- apelidos -- */

  function renderAliases(container) {
    const aliases = HWOverrides.getBenchmarkOverrides().aliases;
    const rows = [];
    for (const section of ["cpu", "gpu", "chipsets"]) {
      for (const [from, alias] of Object.entries(aliases[section] || {})) rows.push({ section, from, alias });
    }
    if (rows.length === 0) {
      const empty = el("div", "empty-state");
      empty.appendChild(el("strong", null, "Nenhum apelido cadastrado"));
      empty.appendChild(
        el(
          "div",
          null,
          "Apelidos aparecem aqui quando você aponta um modelo do anúncio para uma entrada que já existe na base, na revisão de um item pendente."
        )
      );
      container.appendChild(empty);
      return;
    }

    const wrap = el("div", "bench-table-wrap");
    const table = el("table", "bench-table");
    const thead = el("thead");
    const hr = el("tr");
    ["Seção", "Do anúncio", "Aponta para", "Criado em", ""].forEach((h, i) => {
      const th = el("th", i === 4 ? "col-actions" : null, h);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el("tbody");
    rows.forEach(({ section, from, alias }) => {
      const tr = el("tr");
      tr.appendChild(el("td", null, section.toUpperCase()));
      tr.appendChild(el("td", "col-key", from));
      tr.appendChild(el("td", "col-key", alias.target));
      tr.appendChild(el("td", null, HWFormat.fmtDate(alias.createdAt)));
      const actions = el("td", "col-actions");
      const rm = el("button", "btn btn-sm btn-danger-ghost", "Remover");
      rm.addEventListener("click", () => {
        HWOverrides.clearBenchmarkAlias(section, from);
        toast("Apelido removido", `"${from}" volta a não ter correspondência.`, "ok");
        HWCat.refresh("benchmarks");
      });
      actions.appendChild(rm);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  /* ------------------------------------------------- ajustes do modelo --- */

  const TUNING_GROUPS = [
    {
      group: "ram_scoring",
      title: "Latência de RAM",
      note:
        "O CL do anúncio vira latência real (ns = CL x 2000 / MT/s) e é comparado com a referência. Os limites min/max evitam que um CL lido errado do nome distorça o score.",
      keys: [
        ["reference_latency_ns", "Latência de referência (ns)"],
        ["min_latency_multiplier", "Multiplicador mínimo"],
        ["max_latency_multiplier", "Multiplicador máximo"],
      ],
    },
    {
      group: "psu_efficiency_multiplier",
      title: "Eficiência de fonte",
      note: "Multiplica a wattagem no score da fonte, por selo 80 PLUS.",
      keys: null, // derivado das chaves do arquivo
    },
    {
      group: "storage_interface_multiplier",
      title: "Interface de armazenamento",
      note: "Multiplica a capacidade no score do armazenamento — é o que faz um NVMe valer mais que um HDD do mesmo tamanho.",
      keys: null,
    },
    {
      group: "socket_max_ram_mhz",
      title: "RAM máxima por soquete",
      note:
        "Usado quando o chipset da placa-mãe não está na base. O montador reduz o score de um kit mais rápido do que a plataforma aproveita.",
      keys: null,
    },
  ];

  function renderTuning(container) {
    const base = HWCat.state.benchmarks;
    const tuning = HWOverrides.getBenchmarkOverrides().tuning;

    const grid = el("div", "tuning-grid");
    TUNING_GROUPS.forEach((def) => {
      const baseGroup = base[def.group] || {};
      const keys = def.keys || Object.keys(baseGroup).filter((k) => !k.startsWith("_")).map((k) => [k, k]);

      const box = el("div", "tuning-group");
      box.appendChild(el("h3", null, def.title));
      box.appendChild(el("p", "tuning-note", def.note));
      const rows = el("div", "tuning-rows");

      keys.forEach(([key, label]) => {
        const row = el("div", "tuning-row");
        const id = `tune-${def.group}-${key}`;
        const lab = el("label", null, label);
        lab.htmlFor = id;
        row.appendChild(lab);

        const input = document.createElement("input");
        input.id = id;
        input.type = "number";
        input.step = "any";
        const overridden = (tuning[def.group] || {})[key];
        input.value = overridden ?? baseGroup[key] ?? "";
        input.placeholder = String(baseGroup[key] ?? "");
        if (overridden !== undefined) input.classList.add("changed");
        input.title = `Padrão do arquivo: ${baseGroup[key] ?? "--"}`;

        input.addEventListener("change", () => {
          const raw = input.value.trim();
          try {
            // digitar exatamente o valor do arquivo remove o override: assim o
            // ajuste some do backup em vez de virar uma "mudanca" que nao muda nada.
            const value = raw === "" || Number(raw) === Number(baseGroup[key]) ? null : raw;
            HWOverrides.setTuning(def.group, key, value);
            HWCat.refresh("benchmarks");
          } catch (err) {
            toast("Valor recusado", err.message, "error");
            input.value = overridden ?? baseGroup[key] ?? "";
          }
        });
        row.appendChild(input);
        rows.appendChild(row);
      });

      box.appendChild(rows);
      grid.appendChild(box);
    });
    container.appendChild(grid);

    const counts = HWOverrides.benchmarkCounts();
    const footer = el("div", "toolbar");
    footer.style.marginTop = "14px";
    const reset = el("button", "btn btn-danger-ghost btn-sm", "Restaurar todos os padrões");
    reset.disabled = counts.tuning === 0;
    reset.addEventListener("click", () => {
      HWOverrides.clearTuning();
      toast("Ajustes restaurados", "Os parâmetros voltaram aos valores de dados/benchmarks.json.", "ok");
      HWCat.refresh("benchmarks");
    });
    footer.appendChild(reset);
    footer.appendChild(
      el("span", "decision-note", counts.tuning ? `${counts.tuning} parâmetro(s) alterado(s).` : "Nenhum parâmetro alterado.")
    );
    container.appendChild(footer);
  }

  /* -------------------------------------------------------- montagem ----- */

  function render() {
    const container = document.getElementById("benchdb-panel");
    if (!container) return;
    clear(container);

    const counts = HWOverrides.benchmarkCounts();

    const head = el("div", "panel-head");
    const headText = el("div");
    headText.appendChild(el("h2", null, "Base de performance"));
    headText.appendChild(
      el(
        "p",
        "panel-hint",
        "A base curada de dados/benchmarks.json mais as suas alterações. Editar um score aqui grava um override nas suas decisões — o arquivo em si nunca é alterado. Use \"Exportar benchmarks.json mesclado\", na aba de backup, para tornar as alterações permanentes."
      )
    );
    head.appendChild(headText);
    container.appendChild(head);

    const nav = el("div", "toolbar");
    const chips = el("div", "chip-group");
    SECTIONS.forEach((s) => {
      const label = s.key === "aliases" ? `${s.label}` : s.label;
      const btn = el("button", `chip-btn${view.section === s.key ? " active" : ""}`, label);
      if (s.key === "aliases" && counts.aliases) btn.appendChild(el("span", "chip-count", counts.aliases));
      btn.addEventListener("click", () => {
        view.section = s.key;
        render();
      });
      chips.appendChild(btn);
    });
    nav.appendChild(chips);
    container.appendChild(nav);

    if (view.section !== "aliases") {
      const tools = el("div", "toolbar");
      const searchWrap = elHtml("div", "search-wrap", icon("search"));
      const search = document.createElement("input");
      search.type = "search";
      search.className = "search-input";
      search.placeholder = "Buscar modelo ou marca...";
      search.value = view.search;
      search.addEventListener(
        "input",
        HWUi.debounce((e) => {
          view.search = e.target.value;
          render();
          const again = document.querySelector("#benchdb-panel .search-input");
          if (again) {
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
          }
        }, 200)
      );
      searchWrap.appendChild(search);
      tools.appendChild(searchWrap);

      const onlyCustom = el("label", "switch");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = view.onlyCustom;
      cb.addEventListener("change", () => {
        view.onlyCustom = cb.checked;
        render();
      });
      onlyCustom.appendChild(cb);
      onlyCustom.appendChild(document.createTextNode("Só minhas alterações"));
      tools.appendChild(onlyCustom);
      container.appendChild(tools);

      const tableBox = el("div");
      const total = renderTable(tableBox, view.section);
      container.appendChild(tableBox);
      container.appendChild(el("p", "decision-note", `${total} entrada(s) nesta seção.`));
    } else {
      renderAliases(container);
    }

    container.appendChild(el("hr", "divider"));
    const tuningHead = el("div");
    tuningHead.appendChild(el("h2", null, "Ajustes do modelo de pontuação"));
    tuningHead.appendChild(
      el(
        "p",
        "panel-hint",
        "Parâmetros globais das fórmulas de RAM, fonte e armazenamento. Deixe em branco (ou digite o valor original) para voltar ao padrão do arquivo."
      )
    );
    container.appendChild(tuningHead);
    renderTuning(container);
  }

  window.HWBenchDb = { render };
})();
