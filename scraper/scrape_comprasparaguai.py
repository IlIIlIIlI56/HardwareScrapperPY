"""
Scraper da categoria Informatica (componentes de PC) da comprasparaguai.com.br.

Percorre as paginas de listagem de cada categoria de componente, extrai
nome, preco (USD/BRL), numero de ofertas, imagem e link de cada produto,
enriquece cada item com specs extraidas via regex (spec_extractor.py) e
salva tudo em dados/products.json (a pasta de dados do aplicativo).

Normalmente quem chama isto e o proprio app, pelo botao "Coletar dados agora".
A linha de comando continua existindo para depuracao -- rodar so uma categoria,
aumentar o delay, escrever num arquivo de teste:

    python scraper/scrape_comprasparaguai.py
    python scraper/scrape_comprasparaguai.py --categories cpu gpu --max-pages 5
    python scraper/scrape_comprasparaguai.py --delay 1.0 --output teste.json

O arquivo gerado e consumido inteiramente pelo front-end (js/app.js) via fetch
no servidor local do app -- nenhum scraping acontece na janela.
"""

import argparse
import json
import re
import sys
import time
import random
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from spec_extractor import extract_specs, normalize

# Rodado como script solto (`python scraper/scrape_comprasparaguai.py`) o pacote
# do app nao esta no sys.path -- sem isto o CLI gravaria num lugar diferente do
# que a janela le, e a coleta "sumiria".
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from appcore import paths  # noqa: E402

BASE_URL = "https://www.comprasparaguai.com.br"

# categoria interna -> slug da URL no site
CATEGORY_SLUGS = {
    "cpu": "processador",
    "motherboard": "placa-mae",
    "ram": "memoria-ram",
    "gpu": "placa-de-video",
    "psu": "fonte",
    "storage": "hd-ssd",
}

CATEGORY_LABELS_PT = {
    "cpu": "Processador (CPU)",
    "motherboard": "Placa-Mae",
    "ram": "Memoria RAM",
    "gpu": "Placa de Video (GPU)",
    "psu": "Fonte (PSU)",
    "storage": "Armazenamento (SSD/HD)",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}

# trava de seguranca por categoria -- se o site mudar de estrutura ou a
# paginacao nunca "esvaziar", o scraper para aqui em vez de rodar para sempre.
HARD_PAGE_CAP = 80


def parse_brl_price(text):
    """'1.130,00' -> 1130.0  |  '163,50' -> 163.5"""
    if not text:
        return None
    cleaned = re.sub(r"[^\d,.-]", "", text)
    cleaned = cleaned.replace(".", "").replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def fetch_page(session, url, retries=3, timeout=20):
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, headers=HEADERS, timeout=timeout)
            if resp.status_code == 200:
                return resp.text
            print(f"  [aviso] HTTP {resp.status_code} em {url}")
        except requests.RequestException as exc:
            print(f"  [aviso] falha de rede ({attempt}/{retries}) em {url}: {exc}")
        time.sleep(1.5 * attempt)
    return None


def parse_products_from_html(html, category, base_url=BASE_URL):
    soup = BeautifulSoup(html, "html.parser")
    results_container = soup.select_one(".resultados-busca") or soup
    cards = results_container.select(".promocao-produtos-item")

    products = []
    for card in cards:
        name_el = card.select_one(".promocao-item-nome a")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        href = name_el.get("href", "")
        url = urljoin(base_url, href)

        desc_el = card.select_one(".promocao-item-caracteristicas")
        description = desc_el.get_text(strip=True) if desc_el else ""

        price_usd_el = card.select_one(".price-model span")
        price_usd_text = price_usd_el.get_text(strip=True).replace("\xa0", " ") if price_usd_el else ""
        price_usd_text = price_usd_text.replace("US$", "").strip()
        price_usd = parse_brl_price(price_usd_text)

        price_brl_el = card.select_one(".promocao-item-preco-text")
        price_brl_text = price_brl_el.get_text(strip=True).replace("R$", "").strip() if price_brl_el else ""
        price_brl = parse_brl_price(price_brl_text)

        offers_el = card.select_one(".ver-detalhes .btn")
        offers = None
        if offers_el:
            m = re.search(r"(\d+)", offers_el.get_text())
            offers = int(m.group(1)) if m else None

        img_el = card.select_one(".promocao-item-img img")
        image = None
        if img_el:
            image = img_el.get("data-src") or img_el.get("src")

        if not name or price_usd is None:
            continue

        specs = extract_specs(category, name, description)

        products.append(
            {
                "category": category,
                "name": name,
                "description": description,
                "url": url,
                "image": image,
                "price_usd": price_usd,
                "price_brl": price_brl,
                "offers": offers,
                "specs": specs,
            }
        )

    return products


class ScrapeCancelled(Exception):
    """Levantada quando `should_stop()` pede parada no meio da coleta."""


def scrape_category(session, category, max_pages, delay, should_stop=None):
    slug = CATEGORY_SLUGS[category]
    print(f"\n== {CATEGORY_LABELS_PT[category]}  (/{slug}/) ==")

    all_products = []
    seen_urls = set()
    page = 1
    effective_cap = min(max_pages, HARD_PAGE_CAP) if max_pages else HARD_PAGE_CAP

    while page <= effective_cap:
        if should_stop and should_stop():
            print(f"  [cancelado] parando em {CATEGORY_LABELS_PT[category]}, pagina {page}.")
            raise ScrapeCancelled(category)
        url = f"{BASE_URL}/{slug}/" if page == 1 else f"{BASE_URL}/{slug}/?page={page}"
        html = fetch_page(session, url)
        if html is None:
            print(f"  [erro] nao foi possivel obter a pagina {page}, parando categoria.")
            break

        products = parse_products_from_html(html, category)
        if not products:
            print(f"  pagina {page}: sem produtos -> fim da paginacao.")
            break

        new_count = 0
        for p in products:
            if p["url"] not in seen_urls:
                seen_urls.add(p["url"])
                all_products.append(p)
                new_count += 1

        print(f"  pagina {page}: {len(products)} produtos ({new_count} novos)")

        if new_count == 0:
            print("  nenhum produto novo -> assumindo fim da paginacao.")
            break

        page += 1
        time.sleep(delay + random.uniform(0, 0.4))

    print(f"  total coletado em {CATEGORY_LABELS_PT[category]}: {len(all_products)} produtos")
    return all_products


DEFAULT_OUTPUT = str(paths.products_path())


def run_scrape(categories=None, max_pages=None, delay=0.6, output_path=None, should_stop=None):
    """
    Nucleo do scraper, reutilizavel tanto pelo CLI (main(), abaixo) quanto pelo
    app (appcore/scrape_job.py, por tras do botao "Coletar dados agora").
    Devolve o dict que tambem e salvo em products.json.

    `should_stop` e um callable sem argumentos consultado entre paginas: quando
    devolve True a coleta e abortada com ScrapeCancelled e NADA e gravado -- um
    products.json com metade das categorias seria pior que o arquivo anterior,
    porque uma build precisa das seis.
    """
    categories = categories or list(CATEGORY_SLUGS.keys())
    max_pages = max_pages or HARD_PAGE_CAP
    output_path = Path(output_path or DEFAULT_OUTPUT)

    session = requests.Session()

    all_products = []
    counts_by_category = {}
    for category in categories:
        products = scrape_category(session, category, max_pages, delay, should_stop=should_stop)
        all_products.extend(products)
        counts_by_category[category] = len(products)

    output = {
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "source": f"{BASE_URL}/informatica/",
        "counts_by_category": counts_by_category,
        "total_products": len(all_products),
        "products": all_products,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nOK: {len(all_products)} produtos salvos em {output_path}")
    return output


def main():
    parser = argparse.ArgumentParser(description="Scraper de hardware da comprasparaguai.com.br")
    parser.add_argument(
        "--categories",
        nargs="+",
        choices=list(CATEGORY_SLUGS.keys()),
        default=list(CATEGORY_SLUGS.keys()),
        help="Quais categorias raspar (padrao: todas)",
    )
    parser.add_argument("--max-pages", type=int, default=HARD_PAGE_CAP, help="Paginas maximas por categoria")
    parser.add_argument("--delay", type=float, default=0.6, help="Segundos de espera entre paginas")
    parser.add_argument("--output", type=str, default=DEFAULT_OUTPUT, help="Caminho do JSON de saida")
    args = parser.parse_args()

    run_scrape(categories=args.categories, max_pages=args.max_pages, delay=args.delay, output_path=args.output)


if __name__ == "__main__":
    sys.exit(main())
