# SafeFlow Architecture — HashKey Chain

## System Overview

SafeFlow is an on-chain AI payment agent built exclusively on **HashKey Chain**, integrated with the **HashKey Settlement Protocol (HSP)**. It enforces a strict separation between **human-controlled funds** and **AI-controlled execution**, ensuring an agent can never exceed its granted authority.

```text
┌──── User Interfaces ────────────────────────────────────────┐
│  Web Dashboard (Next.js)  │  Chat UI                        │
├──── AI Strategy Engine ─────────────────────────────────────┤
│  Natural language → payment intent creation                 │
├──── HSP Integration ────────────────────────────────────────┤
│  HSP API (PaymentIntent creation via JWT-signed requests)   │
│  Webhook Handler (async payment confirmation)               │
├──── SafeFlow Producer API ──────────────────────────────────┤
│  Intent queue → Agent ack → Execution → Result reporting    │
├──── HashKey Chain Contract ─────────────────────────────────┤
│  SafeFlowVaultHashKey.sol                                   │
│  (wallets + session caps + execute payment)                 │
├──── HashKey Chain (133 / 177 / 31338) ──────────────────────┤
│  On-chain settlement with HSK / HashKey ecosystem tokens    │
├──── Audit Layer ────────────────────────────────────────────┤
│  Evidence hash (bytes32) → IPFS payload                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Why HashKey Chain

SafeFlow is designed specifically for the HashKey ecosystem:

- **HSP Native Integration** — First-class support for HashKey Settlement Protocol payment flows
- **Fast Finality** — HashKey Chain's EVM-compatible consensus delivers sub-second block times, ideal for payment UX
- **HSK Native Token** — Built-in support for HSK and HashKey ecosystem tokens
- **Merchant Infrastructure** — Direct alignment with HashKey's licensed merchant payment stack
- **Regulatory Compliance** — Operating within HashKey's regulatory framework

---

## Security Model

The design enforces three invariants:

1. **Fund Isolation** — User deposits into a wallet on-chain; only the wallet owner can withdraw.
2. **Bounded Execution** — Agent operates through a `SessionCap` with per-interval rate limit, total spending cap, and expiry timestamp.
3. **Evidence Anchoring** — Every agent action is recorded with an `evidenceHash` on-chain, linking to the off-chain HSP reasoning payload.

### Trust Boundaries

```text
Owner (human)                    Agent (AI)
  │                                 │
  ├── createWallet()                │
  ├── deposit(token, amount)        │
  ├── createSessionCap(agent, ...) ─┤
  ├── revokeSessionCap(capId)       │
  │                                 ├── executePayment(capId, ...)
  ├── withdraw(walletId, ...)       │       ↓
  │                                 │   [contract enforces limits]
  │                                 │       ↓
  │                                 │   PaymentExecuted event
```

The agent **cannot**:

- Withdraw funds back to itself
- Modify its own spending limits
- Spend beyond per-interval or total cap
- Operate after session expiry or revocation
- Access wallets it wasn't granted a cap for

---

## Smart Contract: SafeFlowVaultHashKey.sol

Single Solidity contract deployed to HashKey Chain, combining wallet management, session cap logic, and HSP payment execution.

### Data Structures

```solidity
struct Wallet {
    address owner;
    bool exists;
}

struct SessionCap {
    uint256 walletId;
    address agent;
    uint64  maxSpendPerInterval;  // rate limit per time window
    uint256 maxSpendTotal;        // lifetime spending cap
    uint64  intervalSeconds;      // rate-limit window length
    uint64  expiresAt;            // unix timestamp
    uint256 totalSpent;           // cumulative spend
    uint64  lastSpendTime;        // last execution timestamp
    uint256 currentIntervalSpent; // spend in current interval
    bool    active;               // revocable
}
```

### State

- `wallets` — mapping(walletId => Wallet)
- `balances` — mapping(walletId => token => amount)
- `sessionCaps` — mapping(capId => SessionCap)
- Auto-incrementing `nextWalletId` and `nextCapId`

### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `createWallet()` | Anyone | Create a new wallet, caller becomes owner |
| `deposit(walletId, token, amount)` | Anyone | Deposit tokens (ERC-20 or native HSK) |
| `withdraw(walletId, token, amount)` | Owner | Withdraw tokens back to owner |
| `createSessionCap(...)` | Owner | Grant agent a spending cap |
| `revokeSessionCap(capId)` | Owner | Instantly revoke agent permission |
| `executePayment(...)` | Agent | Execute HSP payment within cap bounds |
| `getBalance(walletId, token)` | View | Check wallet token balance |
| `getSessionCap(capId)` | View | Read cap configuration and state |
| `getRemainingAllowance(capId)` | View | Check remaining interval + total budget |

### executePayment Flow

```text
Agent calls executePayment(capId, token, amount, recipient, evidenceHash, intentId)
  │
  ├── 1. Validate: cap active, caller == cap.agent, not expired
  ├── 2. Check total limit: totalSpent + amount <= maxSpendTotal
  ├── 3. Check interval limit: reset if new window, then check
  ├── 4. Check wallet balance
  ├── 5. Update state: totalSpent, currentIntervalSpent, lastSpendTime, balance
  ├── 6. Transfer tokens to recipient (ERC-20 transfer or native HSK send)
  └── 7. Emit PaymentExecuted(walletId, capId, recipient, token, amount, evidenceHash, intentId)
```

### Events

| Event | Fields |
|-------|--------|
| `WalletCreated` | owner (indexed), walletId (indexed) |
| `Deposited` | walletId (indexed), token (indexed), amount |
| `Withdrawn` | walletId (indexed), token (indexed), amount |
| `SessionCapCreated` | walletId, capId, agent (all indexed) + limits |
| `SessionCapRevoked` | capId (indexed) |
| `PaymentExecuted` | walletId, capId, recipient (indexed) + token, amount, evidenceHash, intentId |

### Errors

| Error | Trigger |
|-------|---------|
| `NotOwner()` | Non-owner attempts owner action |
| `SessionExpired()` | Cap past expiresAt |
| `ExceedsIntervalLimit()` | Amount exceeds per-interval cap |
| `ExceedsTotalLimit()` | Amount exceeds lifetime cap |
| `InsufficientBalance()` | Wallet lacks funds |
| `InvalidSessionCap()` | Wrong agent or invalid cap |
| `SessionCapNotActive()` | Cap was revoked |
| `TransferFailed()` | Token transfer reverted |
| `ZeroAmount()` | Zero amount passed |
| `ZeroAddress()` | Zero address passed |

---

## HSP Integration

### HashKey Settlement Protocol (HSP)

HSP is HashKey's official payment settlement layer. SafeFlow uses HSP to create merchant-compliant PaymentIntents that the AI agent fulfills on-chain.

**Base URLs:**

- QA: `https://merchant-qa.hashkeymerchant.com`
- Production: `https://merchant.hashkeymerchant.com`

### HSP Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/orders` | Create PaymentIntent (order) |
| `GET /v1/orders/{orderId}` | Query PaymentIntent status |
| Webhook | Async payment confirmation callback |

**Authentication:** JWT signed with merchant's secp256k1 private key (`HSP_MERCHANT_PRIVATE_KEY`).

### SafeFlow Producer API

The Producer API is the coordination layer between users, HSP, and AI agents. All routes under `web/src/app/api/hashkey/`.

**Base URL:** `http://localhost:3000/api/hashkey` (local) or deployed URL

| Route | Method | Description |
|-------|--------|-------------|
| `/intents` | POST | Create PaymentIntent (user-initiated) |
| `/intents` | GET | List PaymentIntents |
| `/intents/{id}` | GET | Get single PaymentIntent |
| `/intents/{id}/ack` | POST | Agent acknowledges/claims intent |
| `/intents/{id}/result` | POST | Agent reports execution result |
| `/intents/next` | GET | Retrieve next pending intent (agent polling) |
| `/hsp/webhook` | POST | Handle HSP webhook callbacks (signature verified) |
| `/hsp/status` | GET | HSP configuration health check |

### Payment Flow

```text
1. User creates intent
   → UI or chat triggers POST /api/hashkey/intents
   → Producer API calls HSP POST /v1/orders (JWT-signed)
   → HSP returns orderId, stored with PaymentIntent

2. Agent discovers intent
   → Agent polls GET /api/hashkey/intents/next
   → Receives pending intent with signature

3. Agent claims intent
   → POST /api/hashkey/intents/{id}/ack
   → Intent status: pending → claimed

4. Agent executes on-chain
   → Calls SafeFlowVaultHashKey.executePayment(capId, token, amount, recipient, ...)
   → Transaction submitted to HashKey Chain
   → PaymentExecuted event emitted

5. Agent reports result
   → POST /api/hashkey/intents/{id}/result with txHash
   → Intent status: claimed → executed

6. HSP confirms settlement
   → HSP webhook → POST /api/hashkey/hsp/webhook
   → Signature verified, intent status: executed → confirmed
```

---

## HashKey Chain Deployment

### Supported Networks

| Network | Chain ID | RPC | Status |
|---------|----------|-----|--------|
| HashKey Chain Mainnet | 177 | `https://mainnet.hsk.xyz` | Production |
| HashKey Chain Testnet | 133 | `https://testnet.hsk.xyz` | Primary dev target |
| HashKey Fork Local | 31338 | `http://127.0.0.1:8546` | Local development |

### Deployment Commands

```bash
# Testnet
forge script script/DeployHashKey.s.sol --rpc-url https://testnet.hsk.xyz --broadcast

# One-click local fork (anvil + deploy + configure web env)
./scripts/start-hashkey-fork.sh

# Unified deploy script with auto-configuration
node scripts/deploy-contract-and-configure-web.mjs \
  --network hashkey_testnet \
  --contract hashkey
```

---

## Audit Layer

### Purpose

Every AI agent decision must be recorded for transparency and auditability. The audit trail links on-chain execution to off-chain HSP reasoning.

### Flow

```text
1. Agent decides to execute payment
2. POST /api/audit → records reasoning (intent, recipient, amount), returns evidenceHash
3. Agent calls executePayment(..., evidenceHash, intentId, ...)
4. On success: PATCH /api/audit → updates txHash, status
5. (Optional) Upload payload to IPFS, store CID
```

### Audit Entry Schema

```json
{
  "id": "uuid",
  "timestamp": 1712793600000,
  "agentAddress": "0x...",
  "action": "payment",
  "intentId": "hsp-intent-id",
  "recipient": "0x...",
  "token": "HSK",
  "amount": "100000000000000000000",
  "reasoning": "Executing HSP PaymentIntent for merchant X, verified signature",
  "evidenceHash": "0xsha256...",
  "txHash": "0x...",
  "ipfsCid": "Qm...",
  "status": "executed"
}
```

### Evidence Hash

`evidenceHash = SHA-256(JSON.stringify({ timestamp, agentAddress, action, intentId, recipient, amount, reasoning }))`

This hash is passed to the contract and emitted in the `PaymentExecuted` event, permanently anchoring the reasoning to the on-chain payment.

---

## Frontend Architecture

### Dashboard Tabs

The UI activates HashKey-specific tabs when the wallet is connected to a HashKey chain (133, 177, or 31338):

| Tab | Component | Description |
|-----|-----------|-------------|
| Vault | `VaultExplorer` | HashKey vault overview, balances |
| Sessions | `SessionManager` | SessionCap creation, revocation, allowance |
| History | `PaymentHistory` | PaymentIntent list with status badges |
| HSP | `HspPanel` | HSP configuration health check |
| Chat | `ChatAgent` | Natural language payment commands |

### Key Libraries

- **wagmi v2** — React hooks for HashKey Chain
- **RainbowKit** — Wallet connection modal
- **Lucide React** — Icon library
- **TailwindCSS** — Utility-first styling
- **jose** — JWT signing for HSP authentication

### Mode Detection

`lib/mode.ts` exports chain-based mode helpers:

```typescript
export function isHashKeyChain(chainId: number | undefined): boolean;
export function getModeForChain(chainId: number | undefined): SafeFlowMode;
export const HASHKEY_ENABLED: boolean;           // from env
export const HASHKEY_LOCAL_FORK_ENABLED: boolean; // from env
```

The UI switches modes dynamically based on `useChainId()` from wagmi.

### AI Chat Intent Parser

LLM-powered parser with rule-based fallback. Extracts structured payment intents:

- **create_payment** — "pay 100 USDT to 0x...", "send 50 HSK to merchant X"
- **payment_status** — "check my payment status", "is intent xxx done?"
- **session_status** — "show my session caps", "remaining budget"
- **general** — Fallback with help suggestions

Parsed intents produce: recipient, token symbol, amount, HSP order reference.

---

## Supported Chains

| Chain | Chain ID | RPC | Role |
|-------|----------|-----|------|
| HashKey Chain Mainnet | 177 | `https://mainnet.hsk.xyz` | Production deployment |
| HashKey Chain Testnet | 133 | `https://testnet.hsk.xyz` | Primary development target |
| HashKey Fork Local | 31338 | `http://127.0.0.1:8546` | Local anvil fork for dev/test |

### Local Fork Management

The fork persists state across restarts via `anvil --state`:

```bash
# First run or resume
./scripts/start-hashkey-fork.sh

# Force fresh fork + redeploy contract
./scripts/start-hashkey-fork.sh --fresh
```

State is stored in `.hashkey-fork-state.json` (gitignored) — contracts, wallets, sessions, and balances all survive restart.

---

## Environment Variables

### HashKey Contract

```env
NEXT_PUBLIC_HASHKEY_ENABLED=true
NEXT_PUBLIC_HASHKEY_CONTRACT=0xYourDeployedAddress
NEXT_PUBLIC_HASHKEY_CHAIN_ID=133
```

### HSP Credentials (server-only)

```env
HSP_APP_KEY=                          # From HashKey merchant portal
HSP_APP_SECRET=                       # From HashKey merchant portal
HSP_MERCHANT_PRIVATE_KEY=             # secp256k1 hex, for JWT signing
HSP_PAY_TO=                           # Merchant receiving address
HSP_BASE_URL=https://merchant-qa.hashkeymerchant.com
HSP_ENVIRONMENT=qa                    # "qa" or "production"
HSP_MERCHANT_NAME=SafeFlow Agent
```

### Local Fork

```env
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED=true
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID=31338
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL=http://127.0.0.1:8546
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_NAME=HashKey Fork Local
```

### Shared

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
LLM_PROVIDER=anthropic                # "openai" or "anthropic"
ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
```
