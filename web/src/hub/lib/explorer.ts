export type HubCluster = "mainnet-beta" | "devnet" | "localnet";

const suffix = (cluster: HubCluster) => {
  if (cluster === "mainnet-beta") return "";
  if (cluster === "devnet") return "?cluster=devnet";
  return "?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899";
};

export const explorerAddress = (address: string, cluster: HubCluster) =>
  `https://explorer.solana.com/address/${address}${suffix(cluster)}`;

export const explorerTx = (sig: string, cluster: HubCluster) =>
  `https://explorer.solana.com/tx/${sig}${suffix(cluster)}`;
