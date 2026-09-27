# Wisp Free — TikTok launch ad

30 s vertical ad announcing Wisp Free, in two cuts that share the same slides and the same 13 cut points:

- **Raw cut:** hard cuts only, no transitions, effects, music or audio. It gets finished in ChatCut.
- **Animated cut:** every slide animates, with 3D motion throughout (details below). Still no audio.

| Output | |
|---|---|
| `out/wisp-free-tiktok.mp4` | raw cut: 1080×1920, 30 fps, exactly 30.00 s / 900 frames, H.264 High, yuv420p (BT.709), no audio track, keyframe on every cut |
| `out/wisp-free-tiktok-animated.mp4` | animated cut: same format, same frame-exact cut points |
| `out/contact-sheet-animated.jpg` | the resting pose of every animated slide |
| `out/png/*.png` | each slide as a 1080×1920 PNG |
| `out/cuts.csv` | cut list with seconds, frame numbers and timecodes |
| `out/contact-sheet.jpg` | all 14 slides at a glance |

## Timing

| # | Slide | In | Out | Frames |
|---|---|---|---|---|
| 1 | `01-stop` — STOPPP ✋ wisp just went FREE (red glow) | 0.0 | 1.5 | 45 |
| 2 | `02-mac` — do you have a Mac? 💻 | 1.5 | 2.8 | 39 |
| 3 | `03-answer` — Answer ⌃1 · mitosis vs meiosis | 2.8 | 6.0 | 96 |
| 4 | `04-translate` — Translate ⌃3 · full version | 6.0 | 8.3 | 69 |
| 5 | `05-explain` — Explain ⌃5 · ZeroDivisionError | 8.3 | 10.6 | 69 |
| 6 | `06-summarize` — Summarize ⌃2 · Pomodoro | 10.6 | 12.9 | 69 |
| 7 | `07-rewrite` — Rewrite ⌃4 | 12.9 | 14.8 | 57 |
| 8 | `08-custom` — Custom ⌃6 · flashcards | 14.8 | 17.0 | 66 |
| 9 | `09-invisible-ink` — Invisible Ink · full version | 17.0 | 19.5 | 75 |
| 10 | `10-works-on-anything` | 19.5 | 21.3 | 54 |
| 11 | `11-pick-your-ai` | 21.3 | 23.3 | 60 |
| 12 | `12-free` — $0 · wisp free | 23.3 | 25.8 | 75 |
| 13 | `13-full-version` — want it ALL? $15 once | 25.8 | 27.5 | 51 |
| 14 | `14-cta` — logo · wispformac.com · comment FREE | 27.5 | 30.0 | 75 |

The timing lives in `timeline.json`, along with the exact answer text for each demo slide.

## Rebuild

```sh
npm install                          # playwright + ffmpeg-static
npx playwright install chromium      # first time only, if Chrome isn't installed yet
npm run build:free                   # raw cut: render PNGs, check layout, encode + verify MP4
npm run build:free -- --png          # PNGs + checks only
npm run build:free:animated          # animated cut: render every frame, check, encode + verify
npm run build:free:animated -- --preview   # a few frames per slide as contact sheets (quick look)
```

Edit the slides in `slides/*.html` (shared styles are in `slides/style.css`; `slides/icon.png` is the app icon from wispformac.com).
The build stops before encoding if any check fails. It checks that:

- all text stays inside the safe area (x 60–1020, y 180–1580) and nothing overflows the canvas;
- no text overlaps other text, no block overlaps another, and text stays inside its card, chip, pill or tile (measured from the actual glyph shapes);
- each demo answer (`[data-answer]`) matches `timeline.json` word for word;
- no banned words appear (cheat, test, exam, undetectable, fast, instant, …);
- the fonts and logo loaded;
- the MP4 is 1080×1920, 30 fps, 30.00 s, 900 frames, with no audio track;
- every decoded frame matches the PNG the timeline puts at that frame, so each cut lands on its exact frame.

Fonts: Inter and JetBrains Mono (both OFL, in `../fonts`). Emoji come from the system emoji font.

## Animated cut

The same HTML slides are used for both cuts. Opened normally, a slide is the static design. Opened
with `?anim`, `slides/anim.js` adds the motion, and `animate.mjs` scrubs each slide to the exact time
of every frame (Web Animations API, paused and seeked). Every frame is reproducible, and the cuts land
on the same frames as in the raw cut.

- **Every slide:** a 3D field of drifting sparkles, a breathing glow, and a punch-in on the cut.
- **Demo slides:** the mode chip swings in with a gloss sweep, and the page flies up in 3D. A crosshair
  drags the dashed capture box, the answer panel pops out of the selection, and the answer streams in
  word by word.
- **Per-slide extras:**
  - Rewrite: the grammar errors get red squiggles.
  - Custom: the instruction types itself.
  - Invisible Ink: the faint answer is grabbed and dragged into place.
  - Hook, $0 and "want it ALL?": the big words are solid extruded 3D type.
  - "want it ALL?": the six mode icons orbit in 3D.
- **End slide:** the real 3D Wisp icon from wispformac.com (`slides/wisp3d.js`, ported from the site's
  Three.js code so it runs off the video clock).

To keep the motion smooth at 30 fps:

- **Easing:** curves ease out with at most one small overshoot, so nothing wobbles.
- **Pace:** moves are short and every fade takes several frames.
- **Impacts:** they get a single smooth camera kick instead of a shake.
- **Idle sways:** they start from rest and ease through every turn.
- **Motion blur:** each video frame is the average of 4 renders spread across half a frame (a
  180° shutter). `SUBFRAMES=1` turns it off for quick test renders.

The animated render runs the same layout checks as the raw build on each slide's resting pose
(settled, mid-hold and last frame). It also requires every slide to finish its entrance with at least
0.5 s left on screen, and checks that each slide's first and last frame sit on the timeline's cut
frames in the final MP4.
