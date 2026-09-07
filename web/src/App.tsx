import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HubProvider, HubRoutes } from "./hub";
import { Header } from "./Header";
import { shellConfig } from "./config";

/** Standalone shell — mounts at `/hub/*`, the same path otchub will use inside its own router. */
export function App() {
  return (
    <HubProvider
      rpcUrl={shellConfig.rpcUrl}
      programId={shellConfig.programId}
      cluster={shellConfig.cluster}
    >
      <BrowserRouter>
        <div className="crt min-h-screen bg-black font-mono text-green-400">
          <div className="mx-auto max-w-6xl px-3 py-4">
            <Header />
            <main className="mt-3">
              <Routes>
                <Route path="/hub/*" element={<HubRoutes />} />
                <Route path="*" element={<Navigate to="/hub" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>
    </HubProvider>
  );
}
