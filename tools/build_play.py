"""試作を、GitHub Pages で開ける単独のHTMLにする。

prototype/kaeshi/index.html（Artifact 用。<head> などの外枠を持たない）を
play/index.html（そのままブラウザで開ける完全なHTML）に包む。
試作を直したら、このスクリプトを実行してから push する。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "prototype" / "kaeshi" / "index.html"
OUT = ROOT / "play" / "index.html"

HEAD = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="風の伝説">
<meta name="theme-color" content="#0a0f1c">
<style>html { -webkit-text-size-adjust: 100%; } body { margin: 0; }</style>
</head>
<body>
"""
TAIL = "\n</body>\n</html>\n"

def main():
    body = SRC.read_text(encoding="utf-8")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(HEAD + body + TAIL, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()
