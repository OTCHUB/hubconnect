// Wallet detection + connect + signing, ported from otchub/src/lib/solanaWallets.js and
// walletSigner.js. Merges window-injected providers (Phantom, Solflare, Backpack, …) with Wallet
// Standard wallets (Jupiter Mobile and other standard-only wallets). The Standard handshake is two
// DOM events — the app fires `wallet-standard:app-ready` with a `register` callback and wallets
// answer with `wallet-standard:register-wallet` — so no extra dependency is needed.
//
// SECURITY MODEL: the module never holds, sees, or transmits private keys. Signing only asks the
// user's wallet to approve a transaction it can review; callers simulate first so a failing tx is
// never signed. A signer is only handed out for the exact address that was connected.
import { Transaction, VersionedTransaction } from "@solana/web3.js";

type SignedTx = { serialize(): Uint8Array };
type InjectedProvider = {
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: unknown } | undefined>;
  publicKey?: unknown;
  signTransaction?: (tx: Transaction | VersionedTransaction) => Promise<SignedTx>;
  signAllTransactions?: (txs: (Transaction | VersionedTransaction)[]) => Promise<SignedTx[]>;
};

type StandardAccount = { address?: string; publicKey?: unknown; chains?: readonly string[] };
type StandardSignOut = { signedTransaction?: Uint8Array };
type StandardWallet = {
  name: string;
  icon?: string;
  chains?: readonly string[];
  accounts?: readonly StandardAccount[];
  features: Record<
    string,
    {
      connect?: () => Promise<{ accounts?: readonly StandardAccount[] }>;
      signTransaction?: (
        ...inputs: { account: StandardAccount; transaction: Uint8Array; chain: string }[]
      ) => Promise<StandardSignOut[] | StandardSignOut>;
    }
  >;
};

/** Signs with the user's wallet and returns serialized signed bytes for broadcast. */
export type WalletSigner = {
  publicKey: string;
  name: string;
  signTransactionRaw: (tx: Transaction | VersionedTransaction) => Promise<Uint8Array>;
  signAllTransactionsRaw: (txs: (Transaction | VersionedTransaction)[]) => Promise<Uint8Array[]>;
};

export type WalletEntry =
  | { id: string; name: string; kind: "injected"; provider: InjectedProvider; icon?: string }
  | { id: string; name: string; kind: "standard"; wallet: StandardWallet; icon?: string };

// Official brand marks, vendored in /public/wallets (no hotlinks) — same paths as otchub.
export const BRAND_ICON: Record<string, string> = {
  phantom: "/wallets/phantom.svg",
  solflare: "/wallets/solflare.ico",
  backpack: "/wallets/backpack.ico",
  jupiter: "/wallets/jupiter.ico",
};

const standard = new Set<StandardWallet>();
const subscribers = new Set<() => void>();
let appReadyFired = false;

const notify = () => subscribers.forEach((cb) => cb());

const registerApi = {
  register: (...wallets: StandardWallet[]) => {
    wallets.forEach((w) => standard.add(w));
    notify();
    return () => {
      wallets.forEach((w) => standard.delete(w));
      notify();
    };
  },
};

function initStandard() {
  if (appReadyFired || typeof window === "undefined") return;
  appReadyFired = true;
  window.addEventListener("wallet-standard:register-wallet", (e) => {
    const cb = (e as CustomEvent<(api: typeof registerApi) => void>).detail;
    if (typeof cb === "function") cb(registerApi);
  });
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: registerApi }));
}

if (typeof window !== "undefined") initStandard();

export function subscribeWallets(cb: () => void) {
  subscribers.add(cb);
  initStandard();
  return () => {
    subscribers.delete(cb);
  };
}

const pkString = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  const s = (v as { toString?: () => string } | null)?.toString?.();
  return s && s !== "[object Object]" ? s : null;
};

function injectedWallets(): WalletEntry[] {
  const w = (typeof window !== "undefined" ? window : {}) as Record<string, any>;
  const found: WalletEntry[] = [];
  const add = (id: string, name: string, provider: unknown) => {
    const p = provider as InjectedProvider | undefined;
    if (p && typeof p.connect === "function" && !found.some((x) => x.id === id)) {
      found.push({ id, name, kind: "injected", provider: p, icon: BRAND_ICON[id] });
    }
  };
  add("phantom", "Phantom", w.phantom?.solana ?? w.solana);
  add("solflare", "Solflare", w.solflare);
  add("backpack", "Backpack", w.backpack);
  add("jupiter", "Jupiter", w.jupiter?.solana ?? w.jupiter);
  add("coinbase", "Coinbase", w.coinbaseSolana);
  add("glow", "Glow", w.glow);
  return found;
}

function standardWallets(): WalletEntry[] {
  return [...standard]
    .filter((w) => w.chains?.some((c) => String(c).startsWith("solana:")))
    .filter((w) => typeof w.features["standard:connect"]?.connect === "function")
    .map((w) => ({ id: `std:${w.name}`, name: w.name, kind: "standard", wallet: w, icon: w.icon }));
}

/** Injected first; standard-only brands appended (de-duped by name). */
export function detectWallets(): WalletEntry[] {
  const injected = injectedWallets();
  const seen = new Set(injected.map((w) => w.name.toLowerCase()));
  return [...injected, ...standardWallets().filter((w) => !seen.has(w.name.toLowerCase()))];
}

// ---- connected-wallet registry (one signing wallet per page) ----
type Connected = { entry: WalletEntry; publicKey: string; account?: StandardAccount };
let connected: Connected | null = null;

export function clearConnectedWallet() {
  connected = null;
}

/** Connect and return the base58 address. Solflare's connect() resolves void — read the provider. */
export async function connectWallet(entry: WalletEntry): Promise<string | null> {
  if (entry.kind === "standard") {
    const connect = entry.wallet.features["standard:connect"]?.connect;
    if (!connect) throw new Error("wallet does not support standard:connect");
    const out = await connect();
    const acct = out?.accounts?.[0] ?? entry.wallet.accounts?.[0];
    const pk = acct?.address ?? pkString(acct?.publicKey);
    if (pk) connected = { entry, publicKey: pk, account: acct };
    return pk;
  }
  const res = await entry.provider.connect();
  const pk = pkString(res?.publicKey) ?? pkString(entry.provider.publicKey);
  if (pk) connected = { entry, publicKey: pk };
  return pk;
}

/** Prompt-free reconnect after reload: `onlyIfTrusted` resolves silently for authorized sites. */
export async function silentReconnect(stored: string): Promise<string | null> {
  for (const entry of detectWallets()) {
    try {
      if (entry.kind === "injected") {
        const res =
          pkString(entry.provider.publicKey) === stored
            ? undefined
            : await entry.provider.connect({ onlyIfTrusted: true });
        if ((pkString(res?.publicKey) ?? pkString(entry.provider.publicKey)) === stored) {
          connected = { entry, publicKey: stored };
          return stored;
        }
      } else if ((await connectWallet(entry)) === stored) return stored;
    } catch {
      /* not authorized in this wallet — try the next one */
    }
  }
  return null;
}

// Wallet prompts can hang when the popup closes without answering (mobile deep-link wallets);
// race against a generous timeout so a stalled prompt surfaces instead of freezing the run.
const SIGN_TIMEOUT_MS = 120_000;
const pendingRejects = new Set<(e: Error) => void>();

/** Abort every in-flight sign prompt (CANCEL during the signature phase; nothing was sent yet). */
export function abortPendingSigns(reason = "Cancelled — no tx was sent") {
  const err = new Error(reason);
  for (const rej of [...pendingRejects]) rej(err);
  pendingRejects.clear();
}

function withSignTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const rej = (e: Error) => {
      pendingRejects.delete(rej);
      reject(e);
    };
    pendingRejects.add(rej);
    const timer = setTimeout(
      () =>
        rej(
          new Error(
            `${label} timed out after ${SIGN_TIMEOUT_MS / 1000}s — the wallet prompt may have closed. Nothing was sent.`,
          ),
        ),
      SIGN_TIMEOUT_MS,
    );
    p.then((v) => {
      clearTimeout(timer);
      pendingRejects.delete(rej);
      resolve(v);
    }, rej);
  });
}

const serializeForSigning = (tx: Transaction | VersionedTransaction) =>
  tx instanceof VersionedTransaction
    ? tx.serialize()
    : tx.serialize({ requireAllSignatures: false, verifySignatures: false });

async function signOne(c: Connected, tx: Transaction | VersionedTransaction): Promise<Uint8Array> {
  if (c.entry.kind === "injected") {
    if (!c.entry.provider.signTransaction)
      throw new Error(`${c.entry.name} does not expose signTransaction`);
    const signed = await withSignTimeout(
      c.entry.provider.signTransaction(tx),
      "Wallet sign prompt",
    );
    if (!signed) throw new Error("Wallet did not return a signed transaction");
    return new Uint8Array(signed.serialize());
  }
  const feat = c.entry.wallet.features["solana:signTransaction"];
  if (!feat?.signTransaction)
    throw new Error("Connected wallet does not support solana:signTransaction");
  if (!c.account) throw new Error("No authorized account from wallet");
  const chain = c.account.chains?.[0] ?? c.entry.wallet.chains?.[0];
  if (!chain) throw new Error("Wallet did not report a supported chain");
  const res = await withSignTimeout(
    feat.signTransaction({ account: c.account, transaction: serializeForSigning(tx), chain }),
    "Wallet sign prompt",
  );
  const out = Array.isArray(res) ? res[0] : res;
  if (!out?.signedTransaction) throw new Error("Wallet returned no signed transaction");
  return new Uint8Array(out.signedTransaction);
}

/** One prompt for N txs on injected wallets; Wallet Standard has no batch feature — per-tx fallback. */
async function signAll(c: Connected, txs: (Transaction | VersionedTransaction)[]) {
  if (!txs.length) return [];
  if (c.entry.kind === "injected" && c.entry.provider.signAllTransactions) {
    const signed = await withSignTimeout(
      c.entry.provider.signAllTransactions(txs),
      "Wallet batch sign prompt",
    );
    if (!Array.isArray(signed) || signed.length !== txs.length)
      throw new Error("Wallet returned wrong number of signed transactions");
    return signed.map((s) => new Uint8Array(s.serialize()));
  }
  const out: Uint8Array[] = [];
  for (const tx of txs) out.push(await signOne(c, tx));
  return out;
}

export function getSigner(): WalletSigner | null {
  const c = connected;
  if (!c) return null;
  return {
    publicKey: c.publicKey,
    name: c.entry.name,
    signTransactionRaw: (tx) => signOne(c, tx),
    signAllTransactionsRaw: (txs) => signAll(c, txs),
  };
}

/** Signer only for the viewed address — a pasted/lookup address never gets a signer. */
export function getSignerForAddress(address: string | null | undefined): WalletSigner | null {
  const s = getSigner();
  return s && address && s.publicKey === address ? s : null;
}
