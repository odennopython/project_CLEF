# 人物の素材をどう用意するか（2026-10-29、オーナーの判断待ち）

## オーナーの評価

> 人形は抜本的に見直したい。やはりカクカク人形で、一言で言うとクオリティが低い。

## 結論

コードで人体を作る方法（試作 0.1〜0.8）は限界に来た。抜本的に直すには、彫刻された人体モデルと、本物の人間の動き（モーションキャプチャ）が必要。この環境からは素材の配布サイトに直接アクセスできないため、オーナーに入手してもらう必要がある。

## 候補

| 案 | 内容 | 品質 | 費用 | 注意点 |
|---|---|---|---|---|
| A. Mixamo（推奨） | Adobeの無料サービス。写実的な人体と、大剣のモーションキャプチャ一式 | 高い | 無料（Adobeアカウント） | 商用のゲームに使えるが、元のファイルの配布は禁止。公開リポジトリには置けない |
| B. Quaternius（CC0） | 自由に使える人体と、120種類以上の動き | 中 | 無料 | 制約はほぼない |
| C. 購入・依頼 | 侍の人体モデルの購入、3Dの美術担当への依頼 | 最も高い | 数千円〜数十万円 | 時間がかかる |

### Aを選ぶ場合の前提

元のファイルを公開できないので、リポジトリを非公開にする。無料のGitHub Pagesは使えなくなるため、次のどちらかにする。

- GitHub Pro（月4ドル）で、非公開のままPagesを使う
- Godotへ移り、TestFlightでiPhoneに入れる（Apple Developer Program、年99ドル）

## 素材が届くまでに準備できること

- 骨のある人体モデルの読み込み
- ゲームの判定のタイミング（刃が届く瞬間）に、動きの再生速度を合わせる仕組み
- 刀を手の骨に持たせる仕組み

## 出典

- [Mixamo | Common questions（Adobe公式）](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
- [Mixamo FAQ: Licensing, Royalties, Ownership（Adobeコミュニティ）](https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/m-p/13234775)
- [Free Character Animations and Auto-Rigging: Mixamo and Its Alternatives (2026)](https://app.cinevva.com/guides/free-character-animations-rigging)
- [CC0のアニメーション素材の紹介](https://app.cinevva.com/tools/animations)
