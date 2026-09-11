// Shared "may the sweeper touch a live marketplace yet" gate — independent of, and evaluated
// in addition to, `checkOperationalGate`. Deliberately provider-agnostic: we have not
// committed to Magic Eden vs. OpenSea for desk-listing/floor-price data, so this only asks
// "is *some* marketplace provider explicitly configured and enabled", never assumes which
// one. Default is OFF — until an operator sets `SWEEPER_ENABLED=1` plus a supported
// `MARKETPLACE_PROVIDER` and its API key, the sweeper stays the current read-only heartbeat
// (on-chain `desks_owned` vs. `DESK_ACQUISITION_TARGET` only — see `./arbitrage`). This should
// remain OFF through mainnet launch, and only be flipped on once one integration is picked,
// implemented, and verified on devnet first.

export type MarketplaceProvider = "magiceden" | "opensea";

export const SUPPORTED_MARKETPLACE_PROVIDERS: readonly MarketplaceProvider[] = [
  "magiceden",
  "opensea",
];

export type MarketplaceGateInputs = {
  /** `SWEEPER_ENABLED=1` — explicit operator opt-in, separate from the global `DRY_RUN`/
   *  `Config.paused` gates so the sweeper can stay off even once everything else goes live. */
  sweeperEnabled: boolean;
  /** `MARKETPLACE_PROVIDER` — must name one of `SUPPORTED_MARKETPLACE_PROVIDERS`. */
  provider?: string;
  /** The API key for whichever provider is named above (`MAGIC_EDEN_API_KEY` /
   *  `OPENSEA_API_KEY`), resolved by the caller — see `loadMarketplaceGateInputsFromEnv`. */
  apiKey?: string;
};

export type MarketplaceGateResult =
  | { ok: true; provider: MarketplaceProvider }
  | { ok: false; reason: string };

/** Pure decision logic only — no RPC/API calls. Mirrors `gate.ts` / `gas.ts`. */
export function checkMarketplaceGate(inputs: MarketplaceGateInputs): MarketplaceGateResult {
  if (!inputs.sweeperEnabled) {
    return {
      ok: false,
      reason:
        "SWEEPER_ENABLED != 1 — desk-sweeping paused by operator default until a marketplace integration ships",
    };
  }
  const provider = inputs.provider?.toLowerCase();
  if (!provider || !SUPPORTED_MARKETPLACE_PROVIDERS.includes(provider as MarketplaceProvider)) {
    return {
      ok: false,
      reason: `MARKETPLACE_PROVIDER must be one of ${SUPPORTED_MARKETPLACE_PROVIDERS.join("/")} — got ${
        inputs.provider ?? "(unset)"
      }`,
    };
  }
  if (!inputs.apiKey) {
    return {
      ok: false,
      reason: `MARKETPLACE_PROVIDER=${provider} but its API key env var is not set`,
    };
  }
  return { ok: true, provider: provider as MarketplaceProvider };
}

/** Resolves `MarketplaceGateInputs` from the process env — `SWEEPER_ENABLED`,
 *  `MARKETPLACE_PROVIDER`, and that provider's `*_API_KEY`. */
export function loadMarketplaceGateInputsFromEnv(): MarketplaceGateInputs {
  const provider = process.env.MARKETPLACE_PROVIDER;
  const apiKey =
    provider?.toLowerCase() === "opensea"
      ? process.env.OPENSEA_API_KEY
      : provider?.toLowerCase() === "magiceden"
        ? process.env.MAGIC_EDEN_API_KEY
        : undefined;
  return { sweeperEnabled: process.env.SWEEPER_ENABLED === "1", provider, apiKey };
}
