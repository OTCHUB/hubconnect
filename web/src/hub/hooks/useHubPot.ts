import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  fetchHubPot,
  fetchHubPotRound,
  parseMint,
  type HubPotRoundView,
  type HubPotView,
} from "@hub-sdk";
import { useHub } from "../HubProvider";

/** Decimals for each of the 4 MemeStock basket mints, resolved live (never hardcoded — §A2). */
export type HubPotDecimals = { otc: number; crclx: number; nvdax: number; spcxx: number };

export type HubPotDisplay = {
  /** `null` ⇒ `init_hub_pot` has not been called yet on this cluster. */
  pot: HubPotView | null;
  decimals: HubPotDecimals | null;
  /** Most recently opened `HubPotRound`, or `null` if none has been opened yet. */
  latestRound: HubPotRoundView | null;
};

/** §A5.1 — HUB Pot basket transparency read. One extra RPC round trip beyond `fetchHubPot`
 *  itself: the 4 bucket mints' live decimals (for display formatting) + the latest opened
 *  round (for the wallet's estimated-share preview), mirroring `useTokenomics`'s shape. */
export function useHubPot() {
  const { connection, program, programId } = useHub();
  return useQuery({
    queryKey: ["hub", "hubPot", programId.toBase58(), connection.rpcEndpoint],
    queryFn: async (): Promise<HubPotDisplay> => {
      const pot = await fetchHubPot(program);
      if (!pot) return { pot: null, decimals: null, latestRound: null };

      const mints = [pot.otcMint, pot.crclxMint, pot.nvdaxMint, pot.spcxxMint].map(
        (m) => new PublicKey(m),
      );
      const [mintInfos, latestRound] = await Promise.all([
        connection.getMultipleAccountsInfo(mints),
        pot.roundCount > 0 ? fetchHubPotRound(program, pot.roundCount - 1) : null,
      ]);
      const [otc, crclx, nvdax, spcxx] = mints.map((m, i) =>
        mintInfos[i] ? parseMint(m, mintInfos[i]!.data).decimals : 6,
      );
      return { pot, decimals: { otc, crclx, nvdax, spcxx }, latestRound };
    },
  });
}
