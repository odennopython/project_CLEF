# CLAUDE.md

## このプロジェクトについて

本質的な面白さと洗練を目指すiOSゲーム。現在は設計段階。戦闘の手触りを確かめる試作が `prototype/kaeshi/` にある（1つのHTMLファイル、Three.js r128）。
人物の形は `tools/bake_characters.js` で彫刻して焼き出し、index.html に埋め込む（形を変えたら `node tools/bake_characters.js 0.0105` を実行）。
試作を直したら `python3 tools/build_play.py` を実行して `play/index.html`（GitHub Pages で公開する単独のHTML）を作り直してから push する。
作業を始める前に `docs/README.md` から設計資料を読み、決定事項と設計の柱に沿って進めること。

## 進め方の約束

- 会話は日本語で行う。
- オーナーへの忖度は不要。食い違いや弱点は率直に指摘する。
- 既存ゲームの表面的な特徴に引っ張られず、構造（本質）から考える。
- 議論で決まったことは積極的に `docs/` に記録する。決定事項は `docs/01-decisions.md`、設計の柱は `docs/03-pillars.md` を更新する。
- 根拠のない推測を事実として書かない。調べた事実には出典を付ける。
