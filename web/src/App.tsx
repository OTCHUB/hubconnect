import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HubProvider, HubRoutes, useHub } from "./hub";
import { WalletProvider } from "./hub/WalletProvider";
import { DripPage } from "./hub/routes/DripPage";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { TerminalBottomBar, TerminalTopBar } from "./TerminalBars";
import { shellConfig } from "./config";

/** otchub's fixed top/bottom terminal bars + page footer — reads `cluster` from HubProvider, so
 * it must render inside the provider (unlike `App`, which mounts it). */
function AppShell() {
  const { cluster } = useHub();
  const statusText = `${cluster.toUpperCase().replace(/-/g, "_")}_LINK_ACTIVE`;
  return (
    <div className="min-h-screen max-w-[100vw] bg-black pt-[34px] pb-[34px] font-mono text-green-400">
      <TerminalTopBar label="$HUB :: OTC Desks Yield Optimizer" statusText={statusText} />
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 xl:max-w-[1500px]">
        <Header />
        <main className="mt-3">
          <Routes>
            <Route path="/hub/*" element={<HubRoutes />} />
            <Route path="/drip" element={<DripPage />} />
            <Route path="*" element={<Navigate to="/hub" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
      <TerminalBottomBar>
        $HUB :: COMMUNITY_TOOLING :: NOT AFFILIATED WITH OTC DESKS
      </TerminalBottomBar>
    </div>
  );
}

/** Standalone shell — mounts at `/hub/*`, the same path otchub will use inside its own router. */
export function App() {
  return (
    <HubProvider
      rpcUrl={shellConfig.rpcUrl}
      programId={shellConfig.programId}
      cluster={shellConfig.cluster}
    >
      <WalletProvider>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </WalletProvider>
    </HubProvider>
  );
}
