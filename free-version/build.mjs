// Renders every slide with headless Chrome, checks the layout, and joins the PNGs
// into a raw 1080x1920 / 30 fps MP4 with hard cuts (no audio, no transitions).
//
//   npm run build:free            render + check + encode + verify
//   npm run build:free -- --png   render + check only
//
// Set FFMPEG=/path/to/ffmpeg to use a different ffmpeg than the bundled ffmpeg-static.

import { chromium } from "playwright";
import ffmpegStatic from "ffmpeg-static";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FORBIDDEN, pageChecks } from "./checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const timeline = JSON.parse(readFileSync(join(here, "timeline.json"), "utf8"));
const { width: W, height: H, fps, duration, safeArea } = timeline;
const ffmpeg = process.env.FFMPEG || ffmpegStatic;
const pngOnly = process.argv.includes("--png");

const outDir = join(here, "out");
const pngDir = join(outDir, "png");
const videoPath = join(here, timeline.output);
mkdirSync(pngDir, { recursive: true });

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };

// ---------- timeline sanity ----------
const slides = timeline.slides.map((s, i) => {
  const startFrame = Math.round(s.start * fps);
  const endFrame = Math.round(s.end * fps);
  if (Math.abs(startFrame - s.start * fps) > 1e-6 || Math.abs(endFrame - s.end * fps) > 1e-6) {
    fail(`${s.file}: ${s.start}-${s.end}s does not land on a frame boundary`);
  }
  if (i === 0 && s.start !== 0) fail("first slide must start at 0");
  if (i > 0 && s.start !== timeline.slides[i - 1].end) fail(`${s.file}: gap/overlap with previous slide`);
  return { ...s, name: s.file.replace(/\.html$/, ""), startFrame, endFrame, frames: endFrame - startFrame };
});
const totalFrames = Math.round(duration * fps);
if (slides.at(-1).end !== duration) fail(`last slide must end at ${duration}s`);
if (slides.reduce((n, s) => n + s.frames, 0) !== totalFrames) fail("frame counts do not add up");


// ---------- render ----------
console.log(`Rendering ${slides.length} slides…`);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") fail(`console error: ${m.text()}`); });
page.on("requestfailed", (r) => fail(`failed to load ${r.url()}`));

for (const s of slides) {
  s.png = join(pngDir, `${s.name}.png`);
  await page.goto(pathToFileURL(join(here, "slides", s.file)).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const { problems, text } = await page.evaluate(pageChecks, {
    safe: safeArea,
    answer: s.answer,
    forbidden: FORBIDDEN.source,
  });
  await page.screenshot({ path: s.png, clip: { x: 0, y: 0, width: W, height: H }, animations: "disabled" });
  const png = readFileSync(s.png);
  const [pw, ph] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (pw !== W || ph !== H) problems.push(`PNG is ${pw}x${ph}`);
  console.log(`${problems.length ? "✗" : "✓"} ${s.name.padEnd(22)} ${s.start.toFixed(1).padStart(4)}–${s.end.toFixed(1).padStart(4)}s  ${String(s.frames).padStart(3)}f  “${text}”`);
  for (const p of problems) fail(`${s.name}: ${p}`);
}
await browser.close();

// cut list for the editor
const tc = (f) => {
  const ss = Math.floor(f / fps);
  return `00:00:${String(ss).padStart(2, "0")}:${String(f % fps).padStart(2, "0")}`;
};
writeFileSync(
  join(outDir, "cuts.csv"),
  "slide,png,start_s,end_s,start_frame,end_frame_exclusive,frames,start_tc\n" +
    slides.map((s, i) => [i + 1, `png/${s.name}.png`, s.start.toFixed(1), s.end.toFixed(1), s.startFrame, s.endFrame, s.frames, tc(s.startFrame)].join(",")).join("\n") + "\n",
);

if (failures) {
  console.error(`\n${failures} problem(s) found — fix the slides before encoding.`);
  process.exit(1);
}
if (pngOnly) process.exit(0);

// ---------- encode ----------
const run = (args, opts = {}) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(r.stderr);
    throw new Error(`ffmpeg failed: ${args.join(" ")}`);
  }
  return r.stderr;
};
const loopInputs = slides.flatMap((s) => ["-loop", "1", "-framerate", String(fps), "-i", s.png]);
const toVideo = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p";

console.log(`\nEncoding ${totalFrames} frames → ${timeline.output}`);
const segments = slides.map((s, i) => `[${i}:v]trim=end_frame=${s.frames},setpts=PTS-STARTPTS,setsar=1[s${i}]`).join(";");
run([
  "-y", "-loglevel", "error",
  ...loopInputs,
  "-filter_complex", `${segments};${slides.map((_, i) => `[s${i}]`).join("")}concat=n=${slides.length}:v=1:a=0,${toVideo}[v]`,
  "-map", "[v]", "-an",
  "-frames:v", String(totalFrames), "-r", String(fps),
  "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "stillimage", "-profile:v", "high",
  "-g", String(fps), "-force_key_frames", slides.map((s) => s.start).join(","),
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-movflags", "+faststart",
  videoPath,
]);

// ---------- verify the MP4 ----------
console.log("Verifying video…");
const info = run(["-i", videoPath], { allowFail: true });
const need = [
  [/Duration: 00:00:30\.00,/, "duration 30.00s"],
  [/Video: h264 \(High\)/, "H.264 High"],
  [/yuv420p\(tv, bt709/, "yuv420p bt709"],
  [/, 1080x1920[ ,]/, "1080x1920"],
  [/, 30 fps,/, "30 fps"],
];
for (const [re, what] of need) if (!re.test(info)) fail(`video is not ${what}`);
if (/Audio:/.test(info)) fail("video has an audio track");

// Independently check every frame: compare each decoded frame against every slide PNG and
// make sure the best match is the slide the timeline says should be on screen.
const work = mkdtempSync(join(tmpdir(), "wisp-verify-"));
const refs = slides.map((_, k) => `[${k + 1}:v]${toVideo},trim=end_frame=${totalFrames}[r${k}]`).join(";");
const chain = slides.map((_, k) => `[${k === 0 ? "0:v" : `m${k - 1}`}][r${k}]psnr=stats_file=p${k}.log[m${k}]`).join(";");
run(["-loglevel", "error", "-i", videoPath, ...loopInputs, "-filter_complex", `${refs};${chain}`, "-map", `[m${slides.length - 1}]`, "-f", "null", "-"], { cwd: work });
const psnr = slides.map((_, k) =>
  readFileSync(join(work, `p${k}.log`), "utf8").trim().split("\n")
    .map((line) => { const v = line.match(/psnr_avg:(\S+)/)[1]; return v === "inf" ? Infinity : parseFloat(v); }));
rmSync(work, { recursive: true, force: true });

const decoded = psnr[0].length;
if (decoded !== totalFrames) fail(`decoded ${decoded} frames, expected ${totalFrames}`);
let worst = Infinity, wrong = 0;
for (let n = 0; n < decoded; n++) {
  const expected = slides.findIndex((s) => n >= s.startFrame && n < s.endFrame);
  const scores = psnr.map((p) => p[n]);
  const best = scores.indexOf(Math.max(...scores));
  worst = Math.min(worst, scores[expected]);
  if (best !== expected || scores[expected] < 35) {
    if (wrong++ < 10) fail(`frame ${n}: shows ${slides[best].name} (${scores[best].toFixed(1)} dB), expected ${slides[expected].name}`);
  }
}
if (wrong) fail(`${wrong} frame(s) show the wrong slide`);
else console.log(`✓ all ${decoded} frames match their slide (lowest PSNR ${worst.toFixed(1)} dB), cuts land on exact frames`);

// contact sheet for a quick overview
run([
  "-y", "-loglevel", "error",
  ...slides.flatMap((s) => ["-i", s.png]),
  "-filter_complex", `${slides.map((_, i) => `[${i}:v]scale=270:480[t${i}]`).join(";")};${slides.map((_, i) => `[t${i}]`).join("")}concat=n=${slides.length}:v=1:a=0,tile=7x2:padding=12:margin=12:color=0x26222F`,
  "-frames:v", "1", "-q:v", "3", join(outDir, "contact-sheet.jpg"),
]);

if (failures) {
  console.error(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log(`\n✓ ${resolve(videoPath)}\n  ${W}x${H}, ${fps} fps, ${duration}s, ${totalFrames} frames, no audio, ${slides.length} slides, ${slides.length - 1} hard cuts`);
