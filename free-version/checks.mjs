// Layout checks that run inside a rendered slide (via page.evaluate). Shared by the raw build and
// the animated render. Elements marked [data-deco] (3D extrusion copies, sparkles, cursors) are
// pure decoration and are skipped.

// Words that must never appear on screen.
export const FORBIDDEN = /\b(cheat\w*|tests?|testing|exams?|quiz\w*|undetect\w*|fast\w*|speed\w*|instant\w*|quick\w*|seconds?)\b/i;

export function pageChecks({ safe, answer, forbidden }) {
  const problems = [];
  // Boxes that are actually drawn (background/border): text and child boxes must stay inside them.
  const CONTAINERS = ".chip, kbd, .pill, .page, .sel, .skel, .panel, .instruction, .tile, .card, .url, .logo";
  // Every block that takes up layout space: none of these may overlap each other.
  const LAYOUT = `${CONTAINERS}, .chips, .caption, .label, .answer, .ink, .private, .headline, .grid, .cards, .pills, .h, .zero`;
  const describe = (el) => {
    const cls = el.getAttribute("class");
    return `<${el.tagName.toLowerCase()}${cls ? "." + cls.trim().split(/\s+/).join(".") : ""}>`;
  };
  const r2 = (r) => `[${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`;
  const inside = (a, b, tol = 1) => a.left >= b.left - tol && a.right <= b.right + tol && a.top >= b.top - tol && a.bottom <= b.bottom + tol;
  const intersects = (a, b, tol = 1) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > tol && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tol;
  const ctx = document.createElement("canvas").getContext("2d");

  // Every visible text fragment: one rect per rendered line, plus the glyph ink box of that line
  // (the line rect covers the font's full ascent/descent, which is taller than the letters).
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const str = node.textContent.trim();
    if (!str) continue;
    const el = node.parentElement;
    if (el.closest("style, script, svg, [data-deco]")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(str);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    const inks = rects.map((r) => {
      const baseline = r.top + m.fontBoundingBoxAscent;
      return { left: r.left, right: r.right, top: baseline - m.actualBoundingBoxAscent, bottom: baseline + m.actualBoundingBoxDescent };
    });
    texts.push({ node, el, rects, inks, label: JSON.stringify(str.slice(0, 40)) });
  }
  if (!texts.length) problems.push("no text found");

  // 1. All text inside the safe area (full line box, so this is stricter than the glyphs).
  for (const t of texts) for (const r of t.rects) {
    if (!inside(r, safe, 0.5)) problems.push(`text ${t.label} ${r2(r)} is outside the safe area`);
  }

  // 2. No two text fragments overlap.
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    for (const a of texts[i].inks) for (const b of texts[j].inks) {
      if (intersects(a, b, 1)) problems.push(`text ${texts[i].label} overlaps ${texts[j].label}`);
    }
  }

  // 3. Layout blocks don't overlap; drawn boxes stay inside the drawn box they sit in.
  const real = (el) => !el.closest("[data-deco]");
  const boxes = [...document.querySelectorAll(LAYOUT)].filter(real);
  const containers = new Set([...document.querySelectorAll(CONTAINERS)].filter(real));
  const rectOf = new Map(boxes.map((b) => [b, b.getBoundingClientRect()]));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (intersects(rectOf.get(a), rectOf.get(b), 0.5)) problems.push(`${describe(a)} overlaps ${describe(b)}`);
  }
  for (const b of boxes) {
    const parent = b.parentElement.closest(CONTAINERS);
    if (parent && !inside(rectOf.get(b), rectOf.get(parent), 0.5)) problems.push(`${describe(b)} sticks out of ${describe(parent)}`);
  }

  // 4. Text stays inside its own drawn box and never touches a drawn box it isn't part of.
  for (const t of texts) for (const ink of t.inks) {
    const own = t.el.closest(CONTAINERS);
    if (own && !inside(ink, rectOf.get(own), 0.5)) problems.push(`text ${t.label} spills out of ${describe(own)} ${r2(ink)} vs ${r2(rectOf.get(own))}`);
    for (const c of containers) {
      if (!c.contains(t.el) && intersects(ink, rectOf.get(c), 0.5)) problems.push(`text ${t.label} runs into ${describe(c)}`);
    }
  }

  // 5. Decorative overlays (e.g. the drag hand) may only cover the element they are attached to.
  for (const o of [...document.querySelectorAll("[data-overlay]")].filter(real)) {
    const r = o.getBoundingClientRect();
    const host = o.parentElement;
    const own = host.closest(CONTAINERS);
    if (own && !inside(r, rectOf.get(own), 0.5)) problems.push(`overlay ${describe(o)} sticks out of ${describe(own)}`);
    for (const t of texts) {
      if (host.contains(t.el)) continue;
      if (t.inks.some((ink) => intersects(ink, r, 0.5))) problems.push(`overlay ${describe(o)} covers text ${t.label}`);
    }
    for (const c of containers) {
      if (!c.contains(o) && !host.contains(c) && intersects(r, rectOf.get(c), 0.5)) problems.push(`overlay ${describe(o)} covers ${describe(c)}`);
    }
  }

  // 6. Nothing scrolls / spills past the 1080x1920 canvas.
  const de = document.documentElement;
  if (de.scrollWidth > 1080 || de.scrollHeight > 1920) problems.push(`page scrolls: ${de.scrollWidth}x${de.scrollHeight}`);

  // 7. Fonts actually loaded (no silent fallback).
  const faces = [...document.fonts];
  const loaded = (family) => faces.some((f) => f.family.replace(/"/g, "") === family && f.status === "loaded");
  if (!loaded("Inter")) problems.push("Inter did not load");
  if (document.querySelector(".code, .code-inline") && !loaded("JetBrains Mono")) problems.push("JetBrains Mono did not load");
  for (const img of document.images) if (!img.complete || !img.naturalWidth) problems.push(`image ${img.src} did not load`);

  // 8. Answers are word-for-word.
  const answers = [...document.querySelectorAll("[data-answer]")];
  if (answer !== undefined) {
    if (answers.length !== 1) problems.push(`expected exactly one [data-answer], found ${answers.length}`);
    else {
      const got = answers[0].textContent.replace(/\s+/g, " ").trim();
      if (got !== answer) problems.push(`answer text differs:\n      got:  ${got}\n      want: ${answer}`);
    }
  } else if (answers.length) problems.push("unexpected [data-answer] on a slide without an answer");

  // 9. Banned wording.
  const words = document.body.innerText;
  const bad = words.match(new RegExp(forbidden, "i"));
  if (bad) problems.push(`forbidden word on screen: "${bad[0]}"`);

  return { problems, text: words.replace(/\s+/g, " ").trim() };
}
