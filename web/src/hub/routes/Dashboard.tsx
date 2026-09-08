import { Link } from "react-router-dom";
import { DeskLookupPanel } from "../components/DeskLookupPanel";
import { Disclaimer } from "../components/Disclaimer";
import { EpochTracker } from "../components/EpochTracker";
import { MetricsStrip } from "../components/MetricsStrip";
import { ProtocolGate } from "../components/ProtocolGate";
import { WalletPanel } from "../components/WalletPanel";
import { YieldTable } from "../components/YieldTable";
import { Panel } from "../components/ui/Panel";
import { FlywheelDiagram } from "../components/ui/FlywheelDiagram";

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
            <Panel
              title="THE $HUB FLYWHEEL"
              right={
                <Link to="mechanics" className="underline hover:text-green-300">
                  full mechanics →
                </Link>
              }
            >
              <p className="mb-2 text-xs leading-relaxed text-green-400/90">
                Activate a desk NFT, earn a share of every reward round, and a slice of that same
                revenue buys back and burns $HUB — click any node below to see how it fits together.
              </p>
              <FlywheelDiagram />
            </Panel>
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
            <div id="hub-wallet">
              <WalletPanel state={state} walletAddress={walletAddress} />
            </div>
            <Panel title="DESK LOOKUP">
              <DeskLookupPanel state={state} />
            </Panel>
          </>
        )}
      </ProtocolGate>
      <Disclaimer />
    </div>
  );
}
