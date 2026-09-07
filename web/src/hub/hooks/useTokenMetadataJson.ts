import { useQuery } from "@tanstack/react-query";
import { fetchOffchainMetadata, type TokenOffchainMetadata } from "@hub-sdk";

/** Off-chain metadata JSON (image + socials) behind the Metaplex `uri`; cached for the session. */
export function useTokenMetadataJson(uri: string | undefined) {
  return useQuery<TokenOffchainMetadata | null>({
    queryKey: ["hub", "token-metadata-json", uri],
    queryFn: () => fetchOffchainMetadata(uri!),
    enabled: !!uri,
    staleTime: Infinity,
    retry: 0,
  });
}
