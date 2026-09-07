import { useHub } from "../../HubProvider";
import { explorerAddress, explorerTx } from "../../lib/explorer";
import { shortKey } from "../../lib/format";

type Props = { address: string; label?: string; full?: boolean; kind?: "address" | "tx" };

export function AddressLink({ address, label, full = false, kind = "address" }: Props) {
  const { cluster } = useHub();
  const href = kind === "tx" ? explorerTx(address, cluster) : explorerAddress(address, cluster);
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
