import { useEffect, useState, type FormEvent } from "react";
import { parsePubkey } from "../hooks/useDeskTier";
import { connectWallet, detectWallets, subscribeWallets, type WalletEntry } from "../lib/wallets";

type Props = { onConnected: (address: string) => void };

const btnCls =
  "border border-green-500/50 px-3 py-1.5 text-xs text-green-400 hover:bg-green-500/10 disabled:opacity-40";

/** Read-only connect (or paste an address) — same panel otchub's WALLET_CONNECT uses. */
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
    setStatus(`AWAITING_${w.name.toUpperCase().replace(/\s+/g, "_")}_APPROVAL`);
    try {
      const pk = await connectWallet(w);
      if (!pk) throw new Error(`${w.name} returned no public key`);
      onConnected(pk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${w.name} connect failed`;
      setError(
        /reject|declin|denied|4001/i.test(msg)
          ? `${w.name}: request rejected — approve the prompt in your wallet to continue.`
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
        "No Solana wallet detected. Open this page in your wallet's browser or paste an address.",
      );
      return;
    }
    if (list.length === 1) void doConnect(list[0]);
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const key = parsePubkey(manual);
    if (!key) return setError("not a valid base58 pubkey");
    setError(null);
    onConnected(key.toBase58());
  };

  const solflareDeepLink = `https://solflare.com/ul/v1/browse/${encodeURIComponent(
    typeof window !== "undefined" ? window.location.href : "https://app.otchub.dev",
  )}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleConnect}
          disabled={busy}
          className={`${btnCls} font-bold`}
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
          <a href={solflareDeepLink} className={btnCls}>
            [OPEN_IN_SOLFLARE ↗]
          </a>
          <span className="text-green-500/40">opens this page in the Solflare in-app browser</span>
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
        <button type="submit" className={btnCls}>
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
