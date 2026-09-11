// Secondary-market links for OTC desks (Metaplex Core assets). Magic Eden is where desks list and
// where the treasury's floor sweeps buy — same URLs otchub's ArbitrageCard / HoldingsDetail use.
export const MAGIC_EDEN_ITEM = "https://magiceden.io/item-details";
/** Official OTC Desks collection slug on Magic Eden (mainnet). */
export const MAGIC_EDEN_COLLECTION_SLUG = "otc_desks";
/** OTC desks collection page on Magic Eden (mainnet slug). Hosts may override via HubProvider. */
export const DEFAULT_COLLECTION_URL = `https://magiceden.io/marketplace/${MAGIC_EDEN_COLLECTION_SLUG}`;
/** Official OTC Desks launch-curve mint (mainnet only — no devnet equivalent, see faucet.ts). */
export const OFFICIAL_MINT_URL = "https://otcdesks.cash/mint";
/** Official OTC Desks activation platform — the external/official alternative to this dashboard's
 *  native ACTIVATE_DESK flow (ActivatePanel.tsx), for users who prefer otcdesks.cash's own UI. */
export const OFFICIAL_DESKS_URL = "https://otcdesks.cash/desks";

export const magicEdenItemUrl = (asset: string) =>
  `${MAGIC_EDEN_ITEM}/${encodeURIComponent(asset)}`;

export const dexscreenerTokenUrl = (mint: string) =>
  `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;

export const jupiterSwapUrl = (outputMint: string) =>
  `https://jup.ag/swap/SOL-${encodeURIComponent(outputMint)}`;
