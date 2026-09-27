# Wisp Free — TikTok launch ad (raw cut)

Raw 30 s vertical ad announcing Wisp Free. Hard cuts only: no transitions, effects, music or audio.
It gets finished in ChatCut.

| Output | |
|---|---|
| `out/wisp-free-tiktok.mp4` | 1080×1920, 30 fps, exactly 30.00 s / 900 frames, H.264 High, yuv420p (BT.709), no audio track, keyframe on every cut |
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
npm run build:free                   # render PNGs, check layout, encode + verify MP4
npm run build:free -- --png          # PNGs + checks only
```

Edit the slides in `slides/*.html` (shared styles are in `slides/style.css`, the logo is `slides/logo.svg`).
The build stops before encoding if any check fails. It checks that:

- all text stays inside the safe area (x 60–1020, y 180–1580) and nothing overflows the canvas;
- no text overlaps other text, no block overlaps another, and text stays inside its card, chip, pill or tile (measured from the actual glyph shapes);
- each demo answer (`[data-answer]`) matches `timeline.json` word for word;
- no banned words appear (cheat, test, exam, undetectable, fast, instant, …);
- the fonts and logo loaded;
- the MP4 is 1080×1920, 30 fps, 30.00 s, 900 frames, with no audio track;
- every decoded frame matches the PNG the timeline puts at that frame, so each cut lands on its exact frame.

Fonts: Inter and JetBrains Mono (both OFL, in `../fonts`). Emoji come from the system emoji font.
