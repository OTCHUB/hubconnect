import { Navigate, Route, Routes } from "react-router-dom";
import { Dashboard, type DashboardProps } from "./routes/Dashboard";
import { DeskPage } from "./routes/DeskPage";
import { TreasuryPage } from "./routes/TreasuryPage";

export type HubRoutesProps = DashboardProps;

/**
 * Relative routes — mount under any parent path, e.g. `<Route path="hub/*" element={<HubRoutes />} />`.
 *   ""              dashboard (metrics · epoch · yield table)
 *   "treasury"      treasury transparency panel
 *   "desk/:asset"   per-desk tier / consignment / unclaimed estimate
 */
export function HubRoutes(props: HubRoutesProps) {
  return (
    <Routes>
      <Route index element={<Dashboard {...props} />} />
      <Route path="treasury" element={<TreasuryPage />} />
      <Route path="desk/:asset" element={<DeskPage />} />
      <Route path="*" element={<Navigate to=".." relative="route" replace />} />
    </Routes>
  );
}
