#!/usr/bin/env bash
# Reproducible build + on-chain verification for the hub program
# (https://solana.com/docs/programs/verified-builds).
#
#   scripts/verify-build.sh build            docker build → target/deploy/hub.so (deterministic)
#   scripts/verify-build.sh hash             sha256 of the local .so vs the on-chain program
#   scripts/verify-build.sh deploy           upgrade the on-chain program with the verified .so
#   scripts/verify-build.sh verify [COMMIT]  rebuild from the public repo at COMMIT and compare
#                                            with the on-chain hash; writes the verify PDA and, on
#                                            mainnet, queues the OtterSec remote job
#   scripts/verify-build.sh orquestra        push IDL + verified-build notes to Orquestra (also
#                                            runs after deploy/verify when ORQUESTRA_TOKEN is set)
#
# Cluster: HUB_CLUSTER=devnet (default) | mainnet-beta. Wallet: HUB_WALLET (must be the upgrade
# authority). RPC: HUB_RPC_URL, else Helius if HELIUS_API_KEY is set, else the public endpoint.
# Each cluster is bound to a git remote/branch (see README "Repositories, branches, clusters"):
#   devnet       ← remote `origin`     (nodecattel/hubconnect, staging)  branch `develop`
#   mainnet-beta ← remote `production` (OTCHUB/hubconnect, public)       branch `main`
# The repo URL written to the verify PDA / Orquestra defaults to that remote (HUB_REPO_URL overrides).
# The docker image is pinned in Cargo.toml [workspace.metadata.cli]; build args (library name,
# base image, commit) are written to the verify PDA so third parties reproduce the same bytes.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# .env fills in variables that are not already set; an explicit environment (HUB_CLUSTER=mainnet-beta
# on the command line, devnet-deploy.sh's HUB_WALLET) always wins — same precedence as dotenv in the
# TS scripts. Lines are evaluated in order so `${HELIUS_API_KEY}` references resolve.
load_env() {
  local line k
  [ -f .env ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    [[ $line =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    k=${BASH_REMATCH[1]}
    [ -n "${!k+x}" ] || eval "export $k=${BASH_REMATCH[2]}"
  done < .env
}
load_env

CLUSTER="${HUB_CLUSTER:-devnet}"
LIB=hub
SO=target/deploy/$LIB.so
PROGRAM_ID=$(solana-keygen pubkey target/deploy/$LIB-keypair.json)

case "$CLUSTER" in
  devnet)
    REMOTE=origin; BRANCH=develop
    WALLET="${HUB_WALLET:-$HOME/.config/solana/hubconnect-devnet.json}"
    RPC="${HUB_RPC_URL:-https://api.devnet.solana.com}"
    [ -z "${HUB_RPC_URL:-}" ] && [ -n "${HELIUS_API_KEY:-}" ] && RPC="https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
    ;;
  mainnet-beta)
    REMOTE=production; BRANCH=main
    WALLET="${HUB_WALLET:?set HUB_WALLET to the mainnet upgrade authority keypair}"
    RPC="${HUB_RPC_URL:-https://api.mainnet-beta.solana.com}"
    [ -z "${HUB_RPC_URL:-}" ] && [ -n "${HELIUS_API_KEY:-}" ] && RPC="https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
    ;;
  *) echo "HUB_CLUSTER must be devnet or mainnet-beta" >&2; exit 1 ;;
esac
WALLET="${WALLET/#\~/$HOME}"

# https URL of the cluster's remote (ssh form normalised, .git stripped) — what solana-verify and
# Orquestra publish as the source. Exported so orquestra-idl.ts records the same URL.
remote_https() {
  git remote get-url "$1" 2>/dev/null | sed -E 's#^git@github\.com:#https://github.com/#; s#\.git$##'
}
REPO="${HUB_REPO_URL:-$(remote_https "$REMOTE")}"
[ -n "$REPO" ] || { echo "git remote '$REMOTE' missing — git remote add $REMOTE <url> (see README)" >&2; exit 1; }
export HUB_REPO_URL="$REPO"

# Deploy/verify must run from the commit the cluster's repo actually holds. Strict on mainnet
# (branch, clean tree, pushed); advisory on devnet so WIP can still be staged.
release_guard() {
  local cur pushed=true
  cur=$(git rev-parse --abbrev-ref HEAD)
  git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null || true
  git merge-base --is-ancestor HEAD "$REMOTE/$BRANCH" 2>/dev/null || pushed=false
  local problems=()
  [ "$cur" = "$BRANCH" ] || problems+=("on branch '$cur', expected '$BRANCH'")
  [ -z "$(git status --porcelain)" ] || problems+=("working tree not clean")
  [ "$pushed" = true ] || problems+=("HEAD not pushed to $REMOTE/$BRANCH ($REPO)")
  [ ${#problems[@]} -eq 0 ] && return 0
  printf "$CLUSTER: %s\n" "${problems[@]}" >&2
  if [ "$CLUSTER" = "mainnet-beta" ] && [ -z "${HUB_FORCE:-}" ]; then
    echo "refusing mainnet $1 — fix the above or set HUB_FORCE=1" >&2; exit 1
  fi
  echo "warning: continuing on $CLUSTER; the source recorded on chain may not match this build" >&2
}

need() { command -v "$1" >/dev/null || { echo "missing $1 — $2" >&2; exit 1; }; }
need docker "https://docs.docker.com/get-docker/"
need solana-verify "cargo install solana-verify"

# HUB_RPC_URL in .env is usually the devnet endpoint; make sure the RPC we deploy/verify through
# really is the cluster HUB_CLUSTER names before any signed transaction leaves this machine.
rpc_guard() {
  local want got
  case "$CLUSTER" in
    devnet)       want=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG ;;
    mainnet-beta) want=5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d ;;
  esac
  got=$(solana genesis-hash -u "$RPC" 2>/dev/null || echo unreachable)
  [ "$got" = "$want" ] && return 0
  echo "RPC is not $CLUSTER (genesis $got) — HUB_RPC_URL points at another cluster; unset it or set it per cluster" >&2
  exit 1
}

local_hash() { solana-verify get-executable-hash "$SO"; }
onchain_hash() { solana-verify get-program-hash -u "$RPC" "$PROGRAM_ID"; }

# Push the IDL + verified-build state (hash, commit, security.txt) to Orquestra so its dashboard
# and REST builders decode the deployed program. Opt-in via ORQUESTRA_TOKEN; never fails the run.
# ORQUESTRA_PRIVATE=1 keeps a devnet project unlisted; mainnet is always public so anyone can
# verify the indexed IDL against the on-chain hash.
orquestra_sync() {
  [ -n "${ORQUESTRA_TOKEN:-}" ] || { echo "orquestra: ORQUESTRA_TOKEN unset — skipping IDL sync"; return 0; }
  local flags=()
  [ "$CLUSTER" = devnet ] && [ -n "${ORQUESTRA_PRIVATE:-}" ] && flags+=(--private)
  npm run -s orquestra:idl -- ${flags[@]+"${flags[@]}"} || echo "warning: orquestra IDL sync failed (deploy/verify unaffected)" >&2
}

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
  rpc_guard
  local l o
  l=$(local_hash); o=$(onchain_hash)
  echo "program:  $PROGRAM_ID ($CLUSTER)"
  echo "local:    $l"
  echo "on-chain: $o"
  if [ "$l" = "$o" ]; then echo "MATCH — on-chain bytes equal the local verified build"; else
    echo "MISMATCH — deploy the verified build ($0 deploy) or rebuild from the deployed commit" >&2; return 2; fi
}

cmd_deploy() {
  [ -f "$SO" ] || { echo "no $SO — run: $0 build" >&2; exit 1; }
  rpc_guard; release_guard deploy
  local size cur program_arg="$PROGRAM_ID"
  size=$(wc -c < "$SO" | tr -d ' ')
  # The program account is fixed-size; grow it first if the new build is larger. A cluster that has
  # never seen the program gets an initial deploy signed with the program keypair instead.
  if cur=$(solana program show "$PROGRAM_ID" -u "$RPC" --output json 2>/dev/null | jq -r '.dataLen'); then
    if [ "$size" -gt "$cur" ]; then
      # `solana program extend` rejects a request for fewer than 10240 additional bytes (unless
      # extending to the account's already-known max size) — round the needed delta up to that floor.
      local need=$((size - cur))
      [ "$need" -lt 10240 ] && need=10240
      echo "extending program data $cur → $((cur + need)) bytes (requested +$need, needed +$((size - cur)))"
      solana program extend "$PROGRAM_ID" "$need" -u "$RPC" -k "$WALLET"
    fi
  else
    echo "initial deploy of $PROGRAM_ID on $CLUSTER"
    program_arg=target/deploy/$LIB-keypair.json
  fi
  solana program deploy "$SO" --program-id "$program_arg" -u "$RPC" -k "$WALLET" \
    --with-compute-unit-price 50000 --max-sign-attempts 100 --use-rpc
  # RPC nodes can serve the pre-upgrade account for a few slots after confirmation.
  for _ in 1 2 3 4 5 6; do cmd_hash && { orquestra_sync; return 0; }; sleep 10; done
  return 2
}

cmd_verify() {
  local commit="${1:-$(git rev-parse HEAD)}"
  # -y -k: after a hash match, write the verify PDA (repo url, commit, build args) signed by the
  # upgrade authority so third parties can reproduce without trusting this script. On mainnet a
  # second step queues OtterSec's remote rebuild from that PDA (`remote submit-job` replaced the
  # deprecated --remote flag); that job is what makes Solana Explorer / SolanaFM / Solscan show
  # "Verified". The remote API is mainnet-only, so devnet stops at the PDA.
  rpc_guard; release_guard verify
  solana-verify verify-from-repo -u "$RPC" --program-id "$PROGRAM_ID" "$REPO" \
    --commit-hash "$commit" --library-name "$LIB" -y -k "$WALLET"
  if [ "$CLUSTER" = "mainnet-beta" ]; then
    solana-verify remote submit-job -u "$RPC" --program-id "$PROGRAM_ID" \
      --uploader "$(solana-keygen pubkey "$WALLET")"
  fi
  orquestra_sync
}

case "${1:-}" in
  build)  cmd_build ;;
  hash)   cmd_hash ;;
  deploy) cmd_deploy ;;
  verify) shift; cmd_verify "$@" ;;
  orquestra) orquestra_sync ;;
  *) sed -n 2,15p "$0"; exit 1 ;;
esac
