// Client for the devnet-exclusive faucet Worker (../../workers/faucet.ts). Always talks to the
// Worker's own origin — devnet.otchub.dev is the only place FAUCET_KEY/FAUCET_KV are deployed —
// regardless of which host is currently rendering this module (standalone shell or otchub),
// so /drip works the same everywhere it's reachable. Devnet-only by construction: every caller
// gates on `cluster === "devnet"` before importing/using this (see DripPage.tsx / OwnDeskPanel.tsx).
export const FAUCET_BASE_URL = "https://devnet.otchub.dev";

export type FaucetError = { error: string };

export type FaucetStatus = {
  faucet: string;
  solLamports: number;
  hubMint: string;
  otcMint: string;
  /** null until Config.desk_collection is set on this cluster. */
  deskCollection: string | null;
  hubPot: { crclx: string; openai: string; anthropic: string } | null;
};

export type MintDeskResult = {
  asset: string;
  deskNumber: number;
  collection: string;
  /** Always false — the faucet never activates on the recipient's behalf; see faucet.ts. */
  activated: false;
  signature: string;
  explorer: string;
};

export type DripResult = {
  signature: string;
  explorer: string;
  wallet: string;
  /** Whole-token amounts per mint label, e.g. `{ hub: "100000", otc: "100000", ... }`. */
  amounts: Record<"hub" | "otc" | "crclx" | "openai" | "anthropic", string>;
  /** The one Mock OTC Desk NFT minted alongside the tokens in this same drip. */
  desk: MintDeskResult;
};

/** Thrown for any non-2xx response; `status` lets callers branch on 429 (cooldown/rate-limit). */
export class FaucetHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "FaucetHttpError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${FAUCET_BASE_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new FaucetHttpError(
      `could not reach the faucet at ${FAUCET_BASE_URL} — check your connection`,
      0,
    );
  }
  const body = (await res.json().catch(() => null)) as (T & FaucetError) | null;
  if (!res.ok || !body) {
    throw new FaucetHttpError(
      body?.error ?? `faucet request failed (HTTP ${res.status})`,
      res.status,
    );
  }
  return body;
}

export const fetchFaucetStatus = () => call<FaucetStatus>("/api/faucet/status");

export const dripTokens = (wallet: string) =>
  call<DripResult>("/api/faucet/drip", { method: "POST", body: JSON.stringify({ wallet }) });

export const mintMockDesk = (wallet: string) =>
  call<MintDeskResult>("/api/faucet/mint-desk", {
    method: "POST",
    body: JSON.stringify({ wallet }),
  });
