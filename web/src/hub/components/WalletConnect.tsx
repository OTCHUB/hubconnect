import { useEffect, useState, type FormEvent } from "react";
import { parsePubkey } from "../hooks/useDeskTier";
import { connectWallet, detectWallets, subscribeWallets, type WalletEntry } from "../lib/wallets";
import { useUITheme } from "../ThemeProvider";
import { BoltIcon, LockIcon } from "./ui/Icons";

type Props = { onConnected: (address: string) => void };

const MODERN_PRIMARY_BTN =
  "inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-40";
const MODERN_GHOST_BTN =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-white/5 disabled:opacity-40";
const RETRO_BTN =
  "border border-green-500/50 px-3 py-1.5 text-xs text-green-400 hover:bg-green-500/10 disabled:opacity-40";

/** Read-only connect (or paste an address) — single-column, near-zero chrome in "modern" mode
 *  (sits inside `WalletPanel`'s `Panel`); square DOS bordered list in "retro" mode. Reads the
 *  global `ThemeProvider` directly (rather than the parent `Panel`'s className) so it matches
 *  whichever chrome it's dropped into — including the always-DOS header connect dropdown. Same
 *  detect/connect/paste logic in both modes; only the surface (and its copy) changes. */
export function WalletConnect({ onConnected }: Props) {
  const { theme } = useUITheme();
  const isModern = theme === "modern";
  const [wallets, setWallets] = useState<WalletEntry[]>(() => detectWallets());
  const [busy, setBusy] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  // Standard wallets register asynchronously; re-detect on register + a short poll.
  useEffect(() => {
    const refresh = () => setWallets(detectWallets());
    const unsub = subscribeWallets(refresh);
    const timers = [500, 1500, 3000].map((ms) => setTimeout(refresh, ms));
    return () => {
      unsub();
      timers.forEach(clearTimeout);
    };
  }, []);

  const doConnect = async (w: WalletEntry) => {
    setBusy(true);
    setConnectingId(w.id);
    setError(null);
    setStatus(
      isModern
        ? `Waiting on ${w.name}…`
        : `AWAITING_${w.name.toUpperCase().replace(/\s+/g, "_")}_APPROVAL`,
    );
    try {
      const pk = await connectWallet(w);
      if (!pk) throw new Error(`${w.name} returned no public key`);
      onConnected(pk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${w.name} connect failed`;
      setError(
        /reject|declin|denied|4001/i.test(msg)
          ? `${w.name}: request rejected — approve the prompt to continue.`
          : msg,
      );
    } finally {
      setStatus(null);
      setBusy(false);
      setConnectingId(null);
    }
  };

  const handleConnect = () => {
    const list = detectWallets();
    setWallets(list);
    if (!list.length) {
      setError(
        "No wallet detected — open this page in your wallet's browser, or paste an address.",
      );
      return;
    }
    if (list.length === 1) void doConnect(list[0]);
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const key = parsePubkey(manual);
    if (!key) return setError("Not a valid address.");
    setError(null);
    onConnected(key.toBase58());
  };

  const solflareDeepLink = `https://solflare.com/ul/v1/browse/${encodeURIComponent(
    typeof window !== "undefined" ? window.location.href : "https://app.otchub.dev",
  )}`;

  if (!isModern) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy}
            className={`${RETRO_BTN} font-bold`}
          >
            {busy ? "[CONNECTING...]" : "[CONNECT_WALLET]"}
          </button>
          <span className="text-[10px] text-green-500/40">
            PHANTOM · SOLFLARE · BACKPACK · JUPITER · OTHERS
            {wallets.length > 0 && ` · ${wallets.length} DETECTED`}
          </span>
        </div>

        {status && <div className="animate-pulse text-xs text-green-400">&gt; {status}</div>}

        {wallets.length === 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-green-500/50">
            <span>MOBILE?</span>
            <a href={solflareDeepLink} className={RETRO_BTN}>
              [OPEN_IN_SOLFLARE ↗]
            </a>
            <span className="text-green-500/40">
              opens this page in the Solflare in-app browser
            </span>
          </div>
        )}

        {wallets.length > 0 && (
          <div className="border border-green-500/30 p-2">
            <span className="text-[10px] text-green-500/60">SELECT_WALLET:</span>
            <div className="mt-1.5 space-y-1.5">
              {wallets.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => doConnect(w)}
                  disabled={busy}
                  className={`flex w-full items-center gap-2.5 border border-green-500/30 px-2.5 py-2 text-left text-xs text-green-400 hover:bg-green-500/10 disabled:opacity-50 ${
                    connectingId === w.id ? "animate-pulse bg-green-500/10" : ""
                  }`}
                >
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center overflow-hidden border border-green-500/35 bg-black text-xs font-bold">
                    {w.icon ? (
                      <img src={w.icon} alt="" className="h-full w-full object-contain p-[2px]" />
                    ) : (
                      w.name[0]?.toUpperCase()
                    )}
                  </span>
                  <span className="flex-1">{w.name.toUpperCase()}</span>
                  <span className="text-[10px] text-green-500/40">
                    {connectingId === w.id ? "CONNECTING…" : "DETECTED"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={submitManual} className="flex flex-wrap gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="OR PASTE WALLET ADDRESS..."
            spellCheck={false}
            className="min-w-0 flex-1 border border-green-500/30 bg-black px-2 py-1.5 text-xs text-green-400 outline-none placeholder:text-green-500/30 focus:border-green-400"
          />
          <button type="submit" className={RETRO_BTN}>
            [LOOKUP]
          </button>
        </form>

        {error && <div className="text-xs leading-relaxed text-amber-400">ERR: {error}</div>}
        <div className="text-[10px] text-green-700">
          READ-ONLY: the dashboard sees public balances only — no signing, never your keys.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleConnect}
          disabled={busy}
          className={MODERN_PRIMARY_BTN}
        >
          <BoltIcon className="h-3.5 w-3.5" />
          {busy ? "Connecting…" : "Connect Wallet"}
        </button>
        <span className="text-xs text-emerald-200/40">
          One tap. Zero custody.{wallets.length > 0 && ` · ${wallets.length} detected`}
        </span>
      </div>

      {status && <div className="text-xs text-emerald-300/80">{status}</div>}

      {wallets.length === 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <a href={solflareDeepLink} className={MODERN_GHOST_BTN}>
            Open in Solflare ↗
          </a>
          <span className="text-xs text-emerald-200/40">on mobile? tap to open in-app.</span>
        </div>
      )}

      {wallets.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200/40">
            Choose your wallet
          </div>
          <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/5">
            {wallets.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => doConnect(w)}
                disabled={busy}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50 ${
                  connectingId === w.id ? "bg-emerald-400/10" : ""
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xs font-bold">
                  {w.icon ? (
                    <img src={w.icon} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    w.name[0]?.toUpperCase()
                  )}
                </span>
                <span className="flex-1">{w.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-emerald-200/40">
                  {connectingId === w.id ? "connecting…" : "detected"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submitManual} className="flex flex-wrap gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="or paste any address — go read-only"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-white outline-none placeholder:text-emerald-200/30 focus:border-emerald-400/50"
        />
        <button type="submit" className={MODERN_GHOST_BTN}>
          Look Up
        </button>
      </form>

      {error && <div className="text-xs leading-relaxed text-amber-300">{error}</div>}
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-200/30">
        <LockIcon className="h-3 w-3" />
        Read-only. We see balances — never your keys.
      </div>
    </div>
  );
}
