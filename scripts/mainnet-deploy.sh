#!/usr/bin/env bash
# Deploy (and optionally verify) the hub program on mainnet-beta with the dedicated mainnet
# deployer — never the devnet key. This exists because verify-build.sh falls back to plain
# HUB_WALLET when unset, and .env sets HUB_WALLET to the devnet keypair unconditionally; sourcing
# .env here without pinning WALLET first would silently sign a mainnet deploy with a devnet key.
#
#   scripts/mainnet-deploy.sh            build + deploy
#   scripts/mainnet-deploy.sh --verify   build + deploy + verify (writes the verify PDA and
#                                        queues the OtterSec remote job)
#
# Wallet: HUB_MAINNET_WALLET (.env) or --wallet on the command line, else
# ~/.config/solana/hubconnect-mainnet.json. HUB_WALLET is intentionally never consulted here.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
[ -f .env ] && set -a && . ./.env && set +a

VERIFY=false
WALLET="${HUB_MAINNET_WALLET:-$HOME/.config/solana/hubconnect-mainnet.json}"
while [ $# -gt 0 ]; do
  case "$1" in
    --verify) VERIFY=true ;;
    --wallet) shift; WALLET="$1" ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done
WALLET="${WALLET/#\~/$HOME}"
[ -f "$WALLET" ] || { echo "mainnet wallet not found: $WALLET" >&2; exit 1; }

RPC="${HUB_MAINNET_RPC_URL:-https://api.mainnet-beta.solana.com}"
[ -z "${HUB_MAINNET_RPC_URL:-}" ] && [ -n "${HELIUS_API_KEY:-}" ] && RPC="https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
MIN_SOL="${HUB_MAINNET_MIN_SOL:-3}"

PUB=$(solana-keygen pubkey "$WALLET")
BAL=$(solana balance "$PUB" -u "$RPC" | awk '{print $1}')
echo "mainnet deployer $PUB balance ${BAL} SOL (min ${MIN_SOL})"
if awk "BEGIN{exit !($BAL < $MIN_SOL)}"; then
  echo "insufficient mainnet SOL in $PUB (have ${BAL}, need ${MIN_SOL}) — fund it first" >&2
  exit 1
fi

PROGRAM_ID=$(solana-keygen pubkey target/deploy/hub-keypair.json 2>/dev/null || true)
[ -n "$PROGRAM_ID" ] || { echo "no target/deploy/hub-keypair.json — run anchor build once first" >&2; exit 1; }

echo "about to deploy/upgrade $PROGRAM_ID on mainnet-beta as $PUB via $RPC"
if [ -z "${HUB_YES:-}" ]; then
  read -r -p "type MAINNET to continue: " confirm
  [ "$confirm" = "MAINNET" ] || { echo "aborted"; exit 1; }
fi

HUB_CLUSTER=mainnet-beta HUB_RPC_URL="$RPC" HUB_WALLET="$WALLET" scripts/verify-build.sh build
HUB_CLUSTER=mainnet-beta HUB_RPC_URL="$RPC" HUB_WALLET="$WALLET" scripts/verify-build.sh deploy
echo "deployed hub program: $PROGRAM_ID"

if [ "$VERIFY" = true ]; then
  HUB_CLUSTER=mainnet-beta HUB_RPC_URL="$RPC" HUB_WALLET="$WALLET" scripts/verify-build.sh verify
  echo "verify job queued for $PROGRAM_ID"
fi
