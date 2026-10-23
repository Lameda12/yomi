# Yomi: 60-second demo

**Run it:** `cd web && npm run dev`, then open http://localhost:3000 (play) and http://localhost:3000/stats.
Without a `DATABASE_URL` it saves solves to `data/solves.jsonl`, so no Neon is needed.

## Talk track (~150 words)

**Problem (10s).** Puzzle sites label difficulty with "easy / medium / hard", usually from a solver or a guess. But what's hard for an algorithm isn't always what's hard for a person. Yomi wants to *predict* how long a human will take, and show that prediction before you start.

**What I built (20s).** Three parts:
1. **Datasets:** 200k Lichess puzzles, 200k Sudoku, 711 Queens levels, combined into one table of puzzle features vs difficulty.
2. **Prototype:** Yomi Zip, a daily path puzzle. *(Play one live.)*
3. **Logging:** every attempt records solve time, backtracks, and the cell where the player paused longest. *(Open /stats: the heatmap shows where people get stuck.)*

**Findings so far (20s).** In Lichess, solution length vs rating gives Spearman ρ = **+0.55**. That's our strongest signal, and its labels come from **real humans**. Queens (ρ = +0.84 for grid size) and Sudoku look strong too, but their labels come from **solvers**, so they measure algorithm effort, not human difficulty. That's exactly why Yomi needs its own human solve data.

**Sprint 2 (10s).** Collect 50+ real Zip solves from playtesters, fit a first solve-time model on puzzle features, and show a prediction before each puzzle. Today it is the solver-effort stand-in, so the game says "how hard it'll be" in solver steps, not a time. It switches to "predicted: 42s, can you beat it?" once the human-time model has 30+ real solves.

## First run (what a new visitor sees)

1. They land straight on a puzzle with a 3x3 how-to-play on top: drag 1 to 2, undo, fill every cell, dots in order. One tap on **Skip** closes it. It shows once per browser, and **Menu > How to play** reopens it.
2. The tutorial is practice only: it sends nothing to the server, so it never creates a solve, never shows in /stats or the board, and never reaches training data.
3. The main screen is the timer, the prediction line, the grid and Undo/Reset. Mode (Regular/Extreme), skip, stats, the board, change name, streak and the privacy note are in **Menu**.
4. The nickname is optional and never blocks play: after the first solve the card asks "Want your name on the board?", with **No thanks** as the main button.

## Prediction and result card (regular screen)

- **Before the solve** the prediction sits in a highlighted box above the grid. With a human-time model it reads "Target: beat 0:42". While the model is the solver-effort stand-in it reads "Yomi's read: on the easier side. Can you make it look easy?" with a note that the number is solver steps for a computer, not a time. Say that out loud.
- **Above the grid** one line states the objective: "Connect 1 to N in order and fill every cell".
- **After the solve**, with a human-time model, the result card leads with the percent as a big number ("40% faster than predicted") and the explanation under it. With the solver-effort model there is no percentage; the card keeps the plain line that the model is still learning from real players. The explanation is one template line, from data already on the device: how much faster or slower than the guess, backtracks, the longest pause and which dot it was near, and whether it was the player's first solve. No LLM call. With the solver-effort model it never claims a time gap; it says the model is still learning from real players.
- **Personal best** per grid size (Regular only), kept on the device only. A faster solve shows a "New best" badge; the first solve of a size just shows the time to beat. The demo screen has no personal best.

## The finish (regular screen)

- The path draws smoothly: the line grows to each new cell and eases back when you undo or reset.
- Finishing a grid fires a short spark burst (under a second) from the last cell, and the line turns green. Each Extreme solve gets a lighter version, since the next puzzle follows at once.
- **Next puzzle** is the one orange button on the result card. It stays pinned to the bottom of the screen and has focus, so Enter works on a keyboard.
- With `prefers-reduced-motion` the path snaps and there is no spark effect.

## Sharing a result

- **Share result** on the result card opens the phone's share sheet (or copies the message on a laptop). The message carries a link like `/r/<solve id>`.
- That page shows the time, backtracks and mode **as the server stored them** (derived from the move log), never numbers typed into the URL, so a link cannot be edited into a fake time. It shows the player's nickname if they set one, otherwise "Anon xxxx". It never shows the anonymous player id or the move log, is not indexed by search engines, and has a generated link preview image.
- It only compares with Yomi's guess when the model predicted a time. While the model is the solver-effort stand-in it says nothing about a prediction.
- If the solve could not be saved yet, the message links to the site instead, and the card says why.

## Extreme (the sprint)

- Switch with **Menu > Extreme**. The first time, a rules card explains it; **Rules** reopens it. Every start shows a one-line reminder: the clock starts when you tap Start and each solved puzzle scores 1.
- The grid is **blurred** until you tap **Start**, so nobody can read the puzzle ahead of the clock. Pick 30 s, 1, 2 or 5 min, or a custom time from 10 seconds to 10 minutes (seconds or minutes). The choice is remembered.
- Once started, the clock counts down (tenths and red in the last 10 s, and the background pulses faster). Solve a puzzle: it scores 1 and the next one appears right away. Same puzzles in the same order every run, smallest grids first. Menu > Skip drops the puzzle on screen without a score.
- When time is up the puzzle in progress does not count (it is stored as unfinished), the grid freezes, and a card shows the score, a "New best" badge if it beats your best for that run length, **Play again**, **Share score** and **Back to Regular**.
- Scores and bests live on the device only. Each solve in a run is still stored like any other (with `mode = 'extreme'`, no per-puzzle clock) and is **not used to train the model**. There is no server-side sprint board yet; the board page only has Most Unpredictable in Yomi.
- The old per-puzzle clock (80% of the predicted time, tightening by 5 points per win) is gone.

## Live demo screen (`/demo`)

Open `/demo` on the projector (1080p fits a whole round; at 720p the result text scrolls a little).

1. Top right: live counters of total solves and players, refreshed every 10 s while the tab is visible. If the database is slow or offline they keep the last numbers and say so.
2. Before the volunteer plays: the model's read of the puzzle, in big text. While the model is the solver-effort stand-in this is solver steps and an easier/harder cue, not a time. Say that out loud.
3. Volunteer drags from 1 through every dot. Then the card shows predicted vs actual, their own stuck cell (red dashes), and the orange heatmap of where earlier solvers got stuck on that puzzle.
4. "Next volunteer" resets everything. Each volunteer is a fresh anonymous player, and their solves are tagged `source = 'demo'` so they can be filtered out later. They do not appear on the Most Unpredictable board.
5. If the Wi-Fi dies, the game still works: it needs no database to play, and solves are queued and sent later.

## Future work

- **Model-tuned daily difficulty** is not built. It only makes sense once a model trained on human solve times exists (30+ completed solves from 2+ players; today there are fewer). Until then the model predicts solver effort, which is not what a player finds hard.

## If asked

- *Why not just use the solver labels?* Queens backtracks track grid size almost perfectly (ρ = +0.84); within one grid size, region features drop to about 0. The solver mostly counts board size, not what trips people up.
- *How many human solves so far?* Few. Collecting them is the Sprint 2 blocker; /stats updates live.
- *Privacy?* An anonymous random ID per browser, with no accounts or personal data.
- *Why would anyone come back?* A daily streak: a small 🔥 counter on the main screen (and on the result card), plus a 7-day strip on the result panel. It is kept only on the player's device and sends nothing to the server. Each return day is another real solve for the model. It is new and unmeasured, so don't claim it works yet.

## Next

Ideas, not built:
- Show the player's best for this size and mode before the solve ("Your best: 0:30"), next to the target.
- A vibration tick on finish for phones that support it.
- A share card image instead of the text line.
