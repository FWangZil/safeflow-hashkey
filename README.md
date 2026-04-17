<img src="web/public/logo.png" align="right" width="120" alt="SafeFlow Logo" />

# SafeFlow — AI Payment Agent on HashKey Chain

**Secure AI-driven payment execution powered by HashKey Settlement Protocol (HSP)**

> Built for the HashKey Chain ecosystem

## What is SafeFlow?

SafeFlow is a secure agent authorization protocol that lets AI agents execute payments on HashKey Chain on behalf of users — with strict on-chain spending limits enforced by Solidity smart contracts.

Users interact via **natural language chat** or **web dashboard**. The AI agent receives PaymentIntents from the HashKey Settlement Protocol (HSP), claims them, and executes them on-chain — all constrained by on-chain `SessionCap` contracts that enforce spending limits, rate limits, and expiry.

### Why HashKey Chain?

- **HSP Native Integration** — First-class support for HashKey Settlement Protocol (HSP) payment flows
- **Fast Finality** — HashKey Chain's EVM-compatible consensus delivers sub-second block times
- **HSK Native Token** — Built-in support for HSK and HashKey ecosystem tokens
- **Merchant-Ready** — Direct integration with HashKey's merchant payment infrastructure
- **Regulatory-Compliant** — Operating within HashKey's licensed payment framework

### Key Features

- **HSP Payment Intents** — Create and manage PaymentIntents through the HashKey Settlement Protocol
- **AI Agent Execution** — "Pay 100 USDT to merchant X" → agent claims intent, executes, confirms
- **On-chain Security** — `SafeFlowVaultHashKey.sol` enforces per-interval and total spending caps
- **Webhook-Driven Settlement** — HSP webhooks confirm payment status to the backend
- **Audit Trail** — Every agent decision recorded with on-chain evidence hash
- **Producer API** — REST endpoints for intent creation, agent acknowledgment, and result reporting

## Architecture

```text
User (Chat / Dashboard)
  ↓
AI Strategy Engine (LLM)
  ↓
HSP API (PaymentIntent creation via JWT-signed requests)
  ↓
SafeFlow Producer API (intent queue + agent coordination)
  ↓
AI Agent (polls intents → claims → executes)
  ↓
SafeFlowVaultHashKey.sol (SessionCap-enforced payments)
  ↓
HashKey Chain (on-chain settlement)
  ↓
HSP Webhook (async payment confirmation)
  ↓
Audit Layer (evidence hash → IPFS)
```

## HashKey Chain Support

| Chain | Chain ID | RPC | Status |
|-------|----------|-----|--------|
| HashKey Chain Mainnet | 177 | `https://mainnet.hsk.xyz` | Production |
| HashKey Chain Testnet | 133 | `https://testnet.hsk.xyz` | Primary dev target |
| HashKey Fork Local | 31338 | `http://127.0.0.1:8546` | Local development |

## HSP Payment Flow

1. **User creates intent** — Via UI or natural language chat
2. **Producer API → HSP** — Creates signed order on HashKey Settlement Protocol
3. **Agent claims intent** — AI agent polls Producer API and acknowledges
4. **On-chain execution** — Agent calls `SafeFlowVaultHashKey.executePayment()` with SessionCap enforcement
5. **HSP webhook callback** — HashKey confirms payment status to the backend
6. **Audit recorded** — Evidence hash linking reasoning to on-chain tx

## Tech Stack

| Component | Technology |
|-----------|------------|
| Smart Contracts | Solidity 0.8.24 + Foundry |
| Frontend | Next.js 16 + React 19 + TailwindCSS 4 |
| Wallet | wagmi v2 + RainbowKit |
| AI | OpenAI / Anthropic (LLM-configurable) |
| Payment Protocol | HashKey Settlement Protocol (HSP) |
| Auth | JWT (secp256k1) for HSP requests |
| Chain | HashKey Chain (testnet 133 / mainnet 177) |

## Quick Start

### 1. Deploy Contracts

```bash
cd contracts
forge build
forge test
```

### 2. Start Local HashKey Fork (recommended for development)

```bash
# Fork HashKey Testnet + deploy contract + configure web env
./scripts/start-hashkey-fork.sh

# Resume from saved state next time (no redeploy)
./scripts/start-hashkey-fork.sh

# Force fresh fork + redeploy
./scripts/start-hashkey-fork.sh --fresh
```

### 3. Run Web App

```bash
cd web
cp .env.example .env.local
# Fill in HashKey + HSP credentials
npm install
npm run dev
```

### 4. Configure HashKey Mode (.env.local)

```env
# WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_wc_project_id

# HashKey Contract
NEXT_PUBLIC_HASHKEY_ENABLED=true
NEXT_PUBLIC_HASHKEY_CONTRACT=0xYourDeployedAddress
NEXT_PUBLIC_HASHKEY_CHAIN_ID=133

# HSP Credentials (from HashKey merchant portal)
HSP_APP_KEY=your_hsp_app_key
HSP_APP_SECRET=your_hsp_app_secret
HSP_MERCHANT_PRIVATE_KEY=your_secp256k1_hex
HSP_PAY_TO=0xMerchantReceivingAddress
HSP_BASE_URL=https://merchant-qa.hashkeymerchant.com
HSP_ENVIRONMENT=qa

# LLM Provider
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key
```

Connect your wallet to **HashKey Chain Testnet (133)** or **HashKey Fork Local** to enter HashKey mode.

## Project Structure

```text
safeflow-evm/
├── contracts/
│   ├── src/
│   │   └── SafeFlowVaultHashKey.sol    # HashKey payment vault with SessionCap
│   ├── script/
│   │   └── DeployHashKey.s.sol          # Deploy to HashKey Chain
│   └── test/
│       └── SafeFlowVaultHashKey.t.sol   # Foundry tests
├── web/
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/hashkey/             # Producer API routes
│   │   │   │   ├── intents/             # PaymentIntent CRUD
│   │   │   │   └── hsp/                 # HSP webhook + status
│   │   │   └── page.tsx                 # HashKey dashboard
│   │   ├── lib/
│   │   │   ├── mode.ts                  # Chain-based mode detection
│   │   │   ├── chains.ts                # HashKey chain configurations
│   │   │   ├── contracts.ts             # SafeFlowVaultHashKey ABI
│   │   │   └── hsp/                     # HSP SDK client
│   │   │       ├── client.ts            # HSPClient + JWT signing
│   │   │       └── constants.ts         # HSP environment URLs
│   │   └── components/
│   │       ├── PaymentHistory.tsx       # PaymentIntent list
│   │       └── HspPanel.tsx             # HSP config health check
│   └── .env.example
├── scripts/
│   ├── start-hashkey-fork.sh            # One-click HashKey fork setup
│   ├── deploy-contract-and-configure-web.mjs
│   └── hashkey-e2e-runner.ts            # Agent E2E runner
├── docs/
│   ├── architecture.md                  # System architecture
│   ├── hashkey-mode-guide.md            # HashKey integration guide
│   ├── hashkey-hsp-research.md          # HSP protocol research
│   └── hashkey-architecture.md          # HashKey-specific design
└── README.md
```

## Documentation

- **[Architecture](docs/architecture.md)** — System architecture and security model
- **[HashKey Mode Guide](docs/hashkey-mode-guide.md)** — HashKey + HSP integration walkthrough
- **[HSP Research](docs/hashkey-hsp-research.md)** — HashKey Settlement Protocol deep dive
- **[HashKey Architecture](docs/hashkey-architecture.md)** — HashKey-specific contract + flow design
- **[Hackathon Submission](docs/hashkey-hackathon-submission.md)** — Submission details

## Security Model

SafeFlow enforces three invariants on HashKey Chain:

1. **Fund Isolation** — User deposits into a wallet on-chain; only the wallet owner can withdraw
2. **Bounded Execution** — Agent operates through a `SessionCap` with per-interval rate limit, total spending cap, and expiry
3. **Evidence Anchoring** — Every agent action records an `evidenceHash` on-chain, linking to off-chain HSP reasoning payload

The AI agent **cannot**:

- Withdraw funds back to itself
- Modify its own spending limits
- Spend beyond per-interval or total cap
- Operate after session expiry or revocation
- Access wallets it wasn't granted a cap for

## What's Next

- HSP mainnet deployment with production merchant onboarding
- Multi-agent payment coordination (parallel intent execution)
- HashKey Chain gas sponsorship integration
- Mobile-first UX for merchant payment scenarios
- Cross-merchant settlement analytics dashboard

## License

MIT
