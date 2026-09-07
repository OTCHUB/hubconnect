#!/usr/bin/env bash
# Reproducible build + on-chain verification for the hub program
# (https://solana.com/docs/programs/verified-builds).
#
#   scripts/verify-build.sh build            docker build → target/deploy/hub.so (deterministic)
#   scripts/verify-build.sh hash             sha256 of the local .so vs the on-chain program
#   scripts/verify-build.sh deploy           upgrade the on-chain program with the verified .so
#   scripts/verify-build.sh verify [COMMIT]  rebuild from the public repo at COMMIT and compare
#                                            with the on-chain hash (adds --remote for mainnet)
#
# Cluster: HUB_CLUSTER=devnet (default) | mainnet-beta. Wallet: HUB_WALLET (must be the upgrade
# authority). RPC: HUB_RPC_URL, else Helius if HELIUS_API_KEY is set, else the public endpoint.
# The docker image is pinned in Cargo.toml [workspace.metadata.cli]; build args (library name,
# base image, commit) are written to the verify PDA so third parties reproduce the same bytes.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
[ -f .env ] && set -a && . ./.env && set +a

CLUSTER="${HUB_CLUSTER:-devnet}"
LIB=hub
SO=target/deploy/$LIB.so
PROGRAM_ID=$(solana-keygen pubkey target/deploy/$LIB-keypair.json)
REPO="${HUB_REPO_URL:-https://github.com/nodecattel/hubconnect}"

case "$CLUSTER" in
  devnet)
    WALLET="${HUB_WALLET:-$HOME/.config/solana/hubconnect-devnet.json}"
    RPC="${HUB_RPC_URL:-https://api.devnet.solana.com}"
    [ -z "${HUB_RPC_URL:-}" ] && [ -n "${HELIUS_API_KEY:-}" ] && RPC="https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
    ;;
  mainnet-beta)
    WALLET="${HUB_WALLET:?set HUB_WALLET to the mainnet upgrade authority keypair}"
    RPC="${HUB_RPC_URL:-https://api.mainnet-beta.solana.com}"
    [ -z "${HUB_RPC_URL:-}" ] && [ -n "${HELIUS_API_KEY:-}" ] && RPC="https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
    ;;
  *) echo "HUB_CLUSTER must be devnet or mainnet-beta" >&2; exit 1 ;;
esac
WALLET="${WALLET/#\~/$HOME}"

need() { command -v "$1" >/dev/null || { echo "missing $1 — $2" >&2; exit 1; }; }
need docker "https://docs.docker.com/get-docker/"
need solana-verify "cargo install solana-verify"

local_hash() { solana-verify get-executable-hash "$SO"; }
onchain_hash() { solana-verify get-program-hash -u "$RPC" "$PROGRAM_ID"; }

cmd_build() {
  # `anchor build` first: the IDL (target/idl, target/types) is generated on the host and is not
  # part of the .so; the docker build then overwrites target/deploy/hub.so with the reproducible one.
  anchor build
  solana-verify build --library-name "$LIB"
  echo "verified artifact: $SO ($(wc -c < "$SO" | tr -d ' ') bytes)"
  echo "executable hash:   $(local_hash)"
}

cmd_hash() {
  [ -f "$SO" ] || { echo "no $SO — run: $0 build" >&2; exit 1; }
  local l o
  l=$(local_hash); o=$(onchain_hash)
  echo "program:  $PROGRAM_ID ($CLUSTER)"
  echo "local:    $l"
  echo "on-chain: $o"
  if [ "$l" = "$o" ]; then echo "MATCH — on-chain bytes equal the local verified build"; else
    echo "MISMATCH — deploy the verified build ($0 deploy) or rebuild from the deployed commit" >&2; exit 2; fi
}

cmd_deploy() {
  [ -f "$SO" ] || { echo "no $SO — run: $0 build" >&2; exit 1; }
  local size cur
  size=$(wc -c < "$SO" | tr -d ' ')
  # The program account is fixed-size; grow it first if the new build is larger.
  cur=$(solana program show "$PROGRAM_ID" -u "$RPC" --output json | jq -r '.dataLen')
  if [ "$size" -gt "$cur" ]; then
    echo "extending program data $cur → $size bytes"
    solana program extend "$PROGRAM_ID" $((size - cur)) -u "$RPC" -k "$WALLET"
  fi
  solana program deploy "$SO" --program-id "$PROGRAM_ID" -u "$RPC" -k "$WALLET" \
    --with-compute-unit-price 50000 --max-sign-attempts 100 --use-rpc
  # RPC nodes can serve the pre-upgrade account for a few slots after confirmation.
  for _ in 1 2 3 4 5 6; do cmd_hash && return 0; sleep 10; done
  return 2
}

cmd_verify() {
  local commit="${1:-$(git rev-parse HEAD)}"
  local args=(verify-from-repo -u "$RPC" --program-id "$PROGRAM_ID" "$REPO" \
    --commit-hash "$commit" --library-name "$LIB")
  # Mainnet: also upload the verify PDA + ask the OtterSec API to reproduce it, so explorers
  # (Solana Explorer, SolanaFM, Solscan) show the program as verified. Devnet has no remote API.
  [ "$CLUSTER" = "mainnet-beta" ] && args+=(--remote -k "$WALLET")
  if [ -n "$(git status --porcelain)" ] || ! git merge-base --is-ancestor "$commit" "@{u}" 2>/dev/null; then
    echo "warning: $commit must be pushed to $REPO and the tree clean for a faithful reproduction" >&2
  fi
  solana-verify "${args[@]}"
}

case "${1:-}" in
  build)  cmd_build ;;
  hash)   cmd_hash ;;
  deploy) cmd_deploy ;;
  verify) shift; cmd_verify "$@" ;;
  *) sed -n 2,13p "$0"; exit 1 ;;
esac
