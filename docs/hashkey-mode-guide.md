# HashKey Integration Guide

This guide explains how to set up SafeFlow on **HashKey Chain**, including contract deployment, HSP configuration, and runtime details.

## Overview

SafeFlow runs exclusively on **HashKey Chain**, integrated with the **HashKey Settlement Protocol (HSP)**:

- Native HSK vault (and ERC-20 support) on HashKey Chain Testnet (133) and Mainnet (177)
- Payment settlement via HSP (HashKey Settlement Protocol)
- Local fork for offline development (chain 31338, port 8546)

The HashKey UI activates automatically when the wallet connects to any HashKey chain — no manual mode switch required.

## Quick Start

### 1. Deploy the HashKey Contract

**Option A — HashKey Testnet:**

```bash
node scripts/deploy-contract-and-configure-web.mjs \
  --network hashkey_testnet \
  --contract hashkey
```

**Option B — Local HashKey Fork (recommended for development):**

```bash
./scripts/start-hashkey-fork.sh
```

Both paths will:

- Compile and deploy `SafeFlowVaultHashKey.sol`
- Set `NEXT_PUBLIC_HASHKEY_CONTRACT` in `web/.env`
- Set `NEXT_PUBLIC_HASHKEY_ENABLED=true`
- Set `NEXT_PUBLIC_HASHKEY_CHAIN_ID=133` (or the fork chain ID for local)

### 2. Configure HSP (Optional)

If you want HSP payment settlement, add these to `web/.env.local`:

```bash
HSP_APP_KEY=your_hsp_app_key
HSP_APP_SECRET=your_hsp_app_secret
HSP_MERCHANT_PRIVATE_KEY=your_secp256k1_private_key_hex
HSP_MERCHANT_NAME=SafeFlow Agent
HSP_PAY_TO=0x_merchant_receiving_address
HSP_BASE_URL=https://merchant-qa.hashkeymerchant.com
```

### 3. Run the App

```bash
cd web && npm run dev
```

Connect your wallet to **HashKey Chain Testnet (133)** or **HashKey Fork Local (31338)**. The UI automatically surfaces the HashKey tabs: **Vault**, **Sessions**, **History**, **HSP**, **Chat**.

## Architecture

### Contract

Single contract: `contracts/src/SafeFlowVaultHashKey.sol`

- **Deposit** — Native HSK via `deposit{value}(walletId)` or ERC-20 via `deposit(walletId, token, amount)`
- **SessionCap** — Per-wallet spending cap with interval rate limit, total cap, and expiry
- **Payment** — Agent calls `executePayment(capId, token, amount, recipient, evidenceHash, intentId)` for HSP-backed payments

### Runtime Infrastructure

- `web/src/lib/mode.ts` — Chain-based detection: `isHashKeyChain(chainId)`, `getModeForChain(chainId)`, `HASHKEY_ENABLED`, `HASHKEY_LOCAL_FORK_ENABLED`
- `web/src/lib/chains.ts` — `hashkeyTestnet` (133), `hashkeyMainnet` (177), `localHashKeyForkChain` (31338)
- `web/src/lib/contracts.ts` — `SAFEFLOW_VAULT_HASHKEY_ABI` + chain-aware `getSafeFlowAddress(chainId)`
- `web/src/lib/tokens.ts` — HSK + ecosystem token metadata

### HSP Client SDK

Located at `web/src/lib/hsp/`:

- `constants.ts` — Base URLs, testnet/mainnet token addresses
- `client.ts` — `HspClient` class with HMAC signing, ES256K JWT, order creation, webhook verification

### Producer API

REST endpoints under `web/src/app/api/hashkey/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/hashkey/intents` | GET | List intents (filter by status/vaultId) |
| `/api/hashkey/intents` | POST | Create a new PaymentIntent |
| `/api/hashkey/intents/[id]` | GET | Get a single intent |
| `/api/hashkey/intents/[id]/ack` | POST | Agent claims an intent |
| `/api/hashkey/intents/[id]/result` | POST | Agent reports tx result |
| `/api/hashkey/intents/next` | GET | Get next pending intent |
| `/api/hashkey/hsp/webhook` | POST | HSP webhook callback receiver |
| `/api/hashkey/hsp/status` | GET | HSP configuration health check |

## Environment Variables

### HashKey Contract

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_HASHKEY_ENABLED` | `true` to include HashKey chains in the wallet picker |
| `NEXT_PUBLIC_HASHKEY_CONTRACT` | Deployed `SafeFlowVaultHashKey` address |
| `NEXT_PUBLIC_HASHKEY_CHAIN_ID` | `133` (testnet) or `177` (mainnet) |

### Local Fork

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED` | `true` to enable local fork |
| `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID` | `31338` (recommended) |
| `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL` | `http://127.0.0.1:8546` |
| `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_NAME` | `HashKey Fork Local` |

### HSP (Server-Side Only)

| Variable | Description |
|----------|-------------|
| `HSP_APP_KEY` | Merchant app key from HashKey |
| `HSP_APP_SECRET` | Merchant app secret |
| `HSP_MERCHANT_PRIVATE_KEY` | secp256k1 private key hex for ES256K JWT |
| `HSP_MERCHANT_NAME` | Display name for payment pages |
| `HSP_PAY_TO` | Receiving address for HSP payments |
| `HSP_BASE_URL` | API base URL (qa/staging/production) |
| `HSP_ENVIRONMENT` | `qa`, `staging`, or `production` |

### Producer API

| Variable | Description |
|----------|-------------|
| `PRODUCER_SIGNING_SECRET` | HMAC secret for external intent creation (optional) |

## HashKey Chain Details

| Property | Testnet | Mainnet |
|----------|---------|---------|
| Chain ID | 133 | 177 |
| Native Token | HSK | HSK |
| RPC | `https://testnet.hsk.xyz` | `https://mainnet.hsk.xyz` |
| Explorer | `https://testnet-explorer.hsk.xyz` | `https://hashkey.blockscout.com` |

## Switching Between Networks

No environment variable switch is required — simply change the connected wallet chain:

- **HashKey Testnet (133)** → UI activates against deployed testnet contract
- **HashKey Mainnet (177)** → UI activates against production contract
- **HashKey Fork Local (31338)** → UI activates against local anvil fork

The chain ID drives everything. Run `./scripts/start-hashkey-fork.sh` to spin up the local fork, or deploy to testnet/mainnet via `scripts/deploy-contract-and-configure-web.mjs`.
