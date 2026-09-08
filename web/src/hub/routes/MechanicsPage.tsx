import { Disclaimer } from "../components/Disclaimer";
import { MechanicsPanel } from "../components/MechanicsPanel";
import { ProtocolGate } from "../components/ProtocolGate";
import { BackLink } from "../components/ui/BackLink";

export function MechanicsPage() {
  return (
    <div className="space-y-2 font-mono">
      <BackLink />
      <ProtocolGate>{(state) => <MechanicsPanel state={state} />}</ProtocolGate>
      <Disclaimer />
    </div>
  );
}
