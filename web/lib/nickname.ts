// Optional leaderboard nicknames. Pure functions, no storage. Anonymous is the default: a player with no
// nickname shows as "Anon xxxx". No real names are asked for or checked.
//
// The profanity filter is basic on purpose. It catches common words, spaced-out and leetspeak spellings,
// but not every creative spelling, and it can flag an innocent name now and then. Latin letters only, so a
// look-alike letter from another script cannot be used to fake a reserved name.

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

// Blocklist stored rot13-encoded so the repo does not carry the words in plain text.
const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const BLOCKED = rot13(
  "shpx fuvg ovgpu phag qvpx pbpx chffl nffubyr onfgneq juber fyhg avttre avttn snttbg snt ergneq encr encvfg " +
    "anmv uvgyre xvxr fcvp puvax genaal cbea cravf intvan phz nany ahqr",
).split(" ");
// Short words only match as a whole word, so "peacock" or "analysis" are fine; long ones match anywhere.
const SHORT = 5;

// Names nobody should pose as.
const RESERVED = ["yomi", "admin", "administrator", "moderator", "mod", "staff", "official", "support"];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", $: "s", "!": "i" };

/** Key for "is this name taken": case-insensitive, same Unicode form. */
export const nicknameKey = (name: string) => name.normalize("NFKC").toLowerCase();

/** Lowercase, strip accents, undo common leetspeak. */
function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[01345788$!]/g, (c) => LEET[c] ?? c);
}

export function isProfane(name: string): boolean {
  const folded = fold(name);
  const compact = folded.replace(/[^a-z]/g, ""); // "f u c k" and "f_u_c_k" both become "fuck"
  const tokens = folded.split(/[^a-z]+/).filter(Boolean);
  return BLOCKED.some((w) =>
    w.length >= SHORT ? compact.includes(w) : compact === w || tokens.some((t) => t === w || t === `${w}s`),
  );
}

export type NicknameResult = { ok: true; nickname: string | null } | { ok: false; error: string };

/** null or blank clears the nickname (back to anonymous). Otherwise 2 to 16 characters. */
export function validateNickname(raw: string | null | undefined): NicknameResult {
  if (raw === null || raw === undefined) return { ok: true, nickname: null };
  const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name === "") return { ok: true, nickname: null };
  const length = Array.from(name).length;
  if (length < NICKNAME_MIN) return { ok: false, error: `At least ${NICKNAME_MIN} characters.` };
  if (length > NICKNAME_MAX) return { ok: false, error: `Max ${NICKNAME_MAX} characters.` };
  // Latin letters, digits, single spaces, underscore, hyphen. No links, emoji or symbols.
  if (!/^[\p{Script=Latin}\p{N}][\p{Script=Latin}\p{N} _-]*$/u.test(name)) {
    return { ok: false, error: "Use letters, numbers, spaces, _ or - only." };
  }
  const compact = fold(name).replace(/[^a-z]/g, "");
  if (RESERVED.includes(compact) || compact.startsWith("anon")) return { ok: false, error: "That name is taken or reserved." };
  if (isProfane(name)) return { ok: false, error: "That name is not allowed." };
  return { ok: true, nickname: name };
}
