"""
Gera os icones de launcher do app Android a partir do MESMO desenho
procedural de make_icon.py (a folha verde sobre o quadrado arredondado) --
para o Android nao ganhar uma marca diferente da do Windows por acidente.

Uso:
    python assets/make_android_icons.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_icon import encode_png, render_rgba  # noqa: E402

ANDROID_RES = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"

# Tamanhos padrao de mipmap do Android (ic_launcher e ic_launcher_round usam o
# mesmo PNG aqui -- o desenho ja tem cantos transparentes, entao a mascara
# redonda que o Android aplica por cima nao corta nada importante).
DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def main():
    for folder, size in DENSITIES.items():
        target_dir = ANDROID_RES / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        png = encode_png(size, render_rgba(size))
        for name in ("ic_launcher.png", "ic_launcher_round.png"):
            (target_dir / name).write_bytes(png)
        print(f"{folder}: {size}x{size} ok")


if __name__ == "__main__":
    main()
