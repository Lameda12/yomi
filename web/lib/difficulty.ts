// The optional "how difficult did that feel?" answer. Three fixed values, no free text. Safe to import in the browser.
export const RATINGS = ["easy", "medium", "hard"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABEL: Record<Rating, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export const isRating = (v: unknown): v is Rating => typeof v === "string" && (RATINGS as readonly string[]).includes(v);
