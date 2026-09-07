import { burnPda, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useTokenMetadataJson } from "../hooks/useTokenMetadataJson";
import { solscanAddress } from "../lib/explorer";
import { fmtBpPct, fmtHub, fmtTokens, shortKey } from "../lib/format";
import { AddressLink } from "./ui/AddressLink";
import { CopyButton } from "./ui/CopyButton";
import { CollapsibleCard, Flag, Row } from "./ui/Panel";

/** Address + explorer link + copy — the fields an indexer verification form asks for. */
function Addr({ address }: { address: string }) {
  const { cluster } = useHub();
  return (
    <span className="inline-flex items-center gap-1.5">
      <AddressLink address={address} />
      <a
        href={solscanAddress(address, cluster)}
        target="_blank"
        rel="noreferrer"
        className="text-[10px] text-green-700 underline hover:text-green-300"
      >
        solscan
      </a>
      <CopyButton text={address} />
    </span>
  );
}

const SOCIAL_KEYS = ["website", "twitter", "telegram", "discord"] as const;

/**
 * §C6.1 — verification info for Dexscreener / CoinGecko / wallet listings: mint (CA), program,
 * burn-proof addresses, supply + authorities read live from the SPL mint, and the Metaplex
 * metadata (name / symbol / icon / socials) exactly as indexers will read it.
 */
export function VerificationPanel({ state }: { state: ProtocolState }) {
  const { programId } = useHub();
  const { config, token, supply } = state;
  const { mint, metadata } = token;
  const meta = useTokenMetadataJson(metadata?.uri);
  const burnState = burnPda(programId)[0].toBase58();
  const d = supply.decimals;
  const socials = meta.data
    ? SOCIAL_KEYS.map((k) => [k, meta.data?.[k] ?? meta.data?.extensions?.[k]] as const).filter(
        (e): e is readonly [(typeof SOCIAL_KEYS)[number], string] => !!e[1],
      )
    : [];

  return (
    <CollapsibleCard
      title="VERIFICATION INFO"
      right={metadata?.symbol ? `$${metadata.symbol}` : undefined}
      defaultOpen
    >
      <div className="mb-2 text-[10px] text-green-700">
        For Dexscreener / CoinGecko / wallet listings. Burns are spl-token <code>Burn</code>{" "}
        instructions, so <em>max − Mint.supply</em> on the mint account is the burn proof; the
        BurnState PDA is the protocol&apos;s cumulative ledger of them.
      </div>
      <Row k="$HUB mint (CA)" v={<Addr address={config.hubMint} />} />
      <Row k="program id" v={<Addr address={programId.toBase58()} />} />
      <Row k="burn state PDA (burn proof)" v={<Addr address={burnState} />} />
      <Row k="treasury multisig (locked)" v={<Addr address={config.treasury} />} />
      <Row k="metadata PDA" v={metadata ? <Addr address={metadata.address} /> : "— not written"} />

      <div className="mt-3 border-t border-green-500/10 pt-2">
        <Row
          k="max supply"
          v={`${fmtTokens(supply.maxUnits, d)} (${fmtHub(supply.maxUnits, d, 0)})`}
        />
        <Row
          k="mint supply (live)"
          v={mint ? fmtTokens(mint.supplyUnits, d) : "— mint not found"}
        />
        <Row
          k="burned"
          v={`${fmtTokens(supply.burnedUnits, d)} · ${fmtBpPct(supply.burnPctOfMaxBp)} of max`}
        />
        <Row k="treasury / locked" v={fmtTokens(supply.lockedUnits, d)} />
        <Row k="circulating" v={fmtTokens(supply.circulatingUnits, d)} />
        <Row k="burn % of circulating" v={fmtBpPct(supply.burnPctOfCirculatingBp)} />
        <Row k="decimals" v={mint ? String(mint.decimals) : "—"} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Flag on={!!mint && mint.mintAuthority === null} label="MINT AUTH REVOKED" />
        <Flag on={!!mint && mint.freezeAuthority === null} label="NO FREEZE AUTH" />
        <Flag on={!!metadata} label="METADATA" />
        <Flag on={!!metadata && !metadata.isMutable} label="METADATA IMMUTABLE" />
        <Flag on={!supply.ledgerDrift} label="LEDGER = MINT" />
      </div>
      {mint?.mintAuthority && (
        <div className="mt-1 text-[10px] text-yellow-500">
          mint authority still {shortKey(mint.mintAuthority)} — revoke before listing
          (scripts/hub-authority.ts)
        </div>
      )}

      {metadata && (
        <div className="mt-3 flex gap-3 border-t border-green-500/10 pt-2">
          {meta.data?.image && (
            <img
              src={meta.data.image}
              alt={`${metadata.symbol} icon`}
              className="h-12 w-12 border border-green-500/30 object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <Row k="name" v={metadata.name || "—"} />
            <Row k="symbol" v={metadata.symbol || "—"} />
            <Row
              k="uri"
              v={
                <a
                  href={metadata.uri}
                  target="_blank"
                  rel="noreferrer"
                  className="underline break-all"
                >
                  {metadata.uri}
                </a>
              }
            />
            <Row k="update authority" v={<Addr address={metadata.updateAuthority} />} />
            {socials.map(([k, v]) => (
              <Row
                k={k}
                key={k}
                v={
                  <a href={v} target="_blank" rel="noreferrer" className="underline break-all">
                    {v}
                  </a>
                }
              />
            ))}
            {meta.isFetched && !meta.data && (
              <div className="text-[10px] text-yellow-500">
                uri JSON unreachable — indexers won&apos;t see icon/socials
              </div>
            )}
            {meta.data && socials.length === 0 && (
              <div className="text-[10px] text-yellow-500">
                no website/twitter/telegram in uri JSON
              </div>
            )}
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
