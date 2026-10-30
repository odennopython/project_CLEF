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

// ───────── 人物の彫刻（docs/23-visual-v2.md） ─────────
// アニメ調（ゼルダの伝説のような、丸くすっきりした形と、はっきりした色の面）。ただし細部まで作り込む。
// 部品：{ d(p) → 距離, m: 素材, b: 骨, k: 馴染ませる量, h: 頭の細かい面に入れるか }
// 硬い物（笠、縄の帯、鞘、鎧の板、弓）は焼き出さず、実行時に形として付ける（index.html）。
function sculpt(kind) {
  const big = kind === 'enemy';
  const sw = big ? 1.14 : 1.0;
  const { J, bones } = skeleton(sw);
  const P = [];
  let headPart = false;
  const part = (m, b, k, d) => P.push({ m, b: BONE[b], k, d, h: headPart });
  const pleat = (p, axisPt, axisDir, n, amp) => {   // 軸のまわりの、折り目の立ったひだ
    const q = sub(p, axisPt), t = dot(q, axisDir), r = sub(q, mul(axisDir, t));
    const f = Math.atan2(r[2], r[0]) * n / Math.PI; return amp * (1 - Math.abs(2 * (f - Math.floor(f)) - 1));
  };
  // 髪の房：根元から中ほど、中ほどから毛先へ、二本の先細りの棒
  const clump = (m, a, b2, c, r0) => part(m, 'head', 0.022, (p) => smin(sdCone(p, a, b2, r0, r0 * 0.62), sdCone(p, b2, c, r0 * 0.62, 0.002), 0.01));

  // ── 頭（細かい面） ──
  headPart = true;
  part('skin', 'neck', 0.03, (p) => Math.max(sdCone(p, v(0, 1.74, -0.008), v(0, 1.95, 0.0), big ? 0.05 : 0.044, big ? 0.046 : 0.04), 1.76 - p[1]));
  // 丸い頭蓋と、丸い頬、小さく尖った顎。鼻はごく小さく、口や目は形にせず絵で描く
  part('skin', 'head', 0.03, (p) => sdEllipsoid(p, v(0, 2.02, -0.012), big ? v(0.094, 0.104, 0.104) : v(0.097, 0.105, 0.103)));
  part('skin', 'head', 0.04, (p) => sdEllipsoid(p, v(0, 1.962, 0.022), big ? v(0.068, 0.074, 0.074) : v(0.07, 0.072, 0.074)));
  part('skin', 'head', 0.03, (p) => sdEllipsoid(p, v(0, 1.91, 0.044), big ? v(0.036, 0.03, 0.032) : v(0.03, 0.026, 0.03)));
  part('skin', 'head', 0.008, (p) => sdCone(p, v(0, 1.99, 0.094), v(0, 1.966, 0.102), 0.006, big ? 0.009 : 0.008));
  [-1, 1].forEach((s) => part('skin', 'head', 0.012, (p) => sdEllipsoid(p, v(s * 0.094, 1.985, -0.006), v(0.012, 0.024, 0.017))));
  // 髪：頭を包む髪（額と耳の前を空ける）
  // 相手は額を広く出し、生え際は中央が下がる（富士額）。髪は後ろへ撫でつけた筋
  const hairline = (p) => big ? 2.085 - 0.0 + Math.abs(p[0]) * 0.25 - 0.012 * Math.exp(-p[0] * p[0] / 0.0004) : 2.05;
  const capCut = (p) => Math.max(Math.min(p[2] - (big ? 0.0 : 0.02), hairline(p) - p[1]), Math.min(p[2] + 0.035, 1.975 - p[1]));
  const strands = (p) => big ? 0.0016 * Math.sin(p[0] * 260 + Math.sin(p[2] * 40) * 2) : 0;
  part('hair', 'head', 0.014, (p) => Math.max(sdEllipsoid(p, v(0, 2.038, -0.02), big ? v(0.1, 0.108, 0.109) : v(0.107, 0.112, 0.113)) + strands(p), capCut(p), (big ? 1.93 : 1.9) - p[1]));
  if (!big) {
    // 主人公：額に落ちる前髪の房、顔の両脇を顎まで縁取る長い房、後ろへ跳ねる房
    [[-0.055, 0.0], [-0.02, 0.012], [0.02, 0.01], [0.055, 0.0]].forEach(([x, dz]) => clump('hair', v(x * 0.8, 2.1, 0.06), v(x, 2.06, 0.1 + dz), v(x * 1.15, 2.0, 0.105 + dz), 0.024));
    [-1, 1].forEach((s) => {
      clump('hair', v(s * 0.07, 2.08, 0.05), v(s * 0.088, 2.0, 0.075), v(s * 0.074, 1.9, 0.07), 0.022);
      clump('hair', v(s * 0.095, 2.06, 0.0), v(s * 0.108, 1.98, 0.01), v(s * 0.1, 1.9, -0.01), 0.02);
    });
    [[0, 2.07, -0.225], [-0.075, 2.05, -0.2], [0.075, 2.05, -0.2], [-0.115, 1.99, -0.165], [0.115, 1.99, -0.165], [-0.04, 1.97, -0.21], [0.04, 1.97, -0.21]].forEach(([x, y, z]) =>
      clump('hair', v(x * 0.35, 2.06, -0.06), v(x * 0.7, (2.06 + y) / 2 + 0.01, (z - 0.06) / 2 - 0.02), v(x, y, z), 0.032));
  } else {
    // 相手：額を出し、髪をきつく後ろへ引いて、頭の上で高く結う（結った先は動きでなびく）。こめかみに一筋
    part('hair', 'head', 0.012, (p) => sdCone(p, v(0, 2.1, -0.07), v(0, 2.13, -0.11), 0.038, 0.03));
    part('accent', 'head', 0.004, (p) => sdCone(p, v(0, 2.123, -0.098), v(0, 2.14, -0.125), 0.033, 0.029));
    [-1, 1].forEach((s) => clump('hair', v(s * 0.08, 2.06, 0.04), v(s * 0.09, 1.99, 0.06), v(s * 0.084, 1.92, 0.05), 0.012));
  }
  headPart = false;

  // ── 体（粗い面） ──
  part('skin', 'neck', 0.03, (p) => Math.max(sdCone(p, v(0, 1.74, -0.008), v(0, 1.95, 0.0), big ? 0.05 : 0.044, big ? 0.046 : 0.04), p[1] - 1.84));
  const torso = (p, g) => smin(smin(smin(
    sdEllipsoid(p, v(0, 1.27, 0), v(0.148 * sw + g, 0.15 + g, 0.112 + g)),
    sdEllipsoid(p, v(0, 1.5, 0.004), v(0.185 * sw + g, 0.2 + g, 0.126 + g)), 0.06),
    sdEllipsoid(p, v(0, 1.64, 0.02), v(0.2 * sw + g, 0.11 + g, 0.116 + g)), 0.05),
    sdCone(p, v(-0.18 * sw, 1.735, -0.005), v(0.18 * sw, 1.735, -0.005), 0.058 + g, 0.058 + g), 0.05);
  if (!big) {
    // 主人公：大きく開いた襟の着物。胸がV字にのぞき、厚く折り返した襟が縁取る
    part('skin', 'chest', 0.03, (p) => sdEllipsoid(p, v(0, 1.58, 0.02), v(0.15, 0.18, 0.11)));
    const vw = (y) => 0.01 + (y - 1.36) * 0.3;
    const vcut = (p) => Math.max(Math.abs(p[0]) - vw(p[1]), 1.36 - p[1], 0.0 - p[2]);
    part('kimono', 'chest', 0.02, (p) => Math.max(torso(p, 0.006), -vcut(p)));
    [-1, 1].forEach((s) => {
      const a0 = v(s * 0.02, 1.37, 0.125), a1 = v(s * 0.13, 1.79, 0.05), bL = basisFrom(sub(a1, a0), v(0, 0, 1));
      part('eri', 'chest', 0.01, (p) => sdBox(p, mul(add(a0, a1), 0.5), v(0.02, len(sub(a1, a0)) / 2, 0.018), 0.014, [bL[0], bL[1], bL[2]]));
    });
    part('eri', 'chest', 0.012, (p) => { const q = sub(p, v(0, 1.8, -0.01)); return Math.max(Math.abs(Math.hypot(q[0], q[2] * 1.2) - 0.075) - 0.018, Math.abs(q[1]) - 0.03, q[2] - 0.02); });
    // 黒い羽織：肩から真っ直ぐ落ち、前は広く開く。裾は袴の上で少し広がる
    const front = (p) => Math.max(Math.abs(p[0]) - 0.135, 0.04 - p[2]);
    const neckHole = (p) => Math.max(Math.hypot(p[0], p[2] * 1.15) - 0.105, 1.7 - p[1]);
    const haoriBody = (p) => {
      const t = clamp((1.76 - p[1]) / 0.76, 0, 1), fl = Math.max(0, 1.18 - p[1]);
      return smin(sdEllipsoid(p, v(0, 1.725, -0.01), v(0.278, 0.115, 0.158)), sdBox(p, v(0, 1.38, -0.012), v(0.236 - t * 0.03 + fl * 0.2, 0.38, 0.154 - t * 0.012 + fl * 0.35), 0.065), 0.05);
    };
    part('haori', 'chest', 0.02, (p) => Math.max(haoriBody(p), -front(p), -neckHole(p), 1.3 - p[1]));
    part('haori', 'waist', 0.003, (p) => Math.max(haoriBody(p), -front(p), 1.0 - p[1], p[1] - 1.34));
    [-1, 1].forEach((s) => {
      // 羽織の襟（前の縁を下まで）と、返った裏地の細い線
      part('haoriEri', 'chest', 0.006, (p) => sdBox(p, v(s * 0.15, 1.36, 0.14), v(0.018, 0.4, 0.014), 0.01, basisFrom(v(s * 0.1, 1, 0.08), v(1, 0, 0))));
      part('haoriEri', 'chest', 0.01, (p) => sdCone(p, v(s * 0.08, 1.83, -0.02), v(s * 0.15, 1.72, 0.13), 0.022, 0.022));
      part('lining', 'chest', 0.003, (p) => sdBox(p, v(s * 0.13, 1.36, 0.146), v(0.006, 0.38, 0.01), 0.005, basisFrom(v(s * 0.1, 1, 0.08), v(1, 0, 0))));
    });
    // 黒い帯（この上に、実行時に縄の帯を巻く）
    part('sash', 'hips', 0.01, (p) => { const q = sub(p, v(0, 1.205, 0)); return Math.max(Math.hypot(q[0], q[2] / 0.8) - 0.17, Math.abs(q[1]) - 0.04); });
  } else {
    // 相手：深紅の内襟を重ねた黒い着物の上に、黒漆の胴。板の継ぎ目の溝と、深紅の縅（おどし）の糸
    part('kimono', 'chest', 0.02, (p) => torso(p, 0));
    [-1, 1].forEach((s) => {
      const a0 = v(s * 0.1, 1.8, 0.09), a1 = v(s * -0.01, 1.52, 0.13), bL = basisFrom(sub(a1, a0), v(1, 0, 0));
      part('kimono', 'chest', 0.01, (p) => sdBox(p, mul(add(a0, a1), 0.5), v(0.028, len(sub(a1, a0)) / 2, 0.014), 0.009, bL));
      const c0 = v(s * 0.074, 1.81, 0.088), c1 = v(s * 0.0, 1.56, 0.128), bC = basisFrom(sub(c1, c0), v(1, 0, 0));
      part('lapel', 'chest', 0.008, (p) => sdBox(p, mul(add(c0, c1), 0.5), v(0.017, len(sub(c1, c0)) / 2, 0.013), 0.006, bC));
    });
    const doShell = (p) => {
      const ax = 0.21 * sw, az = 0.152, r = Math.hypot(p[0] / ax, p[2] / az);
      const groove = 0.004 * Math.max(0, Math.cos(p[1] * 2 * Math.PI / 0.055)) ** 8;   // 板の継ぎ目
      return (r - 1) * az + groove;
    };
    part('armor', 'chest', 0.01, (p) => Math.max(doShell(p), 1.38 - p[1], p[1] - 1.58));
    part('armor', 'waist', 0.01, (p) => Math.max(doShell(p), 1.16 - p[1], p[1] - 1.4));
    // 胸の上の板（胸板）：首の下まで
    part('armor', 'chest', 0.008, (p) => sdBox(p, v(0, 1.62, 0.115), v(0.13, 0.06, 0.02), 0.015));
    part('sash', 'hips', 0.01, (p) => { const q = sub(p, v(0, 1.15, 0)); return Math.max(Math.hypot(q[0], q[2] / 0.8) - 0.2 * 1.06, Math.abs(q[1]) - 0.035); });
  }

  // ── 袴 ──
  const skirtTop = big ? 1.17 : 1.2, skirtBot = big ? 0.12 : 1.0, skirtR0 = big ? 0.19 * 1.06 : 0.165, skirtR1 = big ? 0.42 : 0.185;
  part('hakama', 'hips', 0.03, (p) => {
    const t = clamp((skirtTop - p[1]) / (skirtTop - skirtBot), 0, 1);
    const r = lerp(skirtR0, skirtR1, big ? t : Math.sqrt(t)) * (1 + pleat(p, v(0, 0, 0), v(0, 1, 0), 9, 0.045 * t));
    return Math.max(len([p[0], 0, p[2] / 0.86]) - r, Math.max(p[1] - skirtTop, skirtBot - p[1]));
  });
  part('hakama', 'hips', 0.04, (p) => sdEllipsoid(p, v(0, 1.08, 0), big ? v(0.17 * sw, 0.11, 0.125) : v(0.16, 0.1, 0.115)));

  // ── 脚 ──
  ['R', 'L'].forEach((s) => {
    const Pj = J['P' + s], K = J['K' + s], A = J['A' + s];
    const th = 'thigh' + s, sh = 'shin' + s, ft = 'foot' + s;
    if (big) {
      part('hakama', th, 0.05, (p) => sdCone(p, Pj, K, 0.13, 0.15) - pleat(p, Pj, norm(sub(K, Pj)), 5, 0.012));
      part('hakama', sh, 0.05, (p) => sdCone(p, K, add(A, v(0, 0.02, 0)), 0.15, 0.2) - pleat(p, K, norm(sub(A, K)), 5, 0.02));
    } else {
      part('hakama', th, 0.03, (p) => sdCone(p, Pj, K, 0.098, 0.125) - pleat(p, Pj, norm(sub(K, Pj)), 5, 0.008));
      part('hakama', sh, 0.03, (p) => sdCone(p, K, add(A, v(0, 0.03, 0)), 0.125, 0.15) - pleat(p, K, norm(sub(A, K)), 5, 0.013));
    }
    part('tabi', ft, 0.02, (p) => sdEllipsoid(p, add(A, v(0, -0.04, 0.06)), v(0.048, 0.034, 0.115)));
    part('tabi', ft, 0.02, (p) => sdEllipsoid(p, add(A, v(0, 0.0, 0.0)), v(0.044, 0.05, 0.045)));
    part('tabi', ft, 0.012, (p) => sdEllipsoid(p, add(A, v(0, -0.052, 0.155)), v(0.04, 0.024, 0.04)));
    part('sandal', ft, 0.004, (p) => sdBox(p, add(A, v(0, -0.075, 0.07)), v(0.052, 0.01, 0.14), 0.006));
    part('strap', ft, 0.003, (p) => sdCone(p, add(A, v(-0.04, -0.06, 0.05)), add(A, v(0.0, -0.035, 0.13)), 0.007, 0.007));
    part('strap', ft, 0.003, (p) => sdCone(p, add(A, v(0.04, -0.06, 0.05)), add(A, v(0.0, -0.035, 0.13)), 0.007, 0.007));
  });

  // ── 腕 ──
  ['R', 'L'].forEach((s) => {
    const S = J['S' + s], E = J['E' + s], WR = J['WR' + s], dir = J['dir' + s];
    const ua = 'upperArm' + s, fa = 'foreArm' + s, hd = 'hand' + s;
    const bA = basisFrom(dir, v(0, 0, 1));
    const hang = norm(sub(v(0, -1, 0), mul(dir, dot(v(0, -1, 0), dir))));
    const bS = [cross(dir, hang), dir, hang];
    part('kimono', ua, 0.04, (p) => sdEllipsoid(p, S, mul(v(1, 1, 1), big ? 0.085 : 0.048)));
    if (big) {
      // 相手：袖は肘の上で絞り、前腕は黒漆の籠手（板を三段）
      part('kimono', ua, 0.04, (p) => sdCone(p, add(S, mul(dir, 0.04)), E, 0.08, 0.07) - 0.004 * Math.sin(dot(sub(p, S), bA[0]) * 60));
      part('kimono', fa, 0.03, (p) => sdCone(p, E, add(WR, mul(dir, -0.03)), 0.058, 0.044));
      [0.05, 0.12, 0.19].forEach((t, i) => part('armor', fa, 0.004, (p) => sdBox(p, add(add(E, mul(dir, t + 0.02)), mul(bA[2], -0.03)), v(0.05 - i * 0.004, 0.032, 0.03), 0.012, bA)));
      part('lapel', fa, 0.003, (p) => sdCone(p, add(add(E, mul(dir, 0.24)), mul(bA[0], -0.055)), add(add(E, mul(dir, 0.24)), mul(bA[0], 0.055)), 0.007, 0.007));
    } else {
      // 主人公：着物の細い袖、羽織の袖（前腕の中ほどまで、袖口は深紅）、黒い籠手（帯を巻いた筋）
      part('kimono', ua, 0.03, (p) => sdCone(p, add(S, mul(dir, 0.04)), E, 0.05, 0.045));
      const sleeve = (c0, c1, open) => (p) => {
        const c = mul(add(c0, c1), 0.5), half = len(sub(c1, c0)) / 2;
        let d = sdBox(p, add(c, mul(hang, 0.035)), v(0.07, half, 0.1), 0.03, bS);
        if (open) d = Math.max(d, -sdBox(p, add(c1, mul(hang, 0.035)), v(0.05, 0.035, 0.08), 0.015, bS));
        return d;
      };
      part('haori', ua, 0.02, sleeve(add(S, mul(dir, 0.03)), add(E, mul(dir, 0.02)), false));
      part('haori', fa, 0.02, sleeve(E, add(E, mul(dir, 0.12)), true));
      part('lining', fa, 0.003, (p) => { const c = add(add(E, mul(dir, 0.12)), mul(hang, 0.035)); return Math.max(Math.abs(dot(sub(p, c), dir)) - 0.008, sdBox(p, c, v(0.072, 0.2, 0.102), 0.03, bS), -sdBox(p, c, v(0.055, 0.2, 0.085), 0.015, bS)); });
      const band = (p) => 0.004 * Math.max(0, Math.sin(dot(sub(p, E), dir) * 150)) ** 2;
      part('guard', fa, 0.02, (p) => sdCone(p, add(E, mul(dir, 0.03)), add(WR, mul(dir, -0.01)), 0.047, 0.037) - band(p));
    }
    part('skin', fa, 0.015, (p) => sdEllipsoid(p, WR, v(0.032, 0.029, 0.029)));
    const F = add(WR, mul(dir, 0.065)), bH = basisFrom(dir, v(0, 0, 1));
    const handM = big ? 'glove' : 'skin';
    part(handM, hd, 0.018, (p) => sdBox(p, add(WR, mul(dir, 0.045)), v(0.023, 0.046, 0.041), 0.019, bH));
    part(handM, hd, 0.012, (p) => {
      const q = sub(p, F); const ql = [dot(q, bH[0]), dot(q, bH[1]), dot(q, bH[2])];
      const ring = Math.hypot(ql[0] + 0.012, ql[1] - 0.01) - 0.03;
      return Math.max(Math.abs(ring) - 0.014, Math.abs(ql[2]) - 0.043) - 0.0015 * Math.cos(ql[2] * 150);
    });
    part(handM, hd, 0.01, (p) => sdCone(p, add(F, add(mul(bH[0], -0.03), mul(bH[2], 0.03))), add(F, add(mul(bH[0], 0.0), mul(bH[2], 0.05))), 0.013, 0.011));
  });

  return { parts: P, carve: [], paint: [], bones, J };
}

// 素材の色（見た目どおりの色）。陰影は後で焼き込む。
// 主人公：黒の和装。黒は青みと赤みで描き分ける（羽織＝青みの黒、着物＝炭色、袴＝灰がかった黒）。差し色は縄の帯の紫と、羽織の裏の深紅。
// 相手：黒漆の鎧と、深紅の縅と内襟。袴は鈍い紫がかった灰。
const PALETTE = {
  player: { skin: '#f0cfb4', hair: '#1c2030', kimono: '#2c2e36', eri: '#1a1b21', haori: '#15171e', haoriEri: '#202330', lining: '#7a1424', sash: '#111216', hakama: '#262830', tabi: '#d9dce2', sandal: '#3a3128', strap: '#3d2a55', guard: '#1d1e24', glove: '#1d1e24', accent: '#7a1424' },
  enemy: { skin: '#e3bfa2', hair: '#14151b', kimono: '#1c1b21', lapel: '#8c1a26', armor: '#121318', sash: '#2a2730', hakama: '#3a3640', tabi: '#d4d6dc', sandal: '#5e5140', strap: '#2d2620', glove: '#2a2228', accent: '#8c1a26' },
};

function bake(kind, cell, region) {
  const S = sculpt(kind);
  const head = region === 'head';
  const parts = S.parts.filter((q) => !!q.h === head), carve = S.carve, paint = S.paint;
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
  // 頭は細かい格子で別に焼き出す（顔と髪の房がつぶれないように）
  const min = head ? [-0.17, 1.74, -0.27] : [-bx, -0.02, -bz], max = head ? [0.17, 2.25, 0.18] : [bx, 2.26, bz];
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
function pack(kind, cell, region) {
  const B = bake(kind, cell, region);
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
const HEAD_CELL = 0.005;
const data = { player: pack('player', CELL_SIZE), playerHead: pack('player', HEAD_CELL, 'head'), enemy: pack('enemy', CELL_SIZE), enemyHead: pack('enemy', HEAD_CELL, 'head') };
const js = 'window.CLEF_CHARS = ' + JSON.stringify(data) + ';';
const target = path.join(__dirname, '..', 'prototype', 'kaeshi', 'index.html');
let html = fs.readFileSync(target, 'utf8');
const A = '<script id="clef-chars">', Bm = '</script><!-- /clef-chars -->';
if (html.includes(A)) html = html.slice(0, html.indexOf(A)) + A + js + Bm + html.slice(html.indexOf(Bm) + Bm.length);
else html = html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', A + js + Bm + '\n<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>');
fs.writeFileSync(target, html);
console.log('embedded', (js.length / 1024).toFixed(0), 'KB into', path.relative(process.cwd(), target));
