// First-run tutorial: a tiny 3x3 puzzle with its own state. Pure logic only. It must never touch the network, the
// solve queue or the player id: tutorial play creates no solve row (tests/tutorial.test.ts guards the imports).
import { isSolved, planMove, type Cell, type Dot } from "./zip.ts";

export const TUTORIAL_KEY = "yomi_tutorial_done"; // the tutorial was finished or skipped; never auto-open it again

export const TUTORIAL_N = 3;
export const TUTORIAL_DOTS: Dot[] = [[0, 0, 1], [0, 2, 2], [2, 0, 3]];
const LABEL_AT = new Map(TUTORIAL_DOTS.map(([r, c, v]) => [r * TUTORIAL_N + c, v]));

export interface TutorialState {
  path: Cell[];
  reached2: boolean; // the player has connected 1 to 2
  undid: boolean; // the player has undone something after that (or tapped "Got it")
}

export type TutorialStage = 0 | 1 | 2 | 3;

export const TUTORIAL_STEPS: { title: string; text: string }[] = [
  { title: "Drag through the cells", text: "Start at 1 and drag to 2. Dots must be hit in order: 1, 2, 3." },
  { title: "Made a mistake?", text: "Drag back over your path, or tap Undo. Nothing is lost." },
  { title: "Fill every cell", text: "Now reach 3. The path can't cross itself, and every cell must be filled." },
  { title: "That's the game", text: "Real puzzles are bigger. Yomi reads each grid before you start." },
];

export const tutorialStart = (): TutorialState => ({ path: [[0, 0]], reached2: false, undid: false });

export const tutorialSolved = (s: TutorialState) => isSolved(TUTORIAL_N, TUTORIAL_DOTS, s.path);

export function tutorialStage(s: TutorialState): TutorialStage {
  if (tutorialSolved(s)) return 3;
  if (!s.reached2) return 0;
  return s.undid ? 2 : 1;
}

function withPath(s: TutorialState, path: Cell[], undone: boolean): TutorialState {
  const reached2 = s.reached2 || path.some(([r, c]) => LABEL_AT.get(r * TUTORIAL_N + c) === 2);
  return { path, reached2, undid: s.undid || (undone && s.reached2) };
}

/** Drag the head onto `target`, with the same rules as the real game (planMove). */
export function tutorialMove(s: TutorialState, target: Cell): TutorialState {
  if (tutorialSolved(s)) return s;
  const move = planMove(TUTORIAL_N, LABEL_AT, s.path, target);
  return move ? withPath(s, move.path, move.kind === "undo") : s;
}

/** The Undo button: step back one cell. */
export function tutorialUndo(s: TutorialState): TutorialState {
  if (tutorialSolved(s) || s.path.length <= 1) return s;
  return withPath(s, s.path.slice(0, -1), true);
}

/** "Got it" on the undo step, for players who would rather read than try it. */
export const tutorialSkipUndo = (s: TutorialState): TutorialState => (s.reached2 ? { ...s, undid: true } : s);

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    return false; // storage blocked: the caller keeps an in-memory flag for this visit
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {}
}
