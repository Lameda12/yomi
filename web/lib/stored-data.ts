// What Yomi stores, in plain English. This is the single list behind the /what-we-store page.
// It is checked against the real code by tests/stored-data.test.ts: every column in migrations/*.sql must appear here
// (and nothing else), the API's accepted fields must match, every localStorage key in the source must be listed, and
// the source must not read IPs, cookies or request headers. Change the schema or the API and that test fails until
// this list is updated, so the page cannot quietly drift from what the code does.

/** sent = the browser sends it; derived = the server works it out from the moves; server = the server adds it. */
export type Origin = "sent" | "derived" | "server";
export type Group = "you" | "puzzle" | "play" | "guess" | "extra";

export interface StoredItem {
  column: string;
  what: string;
  why: string;
  origin: Origin;
  group: Group;
}

export const GROUPS: { id: Group; title: string }[] = [
  { id: "you", title: "Who played (anonymously)" },
  { id: "puzzle", title: "Which puzzle" },
  { id: "play", title: "How you played" },
  { id: "guess", title: "What Yomi guessed" },
  { id: "extra", title: "Housekeeping" },
];

// One row per attempt, solved or given up (table `solves`).
export const SOLVES: StoredItem[] = [
  { column: "player_id", group: "you", origin: "sent", what: "A random ID your browser made up for itself. It is not your name and not tied to any account.", why: "Groups your solves together, so you can see your own attempts and so the model can later learn how players differ." },
  { column: "solve_id", group: "you", origin: "sent", what: "A random ID for this one attempt.", why: "Stops a retried upload from being saved twice, and it is the ID in a shared result link." },
  { column: "puzzle_id", group: "puzzle", origin: "sent", what: "Which puzzle you played.", why: "To see how hard each puzzle really is for people." },
  { column: "grid_size", group: "puzzle", origin: "sent", what: "The grid size (5, 6 or 7).", why: "Bigger grids take longer; the model needs to know." },
  { column: "n_dots", group: "puzzle", origin: "derived", what: "How many numbered dots that puzzle has. Looked up from the puzzle, not from you.", why: "A feature the model uses to guess difficulty." },
  { column: "events", group: "play", origin: "sent", what: "Your path as you drew it. For every change: the time since your first move, the grid cell your finger or mouse was on, and the path length. Nothing else about your screen.", why: "The server works out your solve time, backtracks and pauses from this, and uses it to check a solve is real." },
  { column: "solve_ms", group: "play", origin: "derived", what: "How long the attempt took, worked out on the server from your moves (never taken from your phone).", why: "This is what the model is meant to predict once it has been retrained on enough real solves." },
  { column: "completed", group: "play", origin: "derived", what: "Whether you finished the grid or gave up.", why: "Only finished solves count as training data." },
  { column: "backtracks", group: "play", origin: "derived", what: "How many times you undid part of your path.", why: "Shows where a puzzle trips people up." },
  { column: "max_pause_ms", group: "play", origin: "derived", what: "Your longest pause between two moves.", why: "Used to find the spot where you got stuck." },
  { column: "stuck_cell", group: "play", origin: "derived", what: "The grid cell where you paused longest.", why: "Trains the part of the model that guesses where people get stuck." },
  { column: "device", group: "play", origin: "sent", what: "Whether you played with a mouse or by touch. Nothing else about your device.", why: "Touch and mouse play differently, so we can check the model treats both fairly." },
  { column: "started_at_ms", group: "play", origin: "sent", what: "The clock time of your first move (milliseconds since 1970). This reveals roughly when you played.", why: "Used with your solve time to work out when the attempt ended." },
  { column: "ended_at_ms", group: "play", origin: "derived", what: "When the attempt ended: your first-move time plus the solve time the server worked out.", why: "Completes the record of the attempt." },
  { column: "mode", group: "play", origin: "sent", what: "regular or extreme (the sprint).", why: "Extreme runs are kept separate and are not used to train the model." },
  { column: "pred_value", group: "guess", origin: "sent", what: "The number Yomi predicted before you played.", why: "Lets you and the stats pages compare the guess with what happened. Not used to train the model." },
  { column: "pred_unit", group: "guess", origin: "sent", what: "Whether that number is a time or a count of solver steps (the model is still on solver steps).", why: "So a step count is never mistaken for a time." },
  { column: "model_version", group: "guess", origin: "sent", what: "Which version of the model made the guess.", why: "To compare model versions fairly." },
  { column: "id", group: "extra", origin: "server", what: "A row number.", why: "Keeps rows in order." },
  { column: "created_at", group: "extra", origin: "server", what: "The date and time the server saved the row.", why: "Used for the hourly limit on saved solves and for stats over time." },
  { column: "played_zip_before", group: "extra", origin: "sent", what: "Whether you have played a similar puzzle before. The game does not ask this right now, so it is empty.", why: "Reserved for checking whether experience changes solve times." },
  { column: "source", group: "extra", origin: "sent", what: "Marks special rows: demo for the presenter screen's volunteers, local_import for the owner's own early test solves. Empty for normal play.", why: "So those rows can be told apart. Training does not leave them out, because they are real people too." },
  { column: "extreme_limit_ms", group: "extra", origin: "sent", what: "Used only by the old Extreme mode, which had a clock per puzzle. The sprint leaves it empty.", why: "Kept so older rows still make sense." },
];

// Only if you choose a nickname (table `players`).
export const PLAYERS: StoredItem[] = [
  { column: "player_id", group: "you", origin: "sent", what: "The same random ID as above.", why: "Links your nickname to your anonymous solves." },
  { column: "nickname", group: "you", origin: "sent", what: "The name you picked (2 to 16 characters), only if you picked one. It is public: it shows on result links you share.", why: "So a result you share can carry your name instead of an anonymous label." },
  { column: "nickname_lower", group: "you", origin: "server", what: "A lowercase copy of your nickname.", why: "So two people cannot take the same name that differs only by capital letters." },
  { column: "created_at", group: "extra", origin: "server", what: "When you first set a nickname.", why: "Limits how many new nicknames can be created per minute." },
  { column: "updated_at", group: "extra", origin: "server", what: "When you last changed it.", why: "Limits changes to one every 5 seconds per ID." },
];

// What stays in your browser (localStorage). None of it is sent unless it says so.
export const DEVICE: { key: string; what: string }[] = [
  { key: "yomi_player", what: "Your random anonymous ID. Sent with every solve (see above)." },
  { key: "yomi_nick", what: "Your nickname, if the server accepted one." },
  { key: "yomi_nick_pending", what: "A nickname you typed that could not be saved yet (offline). Retried later." },
  { key: "yomi_start_done", what: "Only read, never written now: set by an older start screen that asked about a nickname. It just stops the how-to-play showing again." },
  { key: "yomi_tutorial_done", what: "That you have seen the how-to-play." },
  { key: "yomi_done", what: "Which puzzles you have solved, so the next one is new." },
  { key: "yomi_seen", what: "Which puzzles you have solved or skipped." },
  { key: "yomi_streak_days", what: "The days you solved something, for your streak." },
  { key: "yomi_best", what: "Your best time per grid size." },
  { key: "yomi_mode", what: "Whether you last chose Regular or Extreme." },
  { key: "yomi_sprint_scores", what: "Your best Extreme score for each run length." },
  { key: "yomi_sprint_seconds", what: "The Extreme run length you last picked." },
  { key: "yomi_sprint_rules_seen", what: "That you have read the Extreme rules." },
  { key: "yomi_queue", what: "Solves waiting to be sent, for example when you were offline. Sent on your next visit." },
  { key: "yomi_zip_before", what: "Read by the game but never written by it, so it stays empty." },
  { key: "yomi_demo_stats", what: "Only on the projector screen: the last totals it showed." },
];

export const NOT_STORED: { item: string; detail: string }[] = [
  { item: "Email address", detail: "Nothing asks for one." },
  { item: "An account, login or password", detail: "There are none." },
  { item: "Your real name", detail: "The nickname is optional, you pick it, and it is public." },
  { item: "Your IP address", detail: "Yomi's code never reads it, and no column holds it. (Your host is a different matter, see the notes below.)" },
  { item: "Your location", detail: "Nothing asks for it." },
  { item: "Browser or device identifiers", detail: "Only \"mouse\" or \"touch\" is saved. The code never reads your browser's identity string." },
  { item: "Cookies", detail: "Yomi sets none. Your anonymous ID lives in your browser's local storage instead." },
  { item: "Analytics or ad trackers", detail: "Vercel Web Analytics is used to track page views and Web Vitals (performance metrics). It does not use cookies and respects Do Not Track. No other analytics or ad trackers are present." },
];

export const USES: string[] = [
  "To train the model that predicts how hard a puzzle is and where people get stuck. Only finished Regular solves are used, including the projector-screen volunteers and the owner's early local solves, who are real people too. Extreme runs and a few early test rows are left out. Training is a manual batch job, run by a person from time to time. The model does not change while you play, and your solve is not used until the next time it is run.",
  "To show you your own attempts on the Your attempts page: they are looked up by your anonymous ID, and you can download them. Nobody else's attempts are shown there.",
  "For the What the data shows page: totals, where people get stuck, and, once there is enough data, how the model's guesses compare with what happened. These are aggregates, with no IDs or nicknames.",
  "To build a result page when you share a link: your time, backtracks, mode and your nickname (or an anonymous label like Anon 3f2a). It never shows your random ID or your move log.",
];

export const LIMITS: string[] = [
  "Rate limits: at most 60 saved solves per hour per anonymous ID, and nickname changes once every 5 seconds per ID plus 60 new nicknames a minute across everyone. They go by the anonymous ID your browser made up, not by your IP, so they slow things down but are not strong abuse protection.",
  "Hosting: the site runs on Vercel and the data sits in a Neon database. Like most hosts, they may keep their own server logs, which can include IP addresses. Yomi's code never reads or saves those, and we cannot promise how long the hosts keep them.",
  "Our own logs: when something fails the server writes an error message to its log. It never logs requests, headers, IPs or what you played.",
  "Deleting: picking Go anonymous removes your nickname from the server. There is no button yet to delete saved solves; they carry only the random ID.",
  "Nothing is sold, and nothing is shown to advertisers.",
];

// The fields each API accepts, checked against the real validation code in the tests.
export const API_SOLVE_FIELDS = [
  "solve_id", "player_id", "puzzle_id", "grid_size", "device", "started_at_ms", "events", "played_zip_before", "mode", "extreme_limit_ms", "source", "prediction",
] as const;
export const API_PLAYER_FIELDS = ["player_id", "nickname"] as const;
