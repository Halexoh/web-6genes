import base64
import hashlib
import mimetypes
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FILES = [
    ROOT / "index.html",
    ROOT / "css" / "styles.css",
]

OUTPUT_DIR = ROOT / "assets" / "images"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# data:image/png;base64,...
PATTERN = re.compile(
    r"data:image/(?P<fmt>[a-zA-Z0-9+]+)"
    r"(?:;charset=[^;,]+)?"
    r"(?:;base64)?,"
    r"(?P<data>[^\"')\s]+)"
)

saved = {}
total = 0


def save_image(fmt, data):

    global total

    is_base64 = not data.startswith("<svg")

    if fmt == "svg+xml":
        ext = ".svg"
        raw = data.encode("utf-8")
    else:
        ext = "." + fmt.replace("+xml", "")
        raw = base64.b64decode(data)

    digest = hashlib.sha1(raw).hexdigest()[:12]

    filename = digest + ext

    path = OUTPUT_DIR / filename

    if digest not in saved:
        path.write_bytes(raw)
        saved[digest] = filename
        total += 1

    return f"assets/images/{filename}"


for file in FILES:

    text = file.read_text(encoding="utf-8")

    def repl(match):

        fmt = match.group("fmt")
        data = match.group("data")

        return save_image(fmt, data)

    new = PATTERN.sub(repl, text)

    output = file.with_suffix(file.suffix + ".new")

    output.write_text(new, encoding="utf-8")

    print(f"✓ Procesado: {file.name}")

print()
print(f"Imágenes extraídas: {total}")
print(f"Guardadas en: {OUTPUT_DIR}")
print()
print("Se generaron archivos *.new para revisar antes de reemplazar.")