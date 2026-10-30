// 人物を「彫刻」して、骨と皮の付いた表面を焼き出す。
//
// 1. 人体を、筋肉や骨の形（楕円体・先細りの棒・角の丸い箱）を滑らかに溶け合わせた立体として定義する（符号付き距離）
// 2. その立体の表面を、格子の上で削り出す（Surface Nets）
// 3. くぼみに溜まる影（環境遮蔽）を、頂点の色に焼き込む
// 4. 各頂点が、どの骨にどれだけついていくか（皮の重み）を計算する
// 5. 圧縮して、prototype/kaeshi/index.html の中の印の間に埋め込む
//
// 使い方：node tools/bake_characters.js
'use strict';
const fs = require('fs');
const path = require('path');

// ───────── 小さなベクトル演算 ─────────
const v = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ───────── 形の部品（符号付き距離） ─────────
// 先細りの棒（端が丸い）
function sdCone(p, a, b, ra, rb) {
  const ba = sub(b, a), pa = sub(p, a);
  const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
  return len(sub(pa, mul(ba, h))) - lerp(ra, rb, h);
}
// 楕円体（近似）：軸 u,w,t に沿った半径 rx,ry,rz。回転は基底で与える。
function sdEllipsoid(p, c, r, basis) {
  let q = sub(p, c);
  if (basis) q = [dot(q, basis[0]), dot(q, basis[1]), dot(q, basis[2])];
  const k0 = len([q[0] / r[0], q[1] / r[1], q[2] / r[2]]);
  const k1 = len([q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2])]);
  return k0 < 1e-6 ? -Math.min(r[0], r[1], r[2]) : k0 * (k0 - 1) / k1;
}
// 角の丸い箱
function sdBox(p, c, half, round, basis) {
  let q = sub(p, c);
  if (basis) q = [dot(q, basis[0]), dot(q, basis[1]), dot(q, basis[2])];
  const d = [Math.abs(q[0]) - half[0] + round, Math.abs(q[1]) - half[1] + round, Math.abs(q[2]) - half[2] + round];
  const o = len([Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0)]);
  return o + Math.min(Math.max(d[0], Math.max(d[1], d[2])), 0) - round;
}
// 滑らかな合体（粘土を馴染ませるように）
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); }
function smax(a, b, k) { return -smin(-a, -b, k); }
// 基底：主軸 y を dir に向け、x を side に近づける
function basisFrom(dir, side) {
  const y = norm(dir);
  let x = sub(side, mul(y, dot(side, y))); x = norm(x);
  const z = cross(x, y);
  return [x, y, z];
}

// ───────── 骨（素の姿勢＝腕を少し開いて下ろした姿勢） ─────────
function skeleton(sw) {
  const H = v(0, 1.115, 0), W = add(H, v(0, 0.10, 0)), C = add(W, v(0, 0.24, 0)), N = add(C, v(0, 0.39, 0)), HD = add(N, v(0, 0.15, 0));
  const armAng = 35 * Math.PI / 180;
  const J = { H, W, C, N, HD };
  [['R', -1], ['L', 1]].forEach(([s, sg]) => {
    const dir = v(sg * Math.sin(armAng), -Math.cos(armAng), 0);
    const S = add(C, v(sg * 0.205 * sw, 0.30, 0));
    const E = add(S, mul(dir, 0.31)), WR = add(E, mul(dir, 0.29));
    J['S' + s] = S; J['E' + s] = E; J['WR' + s] = WR; J['dir' + s] = dir;
    const P = add(H, v(sg * 0.095, -0.05, 0)), K = add(P, v(0, -0.5, 0)), A = add(K, v(0, -0.49, 0));
    J['P' + s] = P; J['K' + s] = K; J['A' + s] = A;
  });
  // 骨：名前、親、位置、端（皮の重みの計算に使う線分）
  const bones = [
    ['hips', -1, J.H, J.W], ['waist', 0, J.W, J.C], ['chest', 1, J.C, J.N], ['neck', 2, J.N, J.HD], ['head', 3, J.HD, add(J.HD, v(0, 0.12, 0))],
    ['upperArmR', 2, J.SR, J.ER], ['foreArmR', 5, J.ER, J.WRR], ['handR', 6, J.WRR, add(J.WRR, mul(J.dirR, 0.1))],
    ['upperArmL', 2, J.SL, J.EL], ['foreArmL', 8, J.EL, J.WRL], ['handL', 9, J.WRL, add(J.WRL, mul(J.dirL, 0.1))],
    ['thighR', 0, J.PR, J.KR], ['shinR', 11, J.KR, J.AR], ['footR', 12, J.AR, add(J.AR, v(0, -0.04, 0.16))],
    ['thighL', 0, J.PL, J.KL], ['shinL', 14, J.KL, J.AL], ['footL', 15, J.AL, add(J.AL, v(0, -0.04, 0.16))],
    ['skirt', 0, J.H, add(J.H, v(0, -0.8, 0))],   // 袴の裾：腰について行くが、重さで常に下へ垂れる
  ];
  return { J, bones };
}
const BONE = { hips: 0, waist: 1, chest: 2, neck: 3, head: 4, upperArmR: 5, foreArmR: 6, handR: 7, upperArmL: 8, foreArmL: 9, handL: 10, thighR: 11, shinR: 12, footR: 13, thighL: 14, shinL: 15, footL: 16, skirt: 17 };

// ───────── 人物の彫刻 ─────────
// 部品：{ d(p) → 距離, m: 素材, b: 骨, k: 馴染ませる量 }
function sculpt(kind) {
  const big = kind === 'enemy';
  const sw = big ? 1.14 : 1.0, lw = big ? 1.12 : 1.0;
  const { J, bones } = skeleton(sw);
  const P = [];
  const part = (m, b, k, d) => P.push({ m, b: BONE[b], k, d });
  const pleat = (p, axisPt, axisDir, n, amp) => {   // 軸のまわりに波打つひだ
    const q = sub(p, axisPt), t = dot(q, axisDir), r = sub(q, mul(axisDir, t));
    const ang = Math.atan2(r[2], r[0]);
    if (big) return amp * Math.abs(Math.sin(ang * n));
    const f = ang * n / Math.PI; return amp * (1 - Math.abs(2 * (f - Math.floor(f)) - 1));   // 主人公：折り目の立った鋭いひだ
  };

  // 胴（着物）
  part('kimono', 'waist', 0.05, (p) => sdEllipsoid(p, v(0, 1.26, 0), v(0.15 * sw, 0.15, 0.112)));
  part('kimono', 'chest', 0.06, (p) => sdEllipsoid(p, v(0, 1.5, 0.004), v(0.188 * sw, 0.2, 0.128)));
  part('kimono', 'chest', 0.05, (p) => sdEllipsoid(p, v(0, 1.63, 0.025), v(0.2 * sw, 0.11, 0.118)));
  const carve = [], paint = [];
  if (big) {
    part('kimono', 'chest', 0.05, (p) => sdCone(p, v(-0.19 * sw, 1.745, -0.005), v(0.19 * sw, 1.745, -0.005), 0.066, 0.066));
    [-1, 1].forEach((s) => part('kimono', 'chest', 0.04, (p) => sdEllipsoid(p, v(s * 0.095, 1.79, -0.012), v(0.095, 0.05, 0.07))));   // 僧帽筋
    // 着物のしわ：胸と腹に、縦に流れる浅い溝
    const foldWrap = (base) => (p) => base(p) - 0.0028 * Math.sin(p[0] * 70 + p[1] * 9);
    P.slice(0, 3).forEach((q) => { q.d = foldWrap(q.d); });
    // 襟（前の重なり）と、白い内襟
    [-1, 1].forEach((s) => {
      const a0 = v(s * 0.095, 1.79, 0.1), a1 = v(s * -0.01, 1.48, 0.128), bL = basisFrom(sub(a1, a0), v(1, 0, 0));
      part('lapel', 'chest', 0.01, (p) => sdBox(p, mul(add(a0, a1), 0.5), v(0.026, len(sub(a1, a0)) / 2, 0.012), 0.008, bL));
      const c0 = v(s * 0.072, 1.8, 0.096), c1 = v(s * 0.0, 1.55, 0.124), bC = basisFrom(sub(c1, c0), v(1, 0, 0));
      part('white', 'chest', 0.008, (p) => sdBox(p, mul(add(c0, c1), 0.5), v(0.016, len(sub(c1, c0)) / 2, 0.012), 0.006, bC));
    });
    // 首と頭
    part('skin', 'neck', 0.03, (p) => sdCone(p, v(0, 1.8, -0.005), v(0, 1.94, 0.012), 0.05, 0.046));
    part('skin', 'head', 0.03, (p) => sdEllipsoid(p, v(0, 2.012, -0.012), v(0.096, 0.108, 0.106)));      // 頭蓋
    part('skin', 'head', 0.035, (p) => sdEllipsoid(p, v(0, 1.95, 0.03), v(0.072, 0.074, 0.078)));       // 顔と顎
    part('skin', 'head', 0.02, (p) => sdEllipsoid(p, v(0, 1.915, 0.055), v(0.04, 0.035, 0.045)));       // 顎先
    [-1, 1].forEach((s) => part('skin', 'head', 0.02, (p) => sdEllipsoid(p, v(s * 0.05, 1.975, 0.07), v(0.03, 0.022, 0.025))));  // 頬骨
    part('skin', 'head', 0.012, (p) => sdCone(p, v(-0.045, 2.02, 0.088), v(0.045, 2.02, 0.088), 0.014, 0.014));  // 眉の稜線
    part('skin', 'head', 0.01, (p) => sdCone(p, v(0, 2.005, 0.1), v(0, 1.968, 0.116), 0.012, 0.017));            // 鼻
    [-1, 1].forEach((s) => part('skin', 'head', 0.015, (p) => sdEllipsoid(p, v(s * 0.097, 1.99, -0.004), v(0.016, 0.028, 0.02))));  // 耳
    // 目のくぼみと口（削る）
    [-1, 1].forEach((s) => carve.push({ k: 0.012, d: (p) => sdEllipsoid(p, v(s * 0.034, 1.997, 0.098), v(0.02, 0.012, 0.014)) }));
    carve.push({ k: 0.006, d: (p) => sdBox(p, v(0, 1.94, 0.105), v(0.022, 0.0025, 0.01), 0.002) });
    // 面頬と、荒れた長い髪（後半に笠が飛ぶと見える）
    part('mask', 'head', 0.012, (p) => sdEllipsoid(p, v(0, 1.945, 0.05), v(0.08, 0.06, 0.07)));
    part('mask', 'head', 0.006, (p) => sdCone(p, v(0, 1.985, 0.112), v(0, 1.95, 0.13), 0.014, 0.02));
    part('hair', 'head', 0.03, (p) => sdEllipsoid(p, v(0, 2.035, -0.03), v(0.108, 0.1, 0.112)) - 0.004 * Math.sin(p[0] * 160) * Math.sin(p[1] * 140));
    part('hair', 'head', 0.04, (p) => sdCone(p, v(0, 2.0, -0.08), v(0, 1.78, -0.13), 0.07, 0.035));
  } else {
    // ── 主人公（docs/21-wafuku-cool.md）：布の面と線、なで肩と長い首、小さく若い顔、清潔な黒髪 ──
    // なで肩：肩の線を低く細く
    part('kimono', 'chest', 0.05, (p) => sdCone(p, v(-0.17, 1.728, -0.005), v(0.17, 1.728, -0.005), 0.056, 0.056));
    // 襟：V字に深く合わせた着物の襟と、その内側の白い襟
    [-1, 1].forEach((s) => {
      const a0 = v(s * 0.062, 1.845, 0.05), a1 = v(s * -0.012, 1.42, 0.13), bL = basisFrom(sub(a1, a0), v(1, 0, 0));
      part('eri', 'chest', 0.008, (p) => sdBox(p, mul(add(a0, a1), 0.5), v(0.024, len(sub(a1, a0)) / 2, 0.012), 0.008, bL));
      const c0 = v(s * 0.045, 1.855, 0.045), c1 = v(s * -0.004, 1.5, 0.126), bC = basisFrom(sub(c1, c0), v(1, 0, 0));
      part('white', 'chest', 0.006, (p) => sdBox(p, mul(add(c0, c1), 0.5), v(0.012, len(sub(c1, c0)) / 2, 0.012), 0.005, bC));
    });
    // 長く細い首
    part('skin', 'neck', 0.03, (p) => sdCone(p, v(0, 1.78, -0.01), v(0, 1.95, 0.008), 0.044, 0.04));
    // 小さく整った頭：頭蓋、細い顎（V字）、小さな顎先。頬骨や眉の稜線は付けず、彫らない
    part('skin', 'head', 0.03, (p) => sdEllipsoid(p, v(0, 2.01, -0.012), v(0.086, 0.098, 0.096)));
    part('skin', 'head', 0.035, (p) => sdEllipsoid(p, v(0, 1.958, 0.022), v(0.06, 0.066, 0.07)));
    part('skin', 'head', 0.02, (p) => sdEllipsoid(p, v(0, 1.908, 0.05), v(0.024, 0.022, 0.028)));
    part('skin', 'head', 0.006, (p) => sdCone(p, v(0, 1.995, 0.09), v(0, 1.966, 0.1), 0.006, 0.008));            // 通った鼻筋（小さく）
    [-1, 1].forEach((s) => part('skin', 'head', 0.012, (p) => sdEllipsoid(p, v(s * 0.086, 1.985, -0.006), v(0.012, 0.022, 0.016))));  // 耳
    // 目と眉は、焼き出す頂点の細かさでは描けないので、実行時に顔の上へ描いた絵を重ねる（index.html の faceDecal）
    // 髪：頭全体を包む黒髪（額と耳の前は空ける）
    part('hair', 'head', 0.012, (p) => Math.max(
      sdEllipsoid(p, v(0, 2.018, -0.016), v(0.094, 0.104, 0.104)),
      Math.min(p[2] - 0.035, 2.035 - p[1]),         // 額を空ける
      Math.min(p[2] + 0.02, 1.965 - p[1]),          // 耳の前を空ける
      1.925 - p[1]));                               // 襟足
    // 前髪：中央で分け、両脇の髪が顔を縁取る
    [-1, 1].forEach((s) => {
      part('hair', 'head', 0.01, (p) => sdCone(p, v(s * 0.012, 2.09, 0.06), v(s * 0.055, 2.03, 0.09), 0.016, 0.007));
      part('hair', 'head', 0.01, (p) => sdCone(p, v(s * 0.07, 2.06, 0.05), v(s * 0.074, 1.93, 0.06), 0.016, 0.006));
    });
    // 高く結った髪の根元（ここから下は動きでなびく）
    part('hair', 'head', 0.016, (p) => sdCone(p, v(0, 2.1, -0.07), v(0, 2.09, -0.125), 0.032, 0.03));
    // 深紅の鉢巻は実行時に細い帯として付ける（焼き出す頂点では細い帯がでこぼこになる）

    // 羽織：肩から真っ直ぐ落ちる白い布。前は開き、開いた縁に深紅の裏地がのぞく。
    const front = (p) => Math.max(Math.abs(p[0]) - 0.1, 0.04 - p[2]);        // 前の開き（これを切り抜く）
    const neckHole = (p) => Math.max(Math.hypot(p[0], p[2] * 1.15) - 0.1, 1.72 - p[1]);
    // 肩幅から腰へわずかにすぼまる直線の身頃。裾は袴の上へ少し広がる
    const haoriBody = (p) => {
      const t = clamp((1.76 - p[1]) / 0.76, 0, 1);
      const d = smin(sdEllipsoid(p, v(0, 1.725, -0.01), v(0.275, 0.115, 0.155)), sdBox(p, v(0, 1.38, -0.012), v(0.232 - t * 0.03 + Math.max(0, 1.18 - p[1]) * 0.2, 0.38, 0.15 - t * 0.012 + Math.max(0, 1.18 - p[1]) * 0.35), 0.065), 0.05);
      return d;
    };
    part('haori', 'chest', 0.02, (p) => Math.max(haoriBody(p), -front(p), -neckHole(p), 1.3 - p[1]));
    part('haori', 'waist', 0.003, (p) => Math.max(haoriBody(p), -front(p), 1.0 - p[1], p[1] - 1.34));
    [-1, 1].forEach((s) => {
      // 開いた縁の深紅（裏地が返っている）と、肩から前へ回る羽織の襟
      part('lining', 'chest', 0.003, (p) => sdBox(p, v(s * 0.108, 1.37, 0.13), v(0.008, 0.36, 0.012), 0.008, basisFrom(v(s * 0.08, 1, 0.06), v(1, 0, 0))));
      part('haori', 'chest', 0.01, (p) => sdCone(p, v(s * 0.075, 1.82, -0.02), v(s * 0.11, 1.72, 0.12), 0.02, 0.022));
    });
  }

  // 帯、帯の結び目（主人公は帯を高く締めて腰高に見せる）
  const obiY = big ? 1.17 : 1.235, obiH = big ? 0.045 : 0.036;
  part('sash', 'hips', 0.012, (p) => { const q = sub(p, v(0, obiY, 0)); const r = len([q[0], 0, q[2] / 0.8]); return Math.max(r - (big ? 0.195 * 1.06 : 0.178), Math.abs(q[1]) - obiH); });
  if (big) [-1, 1].forEach((s) => part('sash', 'hips', 0.015, (p) => sdEllipsoid(p, v(s * 0.05, 1.17, -0.165), v(0.065, 0.04, 0.03))));
  // 袴：腰の上部（ひだ）。主人公は帯のすぐ下から、ひだを立てて真っ直ぐ落とす
  const skirtTop = big ? 1.17 : obiY - 0.01, skirtBot = big ? 0.12 : 1.0, skirtR0 = big ? 0.19 * 1.06 : 0.165, skirtR1 = big ? 0.42 : 0.185;
  part('hakama', 'hips', 0.03, (p) => {
    const t = clamp((skirtTop - p[1]) / (skirtTop - skirtBot), 0, 1);
    const r = lerp(skirtR0, skirtR1, big ? t : Math.sqrt(t)) * (1 + pleat(p, v(0, 0, 0), v(0, 1, 0), big ? 7 : 9, (big ? 0.06 : 0.045) * t));
    const q = [p[0], 0, p[2] / 0.86];
    const radial = len(q) - r;
    const vertical = Math.max(p[1] - skirtTop, skirtBot - p[1]);
    return Math.max(radial, vertical);
  });
  part('hakama', 'hips', 0.04, (p) => sdEllipsoid(p, v(0, 1.08, 0), big ? v(0.17 * sw, 0.11, 0.125) : v(0.16, 0.1, 0.115)));

  // 脚
  ['R', 'L'].forEach((s) => {
    const Pj = J['P' + s], K = J['K' + s], A = J['A' + s];
    const th = 'thigh' + s, sh = 'shin' + s, ft = 'foot' + s;
    if (big) {
      // 裾の広い袴に覆われた脚
      part('hakama', th, 0.05, (p) => sdCone(p, Pj, K, 0.13, 0.15) - pleat(p, Pj, norm(sub(K, Pj)), 5, 0.012));
      part('hakama', sh, 0.05, (p) => sdCone(p, K, add(A, v(0, 0.02, 0)), 0.15, 0.2) - pleat(p, K, norm(sub(A, K)), 5, 0.02));
    } else {
      // 足首まで真っ直ぐ落ちる袴（ひだ）。裾はわずかに広がる
      part('hakama', th, 0.03, (p) => sdCone(p, Pj, K, 0.098, 0.125) - pleat(p, Pj, norm(sub(K, Pj)), 6, 0.014));
      part('hakama', sh, 0.03, (p) => sdCone(p, K, add(A, v(0, 0.03, 0)), 0.125, 0.155) - pleat(p, K, norm(sub(A, K)), 6, 0.022));
    }
    if (big) part('wrap', sh, 0.015, (p) => sdEllipsoid(p, A, v(0.042, 0.045, 0.042)));
    // 足袋と草鞋
    part('tabi', ft, 0.02, (p) => sdEllipsoid(p, add(A, v(0, -0.04, 0.06)), v(0.048, 0.034, 0.115)));
    part('tabi', ft, 0.012, (p) => sdEllipsoid(p, add(A, v(0, -0.052, 0.155)), v(0.04, 0.024, 0.04)));
    part('sandal', ft, 0.004, (p) => sdBox(p, add(A, v(0, -0.075, 0.07)), v(0.052, 0.008, 0.14), 0.006));
    part('strap', ft, 0.003, (p) => sdCone(p, add(A, v(-0.04, -0.06, 0.05)), add(A, v(0.0, -0.035, 0.13)), 0.006, 0.006));
    part('strap', ft, 0.003, (p) => sdCone(p, add(A, v(0.04, -0.06, 0.05)), add(A, v(0.0, -0.035, 0.13)), 0.006, 0.006));
  });

  // 腕
  ['R', 'L'].forEach((s) => {
    const S = J['S' + s], E = J['E' + s], WR = J['WR' + s], dir = J['dir' + s];
    const ua = 'upperArm' + s, fa = 'foreArm' + s, hd = 'hand' + s;
    const side = v(0, 0, 1), bA = basisFrom(dir, side);
    part('kimono', ua, 0.04, (p) => sdEllipsoid(p, S, mul(v(1, 1, 1), big ? 0.078 * lw : 0.045)));                    // 三角筋
    if (big) {
      // 広い袖（腕に沿って垂れる）
      part('kimono', ua, 0.05, (p) => sdCone(p, add(S, mul(dir, 0.04)), add(E, mul(dir, 0.16)), 0.085, 0.17) - 0.004 * Math.sin(dot(sub(p, S), bA[0]) * 60));
      part('kimono', fa, 0.03, (p) => sdCone(p, E, add(WR, mul(dir, -0.04)), 0.054 * lw, 0.04 * lw));
    } else {
      // 着物の細い袖と、その上に羽織の四角い大きな袖（腕から下へ垂れる）
      part('kimono', ua, 0.03, (p) => sdCone(p, add(S, mul(dir, 0.04)), E, 0.05, 0.045));
      part('kimono', fa, 0.025, (p) => sdCone(p, E, add(WR, mul(dir, -0.02)), 0.05, 0.04));
      // 羽織の袖：腕から下へ大きく垂れる平らな四角い布。肘をまたいで二の腕と前腕に分け、袖口は深紅
      const hang = norm(sub(v(0, -1, 0), mul(dir, dot(v(0, -1, 0), dir))));      // 腕に垂直で下向き
      const bS = [cross(dir, hang), dir, hang];
      const sleeve = (c0, c1, open) => (p) => {
        const c = mul(add(c0, c1), 0.5), q = sub(p, c), along = dot(q, dir), half = len(sub(c1, c0)) / 2;
        let d = sdBox(p, add(c, mul(hang, 0.045)), v(0.076, half, 0.122), 0.03, bS);
        if (open) d = Math.max(d, -sdBox(p, add(c1, mul(hang, 0.05)), v(0.042, 0.04, 0.09), 0.015, bS));
        return d;
      };
      part('haori', ua, 0.02, sleeve(add(S, mul(dir, 0.03)), add(E, mul(dir, 0.02)), false));
      part('haori', fa, 0.02, sleeve(add(E, mul(dir, 0.0)), add(WR, mul(dir, -0.03)), true));
      part('lining', fa, 0.003, (p) => { const c = add(add(WR, mul(dir, -0.03)), mul(hang, 0.05)); return Math.max(Math.abs(dot(sub(p, c), dir)) - 0.008, sdBox(p, c, v(0.062, 0.2, 0.112), 0.03, bS), -sdBox(p, c, v(0.045, 0.2, 0.093), 0.015, bS)); });
    }
    part('skin', fa, 0.015, (p) => sdEllipsoid(p, WR, v(0.033, 0.03, 0.03)));
    // 手：柄を握った拳（握る軸は前向き）。手のひら、指の節、親指
    const F = add(WR, mul(dir, 0.065));
    const bH = basisFrom(dir, v(0, 0, 1));
    const handM = 'skin';
    part(handM, hd, 0.018, (p) => sdBox(p, add(WR, mul(dir, 0.045)), v(0.022, 0.045, 0.04), 0.018, bH));
    part(handM, hd, 0.012, (p) => {   // 握った四本の指：握る軸（前向き）に沿って並ぶ
      const q = sub(p, F); const ql = [dot(q, bH[0]), dot(q, bH[1]), dot(q, bH[2])];
      const ring = Math.hypot(ql[0] + 0.012, ql[1] - 0.01) - 0.03;   // 柄のまわりを巻く指の輪
      return Math.max(Math.abs(ring) - 0.013, Math.abs(ql[2]) - 0.042) - 0.0015 * Math.cos(ql[2] * 150);
    });
    part(handM, hd, 0.01, (p) => sdCone(p, add(F, add(mul(bH[0], -0.03), mul(bH[2], 0.03))), add(F, add(mul(bH[0], 0.0), mul(bH[2], 0.05))), 0.013, 0.011));   // 親指
  });

  if (big) {
    // 肩衣：肩から横に張り出した硬い布。縁取り。
    [-1, 1].forEach((s) => {
      const c = v(s * 0.33, 1.79, 0), bW = [norm(v(Math.cos(0.2), s * Math.sin(0.2), 0)), norm(v(-s * Math.sin(0.2), Math.cos(0.2), 0)), v(0, 0, 1)];
      part('kataginu', 'chest', 0.02, (p) => sdBox(p, c, v(0.17, 0.012, 0.13), 0.008, bW));
      part('lapel', 'chest', 0.004, (p) => sdBox(p, add(c, v(0, 0, 0.128)), v(0.17, 0.013, 0.006), 0.004, bW));
    });
  }

  return { parts: P, carve, paint, bones, J };
}

// 素材の色（見た目どおりの色）。陰影は後で焼き込む。
const PALETTE = {
  // 主人公：黒に近い藍、白、灰。差し色は深紅だけ（docs/21-wafuku-cool.md）
  player: { kimono: '#1a2233', eri: '#0f1520', white: '#eef0f3', skin: '#dcb79c', hair: '#0a0b0f', eye: '#14100f', haori: '#b9bec8', lining: '#a3172b', accent: '#b3182c', sash: '#2b303c', hakama: '#565b66', tabi: '#eceef2', sandal: '#24252b', strap: '#1a1b20' },
  enemy: { coat: '#2b303a', steel: '#8d99ab', glove: '#1a1c22', stubble: '#6f5c4e', kimono: '#2a2433', hakama: '#3b3541', skin: '#6e5a52', sash: '#d2c08f', lapel: '#d2c08f', white: '#d9d4c8', wrap: '#5b5560', tabi: '#d4d6dc', sandal: '#6e5f45', strap: '#3a2f24', hair: '#0d0f14', tasuki: '#d2c08f', mask: '#5a1a1c', kataginu: '#231e2b' },
};

function bake(kind, cell) {
  const S = sculpt(kind);
  const parts = S.parts, carve = S.carve, paint = S.paint;
  // 距離と、一番近い部品
  function field(p) {
    let d = 1e9, best = -1, bestRaw = 1e9;
    for (let i = 0; i < parts.length; i++) {
      const di = parts[i].d(p);
      if (di < bestRaw) { bestRaw = di; best = i; }
      d = d > 1e8 ? di : smin(d, di, parts[i].k);
    }
    for (const c of carve) d = smax(d, -c.d(p), c.k);
    return { d, best, raw: bestRaw };
  }
  const dist = (p) => field(p).d;

  // 範囲
  const bx = kind === 'enemy' ? 0.66 : 0.6, bz = kind === 'enemy' ? 0.5 : 0.42;
  const min = [-bx, -0.02, -bz], max = [bx, 2.26, bz];
  const nx = Math.ceil((max[0] - min[0]) / cell), ny = Math.ceil((max[1] - min[1]) / cell), nz = Math.ceil((max[2] - min[2]) / cell);
  const at = (i, j, k) => [min[0] + i * cell, min[1] + j * cell, min[2] + k * cell];
  const idx = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
  const val = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  const t0 = Date.now();
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) val[idx(i, j, k)] = dist(at(i, j, k));
  console.log(`${kind}: sampled ${nx}x${ny}x${nz} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Surface Nets：符号が変わる格子に頂点を一つ置き、辺ごとに四角形を張る
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const verts = [];
  const cidx = (i, j, k) => (k * ny + j) * nx + i;
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const vals = corners.map(([a, b, c]) => val[idx(i + a, j + b, k + c)]);
    let pos = 0, neg = 0;
    for (const x of vals) { if (x < 0) neg++; else pos++; }
    if (!pos || !neg) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const va = vals[a], vb = vals[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const ca = corners[a], cb = corners[b];
      sx += ca[0] + (cb[0] - ca[0]) * t; sy += ca[1] + (cb[1] - ca[1]) * t; sz += ca[2] + (cb[2] - ca[2]) * t; n++;
    }
    let p = [min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell];
    cellVert[cidx(i, j, k)] = verts.length;
    verts.push(p);
  }
  const quads = [];
  // 面の表を外側へ向ける
  const pushQuad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) quads.push([a, b, c, d]); else quads.push([a, d, c, b]); };
  for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
    const v0 = val[idx(i, j, k)];
    // x 方向の辺
    if (i < nx) { const v1 = val[idx(i + 1, j, k)]; if ((v0 < 0) !== (v1 < 0)) pushQuad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], v0 < 0); }
    if (j < ny) { const v1 = val[idx(i, j + 1, k)]; if ((v0 < 0) !== (v1 < 0)) pushQuad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], v0 < 0); }
    if (k < nz) { const v1 = val[idx(i, j, k + 1)]; if ((v0 < 0) !== (v1 < 0)) pushQuad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], v0 < 0); }
  }

  // 頂点を表面へ寄せ、法線（距離の勾配）、素材、陰影、皮の重み
  const e = cell * 0.25;
  const grad = (p) => norm([dist(add(p, v(e, 0, 0))) - dist(add(p, v(-e, 0, 0))), dist(add(p, v(0, e, 0))) - dist(add(p, v(0, -e, 0))), dist(add(p, v(0, 0, e))) - dist(add(p, v(0, 0, -e)))]);
  const pal = PALETTE[kind];
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const bones = S.bones;
  const children = bones.map((_, i) => bones.map((b, j) => (b[1] === i ? j : -1)).filter((x) => x >= 0));
  const segDist = (p, b) => { const a = b[2], c = b[3]; const ba = sub(c, a), pa = sub(p, a); const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1); return len(sub(pa, mul(ba, h))); };
  const out = { pos: [], nor: [], col: [], si: [], sw: [] };
  for (let vi = 0; vi < verts.length; vi++) {
    let p = verts[vi];
    for (let it = 0; it < 2; it++) { const d = dist(p); const g = grad(p); p = sub(p, mul(g, d)); }
    const n = grad(p);
    const f = field(p);
    const part0 = parts[f.best];
    // 環境遮蔽：法線の方向へ少しずつ進み、どれだけ他の面に近いかを見る
    let occ = 0, wsum = 0;
    [0.012, 0.03, 0.06, 0.1].forEach((h, i) => { const w = 1 / (i + 1); occ += w * clamp((h - dist(add(p, mul(n, h)))) / h, 0, 1); wsum += w; });
    // 陰の焼き込みは弱く（強いと汚れに見える）。肌はさらに弱く。
    const ao = clamp(1 - occ / wsum * 0.8, part0.m === 'skin' ? 0.8 : 0.55, 1);
    let c = [0, 0, 0], cw = 0;
    for (let i = 0; i < parts.length; i++) {
      const di = parts[i].d(p); const w = Math.exp(-(di - f.raw) / 0.0025);
      if (w < 0.01) continue;
      const ci = hex(pal[parts[i].m] || '#ff00ff'); c = [c[0] + ci[0] * w, c[1] + ci[1] * w, c[2] + ci[2] * w]; cw += w;
    }
    c = c.map((x) => x / cw);
    // 色で描く部分（目、眉）
    for (const q of paint) { const w = clamp(0.5 - q.d(p) / 0.003, 0, 1); if (w > 0) { const ci = hex(pal[q.m]); c = c.map((x, a) => lerp(x, ci[a], w)); } }
    c = c.map((x) => clamp(x * ao, 0, 1));
    // 皮の重み：一番近い部品の骨と、その親・子の骨の間で、骨からの距離に応じて滑らかに分ける
    const b0 = part0.b;
    const cand = [b0, bones[b0][1], ...children[b0]].filter((x) => x >= 0);
    const sigma = 0.055;
    // 腰から垂れる袴は、腰について行き、脚にはわずかに引かれるだけにする（板のように振り上がらないように）
    const skirt = part0.m === 'hakama' && b0 === BONE.hips;
    let ws;
    if (skirt) {
      // 袴の裾：上は腰に、下へ行くほど「垂れる骨」に。脚にはわずかに引かれる。
      const hang = clamp((1.1 - p[1]) / 0.7, 0, 1);
      const leg = p[0] < 0 ? BONE.thighR : BONE.thighL;
      ws = [[BONE.hips, 1 - hang * 0.85], [BONE.skirt, hang * 0.85 * 0.8], [leg, hang * 0.85 * 0.2]];
    } else {
      ws = cand.filter((b) => b !== BONE.skirt).map((b) => [b, Math.exp(-Math.pow(segDist(p, bones[b]), 2) / (2 * sigma * sigma)) * (b === b0 ? 1.6 : 1)]);
    }
    ws.sort((a, b) => b[1] - a[1]); ws = ws.slice(0, 4);
    const tot = ws.reduce((s, x) => s + x[1], 0) || 1;
    while (ws.length < 4) ws.push([0, 0]);
    out.pos.push(...p); out.nor.push(...n); out.col.push(...c);
    out.si.push(...ws.map((x) => x[0])); out.sw.push(...ws.map((x) => x[1] / tot));
  }
  const tris = [];
  for (const q of quads) { tris.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
  console.log(`${kind}: ${verts.length} vertices, ${tris.length / 3} triangles, total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { out, tris, bones, min, max, J: S.J };
}

// 圧縮：位置は範囲内の16ビット、法線は8ビット、色は8ビット、重みは8ビット
function pack(kind, cell) {
  const B = bake(kind, cell);
  const n = B.out.pos.length / 3;
  const pos = new Uint16Array(n * 3), nor = new Int8Array(n * 3), col = new Uint8Array(n * 3), si = new Uint8Array(n * 4), sw = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      pos[i * 3 + a] = Math.round(clamp((B.out.pos[i * 3 + a] - B.min[a]) / (B.max[a] - B.min[a]), 0, 1) * 65535);
      nor[i * 3 + a] = Math.round(clamp(B.out.nor[i * 3 + a], -1, 1) * 127);
      col[i * 3 + a] = Math.round(B.out.col[i * 3 + a] * 255);
    }
    let s = 0;
    for (let a = 0; a < 4; a++) { si[i * 4 + a] = B.out.si[i * 4 + a]; sw[i * 4 + a] = Math.round(B.out.sw[i * 4 + a] * 255); s += sw[i * 4 + a]; }
    sw[i * 4] += 255 - s;
  }
  const idx = n < 65536 ? new Uint16Array(B.tris) : new Uint32Array(B.tris);
  const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
  return {
    min: B.min, max: B.max, n, wide: n >= 65536,
    bones: B.bones.map(([name, parent, at]) => ({ name, parent, at: at.map((x) => +x.toFixed(4)) })),
    pos: b64(pos), nor: b64(nor), col: b64(col), si: b64(si), sw: b64(sw), idx: b64(idx),
  };
}

const CELL_SIZE = +(process.argv[2] || 0.014);
const data = { player: pack('player', CELL_SIZE), enemy: pack('enemy', CELL_SIZE) };
const js = 'window.CLEF_CHARS = ' + JSON.stringify(data) + ';';
const target = path.join(__dirname, '..', 'prototype', 'kaeshi', 'index.html');
let html = fs.readFileSync(target, 'utf8');
const A = '<script id="clef-chars">', Bm = '</script><!-- /clef-chars -->';
if (html.includes(A)) html = html.slice(0, html.indexOf(A)) + A + js + Bm + html.slice(html.indexOf(Bm) + Bm.length);
else html = html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', A + js + Bm + '\n<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>');
fs.writeFileSync(target, html);
console.log('embedded', (js.length / 1024).toFixed(0), 'KB into', path.relative(process.cwd(), target));
