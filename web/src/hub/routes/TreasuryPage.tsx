import { Disclaimer } from "../components/Disclaimer";
import { ProtocolGate } from "../components/ProtocolGate";
import { TreasuryPanel } from "../components/TreasuryPanel";
import { BackLink } from "../components/ui/BackLink";

export function TreasuryPage() {
  return (
    <div className="space-y-2 font-mono">
      <BackLink />
      <ProtocolGate>{(state) => <TreasuryPanel state={state} />}</ProtocolGate>
      <Disclaimer />
    </div>
  );
}
