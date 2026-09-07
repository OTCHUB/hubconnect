import { useParams } from "react-router-dom";
import type { ProtocolState } from "@hub-sdk";
import { DeskCard } from "../components/DeskCard";
import { Disclaimer } from "../components/Disclaimer";
import { ProtocolGate } from "../components/ProtocolGate";
import { BackLink } from "../components/ui/BackLink";
import { ErrorBox, LoadingBox, Notice } from "../components/ui/StateBox";
import { parsePubkey, useDeskTier } from "../hooks/useDeskTier";

function DeskBody({ asset, state }: { asset: string; state: ProtocolState }) {
  const q = useDeskTier(asset, state.config.currentEpoch);
  if (!parsePubkey(asset)) return <Notice tone="red">"{asset}" is not a valid pubkey.</Notice>;
  if (q.isPending) return <LoadingBox label={`READING DESK ${asset.slice(0, 8)}…`} />;
  if (q.isError) return <ErrorBox message={(q.error as Error).message} />;
  return <DeskCard asset={asset} data={q.data} state={state} />;
}

export function DeskPage() {
  const { asset = "" } = useParams<{ asset: string }>();
  return (
    <div className="space-y-2 font-mono">
      <BackLink />
      {asset ? (
        <ProtocolGate>{(state) => <DeskBody asset={asset} state={state} />}</ProtocolGate>
      ) : (
        <Notice tone="red">missing desk asset id in route.</Notice>
      )}
      <Disclaimer />
    </div>
  );
}
