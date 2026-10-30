"""試作を、GitHub Pages で開ける単独のHTMLにする。

prototype/kaeshi/index.html（Artifact 用。<head> などの外枠を持たない）を
play/index.html（そのままブラウザで開ける完全なHTML）に包む。
試作を直したら、このスクリプトを実行してから push する。
"""
from pathlib import Path
import datetime
import re
import subprocess

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
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<style>html { -webkit-text-size-adjust: 100%; } body { margin: 0; }</style>
</head>
<body>
"""
TAIL = "\n</body>\n</html>\n"

def main():
    body = SRC.read_text(encoding="utf-8")
    # 版の情報（最初のルール画面に小さく出す）：試作の番号、作った日時（日本時間）、直前のコミット
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime("%m/%d %H:%M")
    try:
        rev = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        rev = ""
    body = re.sub(r'<span id="ver">([^<]*)</span>', lambda m: f'<span id="ver">{m.group(1)} · {stamp} · {rev}</span>', body, count=1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(HEAD + body + TAIL, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()
