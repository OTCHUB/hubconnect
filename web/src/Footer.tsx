import { GithubIcon } from "./hub/components/ui/Icons";

// Public repo backing the deployed $HUB program — same one scripts/verify-build.sh builds
// from, so this is the "verify the source yourself" link for anyone reading the footer.
const HUB_GITHUB_URL = "https://github.com/OTCHUB/hubconnect";

// Byte-identical with otchub's page footer (src/components/otc/Footer.jsx, mounted on
// src/pages/Hub.jsx) — same copy, order, and link styling — so the $HUB dashboard closes out
// the same way on otchub.dev, app.otchub.dev, and devnet.otchub.dev.
export function Footer() {
  const linkCls = "underline hover:text-green-400";
  return (
    <footer className="mt-4 space-y-1 text-center text-[10px] text-green-500/30">
      <div>$HUB · COMMUNITY_TOOLING · NOT AFFILIATED WITH OTC DESKS</div>
      <div>
        DATA: SOLANA RPC (ON-CHAIN READS) · ECOSYSTEM:{" "}
        <a href="https://otchub.dev" target="_blank" rel="noopener noreferrer" className={linkCls}>
          otchub.dev ↗
        </a>
        {" · "}
        <a
          href="https://fomo.otchub.dev"
          target="_blank"
          rel="noopener noreferrer"
          className={linkCls}
        >
          fomo.otchub.dev ↗
        </a>
        {" · "}
        <a
          href={HUB_GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 ${linkCls}`}
        >
          <GithubIcon className="h-3 w-3" aria-hidden="true" />
          source ↗
        </a>
      </div>
      <div>© 2026 otchub.dev</div>
    </footer>
  );
}
