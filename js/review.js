/**
 * Painel de revisao manual de um produto.
 *
 * O contrato da tela nao mudou: o codigo continua decidindo se um item pontua.
 * O que o usuario faz aqui e corrigir DADOS DE ENTRADA -- as specs que o regex
 * do scraper nao conseguiu extrair do nome do anuncio, ou extraiu errado -- e o
 * painel roda a mesma HWScoring.SCORERS em tempo real para mostrar o efeito.
 *
 * Quatro coisas mudaram em relacao a versao anterior, todas por causa de
 * buracos praticos no fluxo de curadoria:
 *
 *   1. qualquer item pode ser revisado, nao so os pendentes. Um SSD cuja
 *      capacidade o regex leu do codigo do modelo ("KDS240G-L21" -> 240GB, mas
 *      o anuncio e de 480GB) pontuava normalmente, com o numero errado, e nao
 *      havia nenhuma tela para corrigi-lo;
 *   2. uma decisao ja tomada volta com os valores preenchidos, para editar em
 *      vez de desfazer e comecar do zero;
 *   3. um modelo ausente da base pode virar um APELIDO para uma entrada que ja
 *      existe, em vez de sempre exigir um score novo digitado a mao (que vira
 *      uma segunda fonte de verdade para a mesma peca);
 *   4. confirmar um preco fora do padrao e uma acao explicita e separada de
 *      corrigir specs -- antes, qualquer revisao isentava o item do filtro de
 *      outlier sem dizer nada.
 */
(function () {
  const { el, elHtml, icon, toast } = window.HWUi;
  const { REASON } = HWScoring;

  function reasonBlock(product, status, entry) {
    const code = entry && !entry.scored ? entry.reasonCode : null;

    if (status === "ignored") {
      return { tone: "", text: "Item ignorado — fica fora do cálculo de builds mesmo que passe a pontuar. Você pode revisar as specs e reincluir, ou desfazer a decisão." };
    }
    if (code === REASON.PRICE_OUTLIER) {
      return {
        tone: "review-reason--warn",
        text:
          "As especificações deste item são válidas e ele pontua normalmente, mas o índice desempenho/preço ficou muito fora do padrão da categoria (heurística MAD em js/scoring.js) — quase sempre sinal de erro de preço na fonte. " +
          "Confira o anúncio: se o preço estiver certo, use \"Confirmar preço e incluir\"; se estiver errado, \"Ignorar item\".",
      };
    }
    if (code === REASON.SODIMM) {
      return {
        tone: "review-reason--warn",
        text:
          "Identificada como memória SO-DIMM (formato de notebook) — fisicamente incompatível com uma placa-mãe desktop, então fica de fora mesmo com capacidade e velocidade corretas. " +
          "Se for falso positivo do regex (o anúncio é de uma DIMM de desktop), mude \"Formato\" para DIMM abaixo; se for mesmo de notebook, o certo é ignorar.",
      };
    }
    if (code === REASON.NO_PRICE) {
      return { tone: "review-reason--warn", text: "O anúncio não trouxe um preço válido em USD — sem preço não há índice de custo-benefício para calcular. Nada a corrigir aqui além de ignorar o item." };
    }
    if (code === REASON.NO_BENCHMARK) {
      return { tone: "review-reason--info", text: `${entry.reason} Confira o modelo no formulário e, se estiver certo, use o bloco abaixo para apontar um apelido ou cadastrar o score.` };
    }
    if (code === REASON.UNKNOWN_CHIPSET) {
      return { tone: "review-reason--info", text: entry.reason };
    }
    if (code === REASON.MISSING_FIELDS) {
      return { tone: "", text: entry.reason };
    }
    if (status === "scored" || status === "added") {
      return {
        tone: "",
        text: "Este item já pontua. Use os campos abaixo para corrigir uma spec que o scraper leu errado no nome do anúncio — o novo score aparece em tempo real antes de salvar.",
      };
    }
    return { tone: "", text: (entry && entry.reason) || "Complete as especificações abaixo." };
  }

  /* ------------------------------------------------- entrada de benchmark - */

  function searchUrlFor(category, specs) {
    const query =
      category === "cpu"
        ? `${specs.brand || ""} ${specs.model_key || ""} passmark cpu mark score`
        : category === "gpu"
        ? `${specs.brand || ""} ${specs.model_key || ""} passmark g3d videocardbenchmark`
        : `chipset ${specs.chipset || ""} soquete memoria suportada`;
    return { query: query.trim(), url: `https://www.google.com/search?q=${encodeURIComponent(query.trim())}` };
  }

  /**
   * Sub-formulario que aparece quando um CPU/GPU nao bate com nada na base ou
   * uma Placa-Mae usa um chipset desconhecido. Oferece dois caminhos, nesta
   * ordem de preferencia:
   *
   *   apelido  -- aponta este anuncio para uma entrada que JA existe. E o certo
   *               quando a base tem "rtx 4060" e o anuncio diz "RTX 4060 8G OC":
   *               nao inventa numero e nao cria uma segunda entrada para a
   *               mesma GPU, que depois divergiria da primeira;
   *   cadastro -- para pecas que realmente faltam na base. Pede a fonte junto
   *               com o score, porque daqui a tres meses "8400" sozinho nao diz
   *               se veio do PassMark, de um review ou de um chute.
   */
  function renderBenchmarkAddSection(product, mergedSpecs, onSaved) {
    const category = product.category;
    const wrap = el("div", "benchmark-add-panel");

    const title = elHtml("div", "benchmark-add-title", icon("database"));
    title.appendChild(
      document.createTextNode(
        category === "motherboard" ? "Chipset fora da base de performance" : "Modelo fora da base de performance"
      )
    );
    wrap.appendChild(title);

    /* ---- caminho 1: apelido para uma entrada existente ---- */
    const section = category === "motherboard" ? "chipsets" : category;
    const table = category === "motherboard" ? HWCat.effectiveBenchmarks().chipsets : HWCat.effectiveBenchmarks()[category];
    const rawKey = category === "motherboard" ? mergedSpecs.chipset : mergedSpecs.model_key;
    const suggestions =
      category === "motherboard"
        ? Object.keys(table || {})
            .sort()
            .map((k) => ({ key: k, entry: table[k] }))
        : HWMatch.suggestKeys(rawKey, mergedSpecs.brand, table, 10);

    if (suggestions.length) {
      const aliasRow = el("div", "review-form-grid");
      const pick = HWCat.buildFieldInput({
        key: "_alias",
        label: "Apontar para uma entrada existente (apelido)",
        type: "select",
        options: suggestions.map((s) =>
          category === "motherboard"
            ? `${s.key} (tier ${s.entry.tier}, ${s.entry.ram || "?"})`
            : `${s.key} (score ${s.entry.score})`
        ),
        allowEmpty: true,
      });
      aliasRow.appendChild(pick.wrapper);
      wrap.appendChild(aliasRow);

      const aliasBtn = el("button", "btn btn-sm", "Salvar apelido");
      aliasBtn.style.marginBottom = "12px";
      aliasBtn.addEventListener("click", () => {
        const idx = pick.input.selectedIndex - (pick.field.allowEmpty ? 1 : 0);
        if (idx < 0) {
          toast("Escolha uma entrada", "Selecione para qual modelo da base este anúncio aponta.", "warn");
          return;
        }
        try {
          HWOverrides.setBenchmarkAlias(section, rawKey, suggestions[idx].key);
          toast("Apelido salvo", `"${rawKey}" agora usa a entrada "${suggestions[idx].key}".`, "ok");
          onSaved();
        } catch (err) {
          toast("Não foi possível salvar", err.message, "error");
        }
      });
      wrap.appendChild(aliasBtn);
      wrap.appendChild(el("div", "eyebrow", "ou cadastre uma entrada nova"));
    }

    /* ---- caminho 2: cadastrar uma entrada nova ---- */
    const { query, url } = searchUrlFor(category, mergedSpecs);
    const searchLine = el("div", "benchmark-search-line");
    searchLine.appendChild(document.createTextNode("Pesquise: "));
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `"${query}"`;
    searchLine.appendChild(link);
    wrap.appendChild(searchLine);

    const grid = el("div", "review-form-grid");
    const fields = {};
    function add(key, def, value) {
      fields[key] = HWCat.buildFieldInput({ key, ...def }, value);
      grid.appendChild(fields[key].wrapper);
    }

    if (category === "cpu") {
      add("score", { label: "Score (PassMark CPU Mark aprox.)", type: "number" });
      add("socket", { label: "Soquete", type: "text", listId: "list-sockets" }, mergedSpecs.socket);
      add("cores", { label: "Núcleos (opcional)", type: "number" });
    } else if (category === "gpu") {
      add("score", { label: "Score (PassMark G3D aprox.)", type: "number" });
      add("tdp_w", { label: "TDP em W (opcional)", type: "number" });
      add("vram_default", { label: "VRAM padrão em GB (opcional)", type: "number" }, mergedSpecs.vram_gb);
    } else if (category === "motherboard") {
      add("tier", { label: "Tier (1=entrada .. 4=topo)", type: "select", options: ["1", "2", "3", "4"] });
      // sem valor inicial: o montador usa este campo para casar a RAM da build,
      // e um DDR3 assumido por ser a primeira opcao da lista seria pior do que
      // a validacao reclamando que falta escolher.
      add("ram", { label: "Memória suportada", type: "select", options: ["DDR3", "DDR4", "DDR5"], allowEmpty: true });
      add("socket", { label: "Soquete", type: "text", listId: "list-sockets" }, mergedSpecs.socket);
      add("max_ram_mhz", { label: "RAM máxima aproveitada (MHz)", type: "number" });
    }
    // a proveniencia e opcional, mas e ela que torna a base auditavel depois
    add("source", { label: "Fonte do número (opcional)", type: "text" });
    wrap.appendChild(grid);

    const saveBtn = el("button", "btn btn-primary", "Salvar na base de performance");
    wrap.appendChild(saveBtn);
    const msg = el("p", "decision-note", "");
    wrap.appendChild(msg);

    saveBtn.addEventListener("click", () => {
      const read = (k) => (fields[k] && fields[k].input.value !== HWCat.CLEARED ? fields[k].input.value : "");
      let key, entry;

      if (category === "cpu" || category === "gpu") {
        if (!mergedSpecs.model_key) {
          msg.className = "decision-note decision-note--error";
          msg.textContent = "Preencha o modelo no formulário acima antes de cadastrar o score.";
          return;
        }
        key = HWMatch.normalizeKey(mergedSpecs.model_key);
        entry =
          category === "cpu"
            ? { score: read("score"), brand: mergedSpecs.brand || null, socket: read("socket"), cores: read("cores"), source: read("source") }
            : { score: read("score"), brand: mergedSpecs.brand || null, tdp_w: read("tdp_w"), vram_default: read("vram_default"), source: read("source") };
      } else {
        if (!mergedSpecs.chipset) {
          msg.className = "decision-note decision-note--error";
          msg.textContent = "Informe o chipset no formulário acima primeiro.";
          return;
        }
        key = String(mergedSpecs.chipset).trim().toUpperCase();
        entry = { tier: read("tier"), ram: read("ram"), socket: read("socket"), max_ram_mhz: read("max_ram_mhz"), source: read("source") };
      }

      try {
        HWOverrides.setBenchmarkOverride(category === "motherboard" ? "chipsets" : category, key, entry);
        msg.className = "decision-note decision-note--ok";
        msg.textContent = "Salvo. Reavaliando o item...";
        toast("Entrada salva", `"${key}" agora vale para qualquer anúncio desse modelo.`, "ok");
        onSaved();
      } catch (err) {
        msg.className = "decision-note decision-note--error";
        msg.textContent = err.message;
      }
    });

    return wrap;
  }

  /* -------------------------------------------------------- painel -------- */

  function renderReviewPanel(product, { status, entry, onClose }) {
    const schema = HWCat.FIELD_SCHEMAS[product.category] || [];
    const panel = el("div", "review-panel");
    const record = HWOverrides.getOverrideRecord(product.url);

    const reason = reasonBlock(product, status, entry);
    const reasonEl = elHtml("div", `review-reason ${reason.tone}`.trim(), icon(reason.tone.includes("warn") ? "alert" : "info"));
    reasonEl.appendChild(el("span", null, reason.text));
    panel.appendChild(reasonEl);

    // specs cruas do scraper: uteis para ver o que o regex leu antes de corrigir
    const raw = HWUi.specSummary(product.specs);
    if (raw.length) {
      const tags = el("div", "spec-tags");
      tags.appendChild(el("span", "eyebrow", "extraido do nome:"));
      raw.forEach((t) => tags.appendChild(el("span", "spec-tag", t)));
      panel.appendChild(tags);
    }

    // uma decisao ja salva reabre com os valores dela, nao com os do scraper
    const startingSpecs = { ...product.specs, ...((record && record.specs) || {}) };
    const grid = el("div", "review-form-grid");
    const fieldEls = schema.map((f) => HWCat.buildFieldInput(f, startingSpecs[f.key]));
    fieldEls.forEach((f) => grid.appendChild(f.wrapper));
    panel.appendChild(grid);

    const preview = elHtml("div", "review-preview fail", icon("info"));
    const previewText = el("span", null, "Preencha os campos para ver se o item passa a pontuar.");
    preview.appendChild(previewText);
    panel.appendChild(preview);

    const actions = el("div", "review-actions");
    const isOutlier = entry && entry.reasonCode === REASON.PRICE_OUTLIER;
    const addBtn = el("button", "btn btn-primary", isOutlier ? "Confirmar preço e incluir" : "Salvar revisão");
    addBtn.disabled = true;
    const ignoreBtn = el("button", "btn btn-ghost", status === "ignored" ? "Manter ignorado" : "Ignorar item");
    actions.appendChild(addBtn);
    actions.appendChild(ignoreBtn);
    if (record) {
      const undoBtn = el("button", "btn btn-danger-ghost", "Desfazer decisão");
      undoBtn.addEventListener("click", () => {
        HWOverrides.clearOverride(product.url);
        toast("Decisão desfeita", "O item voltou a ser avaliado só pelo pipeline automático.", "ok");
        HWCat.refresh();
      });
      actions.appendChild(undoBtn);
    }
    const closeBtn = el("button", "btn btn-ghost btn-sm", "Fechar");
    closeBtn.addEventListener("click", onClose);
    actions.appendChild(closeBtn);
    panel.appendChild(actions);

    const benchSlot = el("div");
    panel.appendChild(benchSlot);

    let currentSpecs = null;
    let lastBenchTriggerKey = null;

    function updateBenchmarkSlot(merged, probe) {
      const category = product.category;
      let triggerKey = null;
      const needsBench = !probe.ok && (probe.code === REASON.NO_BENCHMARK || probe.code === REASON.UNKNOWN_CHIPSET);

      if (needsBench && (category === "cpu" || category === "gpu") && merged.model_key) {
        triggerKey = `${category}:${HWMatch.normalizeKey(merged.model_key)}`;
      } else if (needsBench && category === "motherboard" && merged.chipset) {
        triggerKey = `motherboard:${merged.chipset}`;
      }

      if (!triggerKey) {
        benchSlot.innerHTML = "";
        lastBenchTriggerKey = null;
        return;
      }
      if (triggerKey === lastBenchTriggerKey) return; // usuario ainda digitando -- nao reconstroi
      lastBenchTriggerKey = triggerKey;
      benchSlot.innerHTML = "";
      benchSlot.appendChild(
        renderBenchmarkAddSection(product, merged, () => {
          lastBenchTriggerKey = null;
          HWCat.invalidate();
          HWCat.recompute();
          updatePreview();
          HWCat.emit("benchmarks");
        })
      );
    }

    function updatePreview() {
      const edited = HWCat.readFormSpecs(fieldEls);
      const merged = { ...product.specs, ...edited };
      const probe = HWCat.previewScore(product, merged);
      if (probe.ok) {
        preview.className = "review-preview ok";
        previewText.textContent =
          `Pontuável: desempenho ${HWFormat.fmtScore(probe.result.score)} · ` +
          `índice de valor ${HWFormat.fmtScore(probe.ratio)} (desempenho por US$).`;
        addBtn.disabled = false;
        currentSpecs = edited;
      } else {
        preview.className = "review-preview fail";
        previewText.textContent = probe.reason;
        addBtn.disabled = true;
        currentSpecs = null;
      }
      updateBenchmarkSlot(merged, probe);
    }

    fieldEls.forEach((f) => f.input.addEventListener("input", updatePreview));
    fieldEls.forEach((f) => f.input.addEventListener("change", updatePreview));
    updatePreview();

    addBtn.addEventListener("click", () => {
      if (!currentSpecs) return;
      try {
        HWOverrides.setOverride(product.url, "added", currentSpecs, { priceConfirmed: isOutlier });
        toast(
          isOutlier ? "Preço confirmado" : "Revisão salva",
          isOutlier
            ? "O item entra nas builds e fica isento do filtro de outlier de preço."
            : "As specs corrigidas já valem para o cálculo das builds.",
          "ok"
        );
        HWCat.refresh();
      } catch (err) {
        toast("Não foi possível salvar", err.message, "error", 9000);
      }
    });

    ignoreBtn.addEventListener("click", () => {
      try {
        HWOverrides.setOverride(product.url, "ignored");
        toast("Item ignorado", "Ele fica de fora das builds até você desfazer a decisão.", "ok");
        HWCat.refresh();
      } catch (err) {
        toast("Não foi possível salvar", err.message, "error", 9000);
      }
    });

    return panel;
  }

  window.HWReview = { renderReviewPanel };
})();
