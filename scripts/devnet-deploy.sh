#!/usr/bin/env bash
# Deploy the hub program to devnet with the dedicated devnet deployer (never reused on mainnet).
#
# Builds with the `mock-jupiter` Cargo feature ON by default (see programs/hub/Cargo.toml and
# programs/mock_jupiter) so the deployed program's `JUPITER_PROGRAM_ID` /
# `RAYDIUM_CP_SWAP_PROGRAM_ID` constants redirect to `programs/mock_jupiter` instead of the real
# Jupiter v6 / Raydium CP-Swap ids — neither of which exists on devnet at all (see
# `programs/mock_jupiter/src/lib.rs`'s doc comment). Without this, `finalize_epoch` /
# `activate_tier_otc` / `upgrade_tier_otc`'s synchronous swap CPI can never succeed against a
# devnet-cluster deploy. This intentionally bypasses `verify-build.sh build`'s Docker
# reproducible-build step (which always builds the default, mock-jupiter-less feature set —
# correct for mainnet-beta parity, wrong here): devnet has no reproducibility requirement. The
# `deploy` step itself (extend/upgrade, hash re-check, Orquestra sync) is feature-agnostic and is
# reused unchanged from verify-build.sh.
#
# Usage: scripts/devnet-deploy.sh [--init] [--no-mock-jupiter]
#   --init              also runs the M1 devnet suite after deploying
#   --no-mock-jupiter   build+deploy the plain (real-Jupiter-id) feature set instead — only useful
#                       for byte-for-byte comparison against a mainnet build; two-hop swap paths
#                       will not be callable against the result on devnet.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
[ -f .env ] && set -a && . ./.env && set +a

WALLET="${HUB_WALLET:-$HOME/.config/solana/hubconnect-devnet.json}"
WALLET="${WALLET/#\~/$HOME}"
RPC="${HUB_RPC_URL:-https://api.devnet.solana.com}"
[ -n "${HELIUS_API_KEY:-}" ] && RPC="https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
MIN_SOL="${HUB_DEVNET_MIN_SOL:-2}"

INIT=false
MOCK_JUPITER=true
for arg in "$@"; do
  case "$arg" in
    --init) INIT=true ;;
    --no-mock-jupiter) MOCK_JUPITER=false ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

PUB=$(solana-keygen pubkey "$WALLET")
BAL=$(solana balance "$PUB" -u "$RPC" | awk '{print $1}')
echo "deployer $PUB balance ${BAL} SOL (min ${MIN_SOL})"
if awk "BEGIN{exit !($BAL < $MIN_SOL)}"; then
  echo "insufficient devnet SOL; run: solana airdrop 2 $PUB -u devnet" >&2
  exit 1
fi

# Full workspace build first (hub, default features, + mock_jupiter — both programs declared
# under [programs.devnet] in Anchor.toml) so the IDL/types are generated and mock_jupiter's own
# .so is produced; then, when enabled, a second `-p hub`-scoped pass rebuilds ONLY hub with
# `--features mock-jupiter` on top, overwriting target/deploy/hub.so — same two-pass pattern
# package.json's `test` script uses for the local mainnet-fork validator suite.
anchor build
if [ "$MOCK_JUPITER" = true ]; then
  echo "rebuilding hub with --features mock-jupiter for devnet"
  anchor build -p hub -- --features mock-jupiter
fi
echo "hub.so executable hash: $(solana-verify get-executable-hash target/deploy/hub.so)"

HUB_CLUSTER=devnet HUB_WALLET="$WALLET" HUB_RPC_URL="$RPC" scripts/verify-build.sh deploy
PROGRAM_ID=$(solana-keygen pubkey target/deploy/hub-keypair.json)
echo "deployed hub program: $PROGRAM_ID"

# mock_jupiter itself also needs to be live on devnet for the above to matter — deploy/upgrade it
# too (idempotent: no-op-equivalent redeploy if its source hasn't changed since the last one).
MOCK_ID=$(solana-keygen pubkey target/deploy/mock_jupiter-keypair.json 2>/dev/null || true)
if [ -n "$MOCK_ID" ] && [ -f target/deploy/mock_jupiter.so ]; then
  SIZE=$(wc -c < target/deploy/mock_jupiter.so | tr -d ' ')
  if CUR=$(solana program show "$MOCK_ID" -u "$RPC" --output json 2>/dev/null | jq -r '.dataLen'); then
    if [ "$SIZE" -gt "$CUR" ]; then
      NEED=$((SIZE - CUR)); [ "$NEED" -lt 10240 ] && NEED=10240
      solana program extend "$MOCK_ID" "$NEED" -u "$RPC" -k "$WALLET"
    fi
    solana program deploy target/deploy/mock_jupiter.so --program-id "$MOCK_ID" -u "$RPC" -k "$WALLET" \
      --with-compute-unit-price 50000 --max-sign-attempts 100 --use-rpc
  else
    echo "initial deploy of mock_jupiter $MOCK_ID on devnet"
    solana program deploy target/deploy/mock_jupiter.so --program-id target/deploy/mock_jupiter-keypair.json \
      -u "$RPC" -k "$WALLET" --with-compute-unit-price 50000 --max-sign-attempts 100 --use-rpc
  fi
  echo "deployed mock_jupiter program: $MOCK_ID"
fi

if [ "$INIT" = true ]; then
  HUB_CLUSTER=devnet HUB_WALLET="$WALLET" npx ts-mocha -p ./tsconfig.json -t 300000 tests/m1-initialize.ts
fi
