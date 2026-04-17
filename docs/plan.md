# SafeFlow × HashKey Chain Plan

## Overview

Build an AI-powered payment agent on **HashKey Chain** integrated with the **HashKey Settlement Protocol (HSP)**. Users express payment intents in natural language; an AI agent claims the intent, executes the payment on-chain via `SafeFlowVaultHashKey`, and reports the result back through the Producer API. All actions are bounded by on-chain SessionCap spending limits.

## Target

- **Chain**: HashKey Chain Testnet (133) for primary development, Mainnet (177) for production
- **Protocol Integration**: HashKey Settlement Protocol (HSP)
- **Local Dev**: HashKey fork on chain 31338, port 8546

---

## Core Idea

User tells an AI Agent a payment intent via natural language / CLI / Dashboard → Producer API creates a PaymentIntent on HSP → Agent claims and executes the intent on HashKey Chain → All operations constrained by on-chain SafeFlowVaultHashKey contract (spending caps, session expiry) → HSP webhook confirms async settlement → Decision evidence stored in audit trail.

---

## Implementation Status

### Contracts

| # | Task | Status |
|---|------|--------|
| 1 | `SafeFlowVaultHashKey.sol` — wallets + session caps + executePayment | ✅ Done |
| 2 | Foundry test suite for HashKey vault | ✅ Done |
| 3 | `DeployHashKey.s.sol` deployment script | ✅ Done |
| 4 | Deploy helper: `scripts/deploy-contract-and-configure-web.mjs` supports `hashkey_testnet`, `hashkey_mainnet`, `local_hashkey_fork` | ✅ Done |
| 5 | One-click local fork: `scripts/start-hashkey-fork.sh` with state persistence | ✅ Done |

### Web App — HashKey Mode

| # | Task | Status |
|---|------|--------|
| 6 | Mode infrastructure (`lib/mode.ts`, `lib/chains.ts`, `lib/contracts.ts`, `lib/tokens.ts`) | ✅ Done |
| 7 | HSP Client SDK (`lib/hsp/constants.ts`, `lib/hsp/client.ts`) with JWT signing | ✅ Done |
| 8 | Producer API routes under `/api/hashkey/` | ✅ Done |
| 9 | PaymentHistory + HspPanel components | ✅ Done |
| 10 | Chain-based dynamic tab switching in `page-client.tsx` | ✅ Done |
| 11 | Environment variable templates in `.env.example` | ✅ Done |

### Agent E2E

| # | Task | Status |
|---|------|--------|
| 12 | E2E agent runner (`scripts/hashkey-e2e-runner.ts`) | ✅ Done |

### Pending

| # | Task | Status |
|---|------|--------|
| 13 | HashKey Mainnet deployment + production HSP credentials | Pending |
| 14 | Cross-intent merchant analytics dashboard | Pending |
| 15 | Recurring payment SessionCap model | Pending |
| 16 | Gas sponsorship integration | Pending |
| 17 | Mobile companion app | Pending |

---

## Repository Structure

```text
safeflow-evm/
├── contracts/                       # Foundry Solidity contracts
│   ├── src/
│   │   ├── SafeFlowVaultHashKey.sol
│   │   └── interfaces/ISafeFlowHashKey.sol
│   ├── test/
│   │   └── SafeFlowVaultHashKey.t.sol
│   └── script/
│       └── DeployHashKey.s.sol
├── web/                             # Next.js frontend + Producer API
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx             # Dashboard with HashKey tabs
│   │   │   ├── providers.tsx        # wagmi / RainbowKit / chain config
│   │   │   └── api/
│   │   │       ├── agent/chat/      # AI chat endpoint
│   │   │       ├── audit/           # Audit CRUD
│   │   │       └── hashkey/
│   │   │           ├── intents/     # Intent CRUD, ack, result, next
│   │   │           └── hsp/         # Webhook, status
│   │   ├── components/
│   │   │   ├── PaymentHistory.tsx
│   │   │   ├── HspPanel.tsx
│   │   │   ├── SessionManager.tsx
│   │   │   └── ChatAgent.tsx
│   │   ├── lib/
│   │   │   ├── mode.ts              # Chain-based HashKey mode detection
│   │   │   ├── chains.ts            # HashKey chain definitions
│   │   │   ├── contracts.ts         # SafeFlowVaultHashKey ABI + helpers
│   │   │   ├── tokens.ts            # HSK + ecosystem tokens
│   │   │   └── hsp/
│   │   │       ├── client.ts        # HSPClient with JWT signing
│   │   │       └── constants.ts     # HSP URLs, tokens
│   │   └── types/index.ts
│   └── .env.example
├── scripts/
│   ├── start-hashkey-fork.sh        # One-click local fork
│   ├── deploy-contract-and-configure-web.mjs
│   └── hashkey-e2e-runner.ts        # Agent E2E runner
├── docs/
│   ├── architecture.md
│   ├── hashkey-mode-guide.md
│   ├── hashkey-hsp-research.md
│   ├── hashkey-architecture.md
│   └── hashkey-hackathon-submission.md
└── README.md
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Smart Contracts | Solidity ^0.8.24 + Foundry |
| Target Chain | HashKey Chain (Testnet 133 / Mainnet 177) |
| Local Dev | Anvil fork (chain 31338, port 8546) |
| Frontend | Next.js 16 + React 19 + TailwindCSS |
| Wallet | wagmi v2 + RainbowKit |
| AI Engine | OpenAI / Anthropic (LLM-configurable) |
| Payment Protocol | HashKey Settlement Protocol (HSP) |
| Auth | JWT (secp256k1 / ES256K) |
| Audit Storage | JSON file (MVP) → SQLite → IPFS extension |
| Skill System | Windsurf skill (`safeflow-hashkey-payment`) |

---

## HashKey Chain Network Details

| Network | Chain ID | RPC | Explorer |
|---------|----------|-----|----------|
| Mainnet | 177 | `https://mainnet.hsk.xyz` | `https://hashkey.blockscout.com` |
| Testnet | 133 | `https://testnet.hsk.xyz` | `https://testnet-explorer.hsk.xyz` |
| Local Fork | 31338 | `http://127.0.0.1:8546` | — |

---

## HSP Integration

- **Base URLs**: QA `https://merchant-qa.hashkeymerchant.com`, Production `https://merchant.hashkeymerchant.com`
- **Auth**: JWT signed with `HSP_MERCHANT_PRIVATE_KEY` (secp256k1)
- **Endpoints used**: `POST /v1/orders`, `GET /v1/orders/{id}`, webhook callback
- **Producer routes**: `/api/hashkey/intents/*`, `/api/hashkey/hsp/*`
