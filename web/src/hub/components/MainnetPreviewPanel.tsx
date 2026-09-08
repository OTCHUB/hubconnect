import { useState } from "react";
import { DEFAULT_MAINNET_PREVIEW_RPC, useMainnetPreview } from "../hooks/useMainnetPreview";
import { parsePubkey } from "../hooks/useDeskTier";
import { OTC_DESKS_COLLECTION_MAINNET } from "../lib/deployments";
import { AddressLink } from "./ui/AddressLink";

const inputCls =
  "flex-1 border border-green-500/30 bg-black px-2 py-1 text-xs text-green-300 outline-none focus:border-green-400";

/**
 * Explicit, opt-in "Mainnet preview" — lets a tester paste a real mainnet-beta wallet address and
 * see its actual OTC Desks NFT metadata/art render through the same components used for the
 * connected wallet, without ever attributing that mainnet data to the wallet currently connected
 * in this app (which may be on devnet). Off by default; shows a persistent banner whenever on, so
 * the cluster a screen is describing is never ambiguous. This replaces silently hardcoding the
 * mainnet collection into devnet reads, which would make a devnet-connected wallet appear to own
 * real mainnet assets it doesn't hold.
 */
export function MainnetPreviewPanel() {
  const [enabled, setEnabled] = useState(false);
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_MAINNET_PREVIEW_RPC);
  const [raw, setRaw] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const q = useMainnetPreview(rpcUrl, enabled ? address : null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const key = parsePubkey(raw);
    if (!key) return setErr("not a valid base58 wallet address");
    setErr(null);
    setAddress(key.toBase58());
  };

  return (
    <div className="border border-amber-500/30">
      <button
        type="button"
        onClick={() => setEnabled((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-widest text-amber-400 hover:bg-amber-500/10"
        aria-expanded={enabled}
      >
        <span>[ MAINNET PREVIEW ] — QA real mainnet desk metadata</span>
        <span>{enabled ? "[ON — click to disable]" : "[OFF — click to enable]"}</span>
      </button>

      {enabled && (
        <div className="space-y-2 border-t border-amber-500/30 p-3">
          <div className="border border-amber-500/50 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-300">
            ⚠ MAINNET_PREVIEW_ACTIVE — reading real <strong>mainnet-beta</strong> data from the OTC
            Desks collection (
            <AddressLink address={OTC_DESKS_COLLECTION_MAINNET} cluster="mainnet-beta" />
            ). This is independent of the wallet connected above and of this app's connected cluster
            — it is NOT that wallet's real holdings. Read-only; no tier/yield shown ($HUB's
            mainnet-beta program is deployed but not yet initialized — no Config/tier data to read
            until `initialize_config` runs).
          </div>

          <label className="flex flex-col gap-1 text-[10px] text-green-600">
            DAS-capable RPC (Helius/Triton) — optional, unlocks art/name; ownership works on the
            public RPC either way
            <input
              value={rpcUrl}
              onChange={(e) => setRpcUrl(e.target.value)}
              spellCheck={false}
              className={inputCls}
            />
          </label>

          <form onSubmit={submit} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <span className="text-xs text-green-600">C:\HUB&gt;</span>
              <input
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="mainnet wallet address to preview"
                spellCheck={false}
                className={inputCls}
              />
              <button
                type="submit"
                className="border border-amber-500/40 px-3 text-xs text-amber-300 hover:bg-amber-500/10"
              >
                PREVIEW
              </button>
            </div>
            {err && <div className="text-[10px] text-red-400">{err}</div>}
          </form>

          {address && (
            <div className="space-y-1">
              <div className="text-[10px] tracking-widest text-green-500/70">
                MAINNET WALLET :: <AddressLink address={address} cluster="mainnet-beta" full />
              </div>
              {q.isPending && <div className="text-xs text-green-500/50">LOADING…</div>}
              {q.isError && (
                <div className="text-xs text-amber-400">ERR: {(q.error as Error).message}</div>
              )}
              {q.data && q.data.length === 0 && (
                <div className="text-xs text-green-700">
                  no desks from the mainnet collection in this wallet.
                </div>
              )}
              {q.data && q.data.length > 0 && (
                <div className="space-y-1">
                  {q.data.map((d) => (
                    <div
                      key={d.asset}
                      className="flex flex-wrap items-center gap-2 border border-green-500/15 px-2 py-1 text-xs"
                    >
                      {d.art?.image ? (
                        <img
                          src={d.art.image}
                          alt={d.art.name ?? "desk NFT"}
                          className="h-6 w-6 shrink-0 border border-green-500/30 bg-black object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="inline-block h-6 w-6 shrink-0 border border-green-500/15 bg-black" />
                      )}
                      <AddressLink address={d.asset} cluster="mainnet-beta" />
                      <span className="min-w-0 flex-1 truncate text-green-600">
                        {d.art?.name ?? "no DAS art"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
