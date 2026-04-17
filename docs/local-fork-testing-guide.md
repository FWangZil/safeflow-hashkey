# HashKey Chain Local Fork Testing Guide

> One-click anvil fork of HashKey Chain Testnet with persistent state, automatic contract deployment, and auto-configured web env.

## Problem Background

When forking HashKey Chain locally for development, you hit a core conflict:

- Your wallet already knows HashKey Chain Testnet (Chain ID 133) and Mainnet (177).
- A naive local fork reusing the same chain ID creates ambiguity — the wallet can't tell which "HashKey" is real and which is the fork.
- Without state persistence, every anvil restart forces a full contract redeploy.

SafeFlow solves both with a dedicated local chain ID (31338) and persisted anvil state.

## Solution: Separate Chain ID + State Persistence

| Concept | Value | Purpose |
|---------|-------|---------|
| **Source chain** | 133 (HashKey Testnet) | Forked from this upstream RPC |
| **Execution chain** | 31338 (HashKey Fork Local) | Local anvil identity, distinct from real HashKey |
| **Port** | 8546 | Avoids conflict with Base fork on 8545 |
| **State file** | `.hashkey-fork-state.json` | Persists contract + wallet state |

## Quick Start

### One-Click Setup

```bash
./scripts/start-hashkey-fork.sh
```

This script will:

1. Kill any anvil process on port 8546
2. Start anvil forking HashKey Testnet (`https://testnet.hsk.xyz`)
3. Set chain ID to 31338, block time 2s
4. Load state from `.hashkey-fork-state.json` if present, otherwise fresh fork
5. Deploy `SafeFlowVaultHashKey` contract (only if no saved state)
6. Write `NEXT_PUBLIC_HASHKEY_*` env vars to `web/.env`
7. Keep anvil running; Ctrl+C gracefully saves state

### Next Run (Resume)

```bash
./scripts/start-hashkey-fork.sh
```

Loads saved state — contract, wallets, SessionCaps, and balances all restored. **No redeploy.**

### Fresh Reset (Redeploy)

```bash
./scripts/start-hashkey-fork.sh --fresh
```

Deletes the state file, forks from remote again, redeploys the contract.

## Manual Setup (If You Want Finer Control)

### 1. Start Anvil with State Persistence

```bash
anvil \
  --fork-url https://testnet.hsk.xyz \
  --port 8546 \
  --chain-id 31338 \
  --block-time 2 \
  --state .hashkey-fork-state.json
```

On exit (Ctrl+C), anvil dumps state to the JSON file. On next start, it loads from the file.

### 2. Deploy Contract

```bash
export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
export NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL="http://127.0.0.1:8546"
export NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID="31338"

node scripts/deploy-contract-and-configure-web.mjs \
  --network local_hashkey_fork \
  --contract hashkey \
  --sync-hashkey-fork-env \
  --force
```

### 3. Configure Web Env

The deploy script auto-writes these to `web/.env`:

```env
NEXT_PUBLIC_HASHKEY_ENABLED=true
NEXT_PUBLIC_HASHKEY_CONTRACT=0xDeployedAddress
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED=true
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID=31338
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL=http://127.0.0.1:8546
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_NAME=HashKey Fork Local
```

### 4. Start the Web App

```bash
cd web
npm run dev
```

Connect your wallet to **HashKey Fork Local (31338)** to activate HashKey mode.

## How State Persistence Works

Anvil's `--state <file>` flag:

- On start: loads state from the file (if it exists)
- On exit: dumps state to the file
- State includes: accounts, balances, contract code, contract storage, nonces

### What's Preserved Across Restarts

- Deployed `SafeFlowVaultHashKey` contract bytecode + address
- All wallet deposits (HSK, ERC-20)
- Active SessionCaps with their spend history
- Any PaymentExecuted events and their state

### What's NOT Preserved

- Pending transactions in the mempool (mempool is cleared on exit)
- Real-time HashKey Testnet state updates after the fork point

### State File Size

Typical sizes:

- Just after deployment: **~200-500 KB**
- After moderate testing: **~2-5 MB**
- Extreme (thousands of txs): **< 50 MB**

The file is gitignored (`.hashkey-fork-state.json`).

## Wallet Setup

### Adding HashKey Fork Local to Your Wallet

Most wallets will auto-detect the chain when SafeFlow's frontend prompts a chain switch. If you need to add it manually:

| Field | Value |
|-------|-------|
| Network Name | HashKey Fork Local |
| RPC URL | `http://127.0.0.1:8546` |
| Chain ID | 31338 |
| Currency Symbol | HSK |
| Block Explorer | — |

### Getting Test HSK

Anvil pre-funds 10 default accounts with 10,000 ETH each (used as HSK on the fork). Use account #0's private key to get started:

```text
Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Import this into your wallet for testing, or send HSK from it to your preferred dev address.

## Common Issues

### Q: Can I run Base Fork and HashKey Fork simultaneously?

**Yes.** They use different ports (8545 vs 8546) and different chain IDs (31337 vs 31338), so they coexist without conflict.

### Q: Port 8546 is already in use

The script auto-kills any process on port 8546 before starting. If it still fails, manually run:

```bash
lsof -ti:8546 | xargs kill -9
```

### Q: State file seems too large

Delete `.hashkey-fork-state.json` and run with `--fresh`. This resets everything.

### Q: Wallet shows the fork as "HashKey Testnet" instead of "HashKey Fork Local"

Check that `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID` is **not** 133 or 177 — it must be a unique ID like 31338.

### Q: Want to fork HashKey Mainnet instead of Testnet?

Override the source RPC:

```bash
HASHKEY_FORK_SOURCE_RPC=https://mainnet.hsk.xyz ./scripts/start-hashkey-fork.sh --fresh
```

## Script Reference

### `scripts/start-hashkey-fork.sh`

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `HASHKEY_FORK_SOURCE_RPC` | `https://testnet.hsk.xyz` | Upstream RPC to fork from |
| `HASHKEY_FORK_PORT` | `8546` | Local anvil port |
| `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID` | `31338` | Local chain ID |
| `ANVIL_BLOCK_TIME` | `2` | Block time in seconds |

Flags:

| Flag | Description |
|------|-------------|
| `--fresh` | Discard saved state, fresh fork + redeploy |
| `--help` | Show usage |

### `scripts/deploy-contract-and-configure-web.mjs`

Relevant network targets:

| Network | Purpose |
|---------|---------|
| `hashkey_testnet` | Deploy to real HashKey Testnet (chain 133) |
| `hashkey_mainnet` | Deploy to real HashKey Mainnet (chain 177) |
| `local_hashkey_fork` | Deploy to local HashKey fork (chain 31338) |

Flags:

| Flag | Description |
|------|-------------|
| `--network <name>` | Target network |
| `--contract hashkey` | Use SafeFlowVaultHashKey variant |
| `--sync-hashkey-fork-env` | Write HashKey local fork env vars |
| `--force` | Redeploy even if existing deployment is live |

## Related Files

| File | Purpose |
|------|---------|
| `scripts/start-hashkey-fork.sh` | One-click fork manager |
| `scripts/deploy-contract-and-configure-web.mjs` | Unified deploy + env configuration |
| `web/src/lib/mode.ts` | `HASHKEY_LOCAL_FORK_ENABLED` detection |
| `web/src/lib/chains.ts` | `localHashKeyForkChain` definition |
| `.hashkey-fork-state.json` | Anvil persisted state (gitignored) |
| `web/.env` | Auto-written env config |
