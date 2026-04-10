---
name: safeflow-evm-yield
description: >
  SafeFlow Yield Agent skill for AI-powered DeFi yield management on EVM chains.
  Use this skill whenever the user or an AI agent wants to: discover yield vaults
  across DeFi protocols, deposit tokens into yield vaults through SafeFlow's
  on-chain security guardrails, check portfolio positions, analyze yield strategies,
  or manage SessionCap spending policies. Also trigger when the user mentions
  "SafeFlow", "yield agent", "vault discovery", "earn API", "LI.FI earn",
  "deposit into vault", "session cap", "agent wallet", "DeFi yield management",
  or asks about safe/guarded AI agent DeFi operations. This skill covers both
  the on-chain contract interaction (SafeFlowVault.sol) and the off-chain
  orchestration (LI.FI Earn API, audit trail, CLI).
---

# SafeFlow EVM Yield Agent

SafeFlow is an on-chain fund management protocol that lets AI agents execute DeFi yield strategies on behalf of users — with strict spending limits enforced by Solidity smart contracts.

## Architecture Overview

```
User / External AI Agent
  ↓
SafeFlow Skill (this file)
  ↓
┌─────────────────────────────────────────────────┐
│  LI.FI Earn API     → Vault discovery & portfolio │
│  LI.FI Composer API → Transaction building         │
│  SafeFlowVault.sol  → On-chain execution + caps    │
│  Audit API           → Evidence recording           │
└─────────────────────────────────────────────────┘
```

## Core Concepts

### SafeFlowVault Contract

A single Solidity contract at `contracts/src/SafeFlowVault.sol` that manages:

- **Wallets** — Users create wallets and deposit ERC-20 tokens
- **SessionCaps** — Owner grants an agent address permission to spend, bounded by:
  - `maxSpendPerInterval` — max tokens agent can spend per time window
  - `maxSpendTotal` — lifetime spending cap
  - `intervalSeconds` — rate-limit window length
  - `expiresAt` — unix timestamp when the cap expires
- **executeDeposit()** — Agent calls this to deposit into a yield vault. The contract enforces all limits and emits `DepositExecuted` with an `evidenceHash` linking to the audit record.

### LI.FI Earn API (no auth required)

| Endpoint | Purpose |
|----------|---------|
| `GET https://earn.li.fi/v1/earn/vaults` | List all yield vaults |
| `GET https://earn.li.fi/v1/earn/vaults?chainId={id}` | Filter by chain |
| `GET https://earn.li.fi/v1/earn/portfolio/{address}/positions` | Portfolio positions |

Common query parameters for vault listing:
- `chainId` — EVM chain ID (8453=Base, 42161=Arbitrum, 1=Ethereum, etc.)
- `limit` / `offset` — Pagination

### LI.FI Composer API (requires API key)

| Endpoint | Purpose |
|----------|---------|
| `GET https://li.quest/v1/quote` | Build deposit transaction |

Required params: `fromChain`, `toChain`, `fromToken`, `toToken`, `fromAddress`, `toAddress`, `fromAmount`. Pass API key via `x-lifi-api-key` header.

### Audit API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/audit` | GET | List all audit records |
| `/api/audit` | POST | Create audit entry (reasoning, vault, amount, risk_score) |
| `/api/audit` | PATCH | Update entry (txHash, ipfsCid, status) |

The POST returns an `evidenceHash` (SHA-256 of the payload) that gets passed to the contract.

---

## Workflow: Discover and Deposit into a Vault

This is the primary workflow an AI agent follows to manage yield on behalf of a user.

### Step 1: Discover Vaults

Fetch vaults from LI.FI Earn API with optional filters:

```bash
# All transactional vaults on Base
curl "https://earn.li.fi/v1/earn/vaults?chainId=8453&limit=50"

# From code (TypeScript)
const res = await fetch('https://earn.li.fi/v1/earn/vaults?chainId=8453&limit=50');
const { data: vaults } = await res.json();
```

Each vault object contains:
- `address` — Vault contract address
- `name` — Human-readable name
- `chainId` / `network` — Chain info
- `protocol.name` — Protocol (Aave, Compound, etc.)
- `tags[]` — Categories like "stablecoin", "blue-chip", "lsd"
- `isTransactional` — Whether deposits are supported
- `underlyingTokens[]` — Token info (symbol, decimals, address)
- `analytics.apy.total` / `.base` / `.reward` — APY breakdown
- `analytics.tvl.usd` — Total value locked

Filter client-side for best results:
- Only use vaults where `isTransactional === true`
- Sort by `analytics.apy.total` descending for highest yield
- Filter by `tags` for strategy type (stablecoin, blue-chip)
- Filter by `underlyingTokens[].symbol` for specific assets

### Step 2: Analyze and Select

The agent should evaluate vaults based on:
- **APY** — Higher is better, but verify it's sustainable (check `apy7d`, `apy30d`)
- **TVL** — Higher TVL generally means lower risk
- **Protocol reputation** — Prefer well-known protocols
- **Tags** — Match user's risk appetite (stablecoin = low risk, blue-chip = medium)

### Step 3: Record Audit Evidence

Before executing, record the agent's reasoning:

```bash
curl -X POST http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{
    "agentAddress": "0xAgentAddress",
    "action": "deposit",
    "vault": "0xVaultAddress",
    "vaultName": "Aave USDC Base",
    "token": "USDC",
    "amount": "500000000",
    "reasoning": "Selected highest APY stablecoin vault on Base with TVL > $10M",
    "riskScore": 2
  }'
```

Response includes `evidenceHash` — save this for the contract call.

### Step 4: Build Transaction via Composer

```bash
curl "https://li.quest/v1/quote?fromChain=8453&toChain=8453&fromToken=0xUSDC&toToken=0xVaultToken&fromAddress=0xAgent&toAddress=0xAgent&fromAmount=500000000" \
  -H "x-lifi-api-key: YOUR_KEY"
```

The response contains `transactionRequest` with `to`, `data`, `value`, `gasLimit`.

### Step 5: Execute via SafeFlow Contract

Call `executeDeposit()` on the SafeFlowVault contract:

```solidity
function executeDeposit(
    uint256 capId,        // SessionCap ID
    address token,        // ERC-20 token address
    uint256 amount,       // Amount in token's smallest unit
    address vault,        // Target vault address
    bytes32 evidenceHash, // From audit API
    bytes calldata callData // From Composer transactionRequest.data
) external;
```

Using ethers.js / viem:

```typescript
import { encodeFunctionData } from 'viem';

const tx = await walletClient.writeContract({
  address: SAFEFLOW_CONTRACT,
  abi: SAFEFLOW_VAULT_ABI,
  functionName: 'executeDeposit',
  args: [capId, tokenAddress, amount, vaultAddress, evidenceHash, composerCallData],
});
```

### Step 6: Update Audit Record

```bash
curl -X PATCH http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{"id": "audit-entry-id", "txHash": "0x...", "status": "executed"}'
```

---

## Workflow: Check Portfolio

```bash
curl "https://earn.li.fi/v1/earn/portfolio/0xWalletAddress/positions"
```

Returns array of position objects with vault info, balance, and PnL.

---

## Workflow: Manage SessionCaps

### Create a SessionCap (owner only)

```typescript
const tx = await walletClient.writeContract({
  address: SAFEFLOW_CONTRACT,
  abi: SAFEFLOW_VAULT_ABI,
  functionName: 'createSessionCap',
  args: [
    walletId,           // uint256 — which wallet
    agentAddress,       // address — agent that gets permission
    maxSpendPerInterval,// uint64  — e.g., 1000e6 for 1000 USDC
    maxSpendTotal,      // uint256 — e.g., 5000e6 for 5000 USDC lifetime
    intervalSeconds,    // uint64  — e.g., 3600 for 1 hour
    expiresAt,          // uint64  — unix timestamp
  ],
});
```

### Check Remaining Allowance

```typescript
const [intervalRemaining, totalRemaining] = await publicClient.readContract({
  address: SAFEFLOW_CONTRACT,
  abi: SAFEFLOW_VAULT_ABI,
  functionName: 'getRemainingAllowance',
  args: [capId],
});
```

### Revoke a SessionCap (owner only)

```typescript
await walletClient.writeContract({
  address: SAFEFLOW_CONTRACT,
  abi: SAFEFLOW_VAULT_ABI,
  functionName: 'revokeSessionCap',
  args: [capId],
});
```

---

## CLI Quick Reference

The `safeflow` CLI provides terminal access to the same capabilities:

```bash
# Discover vaults
safeflow vault list --chain base --token USDC --min-apy 5 --limit 10

# Vault details
safeflow info 0xVaultAddress --chain base

# Portfolio
safeflow portfolio 0xWalletAddress
```

---

## Chain IDs

| Chain | ID |
|-------|-----|
| Ethereum | 1 |
| Arbitrum | 42161 |
| Base | 8453 |
| Optimism | 10 |
| Polygon | 137 |
| BSC | 56 |
| Avalanche | 43114 |

---

## Contract ABI Reference

See `references/abi.json` for the full ABI. Key functions:

| Function | Caller | Purpose |
|----------|--------|---------|
| `createWallet()` | Owner | Create a new agent wallet |
| `deposit(walletId, token, amount)` | Owner | Deposit ERC-20 tokens |
| `withdraw(walletId, token, amount)` | Owner | Withdraw tokens |
| `createSessionCap(...)` | Owner | Grant agent spending permission |
| `revokeSessionCap(capId)` | Owner | Revoke agent permission |
| `executeDeposit(...)` | Agent | Execute vault deposit within caps |
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
1. Log the error to the audit API with `status: "failed"`
2. Inform the user with a clear explanation
3. Suggest corrective action (e.g., "Ask the wallet owner to increase your spending limit")

---

## Security Model

The design enforces a strict separation between the human owner and the AI agent:

- **Owner** controls funds: creates wallet, deposits, sets spending policies
- **Agent** executes within bounds: can only spend up to the granted limits
- **Evidence** is immutable: every action is recorded with an evidenceHash on-chain
- **Revocation** is instant: owner can revoke any SessionCap at any time

This means an AI agent can never:
- Spend more than the owner authorized
- Spend after the cap expires
- Modify its own limits
- Access funds from other wallets
