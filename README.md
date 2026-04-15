<img src="web/public/logo.png" align="right" width="120" alt="SafeFlow Logo" />

# SafeFlow Yield Agent (EVM)

**AI-powered DeFi yield management with on-chain security guardrails**

> Built for DeFi Mullet Hackathon #1 — Track 2: AI × Earn

## What is SafeFlow?

SafeFlow is a secure agent authorization protocol that lets AI agents manage DeFi yield strategies on behalf of users — with strict on-chain spending limits.

Users interact via **natural language chat**, **web dashboard**, or **CLI**. The AI agent discovers optimal yield vaults via LI.FI Earn API, builds deposit transactions via LI.FI Composer, and executes them — all constrained by on-chain `SessionCap` contracts that enforce spending limits, expiry, and vault whitelists.

### Key Features

- **Vault Explorer** — Discover yield vaults across 20+ protocols and multiple chains
- **AI Chat** — "Deposit 500 USDC into the safest vault on Base" → agent handles the rest
- **On-chain Security** — Solidity contracts enforce per-interval and total spending limits
- **Audit Trail** — Every agent decision is recorded with reasoning, stored in DB + IPFS
- **CLI Tool** — `safeflow vault list --chain base --min-apy 5`

### Architecture

```
User (Chat / Dashboard / CLI)
  ↓
AI Strategy Engine (GPT-4o)
  ↓
LI.FI Earn API (vault discovery) + Composer (tx execution)
  ↓
SafeFlow EVM Contracts (AgentWallet + SessionCap)
  ↓
Audit Layer (Backend DB → IPFS)
```

## How it Uses the Earn API

1. **Vault Discovery** — `GET earn.li.fi/v1/earn/vaults` with chain/protocol/tag filters
2. **AI Analysis** — Agent analyzes APY (base vs reward), TVL, risk tags to recommend strategies
3. **Transaction Build** — `GET li.quest/v1/quote` builds cross-chain deposit transactions
4. **Portfolio Tracking** — `GET earn.li.fi/v1/earn/portfolio/{address}/positions`

## Tech Stack

| Component | Technology |
|-----------|------------|
| Contracts | Solidity + Foundry |
| Frontend | Next.js 15 + TailwindCSS + shadcn/ui |
| Wallet | wagmi v2 + RainbowKit |
| AI | OpenAI API (GPT-4o) |
| Yield | LI.FI Earn Data API + Composer |
| Audit | SQLite + IPFS extension |
| CLI | Node.js + Commander.js |

## Quick Start

### Contracts

```bash
cd contracts
forge build
forge test
```

### Web App

```bash
cd web
cp .env.example .env.local
# Add your API keys to .env.local
npm install
npm run dev
```

### CLI

```bash
cd cli
npm install
npm link
safeflow vault list --chain base
```

## Project Structure

```
safeflow-evm/
├── contracts/          # Foundry Solidity contracts
├── web/                # Next.js frontend + API routes
├── cli/                # CLI tool
└── README.md
```

## What's Next

- Multi-strategy rebalancing (auto-rotate between vaults)
- Mainnet deployment with production SessionCap policies
- Mobile-first UX
- Integration with more agent runtimes (OpenClaw, AutoGPT)

## License

MIT
