// Mirrors otchub's page footer (src/pages/Home.jsx) — same copy pattern, credits, and link
// styling — so the $HUB dashboard closes out the same way every other otchub eco site does.
export function Footer() {
  return (
    <footer className="mt-4 space-y-1 text-center text-[10px] text-green-500/30">
      <div>$HUB · COMMUNITY_TOOLING · NOT AFFILIATED WITH OTC DESKS</div>
      <div>
        DATA: SOLANA RPC (ON-CHAIN READS) · ECOSYSTEM:{" "}
        <a
          href="https://otchub.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-green-400"
        >
          otchub.dev ↗
        </a>
        {" · "}
        <a
          href="https://fomo.otchub.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-green-400"
        >
          fomo.otchub.dev ↗
        </a>
      </div>
    </footer>
  );
}
