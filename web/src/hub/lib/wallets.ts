// Read-only wallet detection + connect, ported from otchub/src/lib/solanaWallets.js.
// Merges window-injected providers (Phantom, Solflare, Backpack, …) with Wallet Standard
// wallets (Jupiter Mobile and other standard-only wallets). The Standard handshake is two
// DOM events — the app fires `wallet-standard:app-ready` with a `register` callback and
// wallets answer with `wallet-standard:register-wallet` — so no extra dependency is needed.

type InjectedProvider = {
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: unknown } | void>;
  publicKey?: unknown;
};

type StandardAccount = { address?: string; publicKey?: unknown };
type StandardWallet = {
  name: string;
  icon?: string;
  chains?: readonly string[];
  accounts?: readonly StandardAccount[];
  features: Record<string, { connect?: () => Promise<{ accounts?: readonly StandardAccount[] }> }>;
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

/** Connect and return the base58 address. Solflare's connect() resolves void — read the provider. */
export async function connectWallet(entry: WalletEntry): Promise<string | null> {
  if (entry.kind === "standard") {
    const connect = entry.wallet.features["standard:connect"]?.connect;
    if (!connect) throw new Error("wallet does not support standard:connect");
    const out = await connect();
    const acct = out?.accounts?.[0] ?? entry.wallet.accounts?.[0];
    return acct?.address ?? pkString(acct?.publicKey);
  }
  const res = await entry.provider.connect();
  return pkString(res?.publicKey) ?? pkString(entry.provider.publicKey);
}

/** Prompt-free reconnect after reload: `onlyIfTrusted` resolves silently for authorized sites. */
export async function silentReconnect(stored: string): Promise<string | null> {
  for (const entry of detectWallets()) {
    try {
      if (entry.kind === "injected") {
        if (pkString(entry.provider.publicKey) === stored) return stored;
        const res = await entry.provider.connect({ onlyIfTrusted: true });
        if ((pkString(res?.publicKey) ?? pkString(entry.provider.publicKey)) === stored)
          return stored;
      } else if ((await connectWallet(entry)) === stored) return stored;
    } catch {
      /* not authorized in this wallet — try the next one */
    }
  }
  return null;
}
