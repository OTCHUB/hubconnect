#!/usr/bin/env bash
# Deploy the hub program to devnet with the dedicated devnet deployer (never reused on mainnet).
# Usage: scripts/devnet-deploy.sh [--init]   (--init also runs the M1 devnet suite)
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
[ -f .env ] && set -a && . ./.env && set +a

WALLET="${HUB_WALLET:-$HOME/.config/solana/hubconnect-devnet.json}"
WALLET="${WALLET/#\~/$HOME}"
RPC="${HUB_RPC_URL:-https://api.devnet.solana.com}"
[ -n "${HELIUS_API_KEY:-}" ] && RPC="https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
MIN_SOL="${HUB_DEVNET_MIN_SOL:-2}"

PUB=$(solana-keygen pubkey "$WALLET")
BAL=$(solana balance "$PUB" -u "$RPC" | awk '{print $1}')
echo "deployer $PUB balance ${BAL} SOL (min ${MIN_SOL})"
if awk "BEGIN{exit !($BAL < $MIN_SOL)}"; then
  echo "insufficient devnet SOL; run: solana airdrop 2 $PUB -u devnet" >&2
  exit 1
fi

# Reproducible artifact (anchor build for the IDL, then the pinned docker image overwrites the
# .so) so the on-chain hash is verifiable against the repo — see scripts/verify-build.sh.
scripts/verify-build.sh build
anchor deploy --provider.cluster "$RPC" --provider.wallet "$WALLET"
PROGRAM_ID=$(solana-keygen pubkey target/deploy/hub-keypair.json)
echo "deployed hub program: $PROGRAM_ID"
HUB_CLUSTER=devnet HUB_WALLET="$WALLET" scripts/verify-build.sh hash

if [ "${1:-}" = "--init" ]; then
  HUB_CLUSTER=devnet HUB_WALLET="$WALLET" npx ts-mocha -p ./tsconfig.json -t 300000 tests/m1-initialize.ts
fi
