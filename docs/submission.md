# SafeFlow — Hackathon Submission

> HashKey Chain Hackathon | AI Payment Agent Track
> Team: SafeFlow

---

## Tweet Thread

**Tweet 1:**

Excited to submit SafeFlow for the HashKey Chain Hackathon! 🎯

An AI-powered payment agent on HashKey Chain with on-chain security guardrails, integrated with the HashKey Settlement Protocol (HSP).

Demo video: [LINK]
GitHub: https://github.com/brucexu-eth/safeflow-evm

**Tweet 2:**

How it works:

1. User creates a PaymentIntent via chat or UI
2. Producer API signs and registers it on HashKey Settlement Protocol (HSP)
3. AI agent polls the queue, claims the intent, executes on-chain
4. SafeFlowVaultHashKey enforces SessionCap spending limits — all bounded by immutable Solidity logic

On-chain security. Zero trust assumed.

**Tweet 3:**

Key features:

- Natural language payment commands (Chinese + English)
- HSP-compliant PaymentIntent creation with JWT-signed requests
- Per-session spending caps enforced on HashKey Chain
- Full audit trail with evidence hashing
- One-click local fork: `./scripts/start-hashkey-fork.sh`
- Polished UI with light/dark mode and i18n

Built with Solidity + Next.js 16 + Foundry, running on HashKey Chain Testnet (133).

---

## Project Write-Up

### What does the project do?

SafeFlow is an AI-powered payment agent on HashKey Chain that lets users execute payments through natural language conversation, while maintaining strict on-chain security guardrails via SessionCaps and integrating with the **HashKey Settlement Protocol (HSP)**.

Users interact with an AI chat agent (supporting Chinese and English), describing payment intents in plain language — e.g., "Pay 100 USDT to merchant X" or "Send 50 HSK to 0x…". The agent:

1. **Understands intent**: Parses the user's natural language to identify recipient, amount, token, and purpose.
2. **Registers via HSP**: Producer API creates a compliant PaymentIntent through the HashKey Settlement Protocol using JWT-signed requests.
3. **Claims and executes**: The AI agent polls the queue, acknowledges the intent, then calls `SafeFlowVaultHashKey.executePayment()` on HashKey Chain.
4. **On-chain enforcement**: The vault contract enforces SessionCap spending limits — max per interval, max total, expiry — all immutable.
5. **Webhook settlement**: HSP sends an async webhook confirming settlement, closing the audit loop with an on-chain evidence hash.

The core innovation is the **SessionCap system combined with HSP verification**: users authorize an AI agent to manage payments within strictly bounded parameters, while every payment traces back to a merchant-signed HSP intent. The AI acts autonomously, but only within user-authorized limits and only for valid HSP-backed intents.

### How does it use HashKey Chain and HSP?

SafeFlow is built exclusively for HashKey Chain and integrates the HashKey Settlement Protocol at multiple layers:

**HashKey Settlement Protocol (HSP) Integration**

- **PaymentIntent Creation** — Producer API calls HSP `POST /v1/orders` with JWT signed by merchant's secp256k1 key.
- **Status Queries** — Agents can query HSP order status at any point in the lifecycle.
- **Webhook Verification** — HSP sends async settlement confirmations; SafeFlow verifies signatures before updating intent state.
- **Merchant Metadata** — HSP order data (merchant name, recipient, amount, token) is persisted alongside the SafeFlow intent record.

**HashKey Chain Deployment**

- **Testnet (chain 133)** — Primary development target, deployed via `scripts/deploy-contract-and-configure-web.mjs --network hashkey_testnet`.
- **Mainnet (chain 177)** — Production deployment path supported.
- **Local Fork (chain 31338, port 8546)** — One-click dev environment via `./scripts/start-hashkey-fork.sh` with persistent state across restarts.

**Chain-Native Features**

- Native HSK token support for payments (in addition to ERC-20).
- Automatic chain-based mode detection — connecting wallet to HashKey Chain activates the payment UI.
- HashKey Chain-specific error handling and explorer link generation.

The AI agent combines chat-driven intent creation with HSP-verified settlement and HashKey Chain execution, producing a seamless natural-language-to-payment flow.

### What's next?

1. **Production mainnet deployment** — Move from HashKey Testnet to Mainnet with production HSP merchant credentials.
2. **Multi-agent coordination** — Enable parallel intent execution across multiple agents with shared SessionCap pools.
3. **Gas sponsorship** — Integrate HashKey Chain's sponsor mechanisms so end users don't need HSK for gas.
4. **Merchant analytics dashboard** — Cross-intent analytics, settlement timing, and failure analysis for merchants using HSP.
5. **Mobile-first experience** — React Native companion app with push notifications for PaymentIntent confirmations.
6. **Recurring payment SessionCaps** — Extend the cap model to support subscriptions (monthly/weekly automatic payment windows).

### HSP Integration Feedback

**What worked well:**

- HSP's JWT (ES256K) authentication model is clean and aligns naturally with EVM account-based signing.
- Webhook callbacks with signature verification provide a robust async confirmation channel.
- The QA environment at `merchant-qa.hashkeymerchant.com` is well-suited for hackathon development.

**Suggestions:**

- A TypeScript SDK with typed request/response models would accelerate integration.
- Webhook replay / retry visibility in the merchant portal would help debug integration issues.
- Standardized error codes across all endpoints would simplify client error handling.
- A sandbox faucet for HSK testnet tokens tied to the HSP merchant portal would help bootstrap new integrators.

---

## Links

- **GitHub**: https://github.com/brucexu-eth/safeflow-evm
- **Demo Video**: [TO BE ADDED]
- **Chain**: HashKey Chain Testnet (133) / Mainnet (177)
- **HSP**: HashKey Settlement Protocol integration
