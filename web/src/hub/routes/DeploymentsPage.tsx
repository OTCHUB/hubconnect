import { useState } from "react";
import { useHub } from "../HubProvider";
import { Disclaimer } from "../components/Disclaimer";
import { BackLink } from "../components/ui/BackLink";
import { Panel } from "../components/ui/Panel";
import { useProtocolState } from "../hooks/useProtocolState";
import {
  DEPLOYMENTS,
  liveDeployments,
  type DeploymentStatus,
  type RegistryCluster,
} from "../lib/deployments";
import { solscanAddress } from "../lib/explorer";

const STATUS: Record<DeploymentStatus, { label: string; cls: string }> = {
  live: { label: "LIVE", cls: "border-emerald-500 text-emerald-300" },
  pending: { label: "NOT_DEPLOYED", cls: "border-dashed border-amber-500 text-amber-300" },
  mock: { label: "HARNESS_MOCK", cls: "border-dashed border-slate-500 text-slate-300" },
  external: { label: "EXTERNAL", cls: "border-cyan-500/60 text-cyan-300" },
};

function StatusTag({ status }: { status: DeploymentStatus }) {
  const s = STATUS[status];
  return (
    <span className={`border px-1.5 py-0.5 text-[10px] tracking-widest ${s.cls}`}>{s.label}</span>
  );
}

function SolscanLink({ address, cluster }: { address: string; cluster: RegistryCluster }) {
  return (
    <a
      href={solscanAddress(address, cluster)}
      target="_blank"
      rel="noreferrer"
      title={address}
      className="break-all text-green-300 underline decoration-green-700 hover:text-green-100"
    >
      {address} <span className="no-underline">↗</span>
    </a>
  );
}

function Entry({
  name,
  role,
  address,
  status,
  cluster,
  note,
}: {
  name: string;
  role: string;
  address: string | null;
  status: DeploymentStatus;
  cluster: RegistryCluster;
  note?: string;
}) {
  return (
    <div className="border border-green-500/20 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold tracking-widest text-green-300">{name}</span>
        <StatusTag status={status} />
      </div>
      <div className="mt-1 text-green-500/70">{role}</div>
      <div className="mt-1 font-mono text-[11px]">
        {address ? (
          <SolscanLink address={address} cluster={cluster} />
        ) : (
          <span className="text-green-700">
            — no address on {cluster === "devnet" ? "devnet" : "mainnet"} yet
          </span>
        )}
      </div>
      {note && <div className="mt-1 text-[10px] text-green-700">{note}</div>}
    </div>
  );
}

const toggleCls = (on: boolean) =>
  `border px-2.5 py-1 text-[10px] tracking-widest ${
    on
      ? "border-green-400 bg-green-500/15 text-green-200"
      : "border-green-500/50 text-green-400 hover:bg-green-500/10"
  }`;

/** Program registry with a Solscan cluster toggle; live PDA/Config rows come from the connected RPC. */
export function DeploymentsPage() {
  const { cluster: active, programId } = useHub();
  const { status } = useProtocolState();
  const [cluster, setCluster] = useState<RegistryCluster>(
    active === "mainnet-beta" ? "mainnet-beta" : "devnet",
  );

  const hub = DEPLOYMENTS.find((d) => d.id === "hub-program")!;
  const programDeployed = hub.address[cluster] !== null;
  const showLive = cluster === active && programDeployed;
  const config = status.kind === "ready" ? status.state.config : null;
  const { pdas, fromConfig } = liveDeployments(
    showLive ? programId : null,
    showLive ? config : null,
  );

  const toggle = (
    <span className="flex gap-1">
      {(["devnet", "mainnet-beta"] as RegistryCluster[]).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setCluster(c)}
          className={toggleCls(cluster === c)}
        >
          {c === "devnet" ? "DEVNET" : "MAINNET"}
        </button>
      ))}
    </span>
  );

  return (
    <div className="space-y-2 font-mono">
      <BackLink />
      <Panel title="DEPLOYMENTS :: $HUB PROGRAM REGISTRY" right={toggle}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-green-700">
          <span>
            Links open solscan.io on <span className="text-green-400">{cluster}</span>. Dashboard is
            reading <span className="text-green-400">{active}</span>.
          </span>
          <a
            href="https://github.com/nodecattel/hubconnect"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 whitespace-nowrap border border-green-500/50 px-2 py-1 text-[10px] tracking-widest text-green-400 hover:bg-green-500/10"
            title="hubconnect source on GitHub"
          >
            [SOURCE ↗]
          </a>
        </div>
        <div className="space-y-2">
          {DEPLOYMENTS.filter((d) => d.group === "hub").map((d) => (
            <Entry
              key={d.id}
              {...d}
              address={d.address[cluster]}
              status={d.status[cluster]}
              cluster={cluster}
            />
          ))}
        </div>
      </Panel>

      <Panel title="PROGRAM ACCOUNTS (LIVE)">
        {!programDeployed ? (
          <div className="text-xs text-amber-300">
            $HUB is not deployed on {cluster} — no PDAs to derive.
          </div>
        ) : !showLive ? (
          <div className="text-xs text-green-700">
            switch the dashboard RPC to {cluster} to read live accounts; showing static registry
            only.
          </div>
        ) : (
          <div className="space-y-2">
            {pdas.map((r) => (
              <Entry key={r.id} {...r} status="live" cluster={cluster} />
            ))}
            {fromConfig.map(({ devnetMock, ...r }) => (
              <Entry
                key={r.id}
                {...r}
                status={devnetMock && cluster === "devnet" ? "mock" : "live"}
                cluster={cluster}
              />
            ))}
            {status.kind !== "ready" && (
              <div className="text-xs text-green-700">
                Config rows appear once the protocol state loads.
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="DEPENDENCIES">
        <div className="space-y-2">
          {DEPLOYMENTS.filter((d) => d.group === "deps").map((d) => {
            // Cross-check the static registry's mainnet collection mint against the live
            // on-chain Config.desk_collection once the dashboard is actually reading mainnet.
            const collectionCheck =
              d.id === "otc-desks-collection" && cluster === "mainnet-beta" && showLive && config
                ? config.deskCollection === d.address[cluster]
                  ? "✓ VERIFIED — matches on-chain Config.desk_collection"
                  : "⚠ MISMATCH vs on-chain Config.desk_collection"
                : undefined;
            return (
              <Entry
                key={d.id}
                {...d}
                address={d.address[cluster]}
                status={d.status[cluster]}
                cluster={cluster}
                note={collectionCheck ?? d.note}
              />
            );
          })}
        </div>
      </Panel>
      <Disclaimer />
    </div>
  );
}
