import { AirdropChecker } from "../components/AirdropChecker";
import { Disclaimer } from "../components/Disclaimer";
import { ProtocolGate } from "../components/ProtocolGate";
import { BackLink } from "../components/ui/BackLink";

// Not linked from Header.tsx yet (reachable by direct URL only) — see the airdrop checker's own
// "not yet live" banner, which is driven by on-chain state (TokenomicsConfig.airdropRootSet).
export function AirdropPage() {
  return (
    <div className="space-y-2 font-mono">
      <BackLink />
      <ProtocolGate>{(state) => <AirdropChecker state={state} />}</ProtocolGate>
      <Disclaimer />
    </div>
  );
}
