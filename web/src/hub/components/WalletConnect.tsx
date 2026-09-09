import { useEffect, useState, type FormEvent } from "react";
import { parsePubkey } from "../hooks/useDeskTier";
import { connectWallet, detectWallets, subscribeWallets, type WalletEntry } from "../lib/wallets";

type Props = { onConnected: (address: string) => void };

const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-40";
const ghostBtn =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-white/5 disabled:opacity-40";

/** Read-only connect (or paste an address) — single-column, near-zero chrome by design (sits
 *  inside `WalletPanel`'s `GlassPanel`). Same detect/connect/paste logic as the DOS-styled version
 *  it replaced; only the surface is new. */
export function WalletConnect({ onConnected }: Props) {
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
    setStatus(`Waiting on ${w.name}…`);
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={handleConnect} disabled={busy} className={primaryBtn}>
          <span aria-hidden>⚡</span>
          {busy ? "Connecting…" : "Connect Wallet"}
        </button>
        <span className="text-xs text-emerald-200/40">
          One tap. Zero custody.{wallets.length > 0 && ` · ${wallets.length} detected`}
        </span>
      </div>

      {status && <div className="text-xs text-emerald-300/80">{status}</div>}

      {wallets.length === 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <a href={solflareDeepLink} className={ghostBtn}>
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
        <button type="submit" className={ghostBtn}>
          Look Up
        </button>
      </form>

      {error && <div className="text-xs leading-relaxed text-amber-300">{error}</div>}
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-200/30">
        <span aria-hidden>🔐</span>
        Read-only. We see balances — never your keys.
      </div>
    </div>
  );
}
