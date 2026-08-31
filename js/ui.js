/**
 * Camada de UI compartilhada entre a pagina de builds e a de base de dados:
 * criacao de elementos, icones em SVG inline, miniaturas de produto, toasts,
 * modal e a traducao de specs cruas em texto legivel.
 *
 * Por que os icones sao SVG inline e nao uma fonte/CDN: a pagina roda offline
 * sobre arquivos locais e o rodape promete que nenhuma chamada de rede sai
 * daqui. Um <svg> herdando `currentColor` tambem acompanha o tema claro/escuro
 * de graca, sem nenhuma regra extra de CSS.
 *
 * Tudo dentro de uma IIFE pelo mesmo motivo documentado em format.js: os
 * scripts sao classicos (sem type="module") e dividem um unico escopo global,
 * entao expomos so `window.HWUi`.
 */
(function () {
  // ------------------------------------------------------------------ DOM --

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  /** Como el(), mas aceita HTML confiavel (icones, <b> em rotulos que nos mesmos montamos). */
  function elHtml(tag, className, html) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function frag(...nodes) {
    const f = document.createDocumentFragment();
    nodes.filter(Boolean).forEach((n) => f.appendChild(n));
    return f;
  }

  // ---------------------------------------------------------------- icones --

  const ICONS = {
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="m8.21 13.89-1.2 7.11L12 18.5l4.99 2.5-1.2-7.11"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
    zap: '<path d="M13 2 3 14h8l-1 8 10-12h-8Z"/>',
    folder: '<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/>',
  };

  /** SVG inline de 24x24 com stroke em currentColor -- acompanha o tema sozinho. */
  function icon(name, extraClass) {
    const path = ICONS[name] || ICONS.info;
    return (
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"` +
      (extraClass ? ` class="${extraClass}"` : "") +
      `>${path}</svg>`
    );
  }

  function iconEl(name, extraClass) {
    const span = document.createElement("span");
    span.style.display = "contents";
    span.innerHTML = icon(name, extraClass);
    return span.firstChild;
  }

  // ------------------------------------------------------------ miniaturas --

  const CATEGORY_ABBR = {
    cpu: "CPU",
    motherboard: "MB",
    ram: "RAM",
    gpu: "GPU",
    psu: "PSU",
    storage: "SSD",
  };

  /**
   * Miniatura do produto. O scraper ja guarda a URL da foto em `image`, mas ela
   * aponta para o CDN da loja: se estiver offline (ou o item nao tiver foto),
   * caimos para um bloco com a sigla da categoria em vez de deixar o icone de
   * imagem quebrada, que suja bastante uma lista de centenas de itens.
   */
  function thumb(product, sizeClass) {
    const cls = `thumb${sizeClass ? " " + sizeClass : ""}`;
    if (!product || !product.image) return placeholderThumb(product, cls);

    const img = document.createElement("img");
    img.className = cls;
    img.src = product.image;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => img.replaceWith(placeholderThumb(product, cls)), { once: true });
    return img;
  }

  function placeholderThumb(product, cls) {
    const box = el("div", `${cls} thumb--empty`);
    box.textContent = CATEGORY_ABBR[product && product.category] || "?";
    box.setAttribute("aria-hidden", "true");
    return box;
  }

  // ------------------------------------------------------------------ specs --

  const EFFICIENCY_SHORT = {
    none: null,
    "80+ white": "80+ White",
    "80+ bronze": "80+ Bronze",
    "80+ silver": "80+ Silver",
    "80+ gold": "80+ Gold",
    "80+ platinum": "80+ Platinum",
    "80+ titanium": "80+ Titanium",
  };

  const INTERFACE_SHORT = {
    hdd: "HDD",
    sata_ssd: "SSD SATA",
    nvme: "NVMe",
    nvme_gen4: "NVMe Gen4",
  };

  function fmtCapacity(gb) {
    if (!gb) return null;
    return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`;
  }

  /**
   * Resumo curto e legivel das specs de um produto, na ordem que importa para
   * decidir a compra. Diferente de specSummary() (que despeja `chave: valor`
   * cru e serve para depurar a extracao), isto e o que aparece embaixo do nome
   * da peca nos cards -- por isso omite campos nulos e traduz codigos internos
   * (`sata_ssd` -> "SSD SATA").
   */
  function describeSpecs(category, specs) {
    const s = specs || {};
    const parts = [];
    if (category === "cpu") {
      if (s.model_key) parts.push(s.model_key.toUpperCase());
      if (s.socket) parts.push(s.socket);
    } else if (category === "motherboard") {
      if (s.chipset) parts.push(s.chipset);
      if (s.socket) parts.push(s.socket);
      if (s.form_factor) parts.push(s.form_factor);
    } else if (category === "ram") {
      if (s.capacity_gb) parts.push(fmtCapacity(s.capacity_gb));
      if (s.ddr_gen) parts.push(s.ddr_gen);
      if (s.speed_mhz) parts.push(`${s.speed_mhz}MHz`);
      if (s.cas_latency) parts.push(`CL${s.cas_latency}`);
      if (s.form_factor === "SODIMM") parts.push("SO-DIMM");
    } else if (category === "gpu") {
      if (s.model_key) parts.push(s.model_key.toUpperCase());
      if (s.vram_gb) parts.push(`${s.vram_gb}GB`);
    } else if (category === "psu") {
      if (s.wattage) parts.push(`${s.wattage}W`);
      const eff = EFFICIENCY_SHORT[s.efficiency];
      if (eff) parts.push(eff);
      if (s.modular) parts.push("modular");
    } else if (category === "storage") {
      if (s.capacity_gb) parts.push(fmtCapacity(s.capacity_gb));
      if (s.interface) parts.push(INTERFACE_SHORT[s.interface] || s.interface);
      if (s.form_factor) parts.push(s.form_factor);
    }
    return parts.filter(Boolean).join(" · ");
  }

  /** Lista `chave: valor` das specs cruas -- usada na revisao, para depurar o regex. */
  function specSummary(specs) {
    return Object.entries(specs || {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`);
  }

  // ----------------------------------------------------------------- toasts --

  let toastStack = null;

  function ensureToastStack() {
    if (toastStack && document.body.contains(toastStack)) return toastStack;
    toastStack = el("div", "toast-stack");
    toastStack.setAttribute("role", "status");
    toastStack.setAttribute("aria-live", "polite");
    document.body.appendChild(toastStack);
    return toastStack;
  }

  /** level: 'ok' | 'warn' | 'error' | 'info' */
  function toast(title, message, level = "info", timeoutMs = 5000) {
    const stack = ensureToastStack();
    const box = el("div", `toast toast--${level}`);
    const iconName = level === "ok" ? "check" : level === "error" ? "alert" : level === "warn" ? "alert" : "info";
    box.appendChild(elHtml("span", null, icon(iconName)));
    const body = el("div", "toast-body");
    body.appendChild(el("div", "toast-title", title));
    if (message) body.appendChild(el("div", null, message));
    box.appendChild(body);

    const close = el("button", "modal-close", "×");
    close.setAttribute("aria-label", "Fechar aviso");
    close.addEventListener("click", () => box.remove());
    box.appendChild(close);

    stack.appendChild(box);
    if (timeoutMs > 0) setTimeout(() => box.remove(), timeoutMs);
    return box;
  }

  // ------------------------------------------------------------------ modal --

  /**
   * Modal simples. `render(body, close)` preenche o corpo; `actions` vira os
   * botoes do rodape. Fecha no Esc, no clique fora e no X -- as tres saidas que
   * um usuario tenta por reflexo. Devolve uma funcao que fecha o modal.
   */
  function openModal({ title, subtitle, render, actions = [] }) {
    const backdrop = el("div", "modal-backdrop");
    const modal = el("div", "modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const head = el("div", "modal-head");
    const headText = el("div");
    const h = el("h2", null, title);
    headText.appendChild(h);
    if (subtitle) headText.appendChild(el("p", null, subtitle));
    head.appendChild(headText);

    const closeBtn = el("button", "modal-close", "×");
    closeBtn.setAttribute("aria-label", "Fechar");
    head.appendChild(closeBtn);
    modal.appendChild(head);

    const body = el("div", "modal-body");
    modal.appendChild(body);

    const foot = el("div", "modal-foot");
    modal.appendChild(foot);

    const previouslyFocused = document.activeElement;
    function close() {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }

    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    document.addEventListener("keydown", onKey);

    if (render) render(body, close);

    actions.forEach((a) => {
      const btn = el("button", `btn ${a.className || "btn-ghost"}`, a.label);
      btn.addEventListener("click", () => a.onClick(close));
      if (a.disabled) btn.disabled = true;
      foot.appendChild(btn);
    });
    if (actions.length === 0) foot.remove();

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    (foot.querySelector("button") || closeBtn).focus();
    return close;
  }

  // ------------------------------------------------------------------ misc --

  /** Adia f() ate `ms` sem novas chamadas -- usado na busca, que re-pontua tudo. */
  function debounce(fn, ms = 180) {
    let handle = null;
    return function (...args) {
      clearTimeout(handle);
      handle = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function initThemeToggleAndNav() {
    if (window.HWTheme) window.HWTheme.initThemeToggle();
  }

  window.HWUi = {
    el,
    elHtml,
    clear,
    frag,
    icon,
    iconEl,
    thumb,
    describeSpecs,
    specSummary,
    fmtCapacity,
    toast,
    openModal,
    debounce,
    initThemeToggleAndNav,
    CATEGORY_ABBR,
    INTERFACE_SHORT,
    EFFICIENCY_SHORT,
  };
})();
