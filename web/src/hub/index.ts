// Public surface for hosts (otchub) and the standalone shell. Everything else is internal.
export { HubProvider, useHub } from "./HubProvider";
export type { HubProviderProps, HubContextValue } from "./HubProvider";
export { HubRoutes } from "./HubRoutes";
export type { HubRoutesProps } from "./HubRoutes";
export { useProtocolState } from "./hooks/useProtocolState";
export type { ProtocolStatus } from "./hooks/useProtocolState";
export { useDeskTier } from "./hooks/useDeskTier";
export type { HubCluster } from "./lib/explorer";
export { rpcHost } from "./lib/format";
export { EnvBadge } from "./components/ui/EnvBadge";
export { useRpcCluster } from "./hooks/useRpcCluster";
export type { RpcClusterStatus } from "./hooks/useRpcCluster";
export { WalletPanel } from "./components/WalletPanel";
export { DEPLOYMENTS, type Deployment } from "./lib/deployments";
export type { Scenario } from "./lib/yield";
export { ESTIMATE_LABEL } from "./components/YieldTable";
