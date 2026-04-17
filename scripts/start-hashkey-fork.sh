#!/usr/bin/env bash
#
# HashKey local fork manager — start / restart / fresh deploy
#
# Usage:
#   ./scripts/start-hashkey-fork.sh            # Resume from saved state (or fresh if first run)
#   ./scripts/start-hashkey-fork.sh --fresh     # Force fresh fork + redeploy contract
#
# Prerequisites:
#   - Foundry installed (forge, anvil)
#   - Node.js available
#
# How it works:
#   - anvil's --state flag persists all chain state to a JSON file on disk.
#   - On first run (or --fresh): forks HashKey Testnet, deploys contract, saves state.
#   - On subsequent runs: loads the saved state — contract + vaults + sessions survive.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Parse flags ─────────────────────────────────────────────────
FRESH=false
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=true ;;
    --help|-h)
      echo "Usage: $0 [--fresh]"
      echo "  --fresh   Force fresh fork + redeploy (discard saved state)"
      exit 0 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ─── Configuration (override via env) ────────────────────────────
HASHKEY_FORK_RPC="${HASHKEY_FORK_SOURCE_RPC:-https://testnet.hsk.xyz}"
HASHKEY_FORK_PORT="${HASHKEY_FORK_PORT:-8546}"
HASHKEY_FORK_CHAIN_ID="${NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID:-31338}"
ANVIL_BLOCK_TIME="${ANVIL_BLOCK_TIME:-2}"
STATE_FILE="${ROOT_DIR}/.hashkey-fork-state.json"
ANVIL_LOG_FILE="${ANVIL_LOG_FILE:-${ROOT_DIR}/.hashkey-fork-anvil.log}"
# Verbosity for anvil: 0=quiet, 1=-v (calls), 2=-vv, 3=-vvv (traces+revert reason), 4=-vvvv
ANVIL_VERBOSITY="${ANVIL_VERBOSITY:-3}"

LOCAL_RPC="http://127.0.0.1:${HASHKEY_FORK_PORT}"

# ─── Decide mode ─────────────────────────────────────────────────
NEED_DEPLOY=false

if [ "$FRESH" = true ]; then
  echo "▸ Fresh mode requested — will discard saved state and redeploy."
  rm -f "${STATE_FILE}"
  NEED_DEPLOY=true
elif [ ! -f "${STATE_FILE}" ]; then
  echo "▸ No saved state found — first run, will deploy contract."
  NEED_DEPLOY=true
else
  echo "▸ Resuming from saved state: ${STATE_FILE}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  SafeFlow — HashKey Local Fork"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Fork source : ${HASHKEY_FORK_RPC}"
echo "  Local RPC   : ${LOCAL_RPC}"
echo "  Chain ID    : ${HASHKEY_FORK_CHAIN_ID}"
echo "  Block time  : ${ANVIL_BLOCK_TIME}s"
echo "  State file  : ${STATE_FILE}"
echo "  Deploy      : ${NEED_DEPLOY}"
echo ""

# ─── Step 1: Start Anvil ─────────────────────────────────────────
echo "▸ Starting anvil..."

# Kill any existing anvil on the same port
lsof -ti:${HASHKEY_FORK_PORT} | xargs kill -9 2>/dev/null || true
sleep 0.5

ANVIL_ARGS=(
  --port "${HASHKEY_FORK_PORT}"
  --chain-id "${HASHKEY_FORK_CHAIN_ID}"
  --block-time "${ANVIL_BLOCK_TIME}"
  --state "${STATE_FILE}"
)

# Add verbosity flag (-v / -vv / -vvv / -vvvv) so transaction traces & revert
# reasons surface in the anvil log. Set ANVIL_VERBOSITY=0 to suppress.
if [ "${ANVIL_VERBOSITY}" -gt 0 ] 2>/dev/null; then
  V_FLAG="-$(printf 'v%.0s' $(seq 1 "${ANVIL_VERBOSITY}"))"
  ANVIL_ARGS+=("${V_FLAG}")
fi

if [ "$NEED_DEPLOY" = true ]; then
  # Fresh fork from remote — state file will be created on exit
  ANVIL_ARGS+=(--fork-url "${HASHKEY_FORK_RPC}")
fi
# If resuming: no --fork-url needed, anvil loads from --state file

# Tee anvil output to both terminal (for live debugging) and a log file so
# failures like reverts / invalid opcodes can be inspected after the fact.
: > "${ANVIL_LOG_FILE}"
echo "  anvil log   : ${ANVIL_LOG_FILE}"
# Use process substitution so ${ANVIL_PID} refers to anvil itself (not `tee`).
anvil "${ANVIL_ARGS[@]}" > >(tee "${ANVIL_LOG_FILE}") 2>&1 &
ANVIL_PID=$!
echo "  anvil PID: ${ANVIL_PID}"

# Graceful shutdown: ensure state is saved when script exits
trap "echo ''; echo '▸ Stopping anvil (state will be saved to ${STATE_FILE})...'; kill $ANVIL_PID 2>/dev/null; wait $ANVIL_PID 2>/dev/null; echo '  Done.'" EXIT INT TERM

# Wait for anvil to be ready
for i in $(seq 1 30); do
  if curl -s "${LOCAL_RPC}" -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "✗ anvil did not start within 30 seconds"
    exit 1
  fi
  sleep 1
done

echo "  anvil ready ✓"
echo ""

# ─── Step 2: Deploy contract (only if needed) ────────────────────
if [ "$NEED_DEPLOY" = true ]; then
  echo "▸ Deploying SafeFlowVaultHashKey to local fork..."

  # Use anvil's default account #0 as deployer
  export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  export NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID="${HASHKEY_FORK_CHAIN_ID}"
  export NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL="${LOCAL_RPC}"

  node "${ROOT_DIR}/scripts/deploy-contract-and-configure-web.mjs" \
    --network local_hashkey_fork \
    --contract hashkey \
    --sync-hashkey-fork-env \
    --force

  echo ""
else
  echo "▸ Skipping deploy — contract already exists from saved state."
  echo ""
fi

echo "═══════════════════════════════════════════════════════════"
echo "  ✓ HashKey local fork is ready!"
echo ""
echo "  anvil PID   : ${ANVIL_PID}"
echo "  Local RPC   : ${LOCAL_RPC}"
echo "  Chain ID    : ${HASHKEY_FORK_CHAIN_ID}"
echo ""
echo "  Start the web app:"
echo "    cd web && npm run dev"
echo ""
echo "  Connect wallet to '${NEXT_PUBLIC_HASHKEY_LOCAL_FORK_NAME:-HashKey Fork Local}'"
echo "  to enter HashKey mode."
echo ""
echo "  Press Ctrl+C to stop (state auto-saved)."
echo "  Next time just run: ./scripts/start-hashkey-fork.sh"
echo "  To reset everything: ./scripts/start-hashkey-fork.sh --fresh"
echo "═══════════════════════════════════════════════════════════"

# Keep anvil in foreground
wait $ANVIL_PID
