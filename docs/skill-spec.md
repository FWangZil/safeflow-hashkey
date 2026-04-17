---
name: safeflow-hashkey-payment
description: >
  SafeFlow HashKey Payment Agent skill for AI-powered payment execution on
  HashKey Chain, integrated with the HashKey Settlement Protocol (HSP). Use
  this skill whenever the user or an AI agent wants to: create payment intents
  via HSP, execute on-chain payments on HashKey Chain, claim and fulfill
  PaymentIntents, check payment status, or manage SessionCap spending policies
  for payment agents. Also trigger when the user mentions "SafeFlow",
  "HashKey", "HSP", "HashKey Settlement Protocol", "PaymentIntent", "HSK",
  "HashKey Chain", "merchant payment", "session cap", "agent wallet", or asks
  about safe/guarded AI agent payment operations on HashKey. This skill covers
  both the on-chain contract interaction (SafeFlowVaultHashKey.sol) and the
  off-chain orchestration (HSP API, Producer API, audit trail).
---

# SafeFlow HashKey Payment Agent

SafeFlow is an on-chain fund management protocol on **HashKey Chain** that lets AI agents execute payments on behalf of users — with strict spending limits enforced by Solidity smart contracts and integrated with the **HashKey Settlement Protocol (HSP)**.

## Architecture Overview

```text
User / External AI Agent
  ↓
SafeFlow Skill (this file)
  ↓
┌─────────────────────────────────────────────────────┐
│  HSP API              → PaymentIntent creation       │
│  Producer API         → Intent queue + coordination  │
│  SafeFlowVaultHashKey → On-chain payment + caps      │
│  Audit API            → Evidence recording            │
└─────────────────────────────────────────────────────┘
```

## Core Concepts

### SafeFlowVaultHashKey Contract

A single Solidity contract at `contracts/src/SafeFlowVaultHashKey.sol` deployed to HashKey Chain, managing:

- **Wallets** — Users create wallets and deposit HSK or ERC-20 tokens
- **SessionCaps** — Owner grants an agent permission to spend, bounded by:
  - `maxSpendPerInterval` — max tokens agent can spend per time window
  - `maxSpendTotal` — lifetime spending cap
  - `intervalSeconds` — rate-limit window length
  - `expiresAt` — unix timestamp when the cap expires
- **executePayment()** — Agent calls this to fulfill an HSP PaymentIntent on-chain. The contract enforces all limits and emits `PaymentExecuted` with an `evidenceHash` linking to the audit record.

### HashKey Settlement Protocol (HSP)

HSP is HashKey's merchant payment protocol. SafeFlow uses HSP to create compliant PaymentIntents.

**Base URLs:**

- QA: `https://merchant-qa.hashkeymerchant.com`
- Production: `https://merchant.hashkeymerchant.com`

**Key endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/orders` | Create PaymentIntent (JWT-signed) |
| `GET /v1/orders/{orderId}` | Query PaymentIntent status |
| Webhook | Async payment confirmation |

**Authentication:** JWT signed with merchant's secp256k1 private key via ES256K.

### SafeFlow Producer API

REST endpoints coordinating users, HSP, and AI agents (all under `/api/hashkey/`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/intents` | POST | Create PaymentIntent |
| `/intents` | GET | List PaymentIntents |
| `/intents/{id}` | GET | Get single intent |
| `/intents/{id}/ack` | POST | Agent acknowledges/claims intent |
| `/intents/{id}/result` | POST | Agent reports execution result |
| `/intents/next` | GET | Retrieve next pending intent (agent polling) |
| `/hsp/webhook` | POST | HSP webhook callback (signature verified) |
| `/hsp/status` | GET | HSP configuration health check |

### Audit API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/audit` | GET | List all audit records |
| `/api/audit` | POST | Create audit entry (reasoning, recipient, amount) |
| `/api/audit` | PATCH | Update entry (txHash, ipfsCid, status) |

The POST returns an `evidenceHash` (SHA-256 of the payload) that gets passed to the contract.

---

## Workflow: Execute an HSP PaymentIntent

This is the primary workflow an AI agent follows to fulfill a payment on behalf of a user.

### Step 1: Retrieve Pending Intent

Agent polls the Producer API:

```bash
curl http://localhost:3000/api/hashkey/intents/next
```

Response contains intent details:

```json
{
  "id": "intent-uuid",
  "hspOrderId": "hsp-order-id",
  "recipient": "0x...",
  "token": "0xTokenOrZeroForNative",
  "amount": "100000000000000000000",
  "status": "pending",
  "signature": "0x...",
  "createdAt": 1712793600000
}
```

### Step 2: Acknowledge / Claim Intent

```bash
curl -X POST http://localhost:3000/api/hashkey/intents/{id}/ack \
  -H "Content-Type: application/json" \
  -d '{"agentAddress": "0xAgent"}'
```

Intent transitions: `pending` → `claimed`.

### Step 3: Record Audit Evidence

Before executing, record the agent's reasoning:

```bash
curl -X POST http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{
    "agentAddress": "0xAgent",
    "action": "payment",
    "intentId": "intent-uuid",
    "recipient": "0xRecipient",
    "token": "HSK",
    "amount": "100000000000000000000",
    "reasoning": "Fulfilling verified HSP PaymentIntent for merchant X"
  }'
```

Response includes `evidenceHash` — save this for the contract call.

### Step 4: Execute via SafeFlowVaultHashKey Contract

Call `executePayment()` on the HashKey Chain contract:

```solidity
function executePayment(
    uint256 capId,         // SessionCap ID
    address token,         // Token address (address(0) for native HSK)
    uint256 amount,        // Amount in token's smallest unit
    address recipient,     // Payment recipient
    bytes32 evidenceHash,  // From audit API
    bytes32 intentId       // HSP intent identifier
) external;
```

Using viem:

```typescript
import { createWalletClient, http } from 'viem';
import { HashKeyTestnet } from './chains'; // chain id 133

const tx = await walletClient.writeContract({
  address: SAFEFLOW_HASHKEY_CONTRACT,
  abi: SAFEFLOW_VAULT_HASHKEY_ABI,
  functionName: 'executePayment',
  args: [capId, tokenAddress, amount, recipient, evidenceHash, intentId],
});
```

### Step 5: Report Result to Producer API

```bash
curl -X POST http://localhost:3000/api/hashkey/intents/{id}/result \
  -H "Content-Type: application/json" \
  -d '{
    "txHash": "0x...",
    "status": "executed",
    "blockNumber": 12345
  }'
```

Intent transitions: `claimed` → `executed`.

### Step 6: HSP Webhook Confirms Settlement

HashKey Settlement Protocol sends an async webhook to `/api/hashkey/hsp/webhook`. The Producer API:

1. Verifies the webhook signature
2. Updates intent status: `executed` → `confirmed`
3. Records final settlement state

---

## Workflow: Check Payment Status

```bash
# By SafeFlow intent ID
curl http://localhost:3000/api/hashkey/intents/{id}

# By HSP order ID
curl http://localhost:3000/api/hashkey/intents?hspOrderId=xxx
```

Status values: `pending`, `claimed`, `executed`, `confirmed`, `failed`, `cancelled`.

---

## Workflow: Manage SessionCaps

### Create a SessionCap (owner only)

```typescript
const tx = await walletClient.writeContract({
  address: SAFEFLOW_HASHKEY_CONTRACT,
  abi: SAFEFLOW_VAULT_HASHKEY_ABI,
  functionName: 'createSessionCap',
  args: [
    walletId,           // uint256 — which wallet
    agentAddress,       // address — agent granted permission
    maxSpendPerInterval,// uint64  — e.g., 100e18 for 100 HSK
    maxSpendTotal,      // uint256 — e.g., 1000e18 for 1000 HSK lifetime
    intervalSeconds,    // uint64  — e.g., 3600 for 1 hour
    expiresAt,          // uint64  — unix timestamp
  ],
});
```

### Check Remaining Allowance

```typescript
const [intervalRemaining, totalRemaining] = await publicClient.readContract({
  address: SAFEFLOW_HASHKEY_CONTRACT,
  abi: SAFEFLOW_VAULT_HASHKEY_ABI,
  functionName: 'getRemainingAllowance',
  args: [capId],
});
```

### Revoke a SessionCap (owner only)

```typescript
await walletClient.writeContract({
  address: SAFEFLOW_HASHKEY_CONTRACT,
  abi: SAFEFLOW_VAULT_HASHKEY_ABI,
  functionName: 'revokeSessionCap',
  args: [capId],
});
```

---

## HashKey Chain Network Details

| Network | Chain ID | RPC | Explorer |
|---------|----------|-----|----------|
| HashKey Chain Mainnet | 177 | `https://mainnet.hsk.xyz` | `https://hashkey.blockscout.com` |
| HashKey Chain Testnet | 133 | `https://testnet.hsk.xyz` | `https://testnet-explorer.hsk.xyz` |
| HashKey Fork Local | 31338 | `http://127.0.0.1:8546` | — |

---

## Contract ABI Reference

See `references/abi.json` for the full ABI. Key functions:

| Function | Caller | Purpose |
|----------|--------|---------|
| `createWallet()` | Owner | Create a new agent wallet |
| `deposit(walletId, token, amount)` | Owner | Deposit HSK or ERC-20 |
| `withdraw(walletId, token, amount)` | Owner | Withdraw tokens |
| `createSessionCap(...)` | Owner | Grant agent spending permission |
| `revokeSessionCap(capId)` | Owner | Revoke agent permission |
| `executePayment(...)` | Agent | Execute HSP payment within caps |
| `getBalance(walletId, token)` | Anyone | Check wallet balance |
| `getSessionCap(capId)` | Anyone | Read cap details |
| `getRemainingAllowance(capId)` | Anyone | Check remaining spend budget |

---

## Error Handling

The contract reverts with typed errors:

| Error | Meaning |
|-------|---------|
| `NotOwner()` | Caller is not the wallet owner |
| `SessionExpired()` | SessionCap has expired |
| `ExceedsIntervalLimit()` | Spend exceeds per-interval cap |
| `ExceedsTotalLimit()` | Spend exceeds lifetime cap |
| `InsufficientBalance()` | Wallet doesn't have enough tokens |
| `InvalidSessionCap()` | Wrong agent or invalid cap |
| `SessionCapNotActive()` | Cap has been revoked |

When an error occurs, the agent should:

1. POST to `/api/hashkey/intents/{id}/result` with `status: "failed"` and the error reason
2. Log the error to the audit API
3. Inform the user with a clear explanation
4. Suggest corrective action (e.g., "Ask the wallet owner to increase your spending limit")

---

## Security Model

The design enforces a strict separation between the human owner and the AI agent:

- **Owner** controls funds: creates wallet, deposits, sets spending policies
- **Agent** executes within bounds: can only spend up to the granted limits
- **Evidence** is immutable: every action is recorded with an evidenceHash on-chain
- **Revocation** is instant: owner can revoke any SessionCap at any time
- **HSP-Verified**: Every PaymentIntent originates from HashKey Settlement Protocol with merchant signature

This means an AI agent can never:

- Spend more than the owner authorized
- Spend after the cap expires
- Modify its own limits
- Access funds from other wallets
- Execute payments not backed by a verified HSP intent
