import { Link } from "react-router-dom";
import { DeskLookup } from "../components/DeskLookup";
import { Disclaimer } from "../components/Disclaimer";
import { EpochTracker } from "../components/EpochTracker";
import { MetricsStrip } from "../components/MetricsStrip";
import { ProtocolGate } from "../components/ProtocolGate";
import { WalletPanel } from "../components/WalletPanel";
import { YieldTable } from "../components/YieldTable";
import { Panel } from "../components/ui/Panel";

export type DashboardProps = {
  rawDeskDailyLamports?: number;
  /** Host-connected wallet (otchub); when set the module skips its own connect UI. */
  walletAddress?: string;
};

export function Dashboard({ rawDeskDailyLamports, walletAddress }: DashboardProps) {
  return (
    <div className="space-y-2 font-mono">
      <ProtocolGate>
        {(state, fetchedAt) => (
          <>
            <MetricsStrip state={state} />
            <EpochTracker state={state} />
            <YieldTable state={state} rawDeskDailyLamports={rawDeskDailyLamports} />
            <div className="flex justify-between text-[10px] text-green-700">
              <span>last read {new Date(fetchedAt).toLocaleTimeString()}</span>
              <span className="flex gap-3">
                <Link to="tokenomics" className="underline hover:text-green-300">
                  tokenomics →
                </Link>
                <Link to="treasury" className="underline hover:text-green-300">
                  treasury transparency →
                </Link>
              </span>
            </div>
            <WalletPanel state={state} walletAddress={walletAddress} />
          </>
        )}
      </ProtocolGate>
      <Panel title="DESK LOOKUP">
        <DeskLookup />
      </Panel>
      <Disclaimer />
    </div>
  );
}
