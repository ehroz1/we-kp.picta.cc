#!/usr/bin/env python3
"""
Собирает конструктор КП WE Media в один index.html для GitHub Pages.

Что берёт:
    src/            — код (layouts.js, importer.js, app.js, slides.css, styles.css, index.template.html)
    brand/fonts/    — Inter и Montserrat (TTF по весам)
    brand/logo/     — логотип WE Media Group (берётся только контур)
    brand/ui/       — иконки интерфейса Phosphor Bold

Зерно для градиентных плашек (grain.png, 256×256, шум 0–15%) генерируется
здесь же — детерминированно, чтобы сборка не менялась от запуска к запуску.

Запуск:  python3 build.py
Результат: index.html, manifest.webmanifest, service-worker.js в корне
"""

import base64
import json
import random
import re
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
BRAND = HERE / "brand"
FONTS = BRAND / "fonts"
OUT = HERE / "index.html"

# латиница, кириллица с казахскими буквами, типографские знаки, валюты (₸ ₽ € $), стрелки, ✓
SUBSET_UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+0400-045F,U+0490-0493,U+0496-0497,"
    "U+049A-049B,U+04A2-04A3,U+04AE-04B1,U+04BA-04BB,U+04D8-04D9,U+04E8-04E9,"
    "U+2010-2015,U+2018-201F,U+2022,U+2026,U+2030,U+2032-2033,U+2039-203A,"
    "U+20AC,U+20B8,U+20BD,U+2116,U+2122,U+2190-2193,U+2212,U+2248,U+2260,U+2264-2265,U+2713"
)

# семейство → (имя в CSS, [(вес, курсив)])
FONT_FAMILIES = {
    "Inter": ("WEInter", [(400, False), (500, False), (600, False), (700, False), (500, True), (700, True)]),
    "Montserrat": ("WEMontserrat", [(800, False)]),
}


def data_url(path: Path, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def subset_font(path: Path) -> tuple[bytes, bool]:
    """Урезает шрифт до нужных символов и переводит в woff2. Без fontTools — как есть."""
    try:
        from fontTools import subset  # noqa: F401
    except ImportError:
        print(f"  ! fontTools не установлен, {path.name} встраивается целиком")
        print("    (поставь: pip3 install fonttools brotli — файл станет меньше)")
        return path.read_bytes(), False

    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "out.woff2"
        cmd = [
            sys.executable, "-m", "fontTools.subset", str(path),
            f"--unicodes={SUBSET_UNICODES}",
            "--flavor=woff2",
            f"--output-file={dst}",
            "--layout-features=kern,liga,calt,tnum,lnum,case,locl",
            "--no-hinting",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not dst.exists():
            print(f"  ! не удалось урезать {path.name}, встраиваю целиком")
            return path.read_bytes(), False
        return dst.read_bytes(), True


def font_faces() -> str:
    faces = []
    for stem, (css_name, styles) in FONT_FAMILIES.items():
        for weight, italic in styles:
            path = FONTS / f"{stem}-{weight}{'-italic' if italic else ''}.ttf"
            if not path.exists():
                raise SystemExit(f"нет шрифта {path.relative_to(HERE)}")
            data, woff2 = subset_font(path)
            fmt, mime = ("woff2", "font/woff2") if woff2 else ("truetype", "font/ttf")
            b64 = base64.b64encode(data).decode("ascii")
            faces.append(
                f"@font-face{{font-family:'{css_name}';font-weight:{weight};"
                f"font-style:{'italic' if italic else 'normal'};font-display:block;"
                f"src:url(data:{mime};base64,{b64}) format('{fmt}')}}"
            )
            print(f"шрифт {css_name} {weight}{' italic' if italic else ''}: {len(data) // 1024} КБ")
    return "\n".join(faces)


def png_bytes(width: int, height: int, rows: list[bytes], color_type: int) -> bytes:
    """Минимальный PNG-кодировщик (8 бит на канал)."""
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def grain_png() -> str:
    """Монохромный шум 256×256: светлые и тёмные точки, прозрачность пикселей 0–15%."""
    rnd = random.Random(20260107)
    size = 256
    rows = []
    for _ in range(size):
        row = bytearray()
        for _ in range(size):
            row.append(255 if rnd.random() < 0.5 else 0)   # яркость: белая или чёрная точка
            row.append(rnd.randint(0, 38))                  # альфа: 0–15% (38 из 255)
        rows.append(bytes(row))
    png = png_bytes(size, size, rows, color_type=4)        # 4 = grayscale + alpha
    print(f"зерно grain.png: {len(png) // 1024} КБ")
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def logo_js() -> str:
    """Логотип WE Media Group: один составной контур, рисуется в любом цвете через currentColor."""
    svg = (BRAND / "logo" / "we-media-group_black.svg").read_text(encoding="utf-8")
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    paths = [re.search(r'\sd="([^"]+)"', tag).group(1) for tag in re.findall(r"<path[^>]*>", svg)]
    data = {"vb": vb, "paths": paths}
    return "const LOGO = " + json.dumps(data) + ";\n"


def ui_icons() -> str:
    """Иконки интерфейса — живая разметка SVG, цвет наследуется через currentColor."""
    out = {}
    for f in sorted((BRAND / "ui").glob("*.svg")):
        svg = " ".join(f.read_text(encoding="utf-8").split())
        svg = svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ', 1)
        out[f.stem] = svg
    print(f"иконок интерфейса: {len(out)}")
    return "const ICONS = " + json.dumps(out, ensure_ascii=False) + ";\n"


def main() -> int:
    if not SRC.exists():
        print("нет папки src/ — запусти скрипт из корня проекта")
        return 1

    assets_js = logo_js() + ui_icons()

    icon_svg = BRAND / "pwa-icon.svg"
    icon_mask = BRAND / "pwa-icon-maskable.svg"
    icon_png = BRAND / "pwa-icon-180.png"
    favicon_url = data_url(icon_svg, "image/svg+xml") if icon_svg.exists() else ""
    if icon_png.exists():
        apple_icon_url = data_url(icon_png, "image/png")
    else:
        print(f"  ! нет {icon_png.name} — apple-touch-icon будет из SVG (хуже на части iOS)")
        apple_icon_url = favicon_url

    slides_css = (SRC / "slides.css").read_text(encoding="utf-8").replace("__GRAIN__", grain_png())

    html = (SRC / "index.template.html").read_text(encoding="utf-8")
    replacements = {
        "__FONT_FACES__": font_faces(),
        "__SLIDES_CSS__": slides_css,
        "__CSS__": (SRC / "styles.css").read_text(encoding="utf-8"),
        "__ASSETS_JS__": assets_js,
        "__FAVICON__": favicon_url,
        "__APPLE_TOUCH_ICON__": apple_icon_url,
        "__LAYOUTS_JS__": (SRC / "layouts.js").read_text(encoding="utf-8"),
        "__IMPORTER_JS__": (SRC / "importer.js").read_text(encoding="utf-8"),
        "__APP_JS__": (SRC / "app.js").read_text(encoding="utf-8"),
    }
    for token, value in replacements.items():
        if token not in html:
            print(f"ошибка сборки: в шаблоне нет {token}")
            return 1
        html = html.replace(token, value)

    OUT.write_text(html, encoding="utf-8")
    print(f"\nготово: {OUT.name}  ({OUT.stat().st_size / 1024:.0f} КБ)")

    manifest = (SRC / "manifest.template.json").read_text(encoding="utf-8")
    manifest = manifest.replace("__PWA_ICON__", favicon_url)
    manifest = manifest.replace("__PWA_ICON_MASKABLE__",
                                data_url(icon_mask, "image/svg+xml") if icon_mask.exists() else favicon_url)
    (HERE / "manifest.webmanifest").write_text(manifest, encoding="utf-8")
    (HERE / "service-worker.js").write_text((SRC / "service-worker.js").read_text(encoding="utf-8"),
                                            encoding="utf-8")
    print("готово: manifest.webmanifest, service-worker.js")
    print("залей в репозиторий и включи GitHub Pages — см. README.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
