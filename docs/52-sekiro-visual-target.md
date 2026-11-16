# 52. Sekiro を基準にした視覚目標仕様（2026-11-16）

オーナーの指示：「Sekiro レベルのビジュアルやゲームデザインを定義して（細かく）、そこに向かって作業する」。ゲームデザイン側は [53](53-sekiro-design-target.md)。

## 0. 調査の限界（先に）
- 調査担当（Fable）の環境では、記事本文を開けなかった（WebFetch が全ホストで失敗）。**以下の「調べた事実」は、すべて検索結果の要約を読んだだけの二次情報**。
- **Sekiro の人物の三角形数・テクスチャ解像度・骨数は、公開値が見つからなかった**（[51](51-gap-vs-aaa.md) と同じ結論）。色・霧・画角・ヒットストップの数値も見つからず、下の【記憶】は出典の無い知識。参照動画で確かめるまで根拠にしない。
- 受け入れ検査の**閾値の多くは自前の設定**で、Sekiro の実測ではない。

## 1. 調べた事実（二次情報）
**制作手法**
- 人物は 3ds Max でモデリング → ZBrush で細部をスカルプト → 法線マップに焼く。衣装は Marvelous Designer で型紙から立体化。布目のタイリング画像をブレンド [S1]。
- 布は「ベース＋経年劣化の傷みの画像」を重ねる。目立たせたい人物には、暗所でも最初に目が行く彩度の高い模様を足す [S2]。
- 背景は 3ds Max で手動配置。「DCC／エンジン上の手動配置／自動配置の補助」で、重要でない配置を自動化し、こだわる所に時間を回す [S3]。
- 背景の目標は「一目で物語が伝わる」（荒れ寺の大量の仏像、等）。城壁は「跳んでも登れない高さ」と一目で分かるように。直線的で寂しい所には火・旗・岩を置く。シルエットを崩してポリゴンらしさを減らす [S4][S5]。登れそうで登れない曖昧な隙間は作らない [S6]。
**美術方針**
- 宮崎氏「美術設計で注力したのは、より鮮やかな色の使用」[S7]。Game Informer も「これまでのフロム作品より明るく色彩豊か」[S8]。舞台は戦国末期 [S8]。
**技術**
- Dark Souls 3 のエンジンの発展版 [S10]。PS4 Pro は再構成 1800p で 38〜48fps、**据置機でも 60fps 固定ではない** [S11][S12][S13]。
**戦闘の視覚言語**
- 弾き成功は鋭い金属音と火花、通常の防御は鈍い音 [S14]。危険攻撃は赤い「危」の字が頭上に閃く（突き＝見切り、下段＝跳ぶ、掴み＝避ける）[S16]。
- 忍殺可能は相手の体の赤い印。体幹バーは敵の頭上／自分は画面下 [S17][S18]。弾かれた側は回復が遅い。動作のキャンセル無し [S19][S20]。
- カメラへの批判：壁を背にすると、ロックオン中に自分か敵が見えなくなる [S21]。

## 2. 現行の指針との食い違い（判断が必要）
1. **夜か昼か**：[49](49-art-bible.md) は「月明かりと灯りだけの夜」。Sekiro は鮮やかな色が方針 [S7]。夜一色だと、作り込み（[51](51-gap-vs-aaa.md) の摩耗テクスチャは「暗い夜の画面で違いは小さい」）が見えない。→ **世界のうち少なくとも2つを昼か夕方にする案**（オーナー判断）。
2. **血と文字の禁止**：[49](49-art-bible.md) は禁止。Sekiro の読みやすさは「危」の字と血しぶきに依る。禁止を守るなら、代わりの記号（刃の十字）が同じ速さで読めることを測る。
3. **三角形**：主人公約18.7万・敵約21.1万は、据置の人物予算より多い。方向は「減らして、画像に細部を移す」。

## 3. 目標仕様（10分類）
標準ショット：[49](49-art-bible.md) の4枚（雪山・石段・屋内・技の瞬間）＋「主人公の背面半身」「敵の正面半身」＝6枚。

| # | 分類 | 優先 | 目標（こちらの設定） | 受け入れ検査 |
|---|---|---|---|---|
| ① | 人物の輪郭と衣装の層 | P0 大 | 5層（下着・着物・上着か鎧・帯紐・小物）が段差で見える。左右非対称2つ以上。差し色は1体1色、面積5%以下 | 黒塗りシルエットで勢力と武器を当てられる。半身で5層を数えられる |
| ② | 材質と摩耗 | P0 中〜大 | 1体に材質5種以上（布・漆・鋼・革・肌か藁）。摩耗3種（縁の擦れ・裾の泥・くぼみの汚れ）を夜でも見える強さに | 材質5種を第三者が指せる。同型の雑兵3体で汚れ方が違う。**UV出力が前提** |
| ③ | 三角形と負荷 | P0 中 | 主人公6万以下、雑兵4万以下、主8万以下、一コマ25万以下、描画呼び出し120以下。細分を1回に | `charStats()` が以下。**iPhone実機で3人戦55fps以上を60秒**（実機計測は未実施） |
| ④ | 手と顔 | P1 大 | 指が柄に沿って巻く、空いた手が開く。素顔は出さず面・頭巾 | 技の瞬間で指が柄を貫通せず4本が接する。斬り動作で肘・肩がつぶれない |
| ⑤ | 環境の構図と語り | P0 中 | 各開けに「ここで何があったか」を示す小道具の組を1つ。輪郭に崩し。前景・中景・遠景の3層 | 標準ショットで、小道具1組以上／左右に配置物／輪郭の崩し3か所以上／3層が輝度で分離 |
| ⑥ | 色と時間帯 | P0 小〜中（**要判断**） | 6世界のうち2つ以上を昼か夕方に。夜でも人物の中間調を潰さない | 人物領域の輝度中央値が全域の25〜60%。黒潰れ・白飛び各5%以下。隣の世界と支配色相が40度以上離れる |
| ⑦ | 光と後処理 | P1 中 | 縁の光を主人公と敵の両方に常時。霧は奥行きで色が変わる。ブルームは火花・刃・灯りのみ | 6枚すべてで輪郭の片側に縁の光。画面全体の白飛びなし |
| ⑧ | 戦闘エフェクト | P0 中 | 弾き＝接点から刃の向きに飛ぶ火花筋。弾きと防御で量・色・音を分ける。危険の合図は出現位置を固定し、動作開始と同じコマで出す。崩しの瞬間は相手の体に赤い一点 | 接触から火花まで1コマ以内。弾き／防御を10人中9人が見分ける。危険の合図は命中の0.5秒以上前 |
| ⑨ | カメラ | P1 小 | 縦長で主人公は下1/3、敵は中央やや上。壁や柱が間に入ったら透かすか寄る | 戦闘60秒の録画で、人物が半分以上隠れるコマが2%以下 |
| ⑩ | HUDと動き | P1 小(HUD)/大(動き) | 文字なしを維持。全技に「溜め→打ち→決め→戻り」。弾かれた側は硬直が長い | 初見の人が相手の体幹の残りを3段階で当てる（正答8割）。予備動作0.3秒以上。接地中の足の滑り5cm以下 |

**届かないもの**：スカルプト由来の造形、型紙由来の布のしわ、顔、捕捉された動きの重み。**生成3D・テクスチャ資産か人の手なしでは、この差は残る**（[50](50-ai-tells-audit.md)）。

## 4. 優先順
1. 実機計測と三角形の削減（③）：他の全ての前提
2. 明るさと色の決定（⑥）：オーナーの判断が要る
3. UV出力 → 材質と摩耗（②）→ 衣装の層（①）
4. 環境の語りと輪郭崩し（⑤）、戦闘エフェクトの読み分け（⑧）
5. カメラ（⑨）、手（④）、後処理（⑦）、動き（⑩）

## Sources（すべて検索結果の要約経由。本文は未読）
- [S1] CGWORLD「Marvelous Designerで和装を表現『SEKIRO』」https://cgworld.jp/feature/201908-gg2019-sekiro.html
- [S2] 4Gamer CEDEC+KYUSHU 2021 https://www.4gamer.net/games/463/G046388/20211130134/
- [S3] CGWORLD GCC '19 https://cgworld.jp/feature/201905-gcc01-sekiro.html
- [S4] ファミ通 https://www.famitsu.com/news/202112/07242704.html
- [S5] Siliconera https://www.siliconera.com/sekiro-environments-were-designed-to-reflect-culture/
- [S6] Siliconera https://www.siliconera.com/tag/sekiro/
- [S7] Red Bull 宮崎氏インタビュー https://www.redbull.com/us-en/sekiro-shadows-die-twice-interview
- [S8] Game Informer https://gameinformer.com/2019/01/16/how-from-software-is-changing-its-approach-to-storytelling-for-sekiro-shadows-die-twice
- [S10] DSOGaming https://www.dsogaming.com/?p=124045
- [S11] Gamepur（Digital Foundry 引用）https://gamepur.com/?p=41573
- [S12] GamingBolt https://gamingbolt.com/sekiro-shadows-die-twice-ps4-pro-currently-runs-at-1080p-and-unlocked-frame-rate
- [S13] Vidaextra https://www.vidaextra.com/accion/sekiro-shadows-die-twice-analisis-tecnico-comparativo-spoilers-digital-foundry
- [S14] Fextralife Deflection https://sekiroshadowsdietwice.wiki.fextralife.com/Deflection
- [S16] Fextralife Combat https://sekiroshadowsdietwice.wiki.fextralife.com/Combat
- [S17] Activision サポート（公式）https://support.activision.com/sekiro/articles/sekiro-shadows-die-twice-game-mechanics
- [S18] GameWith https://gamewith.net/sekiro/article/show/8502
- [S19][S20] Fextralife Combat / Game Wisdom https://game-wisdom.com/critical/breakdown-sekiros-combat-broken
- [S21] TV Tropes https://www.tvtropes.org/pmwiki/pmwiki.php/YMMV/SekiroShadowsDieTwice
