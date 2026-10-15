import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { modelInfo, parseModel, puzzlePrediction, type Predictions } from "./predict.ts";
import type { ZipPuzzle } from "./zip.ts";

/**
 * Read public/model.json and predict every puzzle on the server (the client never gets solutions).
 * Missing, unreadable or off-contract model = null, and the game runs without predictions.
 */
export function loadPredictions(puzzles: ZipPuzzle[], file = path.join(process.cwd(), "public", "model.json")): Predictions | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error("[model] cannot read model.json:", err instanceof Error ? err.message : err);
    return null;
  }
  const m = parseModel(raw);
  if (!m) {
    console.error("[model] model.json does not follow the model contract; predictions are off");
    return null;
  }
  try {
    return { model: modelInfo(m), byPuzzle: Object.fromEntries(puzzles.map((p) => [p.id, puzzlePrediction(m, p)])) };
  } catch (err) {
    console.error("[model] prediction failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
