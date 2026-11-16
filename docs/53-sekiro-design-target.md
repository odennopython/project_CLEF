# 53. Sekiro を基準にした戦闘・進行の目標仕様（2026-11-16）

見た目側は [52](52-sekiro-visual-target.md)。決定事項（[01](01-decisions.md)・[03](03-pillars.md)・[46](46-skills-and-worlds.md)）は動かさない。

## 0. 調査の信頼度
- 調査担当の環境では記事本文を開けず、**Sekiro の記述はすべて検索結果の抜粋どまり**。公式の一次情報は Activision のサポート記事（体力が低いほど体幹の回復が遅い）だけ。
- 弾きの窓の数値は出典が割れる（Fextralife「30フレーム（0.5秒）、直前にガードを離していると7フレーム」。よく言われる「約200ms」は確認できず）。**どちらもファン解析で公式値ではない**。
- 攻撃ごとの体幹ダメージ値、敵配置・ステルス・立体的レベル設計の開発者発言は見つからなかった。
- 以下の提案値は**設計判断**で、実機で詰める仮の値。

## 1. Sekiro の要点
| 項目 | 内容 | 種別 |
|---|---|---|
| 体幹と体力 | 敵の体力が低いほど体幹の回復が遅い | 公式 |
| 弾き | 着弾の約0.5秒前までのガードで弾き。連打で窓が縮む。弾きは受けより体幹を削る | ファン wiki |
| 忍殺 | 体幹が溜まると忍殺。ボスは印が複数あり、印の間で体力と体幹が全回復 | ファン wiki |
| 危 | 突き＝ガード不可（見切り）、下段＝跳ぶ、掴み＝避ける | ファン wiki |
| 回生の意図 | 「死にすぎてテンポが損なわれた」ため、危うい戦闘を攻めた設計にする | 二次（PC Gamer） |
| 稽古 | 半兵衛：罰なしで弾き・見切りを練習できる | 攻略 |

## 2. 目標仕様（10項目）
| # | 項目 | 優先 | 提案（要点） | 試作との差（調査担当の読み） |
|---|---|---|---|---|
| ① | 弾き・体幹 | P0 | 窓 白峰240→世界3以降200→無銘170ms。遅れの猶予50ms。連打時の窓100ms。崩れまでの弾き回数 雑兵3〜4／手練6〜8／主12〜16。相手の体幹回復は傷に応じ9→2/秒。受けで自分が満杯なら即敗北でなく0.9秒の崩れ | 窓が合計約430msと広い。回復が傷で変わらない。`block()` の `S.P >= 100` で即敗北 |
| ② | 危の技 | P0 | 文字なし（赤い刃＋十字＋音）を維持。**警告は着弾の450ms以上前**。突き＝上（踏み）、足払い＝刃の来る側と逆へ、体当たり＝避け、クナイ＝避けのみ | 足払いと体当たりの正解が両方「左右」。突き・体当たりの警告が約440msで下限すれすれ |
| ③ | 敵の型 | P1 | 刀雑兵＝肩が上がる・予告800ms、槍＝700ms、大太刀・金砕棒＝1100ms・一発で大崩し、二刀＝各段350ms、弓＝1000ms、忍＝虚と消え | 「予告の下限」の規則が無く、格の係数で下限を割りうる |
| ④ | 主の形 | P1 | 中間主＝1形、世界の最後＝2形、白狐・無銘＝2〜3形。形の変化で新しい問いを一つだけ。速度の上乗せ最大8% | 変化は主に時間の ×0.92。世界2〜5の主の専用の問いが未実装（[46](46-skills-and-worlds.md)も認める） |
| ⑤ | とどめ | P1 | 崩れ2.3秒維持。逃したら崩しを60へ戻す。居合で雑兵一撃が「短絡」 | 崩れを逃した扱いは未確認 |
| ⑥ | 技の経済 | P0 | クナイ3本・1本4秒、居合切り1.8秒、神纏9秒は維持。神纏／神纏切りの窓を設計書（320／180ms）に合わせる | **`S.arm` が −260〜+1000ms で、設計書と3倍以上ずれる** |
| ⑦ | 5区間の緩急 | P1 | 強さ 3→5→6→8→10。所要 30／50／70／60／120〜180秒、一合6〜8分 | 所要時間の目標と計測が無い |
| ⑧ | 教え方 | P0 | 最初の一戦を台本に（遅い袈裟、着弾200ms前に時間をほぼ止め、はじくまで待つ）。山小屋に稽古相手 | 見せるだけで、やらせて確かめる場が無い |
| ⑨ | 負けとやり直し | P0 | 主に届いたら主の手前から再開。負けから再入力まで3秒以内 | 主で負けると最大4戦戻る |
| ⑩ | 触った感触 | P0 | 触れてから画面・音が変わるまで50ms以下 | `judgeImpact` が向き未確定の指を最大200ms待つ。振動は一箇所のみ（iOS Safari では動かないはず） |

**調査担当の総評**：仕組みの数では Sekiro の骨格をほぼ持っている。足りないのは**厳しさの較正**。窓が広すぎ、決定済みの柱（読んで返す、技の使い分け）がまだ試されていない。

## 3. ⚠ オーナーの過去の指示との食い違い（判断が必要）
調査担当は、神纏・神纏切り・弾きの窓を**狭める**ことを P0 に挙げた。しかしオーナーは過去に明示して**緩めるよう指示**している（「神纏と神纏切りのタイミングはもう少しだけゆるく」「かなり緩くしていいよ」「通常弾きと居合からの弾きも発動を緩くして欲しい」）。**指示を覆さない。窓は現状のまま**にし、次を提案する：
- 難度を**選べる**ようにする（既定は今のまま「やさしい」、世界が進むと「ふつう」「きびしい」を選べる）。きびしい設定で設計書の値（320／180ms、弾き240→170）を使う。
- 決めるのはオーナー。

## 4. 作業の優先順（見た目と合わせて）
1. 実機計測と三角形の削減（52 ③）
2. 手触り（50ms予算）、教え方（台本の一戦）、やり直し（主の手前から）
3. 世界の明るさ・色（52 ⑥、**要判断**）
4. UV出力→摩耗・衣装の層（52 ①②）
5. 戦闘エフェクトの読み分け、危の正解の分化、予告の下限の規則

## Sources
- [Activision サポート（公式）](https://support.activision.com/ja/sekiro/articles/sekiro-shadows-die-twice-game-mechanics)
- Fextralife：[Deflection](https://sekiroshadowsdietwice.wiki.fextralife.com/Deflection)、[Combat](https://sekiroshadowsdietwice.wiki.fextralife.com/Combat)、[Posture](https://sekiroshadowsdietwice.wiki.fextralife.com/Posture)、[Mikiri Counter](https://sekiroshadowsdietwice.wiki.fextralife.com/Mikiri+Counter)、[Bosses](https://sekiroshadowsdietwice.wiki.fextralife.com/Bosses)（ファン wiki）
- [PC Gamer：回生についての Miyazaki 発言](https://pcgamer.com/sekiro-resurrection-mechanic-allows-for-deadlier-combat-than-dark-souls-says-miyazaki)（二次）
- [PlayStation Blog：Miyazaki インタビュー](https://blog.playstation.com/2018/07/13/interview-miyazaki-on-the-limbs-and-lore-of-sekiro-shadows-die-twice/)（本文未読）
- [Super Jump：The Art and Science of Sekiro's Combat](https://www.superjumpmagazine.com/the-art-and-science-of-sekiros-combat/)（ファン分析）
- [Gamer Guides：半兵衛](https://www.gamerguides.com/sekiro-shadows-die-twice/npc-quests/characters/hanbei-the-undying)、[Samurai Gamers：体幹](https://samurai-gamers.com/sekiro-shadows-die-twice/posture-system/)（攻略）
- [DXOMARK：タッチから表示までの応答](https://www.dxomark.com/the-importance-of-touch-to-display-response-time-in-gaming)
