// Append-only, resume-safe journal for the epoch keeper — `keeper/README.md`'s
// "resume-safe via an append-only journal (keeper/<name>/journal/, git-ignored)" contract
// (already covered by `.gitignore`'s `keeper/**/journal/`). One newline-delimited JSON record
// per `finalize_epoch` attempt.
//
// This is an audit/dedupe aid, never the source of truth: whether an epoch is already closed is
// always decided by the live `Epoch.finalized` account read, re-fetched fresh every cycle
// (`checkOperationalGate`'s sibling rule — never cache past a single run). The journal only
// guards against a same-process double-fire (e.g. an overlapping cycle after a slow RPC call).
import fs from "node:fs";
import path from "node:path";

export type JournalEntry = {
  ts: string;
  epochIndex: number;
  swapTotalLamports: string;
  minHubOut?: string;
  outAmount?: string;
  routeLabels?: string[];
  dryRun: boolean;
  status: "dry-run" | "sent" | "confirm-error" | "error";
  signature?: string;
  error?: string;
};

// Segregated by `HUB_CLUSTER` (set by both `keeper/ecosystem.config.js` [devnet] and
// `keeper/ecosystem.mainnet.config.js` [mainnet-beta] — same convention `scripts/lib/
// devnet.ts` already hard-requires). Without this, `hub-keeper-epoch` (devnet) and
// `hub-keeper-epoch-mainnet` both run this exact same compiled file from the same repo
// checkout, so `__dirname` — and therefore the journal path — was identical for both
// processes: every devnet dry-run cycle and every real mainnet `finalize_epoch` landed in
// one shared `epochs.ndjson`. Harmless today only because devnet stays DRY_RUN=1 (never
// writes a "sent" entry `alreadySent` would match on) — but a manual devnet DRY_RUN=0 test
// run (the accepted plan for devnet's on-demand `finalize_epoch`) sharing an epoch index
// with a real mainnet epoch would have falsely marked one of them "already sent" and
// silently skipped it.
export const DEFAULT_JOURNAL_DIR = path.join(
  __dirname,
  "..",
  "journal",
  process.env.HUB_CLUSTER || "devnet",
);

export function journalPath(dir: string = DEFAULT_JOURNAL_DIR): string {
  return path.join(dir, "epochs.ndjson");
}

export function appendJournal(entry: JournalEntry, dir: string = DEFAULT_JOURNAL_DIR): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(journalPath(dir), JSON.stringify(entry) + "\n", "utf8");
}

function readEntries(dir: string): JournalEntry[] {
  const p = journalPath(dir);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JournalEntry];
      } catch {
        return [];
      }
    });
}

/** True when a `sent` attempt for `epochIndex` is already on record — see module doc: a
 *  same-process double-fire guard layered on top of (never a substitute for) the live
 *  `Epoch.finalized` check every cycle already performs via `canFinalize`. */
export function alreadySent(epochIndex: number, dir: string = DEFAULT_JOURNAL_DIR): boolean {
  return readEntries(dir).some((e) => e.epochIndex === epochIndex && e.status === "sent");
}
