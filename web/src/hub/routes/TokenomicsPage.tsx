import { Disclaimer } from "../components/Disclaimer";
import { ProtocolGate } from "../components/ProtocolGate";
import { TokenomicsPanel } from "../components/TokenomicsPanel";
import { BackLink } from "../components/ui/BackLink";

export function TokenomicsPage() {
  return (
    <div className="space-y-2 font-mono">
      <BackLink />
      <ProtocolGate>{(state) => <TokenomicsPanel state={state} />}</ProtocolGate>
      <Disclaimer />
    </div>
  );
}
