# SafeFlow Architecture (HashKey Chain Edition)

## Overview

SafeFlow is an on-chain Agent Air-Gap Wallet protocol. It isolates AI agent spending from human-owned funds via a Vault + SessionCap model deployed as a Solidity smart contract on HashKey Chain.

## Core Components

### SafeFlowVault.sol

The single contract manages all state:

- **Vault**: A struct holding `owner`, `balance`, and `exists`. Each vault gets an auto-incrementing `vaultId`.
- **SessionCap**: A mapping `(vaultId, agentAddress) => SessionCap` with:
  - `maxSpendPerSecond` — rate limit in wei/sec
  - `maxSpendTotal` — lifetime cap in wei
  - `totalSpent` — accumulated spend
  - `lastSpendTimeSec` — timestamp of last payment
  - `expiresAtSec` — session expiration timestamp

### Payment Execution Flow

1. Agent calls `executePayment(vaultId, recipient, amount, reasonHash, reasonMemo)`
2. Contract checks: session exists → not expired → total limit → rate limit → vault balance
3. Transfers native HSK to recipient
4. Emits `PaymentExecuted` event with `reasonHash` for audit

### Producer API

Lightweight HTTP server managing PaymentIntent lifecycle:

```
pending → claimed (ACK) → executed/failed
                       → expired
```

- HMAC-signed intents prevent tampering
- Agent verifies signature before execution

### Agent E2E Runner

Autonomous loop:
1. Poll Producer API for next pending intent
2. Verify HMAC signature
3. Apply local policies (max amount, allowed recipients)
4. ACK intent
5. Build reasoning payload → hash it → call `executePayment`
6. Report result back to Producer API

### Human Dashboard (Next.js)

- **Vault Management**: Create vaults, deposit HSK
- **Session Caps**: Grant/revoke agent sessions with configurable limits
- **Payment History**: Observe intent status from Producer API

## Security Analysis

| Layer | Protection |
|-------|-----------|
| Contract | Rate limit, total cap, expiry, owner-only admin |
| Agent | HMAC verification, local policy engine, key isolation |
| Producer API | API key auth, HMAC signing, expiration |
| Human | One-click revoke, withdraw at any time |

## Why EVM / HashKey Chain

- **EVM Compatibility**: Standard Solidity tooling (Foundry, ethers.js, wagmi)
- **Institutional Grade**: HashKey Chain is compliance-first, suitable for financial infrastructure
- **Low Gas**: L2 architecture provides low transaction costs for frequent micro-payments
- **HSK Native Token**: Used as the payment currency within vaults
