import { Navigate, Route, Routes } from "react-router-dom";
import { Dashboard, type DashboardProps } from "./routes/Dashboard";
import { DeploymentsPage } from "./routes/DeploymentsPage";
import { DeskPage } from "./routes/DeskPage";
import { TreasuryPage } from "./routes/TreasuryPage";

export type HubRoutesProps = DashboardProps;

/**
 * Relative routes — mount under any parent path, e.g. `<Route path="hub/*" element={<HubRoutes />} />`.
 *   ""              dashboard (metrics · round progress · yield table · wallet portfolio)
 *   "treasury"      treasury transparency panel
 *   "deployments"   program / PDA / dependency registry with Solscan links
 *   "desk/:asset"   per-desk tier / consignment / unclaimed estimate
 */
export function HubRoutes(props: HubRoutesProps) {
  return (
    <Routes>
      <Route index element={<Dashboard {...props} />} />
      <Route path="treasury" element={<TreasuryPage />} />
      <Route path="deployments" element={<DeploymentsPage />} />
      <Route path="desk/:asset" element={<DeskPage />} />
      <Route path="*" element={<Navigate to=".." relative="route" replace />} />
    </Routes>
  );
}
