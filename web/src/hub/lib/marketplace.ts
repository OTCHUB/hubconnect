// Secondary-market links for OTC desks (Metaplex Core assets). Magic Eden is where desks list and
// where the treasury's floor sweeps buy — same URLs otchub's ArbitrageCard / HoldingsDetail use.
export const MAGIC_EDEN_ITEM = "https://magiceden.io/item-details";
/** Official OTC Desks collection slug on Magic Eden (mainnet). */
export const MAGIC_EDEN_COLLECTION_SLUG = "otc_desks";
/** OTC desks collection page on Magic Eden (mainnet slug). Hosts may override via HubProvider. */
export const DEFAULT_COLLECTION_URL = `https://magiceden.io/marketplace/${MAGIC_EDEN_COLLECTION_SLUG}`;

export const magicEdenItemUrl = (asset: string) =>
  `${MAGIC_EDEN_ITEM}/${encodeURIComponent(asset)}`;

export const dexscreenerTokenUrl = (mint: string) =>
  `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;

export const jupiterSwapUrl = (outputMint: string) =>
  `https://jup.ag/swap/SOL-${encodeURIComponent(outputMint)}`;
