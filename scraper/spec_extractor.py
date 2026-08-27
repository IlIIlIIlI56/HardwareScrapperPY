"""
Extracao de especificacoes tecnicas a partir do nome/descricao de produtos
listados na comprasparaguai.com.br, via regex. Cada categoria tem seu
proprio conjunto de regras porque o site nao expoe specs estruturadas --
apenas o nome do produto (ex: "Processador Intel Core i5-10400 2.9GHz
LGA 1200 12MB") e uma frase curta de descricao.

Cada funcao extract_<categoria>(name, description) devolve um dict com os
campos daquela categoria. Campos nao identificados ficam como None para
que o pipeline de scoring (lado JS) saiba que aquele produto nao pode ser
pontuado com confianca e o exclua do calculo de custo-beneficio.
"""

import re
import unicodedata


def _strip_accents(text):
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(c for c in normalized if not unicodedata.combining(c))


def normalize(text):
    """minusculas, sem acento, espacos colapsados -- usado para chaves de match."""
    text = _strip_accents(text or "").lower()
    text = re.sub(r"\s+", " ", text).strip()
    return text


SOCKET_PATTERN = re.compile(r"\b(LGA\s?-?\d{3,4}|AM[45]|AM3\+?|FM2\+?|TR4|sTRX4)\b", re.IGNORECASE)


def _find_socket(text):
    m = SOCKET_PATTERN.search(text)
    if not m:
        return None
    socket = m.group(1).upper().replace(" ", "").replace("-", "")
    if socket.startswith("LGA"):
        socket = "LGA" + socket[3:]
    return socket


# ---------------------------------------------------------------- CPU ----

INTEL_CORE_RE = re.compile(r"\bi([3579])[\s-]?(\d{4,5})([a-z]{0,3})\b", re.IGNORECASE)
INTEL_ULTRA_RE = re.compile(r"\bultra\s?([579])\s?(\d{3})([a-z]{0,3})\b", re.IGNORECASE)
AMD_RYZEN_RE = re.compile(r"r(?:yzen)?\s?([3579])[\s-]?(\d{3,4})([a-z0-9]{0,4})\b", re.IGNORECASE)


def extract_cpu(name, description=""):
    text = f"{name} {description}"
    norm = normalize(text)

    brand = None
    if "intel" in norm:
        brand = "Intel"
    elif "amd" in norm or "ryzen" in norm:
        brand = "AMD"

    model_key = None
    if brand == "Intel":
        ultra_m = INTEL_ULTRA_RE.search(norm)
        if ultra_m:
            tier, num, suffix = ultra_m.groups()
            model_key = f"ultra {tier} {num}{suffix.lower()}"
        else:
            m = INTEL_CORE_RE.search(norm)
            if m:
                tier, num, suffix = m.groups()
                model_key = f"i{tier}-{num}{suffix.upper()}"
    elif brand == "AMD":
        m = AMD_RYZEN_RE.search(norm)
        if m:
            tier, num, suffix = m.groups()
            model_key = f"ryzen {tier} {num}{suffix.lower()}"

    return {
        "brand": brand,
        "socket": _find_socket(text),
        "model_key": model_key,
    }


# --------------------------------------------------------- Motherboard ---

CHIPSET_RE = re.compile(
    r"\b(A320|A520|A620|B350|B450|B550|B650E?|X370|X470|X570|X670E?|"
    r"H310|H410|H470|H510|H610|H670|H770|B360|B460|B560|B660|B760|"
    r"Z370|Z390|Z490|Z590|Z690|Z790|Z890|B860|H810|W880|"
    r"H61|H81|B75|B85|H97|Z87|Z97|H110|B150|H170|Z170|B250|Z270|B360)(?!\d)",
    re.IGNORECASE,
)

FORM_FACTOR_RE = re.compile(r"\b(mini[\s-]?itx|micro[\s-]?atx|m[\s-]?atx|atx|e[\s-]?atx)\b", re.IGNORECASE)


def extract_motherboard(name, description=""):
    text = f"{name} {description}"
    norm = normalize(text)

    chipset_match = CHIPSET_RE.search(text)
    chipset = chipset_match.group(1).upper().replace(" ", "").replace("-", "") if chipset_match else None

    brand = None
    if "intel" in norm:
        brand = "Intel"
    elif "amd" in norm:
        brand = "AMD"

    ff_match = FORM_FACTOR_RE.search(norm)
    form_factor = ff_match.group(1).upper().replace(" ", "").replace("-", "") if ff_match else None
    if form_factor == "MATX":
        form_factor = "MICROATX"

    return {
        "brand": brand,
        "socket": _find_socket(text),
        "chipset": chipset,
        "form_factor": form_factor,
    }


# ------------------------------------------------------------------ RAM --

RAM_CAPACITY_RE = re.compile(r"\b(\d{1,3})\s?GB\b(?!\s*\))", re.IGNORECASE)
RAM_KIT_RE = re.compile(r"\((\d)\s?x\s?(\d{1,3})\s?GB\)", re.IGNORECASE)
RAM_SPEED_RE = re.compile(r"\b(\d{3,5})\s?MHz\b", re.IGNORECASE)
RAM_DDR_RE = re.compile(r"\bDDR([2-5])L?\b", re.IGNORECASE)
RAM_CL_RE = re.compile(r"\bC[LM]\s?(\d{1,2})\b", re.IGNORECASE)


def extract_ram(name, description=""):
    text = f"{name} {description}"
    norm = normalize(text)

    kit_match = RAM_KIT_RE.search(text)
    if kit_match:
        modules, per_module = int(kit_match.group(1)), int(kit_match.group(2))
        capacity_gb = modules * per_module
    else:
        cap_match = RAM_CAPACITY_RE.search(text)
        capacity_gb = int(cap_match.group(1)) if cap_match else None

    speed_match = RAM_SPEED_RE.search(text)
    ddr_match = RAM_DDR_RE.search(text)
    cl_match = RAM_CL_RE.search(text)

    # memoria SO-DIMM de notebook nao serve para uma build desktop --
    # marcamos para o pipeline de scoring excluir do pool de builds.
    is_notebook = bool(re.search(r"notebook|so-?dimm", norm))

    return {
        "capacity_gb": capacity_gb,
        "speed_mhz": int(speed_match.group(1)) if speed_match else None,
        "ddr_gen": f"DDR{ddr_match.group(1)}" if ddr_match else None,
        "cas_latency": int(cl_match.group(1)) if cl_match else None,
        "form_factor": "SODIMM" if is_notebook else "DIMM",
    }


# ------------------------------------------------------------------ GPU --

NVIDIA_RE = re.compile(r"\b(RTX|GTX)\s?-?(\d{3,4})\s?(Ti\s?Super|Ti|Super)?\b", re.IGNORECASE)
AMD_GPU_RE = re.compile(r"\bRX\s?-?(\d{3,4})\s?(XTX|XT)?\b", re.IGNORECASE)
GPU_VRAM_RE = re.compile(r"\b(\d{1,2})\s?GB\b", re.IGNORECASE)


def extract_gpu(name, description=""):
    text = f"{name} {description}"
    norm = normalize(text)

    brand = None
    model_key = None

    nv = NVIDIA_RE.search(text)
    amd = AMD_GPU_RE.search(text)

    if nv:
        brand = "NVIDIA"
        series, num, suffix = nv.groups()
        suffix_norm = (suffix or "").lower().replace(" ", "")
        model_key = f"{series.lower()} {num}" + (f" {suffix_norm}" if suffix_norm else "")
        model_key = model_key.replace("tisuper", "ti super")
    elif amd:
        brand = "AMD"
        num, suffix = amd.groups()
        model_key = f"rx {num}" + (f" {suffix.lower()}" if suffix else "")
    elif "arc" in norm:
        brand = "Intel"

    vram_match = GPU_VRAM_RE.search(text)

    return {
        "brand": brand,
        "model_key": model_key,
        "vram_gb": int(vram_match.group(1)) if vram_match else None,
    }


# ------------------------------------------------------------------ PSU --

PSU_WATTAGE_RE = re.compile(r"\b(\d{3,4})\s?W\b", re.IGNORECASE)
PSU_EFFICIENCY_RE = re.compile(
    r"80\s?\+?\s?PLUS\s?(WHITE|BRONZE|SILVER|GOLD|PLATINUM|TITANIUM)?", re.IGNORECASE
)


def extract_psu(name, description=""):
    text = f"{name} {description}"

    watt_match = PSU_WATTAGE_RE.search(text)
    eff_match = PSU_EFFICIENCY_RE.search(text)
    efficiency = "none"
    if eff_match:
        rating = eff_match.group(1)
        efficiency = f"80+ {rating.lower()}" if rating else "80+ white"

    return {
        "wattage": int(watt_match.group(1)) if watt_match else None,
        "efficiency": efficiency,
        "modular": bool(re.search(r"modular", text, re.IGNORECASE)),
    }


# -------------------------------------------------------------- Storage --

STORAGE_TB_RE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s?TB\b", re.IGNORECASE)
STORAGE_GB_RE = re.compile(r"\b(\d{2,4})\s?GB\b", re.IGNORECASE)


def extract_storage(name, description=""):
    text = f"{name} {description}"
    norm = normalize(text)

    capacity_gb = None
    tb_match = STORAGE_TB_RE.search(text)
    if tb_match:
        capacity_gb = round(float(tb_match.group(1).replace(",", ".")) * 1024)
    else:
        gb_match = STORAGE_GB_RE.search(text)
        if gb_match:
            capacity_gb = int(gb_match.group(1))

    if "m.2" in norm or "nvme" in norm or "m2" in norm:
        interface = "nvme"
        if "gen4" in norm or "pcie 4" in norm or "pcie4" in norm or "nvme 2" in norm:
            interface = "nvme_gen4"
    elif "ssd" in norm:
        interface = "sata_ssd"
    elif "hd " in norm or norm.startswith("hd") or "hdd" in norm or "sata iii" in norm:
        interface = "hdd"
    else:
        interface = None

    form_factor = None
    if "m.2" in norm or "m2" in norm:
        form_factor = "M.2"
    elif "2.5" in norm:
        form_factor = "2.5\""
    elif "3.5" in norm:
        form_factor = "3.5\""

    return {
        "capacity_gb": capacity_gb,
        "interface": interface,
        "form_factor": form_factor,
    }


EXTRACTORS = {
    "cpu": extract_cpu,
    "motherboard": extract_motherboard,
    "ram": extract_ram,
    "gpu": extract_gpu,
    "psu": extract_psu,
    "storage": extract_storage,
}


def extract_specs(category, name, description=""):
    fn = EXTRACTORS.get(category)
    if not fn:
        return {}
    return fn(name, description)
