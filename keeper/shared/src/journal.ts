// Generic append-only, resume-safe journal shared by all five keeper services
// (`keeper/README.md`'s "resume-safe via an append-only journal (keeper/<name>/journal/,
// git-ignored)" contract — see `.gitignore`'s `keeper/**/journal/`). One newline-delimited
// JSON record per cycle decision, whether or not it actually submitted a transaction.
//
// This is an audit/dedupe aid, never the source of truth: on-chain state is always the
// live read (`checkOperationalGate`'s sibling rule — never cache past a single run). For
// the epoch keeper specifically, `alreadySent` layers a same-process double-fire guard on
// top of (not a substitute for) the live `Epoch.finalized` check every cycle performs via
// `canFinalize`. The four secondary keepers (sweeper/lp/treasury-exit/creator-fee) use this
// purely for observability while their execution paths are deferred (see each service's
// module doc for why) — every cycle's outcome (waited / would-act / blocked / sent / error)
// gets a record so an operator can audit what each keeper *would* have done.
import fs from "node:fs";
import path from "node:path";

/** Generic per-cycle record. `service` disambiguates entries once multiple keepers share
 *  a journal file (not required today — each keeper still gets its own `journal/` dir —
 *  but keeps the shape future-proof if journals are ever consolidated). */
export type JournalEntry = {
  ts: string;
  service: "epoch" | "sweeper" | "lp" | "treasury-exit" | "creator-fee" | "otc-buy";
  /** `swap-sent` is `otc-buy`-specific: the Jupiter swap landed $OTC in the keeper's own ATA but
   *  `record_otc_buy` has not yet confirmed — see `keeper/otc-buy/src/index.ts`'s resume logic. */
  status:
    | "waited"
    | "would-act"
    | "blocked"
    | "dry-run"
    | "swap-sent"
    | "sent"
    | "confirm-error"
    | "error";
  /** Free-form summary of the decision (threshold check, planned legs, gate reason, etc). */
  detail: string;
  signature?: string;
  error?: string;
  /** Extra structured fields specific to a service's decision (leg amounts, route labels,
   *  epoch index, etc) — kept loose so each keeper doesn't need a bespoke journal shape. */
  meta?: Record<string, unknown>;
};

export function journalPath(dir: string, file = "cycles.ndjson"): string {
  return path.join(dir, file);
}

export function appendJournal(dir: string, entry: JournalEntry, file = "cycles.ndjson"): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(journalPath(dir, file), JSON.stringify(entry) + "\n", "utf8");
}

export function readJournal(dir: string, file = "cycles.ndjson"): JournalEntry[] {
  const p = journalPath(dir, file);
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
