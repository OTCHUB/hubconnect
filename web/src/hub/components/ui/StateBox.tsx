import type { ReactNode } from "react";
import { useHub } from "../../HubProvider";
import { explorerAddress } from "../../lib/explorer";
import { rpcHost } from "../../lib/format";
import { AddressLink } from "./AddressLink";

type Tone = "green" | "amber" | "red";

function Box({ tone, children }: { tone: Tone; children: ReactNode }) {
  const cls = {
    green: "border-green-500/30 text-green-400",
    amber: "border-amber-500/40 text-amber-300",
    red: "border-red-500/40 text-red-300",
  }[tone];
  return <div className={`border bg-black p-4 font-mono text-xs ${cls}`}>{children}</div>;
}

export function LoadingBox({ label = "READING CHAIN" }: { label?: string }) {
  return (
    <Box tone="green">
      <span className="text-green-600">&gt;</span> {label}
      <span className="animate-blink">_</span>
    </Box>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <Box tone="red">
      <div className="tracking-widest">[ RPC ERROR ]</div>
      <div className="mt-1 break-all text-red-400/80">{message}</div>
    </Box>
  );
}

export function UninitializedBox() {
  const { programId, cluster, connection } = useHub();
  return (
    <Box tone="amber">
      <div className="tracking-widest">[ PROGRAM NOT INITIALIZED ]</div>
      <div className="mt-2 text-amber-200/80">
        <div>
          program: <AddressLink address={programId.toBase58()} full />
        </div>
        <div>cluster: {cluster}</div>
        <div className="break-all">rpc: {rpcHost(connection.rpcEndpoint)}</div>
        <div className="mt-1">No Config account found at the config PDA.</div>
      </div>
      <div className="mt-2 text-amber-500/70">
        Panels will populate once `initialize` has run.{" "}
        <a
          className="underline hover:text-amber-200"
          href={explorerAddress(programId.toBase58(), cluster)}
          target="_blank"
          rel="noreferrer"
        >
          view program ↗
        </a>
      </div>
    </Box>
  );
}

export function Notice({ tone = "amber", children }: { tone?: Tone; children: ReactNode }) {
  return <Box tone={tone}>{children}</Box>;
}
