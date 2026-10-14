/* Ship Street Ventures: interactive pixel fields.
   One grid language across the page: the cursor paints heat, cells brighten up the
   brand colour ramps, press-and-hold charges a burst, and an idle field spells a word.
   Touch devices get a scroll-driven version; reduced-motion gets a still frame. */
(function () {
  "use strict";

  var REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COARSE = window.matchMedia("(hover: none), (pointer: coarse)").matches;

  /* brand ramps: navy, steel, orange, deep orange; each mixed toward white in 6 steps */
  var BASES = ["#1e3d59", "#48749e", "#fa9819", "#f45f00"];
  var MIX = [0.86, 0.7, 0.5, 0.28, 0.1, 0];
  var LEVELS = MIX.length - 1;
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  var RAMPS = BASES.map(function (h) {
    var c = hexRgb(h);
    return MIX.map(function (m) {
      var r = Math.round(c[0] + (252 - c[0]) * m), g = Math.round(c[1] + (252 - c[1]) * m), b = Math.round(c[2] + (252 - c[2]) * m);
      return { css: "rgb(" + r + "," + g + "," + b + ")", rgb: [r, g, b] };
    });
  });
  function nearest(r, g, b) {
    var br = 0, bl = 3, bd = Infinity;
    for (var i = 0; i < RAMPS.length; i++) for (var j = 0; j < RAMPS[i].length; j++) {
      var p = RAMPS[i][j].rgb, d = (r - p[0]) * (r - p[0]) + (g - p[1]) * (g - p[1]) + (b - p[2]) * (b - p[2]);
      if (d < bd) { bd = d; br = i; bl = j; }
    }
    return { ramp: br, level: bl };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hash(i, k) { var v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); }
  function seeded(seed) { return function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

  /* run a loop only while its element is on screen */
  function whenVisible(el, start, stop) {
    if (!("IntersectionObserver" in window)) { start(); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { e.isIntersecting ? start() : stop(); }); }, { rootMargin: "80px" }).observe(el);
  }

  /* ---------------------------------------------------------------
     HeatField: a canvas grid with an ambient base pattern + cursor heat
     --------------------------------------------------------------- */
  function HeatField(canvas, o) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.o = o;
    this.host = o.host || canvas;
    this.t = 0; this.last = 0; this.raf = 0; this.running = false;
    this.px = -1; this.py = -1; this.inside = false;
    this.lastAct = performance.now(); this.charging = false; this.charge = 0;
    this.waves = []; this.sparks = []; this.word = null; this.wordIdx = 0; this.wordT = 0;
    var self = this;
    this.build();
    var lw = window.innerWidth;
    window.addEventListener("resize", function () { if (window.innerWidth !== lw || !self.cols) { lw = window.innerWidth; self.build(); if (REDUCE) self.frame(0); } });
    if (o.interactive !== false && !COARSE) this.bindPointer();
    this.loop = this.loop.bind(this);
    if (REDUCE) { this.frame(0); return; }
    whenVisible(this.c, function () { if (!self.running) { self.running = true; self.last = 0; self.raf = requestAnimationFrame(self.loop); } },
      function () { self.running = false; cancelAnimationFrame(self.raf); });
  }
  HeatField.prototype.build = function () {
    var c = this.c, dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    var cell = this.o.cell || 6, gap = this.o.gap || 2.4, step = cell + gap;
    this.cell = cell; this.step = step;
    this.cols = Math.ceil(w / step); this.rows = Math.ceil(h / step);
    var n = this.cols * this.rows;
    this.heat = new Float32Array(n);
    this.ramp = new Int8Array(n).fill(-1); this.lvl = new Int8Array(n);
    this.ph = new Float32Array(n); this.sp = new Float32Array(n); this.ph2 = new Float32Array(n); this.sp2 = new Float32Array(n);
    this.amp = new Float32Array(n); this.blink = new Float32Array(n); this.hue = new Float32Array(n);
    this.sR = new Int8Array(n); this.sL = new Int8Array(n);
    var rnd = seeded(20260821), sample = this.o.sampler ? this.o.sampler(this.cols, this.rows) : null;
    for (var y = 0; y < this.rows; y++) for (var x = 0; x < this.cols; x++) {
      var i = y * this.cols + x, nx = this.cols > 1 ? x / (this.cols - 1) : 0, ny = this.rows > 1 ? y / (this.rows - 1) : 0;
      var info = this.o.field ? this.o.field(nx, ny, rnd, sample, x, y) : null;
      if (info) { this.ramp[i] = info.ramp; this.lvl[i] = info.level; }
      if (this.o.dynamic) {
        var q = { ramp: nx > 0.6 ? 2 : 1, level: 3 };
        if (sample) { var si = (y * sample.width + x) * 4; q = nearest(sample.data[si], sample.data[si + 1], sample.data[si + 2]); }
        this.sR[i] = q.ramp; this.sL[i] = q.level;
      }
      this.ph[i] = rnd() * 6.283; this.sp[i] = 1.6 + rnd() * 3.4; this.ph2[i] = rnd() * 6.283; this.sp2[i] = 0.9 + rnd() * 2.6;
      this.amp[i] = 1 + rnd() * 1.8; this.blink[i] = rnd() * 0.5 + 0.5; this.hue[i] = rnd();
    }
    this.word = null;
  };
  HeatField.prototype.bindPointer = function () {
    var self = this, host = this.host;
    function pos(e) { var r = self.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    host.addEventListener("pointermove", function (e) {
      var p = pos(e); self.lastAct = performance.now(); self.inside = true;
      if (self.px < 0) { self.px = p[0]; self.py = p[1]; }
      self.stroke(self.px, self.py, p[0], p[1]);
      self.px = p[0]; self.py = p[1];
    });
    host.addEventListener("pointerleave", function () { self.inside = false; self.px = -1; self.py = -1; self.release(false); });
    if (this.o.charge) {
      host.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || e.target.closest("a,button")) return;
        var p = pos(e); self.px = p[0]; self.py = p[1]; self.charging = true; self.charge = 0; self.lastAct = performance.now();
      });
      window.addEventListener("pointerup", function () { self.release(true); });
      window.addEventListener("pointercancel", function () { self.release(false); });
    }
  };
  HeatField.prototype.release = function (fire) {
    if (!this.charging) return;
    this.charging = false;
    if (fire && this.px >= 0) {
      var power = 0.25 + this.charge;
      this.waves.push({ x: this.px, y: this.py, r: 0, power: power, max: Math.max(this.w, this.h) * (0.25 + power * 0.6) });
      var n = Math.round(10 + power * 40);
      for (var k = 0; k < n; k++) {
        var a = Math.random() * 6.283, s = 2 + Math.random() * 6 * power;
        this.sparks.push({ x: this.px, y: this.py, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 });
      }
    }
    this.charge = 0;
  };
  HeatField.prototype.deposit = function (x, y, amt, sig) {
    var cc = x / this.step, cr = y / this.step, rad = Math.ceil(sig * 1.6), inv = 1 / (2 * sig * sig * 0.18);
    for (var dr = -rad; dr <= rad; dr++) for (var dc = -rad; dc <= rad; dc++) {
      var c = (cc + dc) | 0, r = (cr + dr) | 0;
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
      var dx = c + 0.5 - cc, dy = r + 0.5 - cr, wgt = Math.exp(-(dx * dx + dy * dy) * inv);
      if (wgt < 0.02) continue;
      var i = r * this.cols + c, v = this.heat[i] + amt * wgt; this.heat[i] = v > 1 ? 1 : v;
    }
  };
  /* stamp along the path so fast flicks stay continuous */
  HeatField.prototype.stroke = function (x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0, dl = Math.sqrt(dx * dx + dy * dy), steps = Math.max(1, Math.min(48, Math.round(dl / (this.step * 0.8))));
    var sig = this.o.brush || 5;
    for (var s = 1; s <= steps; s++) { var f = s / steps; this.deposit(x0 + dx * f, y0 + dy * f, this.o.strength || 0.2, sig); }
  };
  /* idle easter egg: rasterise a word into a cell mask */
  HeatField.prototype.makeWord = function (txt) {
    var oc = document.createElement("canvas"), cols = this.cols, rows = this.rows;
    oc.width = cols; oc.height = rows;
    var x = oc.getContext("2d"), size = Math.floor(rows * 0.62);
    x.font = "700 " + size + "px 'Rethink Sans', Arial, sans-serif";
    while (x.measureText(txt).width > cols * 0.8 && size > 6) { size--; x.font = "700 " + size + "px 'Rethink Sans', Arial, sans-serif"; }
    x.fillStyle = "#000"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(txt, cols * 0.5, rows * 0.52);
    var d = x.getImageData(0, 0, cols, rows).data, m = [];
    for (var i = 0; i < cols * rows; i++) if (d[i * 4 + 3] > 110) m.push(i);
    return m;
  };
  HeatField.prototype.loop = function (ts) {
    if (!this.running) return;
    var dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 0.016;
    this.last = ts;
    this.frame(dt);
    this.raf = requestAnimationFrame(this.loop);
  };
  HeatField.prototype.frame = function (dt) {
    if (!this.cols) return;
    this.t += dt;
    var o = this.o, ctx = this.ctx, cols = this.cols, step = this.step, cell = this.cell, t = this.t, heat = this.heat;
    var now = performance.now();

    /* touch: an auto-blob drifts along a path driven by scroll position */
    if (COARSE && o.autoPath && !REDUCE) {
      var r = this.c.getBoundingClientRect(), vh = window.innerHeight || 1;
      var p = clamp(1 - (r.top + r.height) / (vh + r.height), 0, 1);
      var ax = (0.1 + 0.8 * (0.5 + 0.5 * Math.sin(p * 9 + t * 0.4))) * this.w;
      var ay = (0.5 + 0.38 * Math.sin(p * 13 + t * 0.7)) * this.h;
      if (this.px >= 0) this.stroke(this.px, this.py, ax, ay);
      this.px = ax; this.py = ay;
    }
    /* hold to charge: crackle under the pointer while held */
    if (this.charging) {
      this.charge = Math.min(1, this.charge + dt / 2.2);
      for (var k = 0; k < 3; k++) {
        var a = Math.random() * 6.283, rr = (4 + this.charge * 26) * Math.random();
        this.deposit(this.px + Math.cos(a) * rr * 2, this.py + Math.sin(a) * rr * 2, 0.35 + this.charge * 0.4, 2 + this.charge * 3);
      }
    }
    /* shock waves */
    for (var wv = this.waves.length - 1; wv >= 0; wv--) {
      var W = this.waves[wv];
      W.r += (420 + 500 * W.power) * dt;
      var segs = Math.max(12, Math.round(W.r / (step * 0.9))), fade = 1 - W.r / W.max;
      for (var s = 0; s < segs; s++) {
        var an = (s / segs) * 6.283;
        this.deposit(W.x + Math.cos(an) * W.r, W.y + Math.sin(an) * W.r, 0.5 * fade + 0.1, 2.2);
      }
      if (W.r > W.max) this.waves.splice(wv, 1);
    }
    /* sparks */
    for (var sp = this.sparks.length - 1; sp >= 0; sp--) {
      var S = this.sparks[sp];
      S.x += S.vx; S.y += S.vy; S.vx *= 0.96; S.vy *= 0.96; S.life -= dt * 1.1;
      if (S.life > 0) this.deposit(S.x, S.y, 0.5 * S.life, 1.4); else this.sparks.splice(sp, 1);
    }
    /* idle: spell a word, then let it go */
    if (o.words && !COARSE && !REDUCE) {
      var idle = (now - this.lastAct) / 1000;
      if (idle > (o.idleAfter || 7)) {
        if (!this.word) { this.word = this.makeWord(o.words[this.wordIdx % o.words.length]); this.wordIdx++; this.wordT = 0; }
        this.wordT += dt;
        var reveal = Math.min(1, this.wordT / 1.6), hold = this.wordT < 5.5;
        if (hold) for (var wi = 0; wi < this.word.length; wi++) {
          var idx = this.word[wi], col = idx % cols;
          if (col / cols > reveal) continue;
          var target = 0.62 + 0.12 * Math.sin(t * 3 + col * 0.25);
          if (heat[idx] < target) heat[idx] += (target - heat[idx]) * 0.18;
        }
        if (this.wordT > 9) { this.word = null; this.lastAct = now - (o.idleAfter || 7) * 1000 + 3000; }
      } else this.word = null;
    }

    ctx.clearRect(0, 0, this.w, this.h);
    if (o.rule) {
      ctx.strokeStyle = "rgba(30,61,89,0.05)"; ctx.lineWidth = 1;
      for (var lx = 0; lx < this.w; lx += step * 8) { ctx.beginPath(); ctx.moveTo(Math.round(lx) + 0.5, 0); ctx.lineTo(Math.round(lx) + 0.5, this.h); ctx.stroke(); }
    }
    var sweep = (t * 0.32) % 1.8 - 0.4, decay = Math.pow(o.decay || 0.93, dt * 60), dark = !!o.dark;
    for (var i = 0, n = heat.length; i < n; i++) {
      var h = heat[i];
      if (h > 0.002) heat[i] = h * decay; else { heat[i] = 0; h = 0; }
      var base = this.ramp[i], baseLvl = this.lvl[i], x = (i % cols) * step, y = ((i / cols) | 0) * step, lvl, ramp;
      if (o.dynamic) {
        /* living field: drifting density blobs, each cell re-rolls its own coin at its own pace */
        var cx = i % cols, cy = (i / cols) | 0, slot = Math.floor(t * this.sp2[i] * 0.55 + this.ph2[i]);
        if (hash(i, slot) < o.dynamic(cx / cols, cy / this.rows, t)) {
          var sc = cy * cols + ((cx + Math.floor(t * 5)) % cols);
          base = this.sR[sc]; baseLvl = this.sL[sc] + (hash(i, slot + 31) > 0.6 ? 1 : 0);
        } else base = -1;
      }
      if (base >= 0) {
        if (!o.dynamic && h < 0.15 && Math.sin(t * this.sp2[i] + this.ph2[i]) > this.blink[i] + 0.34) continue;
        lvl = baseLvl + Math.round(Math.sin(t * this.sp[i] + this.ph[i]) * (o.dynamic ? 0.6 : this.amp[i]));
        var d = Math.abs((i % cols) / cols - sweep);
        if (d < 0.1) lvl -= Math.round((1 - d / 0.1) * 2.4);
        ramp = base;
        if (this.word && h < 0.3) lvl -= 2;
        if (h > 0.08) { lvl += Math.round(h * 4); if (h > 0.45) ramp = h > 0.75 ? 3 : 2; }
      } else {
        if (h < 0.06) continue;
        ramp = h > 0.6 ? 3 : h > 0.32 ? 2 : (this.hue[i] > 0.5 ? 1 : 0);
        lvl = Math.round(h * LEVELS + 1);
      }
      lvl = clamp(lvl, 0, LEVELS);
      if (dark) { ctx.globalAlpha = base >= 0 ? 0.5 + h * 0.3 : clamp(h * 1.2, 0, 0.72); }
      ctx.fillStyle = RAMPS[ramp][lvl].css;
      ctx.fillRect(x, y, cell, cell);
    }
    if (dark) ctx.globalAlpha = 1;
  };

  /* ---------------------------------------------------------------
     FlowField: cells with home positions on a spring.
     "Dropped in" = stiff blocks that snap back to the old process.
     "Rebuilt"    = a fluid band that parts around you and re-forms.
     --------------------------------------------------------------- */
  function FlowField(canvas, mode) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.mode = mode;
    this.mx = -999; this.my = -999; this.t = 0; this.last = 0; this.running = false;
    var self = this;
    this.build();
    var lw = window.innerWidth;
    window.addEventListener("resize", function () { if (window.innerWidth !== lw) { lw = window.innerWidth; self.build(); if (REDUCE) self.frame(0); } });
    if (!COARSE) {
      canvas.addEventListener("pointermove", function (e) { var r = canvas.getBoundingClientRect(); self.mx = e.clientX - r.left; self.my = e.clientY - r.top; });
      canvas.addEventListener("pointerleave", function () { self.mx = -999; self.my = -999; });
    }
    this.loop = this.loop.bind(this);
    if (REDUCE) { this.frame(0); return; }
    whenVisible(canvas, function () { if (!self.running) { self.running = true; self.last = 0; self.raf = requestAnimationFrame(self.loop); } },
      function () { self.running = false; cancelAnimationFrame(self.raf); });
  }
  FlowField.prototype.build = function () {
    var c = this.c, dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h; this.cell = 6; this.step = 8.4;
    var st = this.step, cols = Math.floor(w / st), rows = Math.floor(h / st), rnd = seeded(7 + (this.mode === "native" ? 99 : 0)), P = [];
    this.cols = cols; this.rows = rows;
    if (this.mode === "drop") {
      /* five rigid process boxes joined by thin handoff lines; work items queue at every box */
      var boxes = 5, bw = Math.max(3, Math.floor((cols - 6) / boxes) - 3), bh = Math.max(4, Math.floor(rows * 0.42)), top = Math.floor((rows - bh) / 2);
      var gapC = Math.max(2, Math.floor((cols - boxes * bw) / (boxes + 1)));
      this.boxes = []; this.lineY = (top + Math.floor(bh / 2)) * st;
      for (var b = 0; b < boxes; b++) {
        var left = gapC + b * (bw + gapC);
        this.boxes.push({ x0: left * st, x1: (left + bw) * st, cx: (left + bw / 2) * st, busy: 0 });
        for (var y = 0; y < bh; y++) for (var x = 0; x < bw; x++) {
          P.push({ hx: (left + x) * st, hy: (top + y) * st, ramp: rnd() > 0.88 ? 1 : 0, lvl: 2 + Math.round(rnd() * 2), box: b, rate: 0.4 + rnd() * 1.4 });
        }
        if (b < boxes - 1) for (var hx = left + bw; hx < left + bw + gapC; hx++) P.push({ hx: hx * st, hy: this.lineY, ramp: 1, lvl: 1, link: true, box: -1, rate: 0 });
      }
      this.tokens = [];
      for (var k = 0; k < 3; k++) this.tokens.push({ x: -st * 2 - k * w * 0.36, stop: 0, wait: 0 });
    } else {
      /* one continuous stream: wide and noisy on the left, narrowing into a clean fast lane on the right */
      var n = Math.round(cols * rows * 0.34);
      for (var i = 0; i < n; i++) P.push({ hx: rnd() * w, q: rnd() - 0.5, ph: rnd() * 6.28, sp: 0.6 + rnd() * 0.8 });
    }
    P.forEach(function (p) { p.x = p.hx; p.y = p.hy || 0; p.vx = 0; p.vy = 0; p.ph = p.ph || rnd() * 6.28; });
    this.P = P;
  };
  FlowField.prototype.loop = function (ts) {
    if (!this.running) return;
    var dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 0.016; this.last = ts;
    this.frame(dt); this.raf = requestAnimationFrame(this.loop);
  };
  FlowField.prototype.frame = function (dt) {
    if (!this.P) return;
    this.t += dt;
    var ctx = this.ctx, st = this.step, cell = this.cell, t = this.t, P = this.P, native = this.mode === "native", w = this.w, h = this.h;
    var mx = this.mx, my = this.my;
    if (COARSE && !REDUCE) { mx = (0.5 + 0.45 * Math.sin(t * 0.5)) * w; my = (0.5 + 0.3 * Math.sin(t * 0.9)) * h; }
    var R = native ? 70 : 46, F = native ? 2400 : 900, K = native ? 3.2 : 26, D = native ? 0.86 : 0.7;
    ctx.clearRect(0, 0, w, h);

    if (!native) {
      /* work items: travel the handoff line, then sit and wait inside every box */
      var B = this.boxes;
      B.forEach(function (b) { b.busy = Math.max(0, b.busy - dt * 2); });
      for (var k = 0; k < this.tokens.length; k++) {
        var T = this.tokens[k];
        if (T.wait > 0) { T.wait -= dt; if (B[T.stop - 1]) B[T.stop - 1].busy = 1; continue; }
        var target = T.stop < B.length ? B[T.stop].cx : w + st * 4;
        T.x += 70 * dt;
        if (T.x >= target) {
          if (T.stop < B.length) { T.x = target; T.wait = 0.8 + Math.random() * 1.6; T.stop++; }
          else { T.x = -st * 3 - Math.random() * w * 0.3; T.stop = 0; }
        }
      }
    }
    for (var i = 0; i < P.length; i++) {
      var p = P[i], hx, hy, ramp, lvl, nx = 0;
      if (native) {
        /* the stream moves; faster once it's resolved */
        nx = p.hx / w;
        p.hx += (22 + 70 * nx) * p.sp * dt;
        if (p.hx > w + st) { p.hx = -st * Math.random() * 3; p.x = p.hx; p.q = Math.random() - 0.5; }
        nx = clamp(p.hx / w, 0, 1);
        var thick = h * (0.42 - nx * 0.3), mid = h * 0.5 + Math.sin(nx * 5.2 - t * 0.8) * h * 0.1 * (1 - nx * 0.7);
        var noise = Math.sin(t * 2.3 * p.sp + p.ph) * (1 - nx) * 9;
        hx = p.hx; hy = mid + p.q * thick + noise;
        ramp = nx < 0.42 ? 0 : nx < 0.72 ? 1 : 2;
        lvl = 1 + Math.round((0.5 - Math.abs(p.q)) * 6 * (0.4 + nx));
      } else {
        hx = p.hx; hy = p.hy; ramp = p.ramp; lvl = p.lvl;
        if (!p.link) {
          var bx = this.boxes[p.box];
          /* each box re-shuffles its own cells; a box with work in it churns harder */
          var rate = p.rate * (1 + bx.busy * 3), slot = Math.floor(t * rate + p.ph);
          if (hash(i, slot) > 0.8 - bx.busy * 0.1) continue;
          if (bx.busy > 0.2 && hash(i, slot + 5) > 0.7) { ramp = 1; lvl = 3; }
        }
      }
      var dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy, near = 0;
      if (d2 < R * R) { var d = Math.sqrt(d2) || 1, f = 1 - d / R; near = f; p.vx += (dx / d) * f * F * dt; p.vy += (dy / d) * f * F * dt; }
      p.vx += (hx - p.x) * K * dt; p.vy += (hy - p.y) * K * dt;
      if (!native) p.vx += (Math.random() - 0.5) * 6 * dt;
      p.vx *= D; p.vy *= D; p.x += p.vx; p.y += p.vy;
      var disp = Math.min(1, Math.sqrt((p.x - hx) * (p.x - hx) + (p.y - hy) * (p.y - hy)) / 30);
      if (native) { if (near > 0.15 || disp > 0.3) { ramp = disp > 0.6 ? 3 : 2; lvl = 3 + Math.round(disp * 2); } }
      else if (disp > 0.25) { ramp = 3; lvl = 2 + Math.round(disp * 3); }
      lvl = clamp(lvl, 0, LEVELS);
      ctx.fillStyle = RAMPS[ramp][lvl].css;
      ctx.fillRect(Math.round(p.x / st) * st, Math.round(p.y / st) * st, cell, cell);
    }
    if (!native) {
      /* draw the work items on top: a 2x2 orange block */
      ctx.fillStyle = RAMPS[3][5].css;
      for (var j = 0; j < this.tokens.length; j++) {
        var tk = this.tokens[j], tx = Math.round(tk.x / st) * st, ty = Math.round(this.lineY / st) * st;
        if (tx < -st || tx > w) continue;
        ctx.fillRect(tx, ty - st, cell, cell); ctx.fillRect(tx + st, ty - st, cell, cell);
        ctx.fillRect(tx, ty, cell, cell); ctx.fillRect(tx + st, ty, cell, cell);
      }
    }
  };

  /* ---------------------------------------------------------------
     Service rows: the row number scrambles on hover
     --------------------------------------------------------------- */
  var GLYPHS = "#%&*+=<>/\\|?0123456789";
  function scramble(el, finalText, ms) {
    if (REDUCE) { el.textContent = finalText; return; }
    var start = performance.now(), len = finalText.length;
    (function tick(now) {
      var p = Math.min(1, (now - start) / ms), out = "";
      for (var i = 0; i < len; i++) {
        var ch = finalText[i];
        if (ch === " " || ch === "\n" || i / len < p * 1.15 - 0.15) out += ch;
        else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = finalText;
    })(start);
  }
  /* ---------------------------------------------------------------
     Headlines decode from pixel noise as they enter the screen
     --------------------------------------------------------------- */
  function decodeHeadings() {
    var els = [].slice.call(document.querySelectorAll("[data-decode]"));
    if (REDUCE || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var el = e.target, txt = el.textContent;
        el.setAttribute("aria-label", txt);
        el.style.minHeight = el.offsetHeight + "px";
        scramble(el, txt, 700);
        setTimeout(function () { el.style.minHeight = ""; el.removeAttribute("aria-label"); }, 1000);
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* gentle rise-in for blocks */
  function reveals() {
    if (REDUCE || !("IntersectionObserver" in window)) return;
    var els = [].slice.call(document.querySelectorAll(".view-body > p, .steps li, .row, .sector, .contact h2, .cmp"));
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) return;           /* already on screen: leave it alone */
      el.classList.add("reveal"); el.style.animationDelay = ((i % 4) * 70) + "ms"; io.observe(el);
    });
  }

  /* ---------------------------------------------------------------
     Wire it up
     --------------------------------------------------------------- */
  function heroField(img) {
    var cv = document.getElementById("heroField"); if (!cv) return;
    var sampler = function (cols, rows) {
      if (!img) return null;
      try { var oc = document.createElement("canvas"); oc.width = cols; oc.height = rows; var x = oc.getContext("2d"); x.drawImage(img, 0, 0, cols, rows); return x.getImageData(0, 0, cols, rows); }
      catch (e) { return null; }
    };
    new HeatField(cv, {
      host: document.getElementById("heroBand"), cell: 6, gap: 2.4, rule: true, sampler: sampler,
      brush: 6, strength: 0.22, decay: 0.95, charge: true, autoPath: true,
      words: ["HUMAN", "SHIP IT", "WORK", "HELLO"], idleAfter: 7,
      dynamic: function (nx, ny, t) {
        /* clusters that drift, merge and split; the band itself undulates */
        var u = nx - t * 0.035;
        var mid = 0.52 + 0.09 * Math.sin(u * 5.5 + t * 0.45);
        var vert = 1 - Math.pow(Math.abs(ny - mid) * 2.1, 1.6);
        if (vert <= 0) return 0;
        var b1 = 0.5 + 0.5 * Math.sin(u * 7.3 + t * 0.32) * Math.cos(ny * 5.1 - t * 0.27);
        var b2 = 0.5 + 0.5 * Math.sin((u * 3.1 + ny * 2.3) * 2.7 - t * 0.21);
        var b3 = 0.5 + 0.5 * Math.sin(u * 13 - ny * 9 + t * 0.6);
        var horiz = 0.45 + 0.55 * Math.pow(nx, 0.6);
        return clamp(vert * (0.18 + 0.5 * b1 + 0.3 * b2 + 0.15 * b3) * horiz * 1.05, 0, 0.95);
      }
    });
  }

  function init() {
    var img = new Image();
    img.onload = function () { heroField(img); };
    img.onerror = function () { heroField(null); };
    img.src = "assets/gradient-2.png";

    var drop = document.getElementById("dropField"), nat = document.getElementById("nativeField");
    if (drop) new FlowField(drop, "drop");
    if (nat) new FlowField(nat, "native");

    var contact = document.getElementById("contactField");
    if (contact) new HeatField(contact, {
      host: contact.parentElement, cell: 7, gap: 3, dark: true, brush: 5, strength: 0.18, decay: 0.94, charge: true
    });

    [].forEach.call(document.querySelectorAll(".row"), function (row) {
      var num = row.querySelector(".row-n");
      function go() { if (num) scramble(num, num.getAttribute("data-n"), 420); }
      row.addEventListener("mouseenter", go); row.addEventListener("focus", go);
    });
    decodeHeadings();
    reveals();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
