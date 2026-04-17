# SafeFlow — Hackathon Submission

> AI Agent Air-Gap Wallet with HSP Settlement on HashKey Chain

## Tracks

| Track | How SafeFlow Fits |
|-------|-------------------|
| **AI Track** | AI agents execute autonomous payments through rate-limited session capabilities, protecting funds from prompt-injection attacks via the Air-Gap wallet model. |
| **PayFi Track** | SafeFlow integrates **HSP (HashKey Settlement Protocol)** as the settlement layer — every payment intent is automatically bridged to an HSP Cart Mandate with ES256K JWT merchant authorization. |

## Architecture

```
Human (Wallet Owner)
  │
  ├─ 1. Create SafeFlowVault (on-chain)
  ├─ 2. Deposit HSK / ERC-20
  ├─ 3. Grant SessionCap to Agent (rate limit + total cap + expiry)
  │
  ▼
SafeFlowVault.sol  ←─── HashKey Chain (Testnet 133 / Mainnet 177)
  │
  ▼
AI Agent (off-chain)
  │  - Local EOA keypair
  │  - Polls Producer API for intents
  │  - Verify → ACK → Execute → Report
  │
  ▼
Producer API  ──► HSP Integration Layer
  │  - PaymentIntent CRUD + state machine
  │  - Auto-bridge to HSP Cart Mandate (USDC on HashKey Chain)
  │  - /v1/hsp/webhook  — receive HSP payment callbacks
  │  - /v1/hsp/status   — configuration health check
  │
  ▼
HSP Merchant Gateway
  │  - Checkout flow (payment URL)
  │  - On-chain USDC settlement
  │  - Webhook notification on completion
```

## Components

### 1. Smart Contracts (`contracts/`)

- **SafeFlowVault.sol** — Solidity contract deployed on HashKey Chain
  - `createVault()`, `deposit()`, `grantSession()`, `revokeSession()`, `executePayment()`
  - On-chain events for full audit trail
  - Rate-limit enforcement per second + total cap

### 2. TypeScript SDK (`sdk/`)

- **agent.ts** — `SafeFlowAgent` class: wallet management, payment execution via viem
- **producer.ts** — `ProducerApiClient`: intent lifecycle (create → ack → report)
- **hsp.ts** — `HspClient`: HMAC-SHA256 signed API requests, Cart Mandate builder, ES256K JWT signing, webhook verification, canonical JSON (RFC 8785)
- **constants.ts** — HashKey Chain definitions, vault ABI

### 3. Producer API (`producer_api/`)

- Node.js HTTP server managing payment intents
- HSP bridge: intent creation auto-creates HSP order with USDC settlement
- Webhook receiver verifies HMAC signatures, updates intent status
- Status endpoint for frontend integration check

### 4. Frontend Dashboard (`web/`)

- Next.js + wagmi + RainbowKit
- **Vault Management** — create vaults, deposit HSK
- **Session Caps** — grant/revoke agent access with rate limits
- **Payment History** — real-time intent observer
- **HSP Settlement** — configuration status, HSP payment orders, checkout links

### 5. Agent Scripts (`agent_scripts/`)

- `e2e_runner.ts` — end-to-end agent loop: poll → ack → execute → report
- `create_intent.ts` — helper to create test intents

## HSP Integration Details

### Authentication

1. **Request signing**: HMAC-SHA256 over `METHOD\nPATH\nQUERY\nBODY_HASH\nTIMESTAMP\nNONCE`
2. **Merchant authorization**: ES256K JWT (secp256k1) with `cart_hash` claim over canonical JSON of Cart Mandate contents

### Payment Flow

```
Producer API creates intent
  → createHspOrderForIntent()
    → Build Cart Mandate (USDC on HashKey Testnet)
    → Sign ES256K JWT via @noble/curves/secp256k1
    → POST /api/v1/merchant/orders (HMAC-signed)
    → Store payment_url + payment_request_id on intent
  → HSP Gateway processes payment
  → HSP sends webhook to /v1/hsp/webhook
    → Verify HMAC signature
    → Update intent status (payment-successful → executed)
```

### Supported Tokens

| Token | Network | Contract | Decimals |
|-------|---------|----------|----------|
| USDC | hashkey-testnet (133) | `0x79AEc4EeA31D50792F61D1Ca0733C18c89524C9e` | 6 |
| USDT | hashkey-testnet (133) | `0x372325443233fEbaC1F6998aC750276468c83CC6` | 6 |
| USDC | hashkey (177) | `0x054ed45810DbBAb8B27668922D110669c9D88D0a` | 6 |
| USDT | hashkey (177) | `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` | 6 |

## Quick Start

```bash
# 1. Install dependencies
cd sdk && bun install && bun run build && cd ..
cd producer_api && npm install && cd ..
cd web && bun install && cd ..

# 2. Configure environment
cp .env.example .env
# Fill in: DEPLOYER_PRIVATE_KEY, CONTRACT_ADDRESS, HSP_APP_KEY, HSP_APP_SECRET,
#          HSP_MERCHANT_PRIVATE_KEY, HSP_PAY_TO

# 3. Start Producer API
cd producer_api && npm start

# 4. Start Frontend
cd web && bun dev

# 5. Run Agent (separate terminal)
cd agent_scripts && bun run e2e_runner.ts
```

## Key Differentiators

1. **Air-Gap Security Model** — Agent never holds the master key; only a rate-limited session capability
2. **Human Kill Switch** — `revokeSession()` instantly disables any agent
3. **On-Chain Audit Trail** — Every payment emits `PaymentExecuted` events queryable by anyone
4. **HSP Native Integration** — Not a mock; real HMAC-signed API calls + ES256K JWT with secp256k1
5. **Dual Settlement** — HSK native payments via vault + USDC stablecoin via HSP

## Team

SafeFlow — Built for HashKey Chain On-Chain Horizon Hackathon 2026
