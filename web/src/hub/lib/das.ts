// Best-effort NFT artwork lookup for desk cards via the Digital Asset Standard (DAS)
// `getAsset`/`getAssetBatch` JSON-RPC methods (Helius, Triton, etc.). These methods are not part
// of the base Solana JSON-RPC spec, so a plain `api.devnet.solana.com`-style endpoint will 404 or
// return a JSON-RPC error — every call here degrades to `null`/`{}` instead of throwing, since art
// is cosmetic and must never block tier/pending-yield reads (§ desk lookup).
export type DeskAssetArt = { name: string | null; image: string | null };

type DasAsset = {
  content?: {
    metadata?: { name?: string };
    files?: { uri?: string; mime?: string }[];
    links?: { image?: string };
  };
};

async function dasRpc(rpcEndpoint: string, method: string, params: unknown): Promise<unknown> {
  const res = await fetch(rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "hub-desk-art", method, params }),
  });
  if (!res.ok) throw new Error(`DAS RPC error ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "DAS error");
  return json.result;
}

function artFromAsset(asset: DasAsset): DeskAssetArt {
  const files = asset.content?.files ?? [];
  const image =
    files.find((f) => f.mime?.startsWith("image/"))?.uri ??
    files[0]?.uri ??
    asset.content?.links?.image ??
    null;
  return { name: asset.content?.metadata?.name ?? null, image };
}

/** Single-asset lookup — used by the desk detail page. */
export async function fetchDeskArt(
  rpcEndpoint: string,
  asset: string,
): Promise<DeskAssetArt | null> {
  try {
    const result = (await dasRpc(rpcEndpoint, "getAsset", { id: asset })) as DasAsset | null;
    return result ? artFromAsset(result) : null;
  } catch {
    return null;
  }
}

/** Batched lookup keyed by asset id — used by the wallet portfolio (avoids N round-trips). */
export async function fetchDeskArtBatch(
  rpcEndpoint: string,
  assets: string[],
): Promise<Record<string, DeskAssetArt>> {
  if (assets.length === 0) return {};
  try {
    const result = (await dasRpc(rpcEndpoint, "getAssetBatch", { ids: assets })) as
      (DasAsset | null)[] | null;
    const out: Record<string, DeskAssetArt> = {};
    (result ?? []).forEach((a, i) => {
      if (a) out[assets[i]] = artFromAsset(a);
    });
    return out;
  } catch {
    return {};
  }
}
