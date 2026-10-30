// 人物を「箱からの造形」で作る（docs/25-modeled-characters.md）。
//
// 商業ゲームの人物と同じ造り：
// 1. 粗い網（ケージ）を、意図した線の流れで組む。体の部品は断面の輪をつなぐ（ロフト）
// 2. 服は体とは別の「厚みのある布の殻」。前の開き、袖口、裾には縁ができ、内側は裏地の色
// 3. Catmull-Clark で2回細分して滑らかにする。布の縁は「折り目（クリース）」としてくっきり残す
// 4. 皮の重み（どの骨にどれだけついて行くか）は、輪を作るときに直接付ける
// 頭は細かい格子の焼き出し（tools/bake_characters.js）を使う。
//
// 使い方：node tools/model_characters.js
'use strict';
const fs = require('fs');
const path = require('path');
const { skeleton, BONE, PALETTE, pack } = require('./bake_characters.js');

// ───────── ベクトル ─────────
const v = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ───────── 網 ─────────
// 頂点：{ p, c（色）, w（骨の重み {骨: 重み}）, fx（布の揺れ）, cl（布かどうか） }
function Mesh() { return { V: [], F: [], sharp: new Set() }; }
const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
function addV(M, p, a) { M.V.push({ p, c: a.c, w: a.w, fx: a.fx || 0, cl: a.cl || 0 }); return M.V.length - 1; }
// 面を足す。expect：面が向くべき向き（外側）。逆なら並びを裏返す
function addF(M, idx, expect) {
  if (expect) {
    const P = idx.map((i) => M.V[i].p);
    let n = [0, 0, 0];
    for (let i = 0; i < P.length; i++) n = add(n, cross(P[i], P[(i + 1) % P.length]));
    if (dot(n, expect) < 0) idx = idx.slice().reverse();
  }
  M.F.push(idx);
}
function markSharp(M, list) { for (let i = 0; i + 1 < list.length; i++) M.sharp.add(ek(list[i], list[i + 1])); }
function merge(target, src) {
  const off = target.V.length;
  src.V.forEach((x) => target.V.push(x));
  src.F.forEach((f) => target.F.push(f.map((i) => i + off)));
  src.sharp.forEach((k) => { const [a, b] = k.split('_').map(Number); target.sharp.add(ek(a + off, b + off)); });
}

// 骨の重みの道具
const W = (...pairs) => { const o = {}; for (let i = 0; i < pairs.length; i += 2) if (pairs[i + 1] > 1e-4) o[BONE[pairs[i]]] = (o[BONE[pairs[i]]] || 0) + pairs[i + 1]; return o; };
const blendW = (a, b, t) => { const o = {}; for (const k in a) o[k] = (o[k] || 0) + a[k] * (1 - t); for (const k in b) o[k] = (o[k] || 0) + b[k] * t; return o; };
function avgAttr(list, wts) {
  const c = [0, 0, 0], w = {}; let fx = 0, cl = 0, tot = 0;
  list.forEach((x, i) => { const k = wts ? wts[i] : 1; tot += k; c[0] += x.c[0] * k; c[1] += x.c[1] * k; c[2] += x.c[2] * k; fx += x.fx * k; cl += x.cl * k; for (const b in x.w) w[b] = (w[b] || 0) + x.w[b] * k; });
  for (const b in w) w[b] /= tot;
  return { c: mul(c, 1 / tot), w, fx: fx / tot, cl: cl / tot };
}

// ───────── Catmull-Clark 細分（折り目つき） ─────────
function subdivide(M) {
  const N = Mesh();
  const E = new Map();
  M.F.forEach((f, fi) => f.forEach((a, i) => { const b = f[(i + 1) % f.length], k = ek(a, b); if (!E.has(k)) E.set(k, { a: Math.min(a, b), b: Math.max(a, b), faces: [] }); E.get(k).faces.push(fi); }));
  // 面の点
  const fp = M.F.map((f) => { const P = f.map((i) => M.V[i]); const p = mul(P.reduce((s, x) => add(s, x.p), [0, 0, 0]), 1 / f.length); return { p, ...avgAttr(P) }; });
  // 辺の点
  const ep = new Map();
  E.forEach((e, k) => {
    const A = M.V[e.a], B = M.V[e.b];
    const hard = M.sharp.has(k) || e.faces.length !== 2;
    const p = hard ? mul(add(A.p, B.p), 0.5) : mul(add(add(A.p, B.p), add(fp[e.faces[0]].p, fp[e.faces[1]].p)), 0.25);
    ep.set(k, { p, ...avgAttr([A, B]), hard });
  });
  // 元の頂点の新しい位置
  const vEdges = M.V.map(() => []), vFaces = M.V.map(() => []);
  E.forEach((e, k) => { vEdges[e.a].push(k); vEdges[e.b].push(k); });
  M.F.forEach((f, fi) => f.forEach((i) => vFaces[i].push(fi)));
  const vIndex = M.V.map((x, i) => {
    const edges = vEdges[i], n = edges.length;
    const hardE = edges.filter((k) => ep.get(k).hard);
    let p = x.p;
    if (hardE.length >= 3 || n === 0) p = x.p;
    else if (hardE.length === 2) {
      const o = hardE.map((k) => { const e = E.get(k); return M.V[e.a === i ? e.b : e.a].p; });
      p = mul(add(add(o[0], o[1]), mul(x.p, 6)), 1 / 8);
    } else if (vFaces[i].length >= 3 && n >= 3) {
      const F = mul(vFaces[i].reduce((s, fi) => add(s, fp[fi].p), [0, 0, 0]), 1 / vFaces[i].length);
      const R = mul(edges.reduce((s, k) => { const e = E.get(k); return add(s, mul(add(M.V[e.a].p, M.V[e.b].p), 0.5)); }, [0, 0, 0]), 1 / n);
      p = mul(add(add(F, mul(R, 2)), mul(x.p, n - 3)), 1 / n);
    }
    return addV(N, p, x);
  });
  const fIndex = fp.map((x) => addV(N, x.p, x));
  const eIndex = new Map();
  ep.forEach((x, k) => eIndex.set(k, addV(N, x.p, x)));
  // 折り目を引き継ぐ
  M.sharp.forEach((k) => { const e = E.get(k); if (!e) return; const m = eIndex.get(k); N.sharp.add(ek(vIndex[e.a], m)); N.sharp.add(ek(m, vIndex[e.b])); });
  // 新しい面（四角形）
  M.F.forEach((f, fi) => {
    const L = f.length;
    for (let i = 0; i < L; i++) {
      const a = f[i], b = f[(i + 1) % L], z = f[(i - 1 + L) % L];
      N.F.push([vIndex[a], eIndex.get(ek(a, b)), fIndex[fi], eIndex.get(ek(z, a))]);
    }
  });
  return N;
}

// ───────── 部品の作り方 ─────────
// 断面の輪：中心 c、横の向き X、奥の向き Z、半径 rx・rz、角度 th の点。shape(th) は半径の倍率
function ringPts(c, X, Z, rx, rz, n, shape, a0, a1, open) {
  if (a0 === undefined) { a0 = 0; a1 = Math.PI * 2; }
  const P = [];
  for (let i = 0; i < n; i++) {
    const t = open ? i / (n - 1) : i / n;
    const th = a0 + (a1 - a0) * t;
    const k = shape ? shape(th) : 1;
    P.push(add(c, add(mul(X, Math.sin(th) * rx * k), mul(Z, Math.cos(th) * rz * k))));
  }
  return P;
}
// 中身の詰まった筒（輪をつなぎ、両端をふさぐ）。attr(r, i, p) → 頂点の属性
function solidLoft(rings, attr, opt) {
  opt = opt || {};
  const M = Mesh(), R = rings.length, n = rings[0].length;
  const ids = rings.map((ring, r) => ring.map((p, i) => addV(M, p, attr(r, i, p))));
  const cen = rings.map((ring) => mul(ring.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / ring.length));
  for (let r = 0; r + 1 < R; r++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, q = [ids[r][i], ids[r][j], ids[r + 1][j], ids[r + 1][i]];
    const mid = mul(add(add(rings[r][i], rings[r][j]), add(rings[r + 1][i], rings[r + 1][j])), 0.25);
    addF(M, q, sub(mid, lerpV(cen[r], cen[r + 1], 0.5)));
  }
  [[0, -1], [R - 1, 1]].forEach(([r, s]) => {
    if ((r === 0 && opt.openStart) || (r === R - 1 && opt.openEnd)) return;
    const axis = R > 1 ? norm(sub(cen[R - 1], cen[0])) : [0, 1, 0];
    const c = addV(M, add(cen[r], mul(axis, s * (opt.capBulge || 0))), attr(r, 0, cen[r]));
    for (let i = 0; i < n; i++) addF(M, [ids[r][i], ids[r][(i + 1) % n], c], mul(axis, s));
    if (opt.sharpCaps) markSharp(M, [...ids[r], ids[r][0]]);
  });
  return M;
}
// 厚みのある布の殻。rings：外側の面の輪（open なら開いた弧）。内側は厚み th だけ内へ。
// attrOut / attrIn：外側と内側の属性（内側は裏地の色）。縁はくっきり残す
function shellLoft(rings, th, attrOut, attrIn, opt) {
  opt = opt || {};
  const M = Mesh(), R = rings.length, n = rings[0].length, open = !!opt.open;
  const cen = rings.map((ring) => mul(ring.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / ring.length));
  const nrm = rings.map((ring, r) => ring.map((p, i) => {
    const pr = open ? ring[Math.max(0, i - 1)] : ring[(i - 1 + n) % n], nx = open ? ring[Math.min(n - 1, i + 1)] : ring[(i + 1) % n];
    const t1 = sub(nx, pr), t2 = sub(rings[Math.min(R - 1, r + 1)][i], rings[Math.max(0, r - 1)][i]);
    let nn = norm(cross(t1, t2));
    if (dot(nn, sub(p, cen[r])) < 0) nn = mul(nn, -1);
    return nn;
  }));
  const O = rings.map((ring, r) => ring.map((p, i) => addV(M, p, attrOut(r, i, p))));
  const I = rings.map((ring, r) => ring.map((p, i) => addV(M, sub(p, mul(nrm[r][i], th)), attrIn(r, i, p))));
  const cols = open ? n - 1 : n;
  for (let r = 0; r + 1 < R; r++) for (let i = 0; i < cols; i++) {
    const j = (i + 1) % n, out = norm(add(nrm[r][i], nrm[r + 1][j]));
    addF(M, [O[r][i], O[r][j], O[r + 1][j], O[r + 1][i]], out);
    addF(M, [I[r][i], I[r][j], I[r + 1][j], I[r + 1][i]], mul(out, -1));
  }
  const loftDir = (r) => norm(sub(cen[Math.min(R - 1, r + 1)], cen[Math.max(0, r - 1)]));
  // 縁（上下の輪と、開いた弧の両端）
  const rim = (a, b, c, d, dir) => addF(M, [a, b, c, d], dir);
  const ends = [];
  if (!opt.closedStart) ends.push([0, -1]);
  if (!opt.closedEnd) ends.push([R - 1, 1]);
  ends.forEach(([r, s]) => {
    for (let i = 0; i < cols; i++) { const j = (i + 1) % n; rim(O[r][i], O[r][j], I[r][j], I[r][i], mul(loftDir(r), s)); }
    markSharp(M, open ? O[r] : [...O[r], O[r][0]]); markSharp(M, open ? I[r] : [...I[r], I[r][0]]);
  });
  if (open) {
    [[0, -1], [n - 1, 1]].forEach(([i, s]) => {
      for (let r = 0; r + 1 < R; r++) {
        const tdir = norm(sub(rings[r][Math.min(n - 1, i + 1)], rings[r][Math.max(0, i - 1)]));
        rim(O[r][i], O[r + 1][i], I[r + 1][i], I[r][i], mul(tdir, s));
      }
      markSharp(M, O.map((row) => row[i])); markSharp(M, I.map((row) => row[i]));
    });
  }
  // 折り目にする縦の線（ひだの山）
  (opt.sharpCols || []).forEach((i) => markSharp(M, O.map((row) => row[i])));
  // ふさいだ端：外と内を、中心の一点でつなぐ
  [[0, -1, opt.closedStart], [R - 1, 1, opt.closedEnd]].forEach(([r, s, closed]) => {
    if (!closed) return;
    const c = addV(M, cen[r], attrOut(r, 0, cen[r]));
    for (let i = 0; i < n; i++) addF(M, [O[r][i], O[r][(i + 1) % n], c], mul(loftDir(r), s));
  });
  return M;
}
// 角の丸い箱（手、足の甲、草履）：8点の箱を細分すると丸くなる
function roundBox(c, X, Y, Z, hx, hy, hz, attr) {
  const M = Mesh(), id = {};
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const p = add(c, add(mul(X, sx * hx), add(mul(Y, sy * hy), mul(Z, sz * hz)))); id[[sx, sy, sz]] = addV(M, p, attr(p)); }
  const q = (a, b, cc, d, dir) => addF(M, [id[a], id[b], id[cc], id[d]], dir);
  q([1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], X); q([-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1], mul(X, -1));
  q([-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1], Y); q([-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], mul(Y, -1));
  q([-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], Z); q([-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], mul(Z, -1));
  return M;
}
// 支えの輪：細分しても角が丸まりすぎないよう、輪を近くに二重にする
const tri = (x) => { const f = x / (2 * Math.PI); return 1 - Math.abs(2 * (f - Math.floor(f + 0.5))); };   // 三角波 0..1

// ───────── 人物 ─────────
function build(kind) {
  const big = kind === 'enemy';
  const sw = big ? 1.06 : 1.0;
  const { J, bones } = skeleton(sw);
  const pal = PALETTE[kind];
  const C = (m) => hex(pal[m] || '#ff00ff');
  const M = Mesh();
  const A = (m, w, extra) => Object.assign({ c: C(m), w, fx: 0, cl: ['skin', 'hair', 'tabi', 'sandal', 'strap', 'glove'].includes(m) ? 0 : m === 'armor' ? 0.5 : 1 }, extra || {});
  // 胴の骨の重み（高さで、腰→腹→胸→首へ）
  const spineW = (y) => {
    if (y < 1.16) return W('hips', 1);
    if (y < 1.3) return blendW(W('hips', 1), W('waist', 1), smooth(1.16, 1.3, y));
    if (y < 1.5) return blendW(W('waist', 1), W('chest', 1), smooth(1.33, 1.5, y));
    if (y < 1.8) return W('chest', 1);
    return blendW(W('chest', 1), W('neck', 1), smooth(1.8, 1.88, y));
  };
  const X = v(1, 0, 0), Y = v(0, 1, 0), Z = v(0, 0, 1);

  // ── 胴の肌（襟の開きからのぞく胸） ──
  {
    const sec = [[1.14, 0.135, 0.105], [1.3, 0.14, 0.1], [1.45, 0.158, 0.112], [1.6, 0.168, 0.118], [1.71, 0.155, 0.108], [1.79, 0.075, 0.068], [1.83, 0.046, 0.044]];
    const rings = sec.map(([y, rx, rz]) => ringPts(v(0, y, 0.005), X, Z, rx * sw, rz, 12));
    merge(M, solidLoft(rings, (r, i, p) => A('skin', spineW(p[1])), { openEnd: true }));
  }
  // ── 首（頭の面と重なる） ──
  merge(M, solidLoft([1.8, 1.86, 1.92].map((y, k) => ringPts(v(0, y, 0.004), X, Z, 0.043 - k * 0.002, 0.041, 10)), (r, i, p) => A('skin', p[1] < 1.85 ? blendW(W('chest', 1), W('neck', 1), 0.6) : W('neck', 1)), { openEnd: true }));

  if (!big) {
    // ── 主人公の着物：炭色の布の殻。前は細く重なり、胸の上でV字に大きく開く ──
    {
      const gap = (y) => 0.07 + Math.max(0, y - 1.5) / 0.32 * 0.5;   // 襟の開き：胸の上だけ（開きすぎると裸に見える）
      const sec = [[1.17, 0.152, 0.12], [1.3, 0.155, 0.116], [1.45, 0.172, 0.126], [1.6, 0.18, 0.13], [1.7, 0.168, 0.12], [1.77, 0.11, 0.09], [1.82, 0.072, 0.066]];
      const rings = sec.map(([y, rx, rz]) => ringPts(v(0, y, 0.005), X, Z, rx, rz, 15, null, gap(y), 2 * Math.PI - gap(y), true));
      merge(M, shellLoft(rings, 0.009, (r, i, p) => A('kimono', spineW(p[1])), (r, i, p) => A('eri', spineW(p[1])), { open: true }));
      // 厚く折り返した襟：開きの縁に沿って首の後ろへ回る帯
      const edge = (s) => sec.map(([y, rx, rz]) => { const g = gap(y); return add(v(0, y, 0.005), add(mul(X, s * Math.sin(g) * (rx + 0.012)), mul(Z, Math.cos(g) * (rz + 0.012)))); });
      const path2 = [...edge(-1).slice(2).reverse(), v(0, 1.835, -0.07), ...edge(1).slice(2)];
      const rings2 = path2.map((c, k) => { const t = norm(sub(path2[Math.min(path2.length - 1, k + 1)], path2[Math.max(0, k - 1)])); const out = norm(sub(c, v(0, c[1], 0))); const side = norm(cross(t, out)); return ringPts(c, side, out, 0.02, 0.012, 8); });
      merge(M, solidLoft(rings2, (r, i, p) => A('eri', spineW(p[1])), {}));
    }
    // ── 黒い羽織：肩から真っ直ぐ落ちる布の殻。前は広く開き、内側は深紅の裏地。裾は少し広がる ──
    {
      const sec = [[0.99, 0.25, 0.19, 0.62], [1.1, 0.232, 0.172, 0.6], [1.25, 0.212, 0.158, 0.58], [1.42, 0.205, 0.152, 0.56], [1.58, 0.212, 0.156, 0.55], [1.7, 0.226, 0.158, 0.52], [1.755, 0.21, 0.15, 0.5], [1.795, 0.15, 0.118, 0.42], [1.83, 0.098, 0.088, 0.36]];
      const rings = sec.map(([y, rx, rz, g]) => ringPts(v(0, y, -0.006), X, Z, rx, rz, 17, (th) => 1 + 0.025 * tri(th * 7) * (y < 1.6 ? 1 : 0) * (Math.cos(th) < 0.3 ? 1 : 0.3), g, 2 * Math.PI - g, true));
      const fxAt = (y) => clamp((1.32 - y) / 0.33, 0, 1) * 0.75;
      merge(M, shellLoft(rings, 0.012, (r, i, p) => A('haori', spineW(p[1]), { fx: fxAt(p[1]) }), (r, i, p) => A('lining', spineW(p[1]), { fx: fxAt(p[1]) }), { open: true }));
    }
    // ── 黒い帯（この上に、実行時に紫の縄を巻く） ──
    merge(M, solidLoft([1.165, 1.2, 1.24].map((y) => ringPts(v(0, y, 0), X, Z, 0.17, 0.14, 12)), (r, i, p) => A('sash', W('hips', 1)), { openStart: true, openEnd: true }));
  } else {
    // ── 相手：黒い着物の上に黒漆の胴。板の継ぎ目は細い溝（支えの輪を二重にして、くっきり） ──
    {
      const sec = [[1.17, 0.15, 0.118], [1.3, 0.152, 0.114], [1.45, 0.175, 0.126], [1.6, 0.188, 0.132], [1.7, 0.178, 0.124], [1.77, 0.12, 0.096], [1.82, 0.078, 0.07]];
      merge(M, solidLoft(sec.map(([y, rx, rz]) => ringPts(v(0, y, 0.005), X, Z, rx * sw, rz, 14)), (r, i, p) => A('kimono', spineW(p[1])), { openStart: true, openEnd: true }));
      // 深紅の内襟（V字）
      [-1, 1].forEach((s) => {
        const pts = [v(s * 0.075, 1.81, 0.06), v(s * 0.05, 1.72, 0.11), v(s * 0.015, 1.6, 0.135)];
        merge(M, solidLoft(pts.map((c, k) => ringPts(c, norm(v(1, 0.4 * s, 0)), Z, 0.018, 0.01, 8)), (r, i, p) => A('lapel', W('chest', 1)), {}));
      });
      const doY = [];
      for (let y = 1.16; y <= 1.585; y += 0.053) doY.push(y);
      const rings = [];
      doY.forEach((y, k) => { const rx = (0.205 + 0.025 * Math.sin((y - 1.16) / 0.43 * Math.PI)) * sw, rz = 0.15 + 0.012 * Math.sin((y - 1.16) / 0.43 * Math.PI); rings.push(ringPts(v(0, y, 0.008), X, Z, rx, rz, 16)); if (k < doY.length - 1) { rings.push(ringPts(v(0, y + 0.006, 0.008), X, Z, rx * 0.985, rz * 0.98, 16)); rings.push(ringPts(v(0, y + 0.012, 0.008), X, Z, rx, rz, 16)); } });
      const doM = solidLoft(rings, (r, i, p) => A('armor', spineW(p[1])), { openStart: true, openEnd: true });
      // 板の縁をくっきり
      merge(M, doM);
      // 胸板
      merge(M, roundBox(v(0, 1.635, 0.118), X, Y, Z, 0.135, 0.05, 0.022, (p) => A('armor', W('chest', 1))));
      merge(M, solidLoft([1.12, 1.15, 1.18].map((y) => ringPts(v(0, y, 0), X, Z, 0.2 * sw, 0.155, 12)), (r, i, p) => A('sash', W('hips', 1)), { openStart: true, openEnd: true }));
    }
  }

  // ── 袴：二本の脚として作る。腰の上では左右が合わさって一枚に見え、股から下は分かれて裾へ広がる。ひだは網の段階で入れる ──
  ['R', 'L'].forEach((s) => {
    const sg = s === 'R' ? -1 : 1;
    const Pj = J['P' + s], K = J['K' + s], Aj = J['A' + s];
    const yTop = big ? 1.19 : 1.22, yBot = Aj[1] + (big ? 0.03 : 0.04);
    const R0 = big ? 0.185 : 0.158, RK = big ? 0.175 : 0.148, RB = big ? 0.215 : 0.182;
    const rings = [];
    const NR = 9, n = 40;
    for (let r = 0; r < NR; r++) {
      const t = r / (NR - 1), y = lerp(yTop, yBot, t);
      const leg = y > K[1] ? lerpV(Pj, K, (Pj[1] - y) / (Pj[1] - K[1])) : lerpV(K, Aj, (K[1] - y) / (K[1] - Aj[1]));
      const cx = y > Pj[1] ? Pj[0] : leg[0];
      const rad = t < 0.45 ? lerp(R0, RK, t / 0.45) : lerp(RK, RB, (t - 0.45) / 0.55);
      const flat = 1 - smooth(0.12, 0.32, t);           // 上ほど内側が真っ直ぐ（左右が合わさる）
      const pleatAmt = 0.09 + 0.06 * t;
      const ring = [];
      for (let i = 0; i < n; i++) {
        const th = i / n * Math.PI * 2;
        const front = Math.cos(th) > -0.2 ? 1 : 0.5;
        let k = 1 + pleatAmt * (tri(th * 10) - 0.5) * front;
        let x = Math.sin(th) * rad * k, z = Math.cos(th) * rad * 0.9 * k;
        // 内側（相手の脚の側）を、上ほど中心線で平らにする
        const inner = -sg * x;   // 正なら中心線の側
        const lim = Math.abs(cx) - 0.004;
        if (inner > lim) x = -sg * lerp(inner, lim + (inner - lim) * 0.15, flat);
        ring.push(v(cx + x, y, z + 0.01));
      }
      rings.push(ring);
    }
    const th = 'thigh' + s, sh = 'shin' + s;
    const wAt = (y) => {
      if (y > 1.0) return blendW(W('hips', 1), W(th, 1), smooth(1.12, 1.0, y) * 0.6);
      if (y > K[1] + 0.08) return blendW(W('hips', 0.35, th, 0.65), W(th, 1), smooth(1.0, 0.8, y) * 0.7);
      if (y > K[1] - 0.12) return blendW(W(th, 0.85, 'hips', 0.15), W(sh, 1), smooth(K[1] + 0.08, K[1] - 0.12, y));
      return W(sh, 0.9, th, 0.1);
    };
    const fxAt = (y) => clamp((1.08 - y) / 0.95, 0, 1);
    merge(M, shellLoft(rings, 0.012, (r, i, p) => A('hakama', wAt(p[1]), { fx: fxAt(p[1]) }), (r, i, p) => A('hakama', wAt(p[1]), { fx: fxAt(p[1]), c: mul(C('hakama'), 0.45) }), { closedStart: true, sharpCols: [0, 4, 8, 12, 16, 20, 24, 28, 32, 36] }));   // ひだの山を折り目として残す

    // ── 足：足袋（丸い箱を足の形に）と草履 ──
    const ft = 'foot' + s;
    const fA = (p) => A('tabi', W(ft, 1));
    merge(M, roundBox(add(Aj, v(0, -0.035, 0.06)), X, Y, Z, 0.045, 0.035, 0.11, fA));
    merge(M, solidLoft([0.0, 0.05].map((dy) => ringPts(add(Aj, v(0, 0.02 + dy, 0)), X, Z, 0.044, 0.046, 8)), (r, i, p) => A('tabi', W(ft, 0.6, sh, 0.4)), {}));
    merge(M, roundBox(add(Aj, v(0, -0.075, 0.07)), X, Y, Z, 0.052, 0.009, 0.14, (p) => A('sandal', W(ft, 1))));
    [-1, 1].forEach((side) => {
      const pts = [add(Aj, v(side * 0.045, -0.062, 0.04)), add(Aj, v(side * 0.025, -0.045, 0.1)), add(Aj, v(0, -0.05, 0.14))];
      merge(M, solidLoft(pts.map((c, k) => ringPts(c, X, Y, 0.007, 0.007, 6)), (r, i, p) => A('strap', W(ft, 1)), {}));
    });
  });

  // ── 腕 ──
  ['R', 'L'].forEach((s) => {
    const S = J['S' + s], E = J['E' + s], WR = J['WR' + s], dir = J['dir' + s];
    const ua = 'upperArm' + s, fa = 'foreArm' + s, hd = 'hand' + s;
    const hang = norm(sub(v(0, -1, 0), mul(dir, dot(v(0, -1, 0), dir))));
    const fwd = norm(cross(dir, hang));
    const armW = (p) => { const t = dot(sub(p, S), dir) / 0.31; return t < 0.85 ? W(ua, 1) : blendW(W(ua, 1), W(fa, 1), smooth(0.85, 1.15, t)); };
    // 肩から二の腕（細い着物の袖）
    const upper = [0.0, 0.1, 0.2, 0.31].map((t, k) => ringPts(add(S, mul(dir, t)), fwd, hang, (big ? 0.065 : 0.05) - k * 0.004, (big ? 0.065 : 0.05) - k * 0.004, 10));
    merge(M, solidLoft([ringPts(add(S, mul(dir, -0.04)), fwd, hang, 0.04, 0.04, 10), ...upper], (r, i, p) => A('kimono', r === 0 ? W('chest', 0.5, ua, 0.5) : armW(p)), {}));
    if (!big) {
      // 羽織の袖：腕から下へ垂れる、角の丸い四角の布の殻。袖口は深紅
      const ts = [0.02, 0.12, 0.22, 0.31, 0.38, 0.43];
      const rings = ts.map((t, k) => {
        const sag = 0.03 + 0.03 * Math.min(1, t / 0.3);
        const c = add(add(S, mul(dir, t)), mul(hang, sag));
        return ringPts(c, fwd, hang, 0.056, 0.082 + (k > 0 ? 0.006 : -0.02), 12, (th) => { const a = Math.abs(Math.sin(th)), b = Math.abs(Math.cos(th)); return 1 / Math.pow(Math.pow(a, 4) + Math.pow(b, 4), 0.25); });
      });
      merge(M, shellLoft(rings, 0.009, (r, i, p) => A('haori', armW(p), { fx: 0.5 * ts[r] / 0.43 }), (r, i, p) => A('lining', armW(p), { fx: 0.5 * ts[r] / 0.43 }), { closedStart: true }));
      // 黒い籠手：帯を巻いた筋
      const tg = [0.02, 0.06, 0.07, 0.12, 0.13, 0.18, 0.19, 0.24, 0.27];
      merge(M, solidLoft(tg.map((t, k) => ringPts(add(E, mul(dir, t)), fwd, hang, (0.046 - t * 0.04) * (k % 2 ? 1.06 : 1), (0.046 - t * 0.04) * (k % 2 ? 1.06 : 1), 10)), (r, i, p) => A('guard', armW(p)), {}));
    } else {
      // 相手：袖は肘の上で絞り、前腕は黒漆の籠手（板を三段）
      const sl = [0.03, 0.14, 0.25, 0.32].map((t, k) => ringPts(add(add(S, mul(dir, t)), mul(hang, 0.02 * k)), fwd, hang, 0.075 + k * 0.006, 0.085 + k * 0.01, 12));
      merge(M, shellLoft(sl, 0.008, (r, i, p) => A('kimono', armW(p), { fx: 0.3 }), (r, i, p) => A('lapel', armW(p), { fx: 0.3 }), { closedStart: true }));
      merge(M, solidLoft([0.0, 0.1, 0.27].map((t) => ringPts(add(E, mul(dir, t)), fwd, hang, 0.05 - t * 0.03, 0.05 - t * 0.03, 10)), (r, i, p) => A('kimono', armW(p)), {}));
      [0.05, 0.12, 0.19].forEach((t, k) => merge(M, roundBox(add(add(E, mul(dir, t + 0.02)), mul(fwd, 0.0)), fwd, dir, hang, 0.052 - k * 0.004, 0.03, 0.05 - k * 0.004, (p) => A('armor', W(fa, 1)))));
    }
    // 手：柄を握った拳（丸い箱）と親指
    const hM = big ? 'glove' : 'skin';
    merge(M, roundBox(add(WR, mul(dir, 0.06)), fwd, dir, hang, 0.034, 0.055, 0.042, (p) => A(hM, W(hd, 1))));
    merge(M, solidLoft([0.0, 0.03, 0.05].map((t, k) => ringPts(add(add(WR, mul(dir, 0.04 + t * 0.5)), mul(fwd, 0.035 + t * 0.4)), dir, hang, 0.014 - k * 0.002, 0.013 - k * 0.002, 6)), (r, i, p) => A(hM, W(hd, 1)), {}));
  });

  // 2回細分
  let S2 = subdivide(subdivide(M));
  return { mesh: S2, bones };
}

// ───────── 書き出し（焼き出しと同じ形式） ─────────
function exportMesh(kind) {
  const { mesh, bones } = build(kind);
  const Vt = mesh.V, n = Vt.length;
  // 法線：面の向きを頂点ごとに足し合わせる
  const nor = Vt.map(() => [0, 0, 0]);
  const tris = [];
  mesh.F.forEach((f) => {
    for (let i = 1; i + 1 < f.length; i++) tris.push(f[0], f[i], f[i + 1]);
    const P = f.map((i) => Vt[i].p);
    let fn = [0, 0, 0];
    for (let i = 0; i < P.length; i++) fn = add(fn, cross(P[i], P[(i + 1) % P.length]));
    f.forEach((i) => { nor[i] = add(nor[i], fn); });
  });
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  Vt.forEach((x) => { for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], x.p[a]); max[a] = Math.max(max[a], x.p[a]); } });
  for (let a = 0; a < 3; a++) { min[a] -= 0.001; max[a] += 0.001; }
  const out = { pos: [], nor: [], col: [], si: [], sw: [], fx: [], cl: [] };
  Vt.forEach((x, i) => {
    out.pos.push(...x.p); out.nor.push(...norm(nor[i]));
    // ゆるい色のむら（手描きのような揺らぎ）と、上を向いた面ほど少し明るく
    const p = x.p, nn = norm(nor[i]);
    const pv = (1 + 0.04 * Math.sin(p[0] * 9 + p[1] * 4.3) * Math.sin(p[2] * 7.1 - p[1] * 5.7)) * (0.94 + 0.06 * nn[1]);
    out.col.push(...x.c.map((c) => clamp(c * pv, 0, 1)));
    let ws = Object.entries(x.w).map(([b, w]) => [+b, w]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = ws.reduce((s, q) => s + q[1], 0) || 1;
    while (ws.length < 4) ws.push([0, 0]);
    out.si.push(...ws.map((q) => q[0])); out.sw.push(...ws.map((q) => q[1] / tot));
    out.fx.push(x.fx); out.cl.push(x.cl);
  });
  console.log(`${kind}: ${n} vertices, ${tris.length / 3} triangles (modeled)`);
  return packRaw({ out, tris, bones, min, max });
}
function packRaw(B) {
  const n = B.out.pos.length / 3;
  const pos = new Uint16Array(n * 3), nor = new Int8Array(n * 3), col = new Uint8Array(n * 3), si = new Uint8Array(n * 4), sw = new Uint8Array(n * 4), fx = new Uint8Array(n), cl = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      pos[i * 3 + a] = Math.round(clamp((B.out.pos[i * 3 + a] - B.min[a]) / (B.max[a] - B.min[a]), 0, 1) * 65535);
      nor[i * 3 + a] = Math.round(clamp(B.out.nor[i * 3 + a], -1, 1) * 127);
      col[i * 3 + a] = Math.round(B.out.col[i * 3 + a] * 255);
    }
    let s = 0;
    for (let a = 0; a < 4; a++) { si[i * 4 + a] = B.out.si[i * 4 + a]; sw[i * 4 + a] = Math.round(B.out.sw[i * 4 + a] * 255); s += sw[i * 4 + a]; }
    sw[i * 4] += 255 - s;
    fx[i] = Math.round(B.out.fx[i] * 255); cl[i] = Math.round(B.out.cl[i] * 255);
  }
  const idx = n < 65536 ? new Uint16Array(B.tris) : new Uint32Array(B.tris);
  const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
  return {
    min: B.min, max: B.max, n, wide: n >= 65536,
    bones: B.bones.map(([name, parent, at]) => ({ name, parent, at: at.map((x) => +x.toFixed(4)) })),
    pos: b64(pos), nor: b64(nor), col: b64(col), si: b64(si), sw: b64(sw), fx: b64(fx), cl: b64(cl), idx: b64(idx),
  };
}

if (require.main === module) {
  const HEAD_CELL = 0.0042;
  const data = { player: exportMesh('player'), playerHead: pack('player', HEAD_CELL, 'head'), enemy: exportMesh('enemy'), enemyHead: pack('enemy', HEAD_CELL, 'head') };
  const js = 'window.CLEF_CHARS = ' + JSON.stringify(data) + ';';
  const target = path.join(__dirname, '..', 'prototype', 'kaeshi', 'index.html');
  let html = fs.readFileSync(target, 'utf8');
  const Am = '<script id="clef-chars">', Bm = '</script><!-- /clef-chars -->';
  html = html.slice(0, html.indexOf(Am)) + Am + js + Bm + html.slice(html.indexOf(Bm) + Bm.length);
  fs.writeFileSync(target, html);
  console.log('embedded', (js.length / 1024).toFixed(0), 'KB into', path.relative(process.cwd(), target));
}
module.exports = { build };
