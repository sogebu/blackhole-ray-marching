// ships.js — other ships in the Schwarzschild viewer: where a ship with a known
// worldline appears on the camera's sky (every lensed image), which event of
// its worldline the image shows (light-travel delay), how its colour shifts
// (Doppler + gravitational, g = omega_cam / omega_em), how large it looks (a
// small sphere drawn as an ellipse) and whether the disk hides it.
//
// This runs on the CPU in JavaScript's f64, once per ship per frame, and hands
// each image to the shader as a few uniforms (index.html `shipUniforms`); the
// shader only paints the ellipse.  The f64 reference with scipy's adaptive
// quadrature is renderer/ships.py (its docstring is the physics; the scheme,
// the leg structure of the orbits and the names below mirror it).  Here every
// integral is a composite Gauss-Legendre sum in a variable that makes the
// integrand smooth, the same substitutions the disk shader uses
// (disk_table.py): y = ln w for near-radial plunging rays, w - 2/3 =
// sqrt(delta) sinh s across the near-critical bump, w_p - w = eps sinh^2 s
// from a turning point, s = -ln(1 - w) next to the horizon.  The roots of
// P(w) = 1/b^2 - w^2 (1 - w) come from the trigonometric cubic formula with
// (b - b_cr) formed directly, so the periastron and the apoastron stay exact
// next to the critical curve.  web/check_ships.py compares this file (run
// under node, or the page's __bh.probeShips) with ships.py.
//
// Units r_S = c = 1.  Vectors are world-axis triples.  Times are the ingoing
// Eddington-Finkelstein v = t + r*, r* = r + ln|r - 1|.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BHShips = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const PI = Math.PI;
  const B_CR = 1.5 * Math.sqrt(3);
  const B_QUAD = 2.0;          // plunging rays: ln w below, sinh about 2/3 at or above
  const R_FROZEN = 1e-6;       // a ship emitting from r < 1 + R_FROZEN is frozen
  const DPHI_MIN = 1e-10;
  const CHI_EPS = 1e-12;
  const N_PANEL = 6;           // composite GL-12 panels per leg (check_ships.py measures)

  // ---- vectors
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (s, a) => [s * a[0], s * a[1], s * a[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
  function perp(v) {
    v = unit(v);
    const trial = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    return unit(cross(v, trial));
  }
  const rStar = r => r + Math.log(Math.abs(r - 1));

  // ---- Gauss-Legendre 12, composite
  const GLX = [0.1252334085114689, 0.3678314989981802, 0.5873179542866175,
               0.7699026741943047, 0.9041172563704748, 0.9815606342467192];
  const GLW = [0.2491470458134027, 0.2334925365383546, 0.2031674267230656,
               0.1600783285433461, 0.1069393259953189, 0.0471753363865120];
  function gl12(f, a, b, n) {
    if (b <= a) return 0;
    const H = (b - a) / n, hh = 0.5 * H;
    let tot = 0;
    for (let j = 0; j < n; j++) {
      const c = a + H * (j + 0.5);
      let s = 0;
      for (let k = 0; k < 6; k++) s += GLW[k] * (f(c - hh * GLX[k]) + f(c + hh * GLX[k]));
      tot += hh * s;
    }
    return tot;
  }
  const asinh = x => Math.asinh(x);

  // ---- orbit legs.  P(w) = 1/b^2 - w^2 (1 - w); dphi = dw / sqrt(P).
  const P_of = (w, b) => 1 / (b * b) - w * w * (1 - w);
  // roots for b > b_cr: {wp (periastron, < 2/3), w2 (apoastron, in (2/3, 1)),
  // u3 (< 0), eps = w2 - wp}, from w = 1/3 + (2/3) cos((theta + 2 pi k)/3),
  // cos theta = 1 - 27/(2 b^2) = -1 + eta, eta = 2 (b - b_cr)(b + b_cr)/b^2
  function roots(b) {
    if (b <= B_CR) return null;
    const eta = 2 * (b - B_CR) * (b + B_CR) / (b * b);
    const piMinus = 2 * Math.asin(Math.sqrt(Math.min(eta / 2, 1)));   // pi - theta
    const th = PI - piMinus;
    const w2 = 1 / 3 + (2 / 3) * Math.cos(th / 3);
    const wp = 1 / 3 + (2 / 3) * Math.cos((2 * PI - th) / 3);
    const u3 = 1 / 3 + (2 / 3) * Math.cos((th + 2 * PI) / 3);
    const eps = (4 / 3) * Math.sin(PI / 3) * Math.sin(piMinus / 3);
    return { wp, w2, u3, eps };
  }
  // the smooth factor h(w): integrand = h / sqrt(P)
  function smooth(kind, w, b, sqrtP) {
    if (kind === 0) return 1;                                   // azimuth
    if (kind === 1) return b / (1 + b * sqrtP);                 // dv, r decreasing
    return (1 + b * sqrtP) / (b * w * w * (1 - w));             // dv, r increasing
  }
  // int_{w1}^{w2} h / sqrt(P) dw on one monotone leg (w1 < w2).  rt = roots(b)
  // when the leg touches a turning point: periastron at w2 = rt.wp (apo false)
  // or apoastron at w1 = rt.w2 (apo true); the substitution is used for the
  // whole leg (it is regular everywhere on the scattering branch).
  function legIntegral(kind, b, w1, w2, rt, apo) {
    if (w2 <= w1) return 0;
    if (kind === 2 && !apo) {
      // the outgoing-leg dv carries 1/w^2 (the flat 2 r): toward small w it
      // is integrated in y = ln w, where it is a plain exponential, up to
      // w_mid (half the periastron, or 1/3 for a plunging ray), clear of
      // every root and of the near-critical bump at 2/3
      const wMid = rt ? 0.5 * rt.wp : 1 / 3;
      if (w1 < wMid && w2 > wMid) return legIntegral(kind, b, w1, wMid, null, false) + legIntegral(kind, b, wMid, w2, rt, apo);
      if (w2 <= wMid) rt = null;
    }
    if (kind === 2 && w2 > 0.9) {
      // next to the horizon in s = -ln(1 - w): dw / (1 - w) = ds
      const lo = Math.max(w1, 0.9);
      const head = lo > w1 ? legIntegral(kind, b, w1, lo, rt, apo) : 0;
      const f = s => {
        const w = 1 - Math.exp(-s), p = Math.max(P_of(w, b), 1e-300), q = Math.sqrt(p);
        return (1 + b * q) / (b * q * w * w);
      };
      return head + gl12(f, -Math.log(1 - lo), -Math.log(1 - w2), N_PANEL);
    }
    if (rt) {
      // scattering branch: P = (wp - w)(w2 - w)(w - u3); wp - w = eps sinh^2 s
      // (or w - w2 = eps sinh^2 s on the inner branch): 2 h ds / sqrt(w - u3)
      const eps = rt.eps, u3 = rt.u3;
      if (!apo && w2 > rt.wp + 1e-15) w2 = rt.wp;        // rounding past the root
      if (apo && w1 < rt.w2 - 1e-15) w1 = rt.w2;
      let s1, s2, wOf;
      if (!apo) { s1 = asinh(Math.sqrt(Math.max(rt.wp - w2, 0) / eps)); s2 = asinh(Math.sqrt((rt.wp - w1) / eps)); wOf = s => rt.wp - eps * Math.sinh(s) ** 2; }
      else { s1 = asinh(Math.sqrt(Math.max(w1 - rt.w2, 0) / eps)); s2 = asinh(Math.sqrt((w2 - rt.w2) / eps)); wOf = s => rt.w2 + eps * Math.sinh(s) ** 2; }
      const f = s => {
        const w = wOf(s), sh = Math.sinh(s), ch = Math.cosh(s);
        const sqrtP = eps * sh * ch * Math.sqrt(Math.max(w - u3, 1e-300));
        return 2 * smooth(kind, w, b, sqrtP) / Math.sqrt(Math.max(w - u3, 1e-300));
      };
      return gl12(f, s1, s2, N_PANEL);
    }
    if (b < B_QUAD || (kind === 2 && w2 <= 1 / 3)) {
      // y = ln w: dw = w dy; b factored out of sqrt(P) so b -> 0 keeps accuracy
      const bb = b * b;
      const f = y => {
        const w = Math.exp(y), q = Math.sqrt(Math.max(1 + bb * w * w * (w - 1), 1e-300));   // b sqrt(P)
        return smooth(kind, w, b, q / b) * w * b / q;
      };
      return gl12(f, Math.log(w1), Math.log(w2), N_PANEL);
    }
    // near-critical plunging: P = delta + (w - 2/3)^2 (w + 1/3), w - 2/3 = sqrt(delta) sinh s
    const delta = (B_CR - b) * (B_CR + b) / (b * b * B_CR * B_CR);
    const sg = Math.sqrt(delta);
    const f = s => {
      const sh = Math.sinh(s), ch = Math.cosh(s), w = 2 / 3 + sg * sh;
      const sqrtP = sg * Math.sqrt(1 + sh * sh * (w + 1 / 3));
      return smooth(kind, w, b, sqrtP) * sg * ch / sqrtP;
    };
    return gl12(f, asinh((w1 - 2 / 3) / sg), asinh((w2 - 2 / 3) / sg), N_PANEL);
  }

  // a traced ray from the camera: {R, b, outgoing, rt (roots or null), wc, trapped}
  function makeRay(R, b, outgoing) {
    const rt = roots(b), wc = 1 / R;
    return { R, b, outgoing, rt, wc, trapped: rt !== null && wc >= rt.w2 - 1e-15 };
  }
  // every passage of the traced ray through radius 1/ws: [{phi, legs}], legs =
  // the physical photon's path ship -> camera as [kind, w1, w2, rt, apo]
  function sweeps(ray, ws) {
    const { wc, b, rt } = ray, out = [];
    // a leg on the scattering branch (b > b_cr, outside the roots) is always
    // integrated in the substitution anchored at the nearer root (rt, apo):
    // regular on the whole branch, and the only form that is right next to
    // the periastron or the apoastron; a plunging leg (rt null) uses ln w or
    // the sinh form about 2/3
    if (ray.outgoing) {
      if (rt === null || !ray.trapped) {
        if (ws >= wc || (rt !== null && wc > rt.wp)) return out;
        out.push({ phi: legIntegral(0, b, ws, wc, rt, false), legs: [[1, ws, wc, rt, false]] });
        return out;
      }
      const w2 = rt.w2;
      if (ws < w2) return out;
      const ac = legIntegral(0, b, w2, wc, rt, true), as = legIntegral(0, b, w2, ws, rt, true);
      if (ws < wc) out.push({ phi: ac - as, legs: [[1, ws, wc, rt, true]] });
      if (ws < 1) out.push({ phi: ac + as, legs: [[2, w2, ws, rt, true], [1, w2, wc, rt, true]] });
      return out;
    }
    if (rt === null || ray.trapped) {
      if (ws <= wc || ws >= 1) return out;
      const apo = rt !== null;
      out.push({ phi: legIntegral(0, b, wc, ws, rt, apo), legs: [[2, wc, ws, rt, apo]] });
      return out;
    }
    const wp = rt.wp;
    if (wc > wp || ws > wp) return out;
    const ac = legIntegral(0, b, wc, wp, rt, false), as = legIntegral(0, b, ws, wp, rt, false);
    if (ws > wc) out.push({ phi: ac - as, legs: [[2, wc, ws, rt, false]] });
    out.push({ phi: ac + as, legs: [[1, ws, wp, rt, false], [2, wc, wp, rt, false]] });
    return out;
  }
  function delayV(legs, b) {
    let tot = 0;
    for (const [k, w1, w2, rt, apo] of legs) tot += legIntegral(k, b, w1, w2, rt, apo);
    return tot;
  }
  // root of g on [lo, hi] with g(lo) g(hi) <= 0: bisection + secant (Illinois)
  function findRoot(g, lo, hi, glo, ghi, tol) {
    if (glo === undefined) glo = g(lo);
    if (ghi === undefined) ghi = g(hi);
    if (glo === 0) return lo;
    if (ghi === 0) return hi;
    let side = 0;
    for (let it = 0; it < 200; it++) {
      let m = lo - glo * (hi - lo) / (ghi - glo);
      if (!(m > lo && m < hi)) m = 0.5 * (lo + hi);
      const gm = g(m);
      if (gm === 0 || hi - lo < tol) return m;
      if ((gm < 0) === (glo < 0)) { lo = m; glo = gm; if (side === -1) ghi *= 0.5; side = -1; }
      else { hi = m; ghi = gm; if (side === 1) glo *= 0.5; side = 1; }
    }
    return 0.5 * (lo + hi);
  }
  // radius of the traced ray at swept azimuth f (null inside the horizon or past the end)
  function radiusAtAzimuth(ray, f) {
    const { wc, b, rt } = ray, tol = 1e-15;
    const az = (w1, w2, r, apo) => legIntegral(0, b, w1, w2, r, apo);
    if (ray.outgoing) {
      if (rt === null || !ray.trapped) {
        if (f >= az(1e-300, wc, rt, false)) return null;
        return 1 / findRoot(w => az(w, wc, rt, false) - f, 1e-300, wc, undefined, undefined, tol);
      }
      const w2 = rt.w2, ac = az(w2, wc, rt, true);
      if (f <= ac) return 1 / findRoot(w => ac - az(w2, w, rt, true) - f, w2, wc, undefined, undefined, tol);
      const rest = f - ac;
      if (rest >= az(w2, 1, rt, true)) return null;
      return 1 / findRoot(w => az(w2, w, rt, true) - rest, w2, 1, undefined, undefined, tol);
    }
    if (rt === null || ray.trapped) {
      const apo = rt !== null;
      if (f >= az(wc, 1, rt, apo)) return null;
      return 1 / findRoot(w => az(wc, w, rt, apo) - f, wc, 1, undefined, undefined, tol);
    }
    const wp = rt.wp, ac = az(wc, wp, rt, false);
    if (f <= ac) return 1 / findRoot(w => ac - az(w, wp, rt, false) - f, wc, wp, undefined, undefined, tol);
    const rest = f - ac;
    if (rest >= az(1e-300, wp, rt, false)) return null;
    return 1 / findRoot(w => az(w, wp, rt, false) - rest, 1e-300, wp, undefined, undefined, tol);
  }

  // ---- pixel angle <-> ray, in the reference frame ("static": R > 1, the
  // local static observer; "ffo": the radial free-fall frame, any R)
  function rayFromAngle(R, chi, frame) {
    const c = Math.cos(chi), s = Math.sin(chi);
    if (frame === "static") {
      const A = 1 - 1 / R;
      return { ray: makeRay(R, R * s / Math.sqrt(A), c <= 0), gInf0: 1 / Math.sqrt(A) };
    }
    const sq = Math.sqrt(R), Eu = (sq - c) / sq;
    if (Eu <= 0) return null;
    return { ray: makeRay(R, R * s / Eu, R > 1 ? c < 1 / sq : c < sq), gInf0: 1 / Eu };
  }
  function branches(R, frame) {
    const e = CHI_EPS;
    if (frame === "static") {
      const A = 1 - 1 / R, sCr = B_CR * Math.sqrt(A) / R;
      if (sCr < 1) {
        const aCr = Math.asin(sCr);
        if (R > 1.5) return [[e, aCr - e], [aCr + e, PI / 2 - e], [PI / 2 + e, PI - aCr - e], [PI - aCr + e, PI - e]];
        return [[e, PI / 2 - e], [PI / 2 + e, PI - aCr - e], [PI - aCr + e, PI - e]];
      }
      return [[e, PI / 2 - e], [PI / 2 + e, PI - e]];
    }
    const sq = Math.sqrt(R), cLim = Math.min(sq, 1 / sq), lo = Math.acos(Math.min(cLim, 1));
    const bb = chi => { const c = Math.cos(chi); return R * Math.sin(chi) / ((sq - c) / sq); };
    if (bb(lo + e) > B_CR) {
      const chiCr = findRoot(x => bb(x) - B_CR, lo + e, PI - e, undefined, undefined, 1e-15);
      return [[lo + e, chiCr - e], [chiCr + e, PI - e]];
    }
    return [[lo + e, PI - e]];
  }
  const imagePhi = (n, dphi) => 2 * PI * Math.ceil(n / 2) + (n % 2 ? -1 : 1) * dphi;

  // every image n <= nMax of a ship at radius rs and in-plane azimuth dphi:
  // [{n, chi, s, b, outgoing, ray, Phi, legs, passage}]
  function findImages(R, rs, dphi, frame, nMax, nScan) {
    nScan = nScan || 48;
    const ws = 1 / rs, found = new Map();
    const sw = chi => { const rr = rayFromAngle(R, chi, frame); return rr ? sweeps(rr.ray, ws).map(p => ({ ...p, ray: rr.ray })) : []; };
    for (const [lo, hi] of branches(R, frame)) {
      const chis = [], vals = [];
      for (let i = 0; i < nScan; i++) {
        const u = 0.5 - 0.5 * Math.cos(PI * i / (nScan - 1));
        chis.push(lo + (hi - lo) * u);
        vals.push(sw(chis[i]));
      }
      for (let n = 0; n <= nMax; n++) {
        if (found.has(n)) continue;
        const target = imagePhi(n, dphi);
        for (let j = 0; j < 2 && !found.has(n); j++) {
          const fn = chi => { const p = sw(chi); return p.length > j ? p[j].phi - target : NaN; };
          for (let i = 0; i < nScan - 1; i++) {
            let a = vals[i].length > j ? vals[i][j].phi - target : null;
            let c = vals[i + 1].length > j ? vals[i + 1][j].phi - target : null;
            if (a === null && c === null) continue;
            if ((a !== null && !isFinite(a)) || (c !== null && !isFinite(c))) continue;
            let loC = chis[i], hiC = chis[i + 1];
            if (a === null || c === null) {
              let yes = a === null ? hiC : loC, no = a === null ? loC : hiC;
              for (let k = 0; k < 60 && Math.abs(yes - no) >= 1e-13; k++) {
                const mid = 0.5 * (yes + no);
                if (sw(mid).length > j) yes = mid; else no = mid;
              }
              const fb = fn(yes);
              if (!isFinite(fb)) continue;
              if (a === null) { loC = yes; a = fb; } else { hiC = yes; c = fb; }
            }
            if (a * c > 0) continue;
            const root = findRoot(fn, loC, hiC, a, c, 1e-14);
            const p = sw(root);
            if (p.length <= j) continue;
            found.set(n, { n, chi: root, s: n % 2 ? -1 : 1, b: p[j].ray.b, outgoing: p[j].ray.outgoing,
                           ray: p[j].ray, Phi: target, legs: p[j].legs, passage: j });
            break;
          }
        }
      }
    }
    return [...found.values()].sort((x, y) => x.n - y.n);
  }

  // ---- worldlines: state(lam) -> {r, rhat, t, v, ut, ur, vtan, dvdlam}
  function circularOrbit(o) {
    const r = o.r, normal = unit(o.normal || [0, 0, 1]);
    const ea = o.axis ? unit(o.axis) : perp(normal), eb = cross(normal, ea);
    const phase0 = o.phase0 || 0, t0 = o.t0 || 0, sense = o.sense || 1;
    const Omega = Math.sqrt(0.5 / (r * r * r)), ut = 1 / Math.sqrt(1 - 1.5 / r);
    return {
      kind: "circular", r, normal, Omega, ut, lamMin: -Infinity, lamMax: Infinity,
      state(lam) {
        const ph = phase0 + sense * Omega * (lam - t0);
        const rhat = add(scale(Math.cos(ph), ea), scale(Math.sin(ph), eb));
        const phat = add(scale(-Math.sin(ph), ea), scale(Math.cos(ph), eb));
        return { r, rhat, t: lam, v: lam + rStar(r), ut, ur: 0, vtan: scale(r * Omega * ut * sense, phat), dvdlam: 1 };
      },
    };
  }
  function staticShip(o) {
    const r = o.r, rhat = unit(o.rhat), A = 1 - 1 / r;
    return { kind: "static", r, lamMin: -Infinity, lamMax: Infinity,
      state(lam) { return { r, rhat, t: lam, v: lam + rStar(r), ut: 1 / Math.sqrt(A), ur: 0, vtan: [0, 0, 0], dvdlam: 1 }; } };
  }
  // free fall from rest at infinity (E = 1, L = 0), lam = proper time, r = R0 at lam = 0
  function radialFall(o) {
    const R0 = o.R0, rhat = unit(o.rhat), v0 = o.v0 || 0;
    const vRaw = r => { const sq = Math.sqrt(r); return -(2 / 3) * r * sq - 2 * sq + r + 2 * Math.log(sq + 1); };
    const c = v0 - vRaw(R0);
    return {
      kind: "radialFall", lamMin: -Infinity, lamMax: (2 / 3) * Math.pow(R0, 1.5) * (1 - 1e-9),
      state(lam) {
        const x = Math.pow(R0, 1.5) - 1.5 * lam, r = x > 0 ? Math.pow(x, 2 / 3) : 1e-12, sq = Math.sqrt(r);
        const v = vRaw(r) + c;
        return { r, rhat, t: v - rStar(r), v, ut: 1 / (1 - 1 / r), ur: -1 / sq, vtan: [0, 0, 0], dvdlam: sq / (sq + 1) };
      },
    };
  }
  // samples {lam: [...], t: [...], pos: [[x,y,z], ...]} with lam monotone (proper
  // time, or t itself outside the horizon); Catmull-Rom in lam, the 4-velocity
  // from the derivative normalized to proper time.  The multiplayer layer will
  // feed this.
  function sampledWorldline(o) {
    const L = o.lam, T = o.t, X = o.pos, N = L.length;
    const at = (arr, i) => arr[Math.min(Math.max(i, 0), N - 1)];
    function interp(lam) {
      let i = 0;
      while (i < N - 2 && L[i + 1] <= lam) i++;
      const h = L[i + 1] - L[i], u = Math.min(Math.max((lam - L[i]) / h, 0), 1);
      const cr = (p0, p1, p2, p3) => {
        const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3, b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3, c = -0.5 * p0 + 0.5 * p2;
        return [((a * u + b) * u + c) * u + p1, (3 * a * u + 2 * b) * u + c];
      };
      const tt = cr(at(T, i - 1), T[i], T[i + 1], at(T, i + 2));
      const xs = [0, 1, 2].map(k => cr(at(X, i - 1)[k], X[i][k], X[i + 1][k], at(X, i + 2)[k]));
      return { t: tt[0], dt: tt[1] / h, x: xs.map(q => q[0]), dx: xs.map(q => q[1] / h) };
    }
    return {
      kind: "samples", lamMin: L[0], lamMax: L[N - 1],
      state(lam) {
        const q = interp(lam), r = norm(q.x), rhat = scale(1 / r, q.x);
        const dr = dot(q.dx, rhat), dtan = sub(q.dx, scale(dr, rhat)), A = 1 - 1 / r;
        const Nn = 1 / Math.sqrt(A * q.dt * q.dt - dr * dr / A - dot(dtan, dtan));
        return { r, rhat, t: q.t, v: q.t + rStar(r), ut: q.dt * Nn, ur: dr * Nn, vtan: scale(Nn, dtan), dvdlam: q.dt + dr / A };
      },
    };
  }
  function makeWorldline(traj) {
    if (traj.kind === "circular") return circularOrbit(traj);
    if (traj.kind === "static") return staticShip(traj);
    if (traj.kind === "radialFall") return radialFall(traj);
    if (traj.kind === "samples") return sampledWorldline(traj);
    throw new Error("unknown trajectory kind " + traj.kind);
  }

  // ---- the camera's boost (freeflight.view_to_camera / view_to_static)
  function viewToCamera(d, beta) {
    const b2 = dot(beta, beta);
    if (b2 === 0) return d;
    const gam = 1 / Math.sqrt(1 - b2), bd = dot(beta, d);
    return unit(scale(1 / (gam * (1 + bd)), add(d, scale((gam - 1) * bd / b2 + gam, beta))));
  }
  const boostFactor = (beta, dCam) => { const b2 = dot(beta, beta); return 1 / ((1 / Math.sqrt(1 - b2)) * (1 - dot(beta, dCam))); };

  function lamAtV(ship, vTarget, lamGuess) {
    const f = l => ship.state(l).v - vTarget;
    const lMin = ship.lamMin, lMax = ship.lamMax;
    lamGuess = Math.min(Math.max(lamGuess, lMin), lMax);
    let lo = Math.max(lamGuess - 1, lMin), hi = Math.min(lamGuess + 1, lMax), h = 1;
    for (let k = 0; k < 80; k++) {
      const flo = f(lo), fhi = f(hi);
      if (flo <= 0 && fhi >= 0) return findRoot(f, lo, hi, flo, fhi, 1e-13);
      if (flo > 0) { if (lo <= lMin) return lMin; hi = lo; lo = Math.max(lo - h, lMin); }
      else { if (hi >= lMax) return lMax; lo = hi; hi = Math.min(hi + h, lMax); }
      h *= 2;
    }
    return lamGuess;
  }
  function geometry(rhatC, st) {
    const rhatS = st.rhat, c = Math.min(Math.max(dot(rhatC, rhatS), -1), 1);
    let e2 = sub(rhatS, scale(c, rhatC));
    e2 = norm(e2) > 1e-12 ? unit(e2) : perp(rhatC);
    const dphi = Math.min(Math.max(Math.acos(c), DPHI_MIN), PI - DPHI_MIN);
    return { rhatS, dphi, e2 };
  }
  function imageAt(cam, ship, n, lam, frame) {
    const st = ship.state(lam), g = geometry(cam.rhat, st);
    const ims = findImages(cam.R, st.r, g.dphi, frame, n);
    for (const im of ims) if (im.n === n) {
      im.st = st; im.lam = lam; im.dphi = g.dphi; im.e2 = g.e2; im.rhatS = g.rhatS;
      im.dv = delayV(im.legs, im.b);
      return im;
    }
    return null;
  }
  // omega_em / E = -k.u / E at the ship (ships.ship_g_inf)
  function shipGInf(st, b, physOut, that) {
    const r = st.r, A = 1 - 1 / r, rad = Math.sqrt(Math.max(1 - A * b * b / (r * r), 0));
    const kr = (physOut ? 1 : -1) * rad;
    return st.ut - kr * st.ur / A + (b / r) * dot(st.vtan, that);
  }

  // one image n of `ship` seen by `cam` = {v, R, rhat, frame, beta}; lamGuess
  // warm-starts the retarded-time solve (ships._solve_image)
  function solveImage(cam, ship, n, lamGuess) {
    const frame = cam.frame === "static" ? "static" : "ffo";
    const beta = cam.beta || [0, 0, 0];
    const st0 = ship.state(lamGuess !== undefined && lamGuess !== null ? lamGuess : 0);
    let lam = lamGuess !== undefined && lamGuess !== null ? lamGuess : lamAtV(ship, cam.v - Math.abs(cam.R - st0.r), 0);
    const lMin = ship.lamMin, lMax = ship.lamMax;
    let lo = null, hi = null, fLo = 0, fHi = 0, im = null, frozen = false;
    for (let it = 0; it < 120; it++) {
      im = imageAt(cam, ship, n, lam, frame);
      let resid;
      if (im === null) resid = Infinity;
      else { resid = im.st.v + im.dv - cam.v; if (Math.abs(resid) < 1e-11) break; }
      if (resid < 0) { lo = lam; fLo = resid; } else { hi = lam; fHi = resid; }
      let lamNew;
      if (lo !== null && hi !== null) {
        if (hi - lo < 1e-13 * Math.max(1, Math.abs(lam))) {
          frozen = im === null;
          if (im === null) { im = imageAt(cam, ship, n, lo, frame); if (im === null) return null; }
          break;
        }
        if (isFinite(fHi)) { lamNew = lo - fLo * (hi - lo) / (fHi - fLo); if (!(lamNew > lo && lamNew < hi)) lamNew = 0.5 * (lo + hi); }
        else lamNew = 0.5 * (lo + hi);
      } else if (im === null) lamNew = lo === null ? lam - 1 : 0.5 * (lo + lam);
      else { lamNew = Math.min(Math.max(lam - resid / Math.max(im.st.dvdlam, 1e-9), lMin), lMax); if (lamNew === lam) break; }
      lam = lamNew;
    }
    if (im === null) return null;
    const st = im.st;
    for (const [k, w1, w2] of im.legs) if (k === 2 && 1 / w2 < 1 + R_FROZEN) frozen = true;
    if (st.r <= 1 + R_FROZEN && cam.R > 1) frozen = true;
    const s = im.s, chi = im.chi;
    const dRef = unit(add(scale(-Math.cos(chi), cam.rhat), scale(s * Math.sin(chi), im.e2)));
    const dCam = dot(beta, beta) > 0 ? viewToCamera(dRef, beta) : dRef;
    const rr = rayFromAngle(cam.R, chi, frame);
    const gCam = rr.gInf0 * boostFactor(beta, dCam);
    const that = add(scale(-Math.sin(im.Phi), cam.rhat), scale(s * Math.cos(im.Phi), im.e2));
    const physOut = im.legs[0][0] === 2;
    const gShip = shipGInf(st, im.b, physOut, that);
    Object.assign(im, { tE: st.t, vE: st.v, rS: st.r, dRef, dCam, gCam, gShip, g: gCam / gShip, frozen, that, physOut, frame });
    return im;
  }
  // angular radii (camera frame) of a sphere of proper radius rho, and the
  // ellipse axes on the camera's sky (ships._sizes)
  function sizes(cam, im, rho) {
    const beta = cam.beta || [0, 0, 0], st = im.st, chi = im.chi, rs = st.r, dphi = im.dphi;
    const boost = boostFactor(beta, im.dCam);
    let aOut = Math.sin(dphi) > 1e-8 ? rho * Math.sin(chi) / (rs * Math.sin(dphi)) * boost : null;
    const eInRef = unit(cross(cross(im.dRef, scale(-1, cam.rhat)), im.dRef));
    let eIn = eInRef;
    if (dot(beta, beta) > 0) {
      const q = viewToCamera(unit(add(im.dRef, scale(1e-5, eInRef))), beta);
      eIn = unit(sub(q, scale(dot(q, im.dCam), im.dCam)));
    }
    if (rs <= 1) {        // inside the horizon: drawn round with the transverse radius
      Object.assign(im, { aIn: aOut, aOut, eIn, eOut: cross(im.dCam, eIn) });
      return;
    }
    const As = 1 - 1 / rs, rad = Math.sqrt(Math.max(1 - As * im.b * im.b / (rs * rs), 0));
    const sig = im.physOut ? 1 : -1;
    const nTr = add(scale(-sig * rad, im.rhatS), scale(im.b * Math.sqrt(As) / rs, im.that));
    const mPerp = unit(cross(cross(im.rhatS, im.that), nTr));
    const eps = 1e-4, chis = [];
    for (const sgn of [1, -1]) {
      const dx = scale(sgn * eps, add(scale(dot(mPerp, im.that), im.that), scale(Math.sqrt(As) * dot(mPerp, im.rhatS), im.rhatS)));
      const x = add(scale(rs, im.rhatS), dx), r2 = norm(x), rh2 = scale(1 / r2, x);
      const d2 = Math.acos(Math.min(Math.max(dot(cam.rhat, rh2), -1), 1));
      const got = findImages(cam.R, r2, Math.min(Math.max(d2, DPHI_MIN), PI - DPHI_MIN), im.frame, im.n).filter(q => q.n === im.n);
      chis.push(got.length ? got[0].chi : NaN);
    }
    const aIn = rho * Math.abs(chis[0] - chis[1]) / (2 * eps) * boost;
    if (aOut === null) aOut = aIn;
    Object.assign(im, { aIn, aOut, eIn, eOut: cross(im.dCam, eIn) });
  }
  // crossing geometry (disk.crossing_geometry_general): phi_1 of the traced ray's plane
  function phi1Of(rhatC, dRef, zd) {
    const dn = dot(dRef, rhatC), s = Math.max(Math.sqrt(Math.max(1 - dn * dn, 0)), 1e-9);
    const e2 = scale(1 / s, sub(dRef, scale(dn, rhatC)));
    let phi1 = Math.atan2(-dot(rhatC, zd), dot(e2, zd));
    phi1 = ((phi1 % PI) + PI) % PI;
    return phi1 < 1e-9 ? PI : phi1;
  }
  function diskHides(cam, im, zd, rIn, rOut) {
    const phi1 = phi1Of(cam.rhat, im.dRef, zd);
    for (let k = 0; k < 5; k++) {
      const f = phi1 + k * PI;
      if (f >= im.Phi - 1e-9) return false;     // a crossing at the ship itself does not hide it
      const r = radiusAtAzimuth(im.ray, f);
      if (r !== null && r >= rIn && r <= rOut) return true;
    }
    return false;
  }
  // all images n <= nMax of a ship, as the camera sees them now.  opts:
  // {rho, diskNormal, rIn, rOut, lamGuess (per image, warm start)}
  function viewShip(cam, ship, nMax, opts) {
    opts = opts || {};
    const out = [];
    for (let n = 0; n <= nMax; n++) {
      const im = solveImage(cam, ship, n, opts.lamGuess ? opts.lamGuess[n] : undefined);
      if (!im) continue;
      if (opts.rho > 0 && !im.frozen) sizes(cam, im, opts.rho);
      im.hidden = (opts.diskNormal && !im.frozen) ? diskHides(cam, im, opts.diskNormal, opts.rIn || 3, opts.rOut || 12) : false;
      out.push(im);
    }
    return out;
  }
  // the camera's ingoing EF clock: dv/dtau for a pilot (E, L, rd) at R, the
  // radial faller (E = 1, L = 0) and a camera at rest (index.html)
  const dvdtauPilot = (R, E, L, rd) => (1 + L * L / (R * R)) / (E - rd / Math.sqrt(R));
  const dvdtauFall = R => Math.sqrt(R) / (Math.sqrt(R) + 1);
  const dvdtauRest = R => 1 / Math.sqrt(1 - 1 / R);
  // v along the E = 1 radial fall up to a constant (radialFall above)
  const vFallRaw = r => { const sq = Math.sqrt(r); return -(2 / 3) * r * sq - 2 * sq + r + 2 * Math.log(sq + 1); };

  return { B_CR, roots, legIntegral, makeRay, sweeps, delayV, radiusAtAzimuth, rayFromAngle, branches,
           imagePhi, findImages, makeWorldline, circularOrbit, staticShip, radialFall, sampledWorldline,
           viewToCamera, boostFactor, lamAtV, solveImage, sizes, viewShip, diskHides, phi1Of, rStar,
           dvdtauPilot, dvdtauFall, dvdtauRest, vFallRaw, N_PANEL };
});
