// Wisp ad animation runtime.
//
// Slides are static unless the page is opened with ?anim. In anim mode every slide registers its
// motion with WispAnim.slide(k => …); the renderer then calls WispAnim.start() once and
// WispAnim.seek(t) for every video frame, so each frame is exact and reproducible (no clocks, no
// requestAnimationFrame). All motion uses the Web Animations API, paused and scrubbed by seek().

(() => {
  const enabled = /[?&]anim\b/.test(location.search);
  const specs = [];
  const pending = [];
  const renderers = [];

  // ---------- easing ----------
  // A damped spring baked into a CSS linear() easing. zeta < 1 overshoots; lower = bouncier.
  function spring(zeta = 0.55, samples = 48) {
    const w = 6.4 / zeta; // settles (to ~0.2%) at the end of the animation
    const wd = w * Math.sqrt(1 - zeta * zeta);
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
      pts.push(`${x.toFixed(4)} ${(t * 100).toFixed(2)}%`);
    }
    pts[pts.length - 1] = "1 100%";
    return `linear(${pts.join(", ")})`;
  }
  const EASE = {
    out: "cubic-bezier(.16, 1, .3, 1)",
    in: "cubic-bezier(.7, 0, .84, 0)",
    inout: "cubic-bezier(.65, 0, .35, 1)",
    back: "cubic-bezier(.34, 1.56, .64, 1)",
    linear: "linear",
    spring: spring(0.5),
    soft: spring(0.72),
    bouncy: spring(0.36),
  };

  // Seeded random so every render of a slide is identical.
  function rng(seed) {
    let a = 0;
    for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const $ = (s, root = document) => (typeof s === "string" ? root.querySelector(s) : s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const P = (px = 1400) => `perspective(${px}px)`;

  // Animate at slide time `at` for `dur` seconds. fill:both, so the first keyframe holds before `at`.
  function A(el, frames, at, dur, ease = "out", opts = {}) {
    el = $(el);
    if (!el) throw new Error("anim target not found");
    return el.animate(frames, {
      delay: at * 1000,
      duration: Math.max(1, dur * 1000),
      easing: EASE[ease] || ease,
      fill: "both",
      ...opts,
    });
  }
  // An extra layer of motion on top of whatever else animates the element (shake, idle float, …).
  const add = (el, frames, at, dur, ease = "linear", opts = {}) =>
    A(el, frames, at, dur, ease, { fill: "forwards", composite: "add", ...opts });
  // Endless back-and-forth idle motion that starts at `at`.
  const idle = (el, frames, period, at = 0, opts = {}) =>
    A(el, frames, at, period / 2, "inout", { fill: "forwards", composite: "add", iterations: Infinity, direction: "alternate", ...opts });
  // Hide until `at` (visibility doesn't flatten 3D, unlike opacity).
  const showAt = (el, at) => A(el, [{ visibility: "hidden" }, { visibility: "visible" }], at, 0.001, "linear");

  // Wrap every word (or character) in a span so it can be animated. textContent stays identical.
  function split(el, mode = "word", block = false) {
    el = $(el);
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) if (!walk.currentNode.parentElement.closest("[data-deco]")) nodes.push(walk.currentNode);
    for (const node of nodes) {
      const parts = mode === "char" ? [...node.textContent] : node.textContent.split(/([ \t\n\r]+)/);
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        if (!part) continue;
        if (mode === "word" && /^[ \t\n\r]+$/.test(part)) { frag.append(part); continue; }
        const s = document.createElement("span");
        s.className = mode === "char" ? "ch" : "w";
        if (block) s.style.display = "inline-block";
        s.textContent = part;
        frag.append(s);
        out.push(s);
      }
      node.replaceWith(frag);
    }
    return out;
  }
  const words = (el, block = false) => split(el, "word", block);
  const chars = (el) => split(el, "char");

  // ---------- building blocks ----------
  const pop = (el, at, { from = 0.2, rot = 0, y = 0, dur = 0.5, ease = "spring" } = {}) =>
    A(el, [
      { transform: `translateY(${y}px) scale(${from}) rotate(${rot}deg)`, opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: "none", opacity: 1 },
    ], at, dur, ease);

  const slam = (el, at, { from = 2.6, dur = 0.26, blur = 14 } = {}) =>
    A(el, [
      { transform: `scale(${from})`, opacity: 0, filter: `blur(${blur}px)` },
      { opacity: 1, offset: 0.35 },
      { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
    ], at, dur, "in");

  const rise = (el, at, { y = 70, dur = 0.45, ease = "spring" } = {}) =>
    A(el, [{ transform: `translateY(${y}px)`, opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: "none", opacity: 1 }], at, dur, ease);

  const stagger = (els, at, step, fn) => els.forEach((e, i) => fn(e, at + i * step, i));

  // Words stream in like an AI answer: fade + a violet glow that cools off.
  const stream = (el, at, span) => {
    const ws = words(el);
    const step = ws.length > 1 ? span / (ws.length - 1) : 0;
    ws.forEach((w, i) =>
      A(w, [
        { opacity: 0, textShadow: "0 0 22px rgba(173,145,255,1)" },
        { opacity: 1, textShadow: "0 0 18px rgba(173,145,255,.9)", offset: 0.3 },
        { opacity: 1, textShadow: "0 0 0 rgba(173,145,255,0)" },
      ], at + i * step, 0.28, "out"));
    return ws;
  };

  // A card that flies up out of the screen in 3D.
  const fly3d = (el, at, { dur = 0.6, rx = 42, ry = -8, y = 300, z = -300 } = {}) =>
    A(el, [
      { transform: `${P(1600)} translate3d(0, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg)`, opacity: 0 },
      { opacity: 1, offset: 0.25 },
      { transform: `${P(1600)} translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg)`, opacity: 1 },
    ], at, dur, "spring");

  // 3D flip around an axis (hinged on an edge via transform-origin set by the caller).
  const flip = (el, at, { axis = "X", deg = -90, dur = 0.55, ease = "spring", persp = 1200 } = {}) =>
    A(el, [
      { transform: `${P(persp)} rotate${axis}(${deg}deg)`, opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: `${P(persp)} rotate${axis}(0deg)`, opacity: 1 },
    ], at, dur, ease);

  const shake = (el, at, amp = 14, dur = 0.24) => {
    const f = [];
    const r = rng("shake" + at);
    for (let i = 0; i <= 8; i++) {
      const k = (1 - i / 8) * amp;
      f.push({ transform: i === 8 ? "translate(0px, 0px)" : `translate(${((r() - 0.5) * 2 * k).toFixed(1)}px, ${((r() - 0.5) * 2 * k).toFixed(1)}px)` });
    }
    return add(el, f, at, dur);
  };

  // A glossy light sweep across a pill/chip/tile.
  function shine(el, at, dur = 0.55) {
    el = $(el);
    el.style.position = el.style.position || "relative";
    el.style.overflow = "hidden";
    const s = document.createElement("i");
    s.className = "shine";
    s.dataset.deco = "";
    el.append(s);
    return A(s, [{ transform: "translateX(-120%) skewX(-18deg)" }, { transform: "translateX(420%) skewX(-18deg)" }], at, dur, "inout");
  }

  // Solid 3D depth for big type: stacked copies pushed back in Z. The text moves into an inner
  // 3D layer (returned) so animating it never moves the block's own layout box.
  function extrude(el, { layers = 14, step = 2.4, from = "5b43b8", to = "1a1330" } = {}) {
    el = $(el);
    const text = el.textContent;
    const inner = document.createElement("span");
    inner.className = "x3d";
    inner.style.cssText = "position:relative;display:inline-block;transform-style:preserve-3d;";
    inner.append(...el.childNodes);
    el.append(inner);
    const mix = (a, b, t) => {
      const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
      const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
      return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
    };
    for (let i = layers; i >= 1; i--) {
      const c = document.createElement("span");
      c.dataset.deco = "";
      c.setAttribute("aria-hidden", "true");
      c.className = "xl";
      c.textContent = text;
      c.style.cssText = `position:absolute;inset:0;white-space:nowrap;transform:translateZ(${-i * step}px);color:${mix(from, to, i / layers)};text-shadow:none;pointer-events:none;`;
      inner.prepend(c);
    }
    return inner;
  }

  // Marquee drag: a crosshair drags a dashed capture box over the selection.
  function drag(sel, at, dur = 0.35) {
    sel = $(sel);
    sel.classList.add("has-hl");
    const hl = document.createElement("i");
    hl.className = "hl";
    hl.dataset.deco = "";
    sel.prepend(hl);
    const cur = document.createElement("i");
    cur.className = "xhair";
    cur.dataset.deco = "";
    cur.innerHTML = '<svg viewBox="0 0 64 64"><g stroke-linecap="round"><path d="M32 4v22M32 38v22M4 32h22M38 32h22" stroke="#fff" stroke-width="9"/><path d="M32 4v22M32 38v22M4 32h22M38 32h22" stroke="#15121D" stroke-width="4"/></g><circle cx="32" cy="32" r="3.5" fill="#15121D" stroke="#fff" stroke-width="2"/></svg>';
    sel.append(cur);
    const w = sel.offsetWidth, h = sel.offsetHeight;
    A(cur, [{ transform: "scale(.4)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], at - 0.12, 0.12, "out");
    A(hl, [{ clipPath: "inset(0 100% 100% 0 round 18px)" }, { clipPath: "inset(0 0% 0% 0 round 18px)" }], at, dur, "inout");
    add(cur, [{ transform: "translate(0px, 0px)" }, { transform: `translate(${w}px, ${h}px)` }], at, dur, EASE.inout);
    A(cur, [{ opacity: 1 }, { opacity: 0 }], at + dur + 0.12, 0.15, "out", { fill: "forwards" });
    return at + dur;
  }

  // Answer panel pops out of the selection, hinged at its little pointer.
  function panelIn(panel, at, { dur = 0.5, mode = "pop" } = {}) {
    panel = $(panel);
    const from = {
      pop: `${P(1400)} translateY(-50px) rotateX(-38deg) rotateY(0deg) scale(.7)`,
      flipY: `${P(1400)} translateY(0px) rotateX(0deg) rotateY(85deg) scale(1)`,
      rise: `${P(1400)} translateY(260px) rotateX(55deg) rotateY(0deg) scale(.9)`,
    }[mode];
    panel.style.transformOrigin = mode === "flipY" ? "0px 50%" : "111px 0px";
    A(panel, [
      { transform: from, opacity: 0 },
      { opacity: 1, offset: 0.25 },
      { transform: `${P(1400)} translateY(0px) rotateX(0deg) rotateY(0deg) scale(1)`, opacity: 1 },
    ], at, dur, "spring");
    const spark = $(".spark", panel);
    if (spark) {
      spark.style.display = "inline-block";
      A(spark, [{ transform: "rotate(-200deg) scale(0)" }, { transform: "rotate(0deg) scale(1)" }], at + 0.08, 0.5, "back");
    }
  }

  // The mode chip swings in from the left in 3D, then gets a gloss sweep.
  function chipIn(at = 0) {
    const chip = $(".chip");
    if (!chip) return;
    chip.style.transformOrigin = "0 50%";
    A(chip, [
      { transform: `${P(900)} translateX(-120px) rotateY(75deg)`, opacity: 0 },
      { opacity: 1, offset: 0.25 },
      { transform: `${P(900)} translateX(0) rotateY(0deg)`, opacity: 1 },
    ], at, 0.5, "spring");
    const kbd = $(".chip kbd");
    if (kbd) { kbd.style.display = "inline-block"; pop(kbd, at + 0.16, { from: 0, rot: -20 }); }
    const icon = $(".chip .icon");
    if (icon) A(icon, [{ transform: "rotate(-90deg) scale(0)" }, { transform: "none" }], at + 0.1, 0.45, "back");
    shine(chip, at + 0.45);
    const pill = $(".chips .pill");
    if (pill) {
      pill.style.transformOrigin = "0 50%";
      A(pill, [{ transform: `${P(900)} rotateY(-80deg) translateX(40px)`, opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: `${P(900)} rotateY(0deg)`, opacity: 1 }], at + 0.22, 0.5, "spring");
    }
  }

  // Whole scene punches in on the cut.
  const punch = (at = 0) =>
    A(".safe", [{ transform: "scale(1.07)", filter: "blur(10px)", opacity: 0.35 }, { transform: "scale(1)", filter: "blur(0px)", opacity: 1 }], at, 0.22, "out");

  // ---------- background: drifting glow + a 3D field of sparkles ----------
  const STAR = (fill) =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path fill='${fill}' d='M50 0C53 36 64 47 100 50C64 53 53 64 50 100C47 64 36 53 0 50C36 47 47 36 50 0Z'/></svg>`)}")`;

  function background(seed) {
    const red = document.body.classList.contains("red");
    document.body.animate(
      [{ transform: "scale(1) translateY(0px)", opacity: 0.85 }, { transform: "scale(1.18) translateY(-60px)", opacity: 1 }],
      { pseudoElement: "::before", duration: 1600, direction: "alternate", iterations: Infinity, easing: EASE.inout, fill: "both" },
    );
    const fx = document.createElement("div");
    fx.id = "fx";
    fx.dataset.deco = "";
    const world = document.createElement("div");
    world.className = "world";
    fx.append(world);
    document.body.insertBefore(fx, document.body.firstChild);
    const r = rng(seed);
    const cols = red ? ["#ff5a5a", "#ff9b9b", "#ffffff"] : ["#ad91ff", "#d6c9ff", "#ffffff", "#7b5cff"];
    for (let i = 0; i < 46; i++) {
      const p = document.createElement("i");
      const size = 10 + r() * 34;
      p.style.cssText = `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;background:${STAR(cols[i % cols.length])} center/contain no-repeat;`;
      world.append(p);
      const x = (r() - 0.5) * 1500, y = (r() - 0.5) * 2300;
      const z0 = -1400 - r() * 600, z1 = 500;
      const dur = 2600 + r() * 2400, spin = (r() - 0.5) * 360;
      const a = 0.35 + r() * 0.55;
      p.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, ${z0}px) rotate(0deg)`, opacity: 0 },
          { opacity: a, offset: 0.2 },
          { opacity: a, offset: 0.8 },
          { transform: `translate3d(${x * 1.05}px, ${y - 120}px, ${z1}px) rotate(${spin}deg)`, opacity: 0 },
        ],
        { duration: dur, iterations: Infinity, delay: -r() * dur, easing: "linear", fill: "both" },
      );
    }
    world.animate(
      [{ transform: "rotateZ(0deg) rotateY(-6deg)" }, { transform: "rotateZ(8deg) rotateY(6deg)" }],
      { duration: 3000, direction: "alternate", iterations: Infinity, easing: EASE.inout, fill: "both" },
    );
  }

  const CSS = `
    #fx { position: absolute; inset: 0; overflow: hidden; perspective: 900px; pointer-events: none; }
    #fx .world { position: absolute; left: 50%; top: 50%; transform-style: preserve-3d; }
    #fx .world i { position: absolute; left: 0; top: 0; display: block; }
    .sel.has-hl { position: relative; isolation: isolate; border-color: transparent !important; background: transparent !important; }
    .sel .hl { position: absolute; inset: -4px; border: 4px dashed var(--violet); background: rgba(173,145,255,.16); border-radius: 18px; z-index: -1; pointer-events: none; }
    .sel .xhair { position: absolute; left: -36px; top: -36px; width: 64px; height: 64px; z-index: 5; pointer-events: none; }
    .sel .xhair svg { width: 100%; height: 100%; display: block; }
    .shine { position: absolute; top: -30%; left: 0; width: 38%; height: 160%; pointer-events: none; z-index: 3;
      background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.65), rgba(255,255,255,0)); mix-blend-mode: soft-light; }
  `;

  const api = {
    enabled,
    EASE, spring, rng, $, $$, P, A, add, idle, showAt, words, chars, split,
    pop, slam, rise, stagger, stream, fly3d, flip, shake, shine, extrude, drag, panelIn, chipIn, punch,
    slide(fn) { specs.push(fn); },
    wait(p) { pending.push(p); },
    onSeek(fn) { renderers.push(fn); },
    async start() {
      if (!enabled) return;
      await document.fonts.ready;
      await Promise.all(pending);
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.append(style);
      document.body.classList.add("anim");
      background(location.pathname);
      for (const fn of specs) fn(api);
      for (const a of document.getAnimations()) a.pause();
      api.seek(0);
    },
    seek(t) {
      for (const a of document.getAnimations()) a.currentTime = t * 1000;
      for (const fn of renderers) fn(t);
    },
    // When every finite animation has finished (idle loops excluded).
    settleTime() {
      let end = 0;
      for (const a of document.getAnimations()) {
        const tm = a.effect.getComputedTiming();
        if (tm.iterations === Infinity) continue;
        if (a.effect.target?.closest?.("#fx")) continue;
        end = Math.max(end, tm.endTime / 1000);
      }
      return end;
    },
  };
  window.WispAnim = api;
})();
