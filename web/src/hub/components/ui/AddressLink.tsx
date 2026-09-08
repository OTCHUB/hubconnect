import { useHub } from "../../HubProvider";
import { explorerAddress, explorerTx, type HubCluster } from "../../lib/explorer";
import { shortKey } from "../../lib/format";

type Props = {
  address: string;
  label?: string;
  full?: boolean;
  kind?: "address" | "tx";
  /** Overrides the connected cluster for the explorer link only — for read-only cross-cluster
   *  previews (MainnetPreviewPanel) where the address genuinely lives on a different cluster than
   *  the one the app is connected to. Never changes which RPC is queried. */
  cluster?: HubCluster;
};

export function AddressLink({ address, label, full = false, kind = "address", cluster }: Props) {
  const { cluster: connectedCluster } = useHub();
  const effectiveCluster = cluster ?? connectedCluster;
  const href =
    kind === "tx"
      ? explorerTx(address, effectiveCluster)
      : explorerAddress(address, effectiveCluster);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={address}
      className="text-green-300 underline decoration-green-700 hover:text-green-100"
    >
      {label ?? (full ? address : shortKey(address))}
    </a>
  );
}
