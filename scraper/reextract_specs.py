"""
Reaplica a extracao de specs sobre um data/products.json JA coletado, sem
nenhuma requisicao de rede.

Por que isso existe: nome e descricao de cada produto ja estao salvos no
arquivo -- as specs sao derivadas deles por regex. Quando spec_extractor.py
melhora (uma familia de GPU que faltava no regex, um sufixo novo de CPU), a
unica forma de aproveitar era rodar a coleta inteira de novo: centenas de
requisicoes e alguns minutos, para recalcular algo que nao depende do site.
Este script faz so o recalculo, em segundos, e mostra o que mudou.

Uso (a partir da pasta do aplicativo):
    python scraper/reextract_specs.py            # mostra o diff e pergunta antes de gravar
    python scraper/reextract_specs.py --dry-run  # so mostra, nunca grava
    python scraper/reextract_specs.py --yes      # grava sem perguntar

Opera sobre dados/products.json -- a mesma pasta de dados que a janela do app
le, e nao mais uma copia separada em data/. Um backup do arquivo anterior e
gravado ao lado, como dados/products.json.bak, antes de qualquer escrita.
"""

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

from spec_extractor import extract_specs

# Rodado como script solto o pacote do app nao esta no sys.path -- sem isto
# este script editaria um arquivo diferente do que a janela le.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from appcore import paths  # noqa: E402

PRODUCTS_PATH = paths.products_path()


def diff_specs(old, new):
    """Campos que mudaram entre dois dicts de spec, no formato {campo: (antes, depois)}."""
    changed = {}
    for key in set(old) | set(new):
        before, after = old.get(key), new.get(key)
        if before != after:
            changed[key] = (before, after)
    return changed


def main():
    parser = argparse.ArgumentParser(description="Reextrai specs de dados/products.json sem raspar de novo.")
    parser.add_argument("--dry-run", action="store_true", help="so mostra o que mudaria")
    parser.add_argument("--yes", "-y", action="store_true", help="grava sem pedir confirmacao")
    parser.add_argument("--limit", type=int, default=25, help="quantas mudancas listar (padrao: 25)")
    args = parser.parse_args()

    if not PRODUCTS_PATH.exists():
        print(f"[erro] {PRODUCTS_PATH} nao existe -- rode a coleta primeiro.")
        return 1

    data = json.loads(PRODUCTS_PATH.read_text(encoding="utf-8"))
    products = data.get("products", [])

    changes = []
    gained = Counter()
    lost = Counter()

    for product in products:
        old = product.get("specs") or {}
        new = extract_specs(product["category"], product.get("name", ""), product.get("description", ""))
        delta = diff_specs(old, new)
        if not delta:
            continue
        changes.append((product, old, new, delta))
        for field, (before, after) in delta.items():
            if before in (None, "") and after not in (None, ""):
                gained[f"{product['category']}.{field}"] += 1
            elif after in (None, "") and before not in (None, ""):
                lost[f"{product['category']}.{field}"] += 1

    print(f"{len(products)} produtos analisados · {len(changes)} com specs diferentes\n")
    if not changes:
        print("Nada a fazer: a extracao atual ja bate com o que esta no arquivo.")
        return 0

    for product, old, new, delta in changes[: args.limit]:
        print(f"  [{product['category']}] {product['name'][:66]}")
        for field, (before, after) in sorted(delta.items()):
            print(f"      {field}: {before!r} -> {after!r}")
    if len(changes) > args.limit:
        print(f"  ... e mais {len(changes) - args.limit} produtos (use --limit para ver mais)\n")

    if gained:
        print("\ncampos preenchidos que antes estavam vazios:")
        for key, count in gained.most_common():
            print(f"  +{count:>4}  {key}")
    # perder um campo raramente e o que se quer: normalmente indica que uma
    # regra nova comeu um caso que a antiga acertava, entao fica em destaque.
    if lost:
        print("\ncampos que ficaram VAZIOS e antes tinham valor (confira antes de gravar):")
        for key, count in lost.most_common():
            print(f"  -{count:>4}  {key}")

    if args.dry_run:
        print("\n--dry-run: nada foi gravado.")
        return 0

    if not args.yes:
        answer = input(f"\nGravar as {len(changes)} mudancas em dados/products.json? [s/N] ").strip().lower()
        if answer not in ("s", "sim", "y", "yes"):
            print("Cancelado -- nada foi gravado.")
            return 0

    backup = PRODUCTS_PATH.with_suffix(".json.bak")
    shutil.copy2(PRODUCTS_PATH, backup)

    for product, _old, new, _delta in changes:
        product["specs"] = new
    data["specs_reextracted_at"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()

    PRODUCTS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nGravado. Backup do arquivo anterior em {backup.name}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
