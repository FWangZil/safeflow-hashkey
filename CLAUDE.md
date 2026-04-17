# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SafeFlow is a secure AI payment agent built on **HashKey Chain**, integrated with the **HashKey Settlement Protocol (HSP)**. Users interact via natural language chat, and an AI agent receives PaymentIntents, claims them, and executes payments on-chain — all constrained by Solidity `SessionCap` contracts that enforce spending limits, rate limits, and expiry.

The project targets HashKey Chain Testnet (133) and Mainnet (177), with local fork support for development (chain 31338, port 8546).

## Commands

### Contracts (Foundry)

```bash
cd contracts
forge build                              # Compile Solidity
forge test                               # Run all tests
forge test -vvv                          # Verbose with traces
forge test --match-test testName         # Single test
forge fmt                                # Format Solidity
forge script script/DeployHashKey.s.sol --rpc-url https://testnet.hsk.xyz --broadcast
```

### Web App (Next.js)

```bash
cd web
npm install
cp .env.example .env.local               # Fill in HashKey + HSP credentials
npm run dev                              # Dev server
npm run build                            # Production build
npm run lint                             # ESLint
```

### Local HashKey Fork

```bash
./scripts/start-hashkey-fork.sh          # Resume or first-run
./scripts/start-hashkey-fork.sh --fresh  # Force fresh fork + redeploy
```

State is persisted to `.hashkey-fork-state.json` — contract and wallet state survive anvil restarts.

## Architecture

```text
User (Chat / Dashboard)
  → AI Strategy Engine (LLM — OpenAI or Anthropic via LLM_PROVIDER env)
    → HSP API (PaymentIntent creation, JWT-signed)
      → Producer API (intent queue, agent coordination)
        → AI Agent (claims + executes on-chain)
          → SafeFlowVaultHashKey.sol (SessionCap-enforced payments)
            → HashKey Chain (133 / 177 / 31338)
              → HSP Webhook (async payment confirmation)
                → Audit Layer (evidence hash → IPFS)
```

### Contracts (`contracts/`)

- **SafeFlowVaultHashKey.sol** — Core contract. Manages wallets (deposit/withdraw ERC-20 or native HSK) and SessionCaps. Agents call `executePayment()` with HSP PaymentIntent data, bounded by their cap.
- **ISafeFlowHashKey.sol** — Events interface (`WalletCreated`, `SessionCapCreated`, `PaymentExecuted`, etc.)
- Solidity 0.8.24, optimizer enabled (200 runs). Targets HashKey Chain Testnet (133) and Mainnet (177).
- Forge fmt: line_length=120, tab_width=4, bracket_spacing=true.

### Web App (`web/`)

Next.js 16 + React 19 + TailwindCSS 4 + wagmi v2 + RainbowKit. Dashboard with HashKey-specific tabs: Vault, Sessions, Payment History, HSP Status.

**Key modules:**

| File | Purpose |
|------|---------|
| `lib/mode.ts` | HashKey mode detection — `isHashKeyChain(chainId)`, `getModeForChain(chainId)`, `HASHKEY_ENABLED` flag. |
| `lib/chains.ts` | HashKey chain configs (testnet 133, mainnet 177, local fork 31338). |
| `lib/contracts.ts` | `SafeFlowVaultHashKey` ABI + `getSafeFlowAddress(chainId)` helper. |
| `lib/hsp/client.ts` | HSP SDK client — JWT signing, order creation, payment queries, webhook verification. |
| `lib/hsp/constants.ts` | HSP environment URLs, HashKey token metadata. |
| `lib/llm.ts` | Unified LLM client — selects OpenAI or Anthropic via `LLM_PROVIDER`. |
| `types/index.ts` | Types: `PaymentIntent`, `HashKeySessionCapInfo`, `HashKeyVaultInfo`. |

**API routes (all under `app/api/hashkey/`):**

| Route | Method | Purpose |
|-------|--------|---------|
| `intents` | POST | Create PaymentIntent |
| `intents` | GET | List PaymentIntents |
| `intents/[id]` | GET | Get single PaymentIntent |
| `intents/[id]/ack` | POST | Agent acknowledges/claims intent |
| `intents/[id]/result` | POST | Agent reports execution result |
| `intents/next` | GET | Retrieve next pending intent for agent polling |
| `hsp/webhook` | POST | Handle HSP webhook callbacks (signature verified) |
| `hsp/status` | GET | HSP configuration health check |

Plus shared: `api/agent/chat`, `api/audit`.

**Components:**

- `PaymentHistory.tsx` — PaymentIntent list with status badges
- `HspPanel.tsx` — HSP configuration + health check dashboard
- `SessionManager.tsx` — SessionCap creation and revocation
- `VaultExplorer.tsx` — HashKey vault overview
- `ChatAgent.tsx` — AI chat with payment intent creation

**Wallet config** (`providers.tsx`): Chains are HashKey Testnet (133), HashKey Mainnet (177), plus HashKey Fork Local (31338) when `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED=true`. See `lib/chains.ts`.

### Environment Variables

Configured in `web/.env.example`. Required variables:

**HashKey Contract:**
- `NEXT_PUBLIC_HASHKEY_ENABLED` — Must be `"true"`
- `NEXT_PUBLIC_HASHKEY_CONTRACT` — Deployed `SafeFlowVaultHashKey` address
- `NEXT_PUBLIC_HASHKEY_CHAIN_ID` — `133` (testnet) or `177` (mainnet)

**HSP Credentials (server-side only):**
- `HSP_APP_KEY` / `HSP_APP_SECRET` — From HashKey merchant portal
- `HSP_MERCHANT_PRIVATE_KEY` — secp256k1 hex for JWT signing
- `HSP_PAY_TO` — Merchant receiving address
- `HSP_BASE_URL` — `https://merchant-qa.hashkeymerchant.com` or production
- `HSP_ENVIRONMENT` — `"qa"` or `"production"`

**Local Fork:**
- `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED` — `"true"` for local dev
- `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID` — `31338` (default)
- `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL` — `http://127.0.0.1:8546`

**Shared:**
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `LLM_PROVIDER` — `"openai"` or `"anthropic"`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`

## Conventions

- The `web/AGENTS.md` warns that this Next.js version may have breaking changes from training data — check `node_modules/next/dist/docs/` before writing Next.js-specific code.
- Chat agent uses a custom `<tool_callJSON>` protocol for LLM tool use rather than native function calling.
- Audit trail is file-based (not a real database) — `data/audit.json` is gitignored.
- **Mode detection is chain-based** — Always use `isHashKeyChain(chainId)` or `getModeForChain(chainId)` from `lib/mode.ts`. The UI activates HashKey tabs when the wallet is connected to a HashKey chain (133, 177, or 31338).
- **Contract selection is context-aware** — Use `getVaultAbi(chainId)` and `getSafeFlowAddress(chainId)` from `lib/contracts.ts` to resolve the correct ABI and address for the connected chain.
- **HSP authentication** — Requires JWT signing with secp256k1 merchant private key. See `lib/hsp/client.ts` for the `HSPClient` class. Never expose `HSP_MERCHANT_PRIVATE_KEY` to the client bundle.
- **HashKey fork state persistence** — `start-hashkey-fork.sh` uses `anvil --state` to persist chain state across restarts. Only redeploys when `--fresh` is passed.
