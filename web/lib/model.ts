import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cellFeatures, parseModel, timeInfo, topStuck, type Model, type TimeInfo } from "./predict.ts";
import { PUZZLES } from "./puzzles.ts";
import type { Cell } from "./zip.ts";

// Read at runtime, not imported: an import would make a malformed file fail the whole build/page, and the
// game must still work without predictions. Missing, unreadable or off-contract file: model is null.
// next.config.ts makes sure the file is shipped with the functions that read it.
const MODEL_PATH = path.join(process.cwd(), "public", "model.json");
let model: Model | null | undefined;
let info: TimeInfo | null | undefined;

export function loadModel(): Model | null {
  if (model === undefined) {
    try {
      model = parseModel(JSON.parse(readFileSync(MODEL_PATH, "utf8")));
      if (!model) console.error("[model] public/model.json does not match the contract; predictions are off");
    } catch (err) {
      console.error("[model] could not read model.json:", err instanceof Error ? err.message : err);
      model = null;
    }
  }
  return model;
}

/** Time prediction for every puzzle, or null when there is no usable model. */
export function loadTimeInfo(): TimeInfo | null {
  if (info === undefined) {
    const m = loadModel();
    try {
      info = m ? timeInfo(m, PUZZLES) : null;
    } catch (err) {
      console.error("[model] could not compute predictions:", err instanceof Error ? err.message : err);
      info = null;
    }
  }
  return info;
}

/** Predicted stuck cells for a puzzle. Empty when the stuck model is untrained or missing. */
export function predictStuck(puzzleId: string): Cell[] {
  const m = loadModel();
  const p = PUZZLES.find((x) => x.id === puzzleId);
  if (!m || !p) return [];
  try {
    return topStuck(m, cellFeatures(p));
  } catch (err) {
    console.error("[model] stuck prediction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
