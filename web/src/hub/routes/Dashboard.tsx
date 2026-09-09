import { Link } from "react-router-dom";
import { DeskLookupPanel } from "../components/DeskLookupPanel";
import { Disclaimer } from "../components/Disclaimer";
import { EarningPreview } from "../components/EarningPreview";
import { EpochTracker } from "../components/EpochTracker";
import { HubBondingDashboard } from "../components/HubBondingDashboard";
import { MainnetPreviewPanel } from "../components/MainnetPreviewPanel";
import { MetricsStrip } from "../components/MetricsStrip";
import { ProtocolGate } from "../components/ProtocolGate";
import { WalletPanel } from "../components/WalletPanel";
import { useWallet } from "../WalletProvider";
import { Panel } from "../components/ui/Panel";
import { FlywheelDiagram } from "../components/ui/FlywheelDiagram";

export type DashboardProps = {
  rawDeskDailyLamports?: number;
  /** Host-connected wallet (otchub); when set the module skips its own connect UI. */
  walletAddress?: string;
};

export function Dashboard({ rawDeskDailyLamports, walletAddress }: DashboardProps) {
  const wallet = useWallet();
  const address = walletAddress ?? wallet.address;

  return (
    <div className="space-y-2 font-mono">
      <ProtocolGate>
        {(state, fetchedAt) => (
          <>
            {/* Top of the main content area, immediately below the global header — the
                centralized wallet controller every panel below implicitly depends on.
                Collapses to a one-line status summary once a wallet is connected. */}
            <div id="hub-wallet">
              <WalletPanel state={state} walletAddress={walletAddress} />
            </div>
            <HubBondingDashboard state={state} address={address} />
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
            <EarningPreview state={state} rawDeskDailyLamports={rawDeskDailyLamports} />
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
            <Panel title="DESK LOOKUP">
              <DeskLookupPanel state={state} />
            </Panel>
            <MainnetPreviewPanel />
          </>
        )}
      </ProtocolGate>
      <Disclaimer />
    </div>
  );
}
