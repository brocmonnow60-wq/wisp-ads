// Renders the animated cut: every frame of every slide is scrubbed to its exact time in headless
// Chrome (see slides/anim.js), encoded per slide, and joined with the same hard cut points as the
// raw version, so the timeline in timeline.json still holds frame for frame.
//
//   npm run build:free:animated                  full render + checks + verify
//   npm run build:free:animated -- --preview     a few frames per slide + contact sheets (quick look)
//   … -- --only 03,12                            limit to some slides
//
// WORKERS=n sets how many slides render in parallel (default 3).
// SUBFRAMES=n sets the motion-blur samples per frame (default 4, 1 = no motion blur).

import { chromium } from "playwright";
import ffmpegStatic from "ffmpeg-static";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN, pageChecks } from "./checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const timeline = JSON.parse(readFileSync(join(here, "timeline.json"), "utf8"));
const { width: W, height: H, fps, duration, safeArea } = timeline;
const ffmpeg = process.env.FFMPEG || ffmpegStatic;
const WORKERS = Number(process.env.WORKERS || 3);
const preview = process.argv.includes("--preview");
const onlyArg = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const MIN_HOLD = 0.5; // every slide must sit still (apart from idle loops) for at least this long
// Motion blur: every output frame averages SUB renders spread over half a frame (a 180° shutter).
const SUB = Number(process.env.SUBFRAMES || 4);
const SHUTTER = 0.5;
const subTimes = (f) => Array.from({ length: SUB }, (_, k) => (f + ((k + 0.5) / SUB - 0.5) * SHUTTER) / fps);

const outDir = join(here, "out");
const videoPath = join(outDir, "wisp-free-tiktok-animated.mp4");
const previewDir = join(outDir, "animated-preview");
mkdirSync(outDir, { recursive: true });

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };

const slides = timeline.slides
  .map((s, i) => {
    const startFrame = Math.round(s.start * fps), endFrame = Math.round(s.end * fps);
    return { ...s, index: i, name: s.file.replace(/\.html$/, ""), startFrame, endFrame, frames: endFrame - startFrame, dur: s.end - s.start };
  })
  .filter((s) => !onlyArg || onlyArg.some((o) => s.name.startsWith(o)));
const totalFrames = Math.round(duration * fps);

// ---------- tiny static server (ES modules don't load from file://) ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
  createReadStream(path).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/free-version/slides/`;

const browser = await chromium.launch();

async function openSlide(s) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("console", (m) => { if (m.type() === "error") fail(`${s.name}: console error: ${m.text()}`); });
  page.on("pageerror", (e) => fail(`${s.name}: ${e.message}`));
  page.on("requestfailed", (r) => fail(`${s.name}: failed to load ${r.url()}`));
  await page.goto(`${base}${s.file}?anim`, { waitUntil: "load" });
  await page.evaluate(() => WispAnim.start());
  page.cdp = await page.context().newCDPSession(page);
  return page;
}
const seek = (page, t) => page.evaluate((t) => WispAnim.seek(t), t);
// Lossless PNG, with Chrome's faster compression setting.
const shot = async (page) =>
  Buffer.from((await page.cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })).data, "base64");

// The resting pose of each slide (after its entrance) must pass the same checks as the raw slides.
async function checkSlide(page, s) {
  const settle = await page.evaluate(() => WispAnim.settleTime());
  if (s.dur - settle < MIN_HOLD - 1e-9) fail(`${s.name}: entrance ends at ${settle.toFixed(2)}s, leaving only ${(s.dur - settle).toFixed(2)}s on screen`);
  const last = (s.frames - 1) / fps;
  const times = [...new Set([Math.min(settle, last), (Math.min(settle, last) + last) / 2, last].map((t) => Math.round(t * fps) / fps))];
  for (const t of times) {
    await seek(page, t);
    const { problems } = await page.evaluate(pageChecks, { safe: safeArea, answer: s.answer, forbidden: FORBIDDEN.source });
    for (const p of problems) fail(`${s.name} @${t.toFixed(2)}s: ${p}`);
  }
  return settle;
}

const run = (args, opts = {}) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0 && !opts.allowFail) { console.error(r.stderr); throw new Error(`ffmpeg failed: ${args.join(" ")}`); }
  return r.stderr;
};
const toVideo = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p";
const blend = SUB > 1 ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${fps}*TB)` : "null";

const work = mkdtempSync(join(tmpdir(), "wisp-anim-"));

async function renderSlide(s) {
  const page = await openSlide(s);
  const settle = await checkSlide(page, s);

  if (preview) {
    mkdirSync(previewDir, { recursive: true });
    const times = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0, settle, s.dur - 1 / fps]
      .map((t) => Math.min(Math.round(t * fps), s.frames - 1))
      .filter((f, i, a) => a.indexOf(f) === i);
    const files = [];
    for (const f of times) {
      await seek(page, f / fps);
      const file = join(previewDir, `${s.name}-f${String(f).padStart(3, "0")}.png`);
      writeFileSync(file, await shot(page));
      files.push(file);
    }
    run(["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]),
      "-filter_complex", `${files.map((_, i) => `[${i}:v]scale=270:480[t${i}]`).join(";")};${files.map((_, i) => `[t${i}]`).join("")}concat=n=${files.length}:v=1:a=0,tile=${files.length}x1:padding=8:margin=8:color=0x26222F`,
      "-frames:v", "1", "-q:v", "3", join(previewDir, `${s.name}.jpg`)]);
    console.log(`✓ ${s.name.padEnd(22)} settles at ${settle.toFixed(2)}s of ${s.dur.toFixed(1)}s  → animated-preview/${s.name}.jpg`);
    await page.close();
    return;
  }

  // Full render: pipe every sub-frame into its own x264 segment; ffmpeg averages each group of SUB.
  s.segment = join(work, `${s.name}.mp4`);
  const enc = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-c:v", "png", "-framerate", String(fps * SUB), "-i", "-",
    "-vf", `${blend},${toVideo}`, "-frames:v", String(s.frames), "-r", String(fps),
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-g", String(fps),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-an", s.segment], { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  enc.stderr.on("data", (d) => (err += d));
  const done = new Promise((ok, no) => enc.on("close", (code) => (code === 0 ? ok() : no(new Error(`${s.name}: ffmpeg exited ${code}\n${err}`)))));
  const t0 = Date.now();
  for (let f = 0; f < s.frames; f++) {
    const times = subTimes(f);
    for (let k = 0; k < times.length; k++) {
      await seek(page, times[k]);
      const buf = await shot(page);
      if (f === 0) writeFileSync(join(work, `${s.name}-first-${k}.png`), buf);
      if (f === s.frames - 1) writeFileSync(join(work, `${s.name}-last-${k}.png`), buf);
      if (!enc.stdin.write(buf)) await new Promise((ok) => enc.stdin.once("drain", ok));
    }
  }
  // the reference frames for the cut check get the same blend
  for (const which of ["first", "last"]) {
    run(["-y", "-loglevel", "error", "-framerate", String(fps * SUB), "-i", join(work, `${s.name}-${which}-%d.png`), "-vf", blend, "-frames:v", "1", join(work, `${s.name}-${which}.png`)]);
  }
  enc.stdin.end();
  await done;
  await page.close();
  console.log(`✓ ${s.name.padEnd(22)} ${String(s.frames).padStart(3)} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s  (settles at ${settle.toFixed(2)}s)`);
}

console.log(`${preview ? "Previewing" : "Rendering"} ${slides.length} animated slide(s) with ${WORKERS} workers…`);
const queue = [...slides].sort((a, b) => b.frames - a.frames);
await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, async () => {
  for (let s; (s = queue.shift()); ) {
    try { await renderSlide(s); } catch (e) { fail(e.message); }
  }
}));
await browser.close();
server.close();

if (preview || onlyArg) {
  rmSync(work, { recursive: true, force: true });
  if (failures) { console.error(`\n${failures} problem(s) found.`); process.exit(1); }
  process.exit(0);
}
if (failures) {
  rmSync(work, { recursive: true, force: true });
  console.error(`\n${failures} problem(s) found — not joining the video.`);
  process.exit(1);
}

// ---------- join at the original cut points ----------
const list = join(work, "list.txt");
writeFileSync(list, slides.map((s) => `file '${s.segment}'`).join("\n") + "\n");
run(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", videoPath]);

// ---------- verify ----------
console.log("Verifying video…");
const info = run(["-i", videoPath], { allowFail: true });
for (const [re, what] of [
  [/Duration: 00:00:30\.00,/, "duration 30.00s"],
  [/Video: h264 \(High\)/, "H.264 High"],
  [/yuv420p\(tv, bt709/, "yuv420p bt709"],
  [/, 1080x1920[ ,]/, "1080x1920"],
  [/, 30 fps,/, "30 fps"],
]) if (!re.test(info)) fail(`video is not ${what}`);
if (/Audio:/.test(info)) fail("video has an audio track");
const counted = run(["-i", videoPath, "-map", "0:v", "-f", "null", "-"]).match(/frame=\s*(\d+)/g);
const decoded = counted ? Number(counted.at(-1).replace(/\D/g, "")) : 0;
if (decoded !== totalFrames) fail(`decoded ${decoded} frames, expected ${totalFrames}`);

// The first and last frame of every slide must sit exactly on the timeline's cut frames.
const picks = slides.flatMap((s) => [[s.startFrame, `${s.name}-first.png`], [s.endFrame - 1, `${s.name}-last.png`]]);
run(["-y", "-loglevel", "error", "-i", videoPath, "-vf", `select='${picks.map(([f]) => `eq(n\\,${f})`).join("+")}'`, "-fps_mode", "passthrough", join(work, "pick-%02d.png")]);
let worst = Infinity;
picks.forEach(([f, ref], i) => {
  const out = run(["-i", join(work, `pick-${String(i + 1).padStart(2, "0")}.png`), "-i", join(work, ref), "-lavfi", `[0:v]format=yuv420p[a];[1:v]${toVideo}[b];[a][b]psnr`, "-f", "null", "-"]);
  const m = out.match(/average:(\S+)/);
  const db = m ? (m[1] === "inf" ? Infinity : parseFloat(m[1])) : 0;
  worst = Math.min(worst, db);
  if (db < 35) fail(`frame ${f} doesn't match ${ref} (${db.toFixed(1)} dB)`);
});
if (!failures) console.log(`✓ ${decoded} frames; every slide starts and ends on its exact cut frame (lowest PSNR ${worst.toFixed(1)} dB)`);

// contact sheet of each slide's resting pose
run(["-y", "-loglevel", "error", ...slides.flatMap((s) => ["-i", join(work, `${s.name}-last.png`)]),
  "-filter_complex", `${slides.map((_, i) => `[${i}:v]scale=270:480[t${i}]`).join(";")};${slides.map((_, i) => `[t${i}]`).join("")}concat=n=${slides.length}:v=1:a=0,tile=7x2:padding=12:margin=12:color=0x26222F`,
  "-frames:v", "1", "-q:v", "3", join(outDir, "contact-sheet-animated.jpg")]);
rmSync(work, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} problem(s) found.`); process.exit(1); }
console.log(`\n✓ ${videoPath}\n  ${W}x${H}, ${fps} fps, ${duration}s, ${totalFrames} frames, no audio, same ${slides.length - 1} cut points as the raw cut`);
