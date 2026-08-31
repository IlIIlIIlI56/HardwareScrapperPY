"""
Gera assets/icon.ico -- o icone do executavel e da janela.

Escrito a mao, com zlib e struct da biblioteca padrao, em vez de usar Pillow:
o icone e um detalhe de empacotamento, e nao valeria acrescentar uma
dependencia de 3 MB (e um passo a mais no build de quem clonar o projeto) so
para desenhar duas circunferencias.

O desenho e a mesma folha do cabecalho das paginas, reduzida ao essencial: a
intersecao de dois circulos deslocados (a forma classica de "vesica", que e
exatamente uma folha) girada 45 graus, mais um talo. Verde sobre um quadrado
arredondado quase preto, os dois do design system em css/style.css.

Uso:
    python assets/make_icon.py
"""

import math
import struct
import zlib
from pathlib import Path

# Mesmas cores do tema escuro em css/style.css.
BACKGROUND = (14, 17, 15)
LEAF = (52, 199, 123)

SIZES = (16, 24, 32, 48, 64, 128, 256)
SUPERSAMPLE = 4  # antialiasing por media: sem isso as bordas da folha serram

OUTPUT = Path(__file__).resolve().parent / "icon.ico"


def _coverage(size, inside):
    """
    Amostra `inside(x, y)` numa grade SUPERSAMPLE vezes mais densa e devolve,
    para cada pixel, a fracao de amostras que cairam dentro da forma. E esse
    numero que vira o alfa -- e o que da a borda suave.
    """
    step = 1.0 / SUPERSAMPLE
    offset = step / 2.0
    total = SUPERSAMPLE * SUPERSAMPLE
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            hits = 0
            for sy in range(SUPERSAMPLE):
                y = py + offset + sy * step
                for sx in range(SUPERSAMPLE):
                    x = px + offset + sx * step
                    if inside(x, y):
                        hits += 1
            row.append(hits / total)
        rows.append(row)
    return rows


def _rounded_square(size):
    radius = size * 0.22
    inner = size - radius

    def inside(x, y):
        dx = max(radius - x, 0.0, x - inner)
        dy = max(radius - y, 0.0, y - inner)
        return dx * dx + dy * dy <= radius * radius

    return inside


def _leaf(size):
    """
    Folha = intersecao de dois circulos de raio R centrados a +-`apart` do
    centro (a "vesica", que e exatamente o contorno de uma folha), inclinada 45
    graus para apontar para cima e a direita. O talo e um segmento de reta
    grosso saindo da ponta de baixo, na mesma direcao.

    O conjunto folha+talo e deslocado meio talo para cima e a direita: sem
    isso, o talo puxaria toda a massa do desenho para o canto inferior
    esquerdo e o icone pareceria torto dentro do quadrado.
    """
    axis_half = 0.279 * size    # metade do comprimento da folha
    width_half = 0.130 * size   # metade da largura, na parte mais gorda
    stem_len = 0.175 * size
    stem_half = 0.030 * size

    # R e `apart` que produzem exatamente (axis_half, width_half):
    #   largura = R - apart ;  comprimento = sqrt(R^2 - apart^2)
    radius = (axis_half * axis_half + width_half * width_half) / (2 * width_half)
    apart = radius - width_half

    diag = math.sqrt(0.5)                  # componente de um vetor unitario a 45 graus
    shift = stem_len / 2.0
    cx = size / 2.0 + shift * diag         # para a direita
    cy = size / 2.0 - shift * diag         # para cima

    # eixo da folha: aponta para baixo-esquerda quando v cresce
    axis = (-diag, diag)
    tip = (cx + axis[0] * axis_half, cy + axis[1] * axis_half)
    stem_end = (tip[0] + axis[0] * stem_len, tip[1] + axis[1] * stem_len)

    def inside(x, y):
        dx, dy = x - cx, y - cy
        # projecao no referencial da folha: v ao longo do eixo, u na largura
        v = dx * axis[0] + dy * axis[1]
        u = -dx * axis[1] + dy * axis[0]
        if (u + apart) ** 2 + v * v <= radius * radius and (u - apart) ** 2 + v * v <= radius * radius:
            return True
        return _distance_to_segment(x, y, tip, stem_end) <= stem_half

    return inside


def _distance_to_segment(x, y, start, end):
    sx, sy = start
    ex, ey = end
    dx, dy = ex - sx, ey - sy
    length_sq = dx * dx + dy * dy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, ((x - sx) * dx + (y - sy) * dy) / length_sq))
    px, py = sx + t * dx, sy + t * dy
    return math.hypot(x - px, y - py)


def render_rgba(size):
    square = _coverage(size, _rounded_square(size))
    leaf = _coverage(size, _leaf(size))

    pixels = bytearray()
    for py in range(size):
        for px in range(size):
            base_alpha = square[py][px]
            leaf_alpha = leaf[py][px] * base_alpha  # a folha nao vaza do quadrado
            if base_alpha <= 0.0:
                pixels += bytes((0, 0, 0, 0))
                continue
            # composicao da folha sobre o fundo, ja com o alfa do quadrado
            color = tuple(
                round(BACKGROUND[i] * (1 - leaf_alpha) + LEAF[i] * leaf_alpha) for i in range(3)
            )
            pixels += bytes((*color, round(base_alpha * 255)))
    return bytes(pixels)


def encode_png(size, rgba):
    """PNG RGBA de 8 bits, um IDAT, todas as linhas com filtro 0."""
    raw = bytearray()
    stride = size * 4
    for py in range(size):
        raw.append(0)
        raw += rgba[py * stride: (py + 1) * stride]

    def chunk(kind, payload):
        data = kind + payload
        return struct.pack(">I", len(payload)) + data + struct.pack(">I", zlib.crc32(data))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def build_ico(sizes=SIZES):
    """
    ICO com cada tamanho guardado como PNG. O Windows aceita entradas PNG desde
    o Vista, e isso deixa o arquivo uma ordem de grandeza menor do que o BMP
    com mascara que o formato original exigia.
    """
    images = [encode_png(size, render_rgba(size)) for size in sizes]

    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries = bytearray()
    for size, png in zip(sizes, images):
        entries += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,  # 0 significa 256 no formato
            0 if size >= 256 else size,
            0,  # paleta
            0,  # reservado
            1,  # planos
            32,  # bits por pixel
            len(png),
            offset,
        )
        offset += len(png)

    return header + bytes(entries) + b"".join(images)


if __name__ == "__main__":
    OUTPUT.write_bytes(build_ico())
    print(f"{OUTPUT} gerado ({OUTPUT.stat().st_size} bytes, tamanhos: {', '.join(map(str, SIZES))})")
