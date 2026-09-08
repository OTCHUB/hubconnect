// Public surface for hosts (otchub) and the standalone shell. Everything else is internal.
export { HubProvider, useHub } from "./HubProvider";
export type { HubProviderProps, HubContextValue } from "./HubProvider";
export { WalletProvider, useWallet } from "./WalletProvider";
export type { WalletContextValue } from "./WalletProvider";
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
export { SwapPanel } from "./components/SwapPanel";
export { ClaimPanel } from "./components/ClaimPanel";
export { ActivatePanel } from "./components/ActivatePanel";
export { useOtcPay } from "./hooks/useOtcPay";
export { quoteTierChange, buildTierChangeIxs, executeTierChange } from "./lib/activate";
export type { PayMethod, TierQuote, TierChangePhase, TierChangeResult } from "./lib/activate";
export { TreasuryPortfolio } from "./components/TreasuryPortfolio";
export { useTreasuryPortfolio } from "./hooks/useTreasuryPortfolio";
export { TokenomicsPanel } from "./components/TokenomicsPanel";
export { MechanicsPanel } from "./components/MechanicsPanel";
export { PieChart } from "./components/ui/PieChart";
export type { PieSlice } from "./components/ui/PieChart";
export { useTokenomics } from "./hooks/useTokenomics";
export type { Tokenomics } from "./hooks/useTokenomics";
export type {
  TreasuryPortfolio as TreasuryPortfolioData,
  TreasuryDesk,
} from "./hooks/useTreasuryPortfolio";
export type { WalletSigner } from "./lib/wallets";
export { getSignerForAddress } from "./lib/wallets";
export type { SwapTransport, JupiterQuote, QuoteParams, TxLog } from "./lib/swap";
export { jupiterLiteTransport } from "./lib/swap";
export {
  magicEdenItemUrl,
  dexscreenerTokenUrl,
  DEFAULT_COLLECTION_URL,
  MAGIC_EDEN_COLLECTION_SLUG,
} from "./lib/marketplace";
export {
  yieldBoostPctOverBase,
  MAX_DESK_SUPPLY,
  NEXT_DESK_SUPPLY_MILESTONE,
  deskMilestoneProgressPct,
} from "./lib/yield";
export { DEPLOYMENTS, type Deployment } from "./lib/deployments";
export type { Scenario } from "./lib/yield";
export { ESTIMATE_LABEL } from "./components/EarningPreview";
export { useHubHistory } from "./hooks/useHubHistory";
export { fetchHubHistory, type HubHistoryPoint } from "./lib/supabaseHistory";
export { HubEarningsChart } from "./components/HubEarningsChart";
export { HubSupplyChart } from "./components/HubSupplyChart";
export { LineChart, type LineSeries } from "./components/ui/LineChart";
