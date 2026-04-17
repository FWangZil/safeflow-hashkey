# SafeFlow — Demo Video Script

> Target length: 3-4 minutes
> Style: Screen recording with voiceover, natural pacing
> Focus: AI payment agent on HashKey Chain with HSP integration

---

## Opening (0:00 - 0:20)

**[Screen: Dark mode landing page, SafeFlow logo animates in]**

Voiceover:

> "What if executing payments on-chain was as easy as having a conversation? Meet SafeFlow — an AI payment agent on HashKey Chain, integrated with the HashKey Settlement Protocol, with on-chain spending limits that keep your funds safe."

**[Screen: Wallet connects to HashKey Fork Local — UI switches to HashKey mode, showing Vault / Sessions / History / HSP tabs]**

---

## Scene 1: AI Chat Payment (0:20 - 1:20)

**[Screen: Click on "Chat" tab, chat interface appears with welcome state]**

Voiceover:

> "Start by telling the AI what you want — in plain English or Chinese."

**[Screen: Type "Pay 100 USDT to merchant 0x1234..." and hit send]**

Voiceover:

> "The agent understands your intent and creates a PaymentIntent via the HashKey Settlement Protocol."

**[Screen: Show loading state with "Creating HSP order...", then result appears with intent card showing recipient, amount, status]**

Voiceover:

> "The Producer API signs the request with the merchant's secp256k1 key, calls HSP, and creates a compliant PaymentIntent on HashKey Chain."

**[Screen: Switch to "History" tab, show the newly created intent in pending state]**

Voiceover:

> "The payment is now queued for the AI agent to claim and execute."

**[Screen: Switch language to Chinese using the language toggle in the header]**

Voiceover:

> "Full internationalization support — switch between English and Chinese instantly."

---

## Scene 2: Agent Execution on HashKey Chain (1:20 - 2:10)

**[Screen: In a terminal, show the agent E2E runner claiming and executing the intent]**

Voiceover:

> "The AI agent polls the Producer API, claims the intent, and executes the payment on HashKey Chain."

**[Screen: Show the intent status transitioning: pending → claimed → executed → confirmed]**

Voiceover:

> "Each status transition is driven by real on-chain activity. The agent calls SafeFlowVaultHashKey.executePayment, and the contract enforces the SessionCap spending limits before allowing the transfer."

**[Screen: Click on the intent to view details with tx hash, block number, evidence hash]**

Voiceover:

> "Every execution produces a transaction hash on HashKey Chain and an evidence hash linking back to the AI reasoning."

**[Screen: Open HashKey Testnet explorer link, show the on-chain transaction with PaymentExecuted event]**

Voiceover:

> "Here it is on the HashKey Chain explorer — the PaymentExecuted event with all the enforcement metadata."

---

## Scene 3: On-Chain Security — SessionCap (2:10 - 2:55)

**[Screen: Click on "Sessions" tab]**

Voiceover:

> "Here's what makes SafeFlow different — the SessionCap system."

**[Screen: Point camera at the spending limits panel — Max Per Interval, Max Total, Interval]**

Voiceover:

> "Before the AI can execute any payment, you set strict spending limits — maximum spend per time interval, maximum total spend, and when the session expires."

**[Screen: Show the Agent Configuration panel — Agent Address, Expiry, Create Session Cap button]**

Voiceover:

> "These limits are enforced on-chain by the SafeFlowVaultHashKey contract. Not by the AI. Not by our servers. By immutable Solidity logic on HashKey Chain."

**[Screen: Brief flash of the Solidity contract code — show the SessionCap struct and the executePayment function with its checks]**

Voiceover:

> "The contract checks every payment against the session cap before execution. Exceeds the interval limit? Reverts. Exceeds the total cap? Reverts. Session expired? Reverts. Period."

---

## Scene 4: Architecture and HSP Integration (2:55 - 3:35)

**[Screen: Show a simple architecture diagram — user → chat → Producer API → HSP → agent → SafeFlowVaultHashKey → HashKey Chain → HSP webhook]**

Voiceover:

> "Here's how the pieces fit together."
>
> "You talk to the AI agent. The Producer API creates a PaymentIntent on the HashKey Settlement Protocol. The agent claims it, executes on HashKey Chain via SafeFlowVaultHashKey, and HSP confirms settlement via webhook. An audit trail with evidence hashing records every step."

**[Screen: Show the terminal — run `forge test` to demonstrate passing tests]**

Voiceover:

> "The smart contract is built with Solidity 0.8.24 and Foundry, with comprehensive tests. The frontend is Next.js 16 with full light and dark mode support."

**[Screen: Show the HSP Status tab confirming healthy connection]**

Voiceover:

> "The HSP integration panel shows live configuration health — credentials, signing key, merchant address, all verified."

---

## Scene 5: Local Fork One-Click Setup & Closing (3:35 - 4:00)

**[Screen: In terminal, run `./scripts/start-hashkey-fork.sh`]**

Voiceover:

> "Developers can spin up a complete HashKey local environment with one command — anvil fork, contract deployment, and web env configuration, all automated. State even persists across restarts."

**[Screen: Click the theme toggle to switch to light mode, show the app in light theme]**

Voiceover:

> "SafeFlow works beautifully in both light and dark mode."

**[Screen: Switch back to dark mode, zoom out to show the full app]**

Voiceover:

> "SafeFlow — AI payment agent on HashKey Chain, powered by the HashKey Settlement Protocol, with zero-trust on-chain security."

**[Screen: Show GitHub repo URL and HashKey Chain tags]**

> "Check us out on GitHub. Thanks for watching."

---

## Production Notes

### Setup before recording

1. Start local HashKey fork: `./scripts/start-hashkey-fork.sh`
2. Clear browser data for fresh state
3. Set app to dark mode
4. Have wallet connected to HashKey Fork Local (31338) with test balance
5. Ensure HSP credentials are configured in `.env.local`
6. Close unnecessary browser tabs

### Key moments to get right

- The first AI payment response with intent card (most impressive visual moment)
- Agent execution transition from pending → confirmed in real-time
- HashKey explorer link showing the on-chain PaymentExecuted event
- Sessions tab showing SessionCap enforcement
- HSP Status panel with live health indicators

### Recording tips

- Use 1920x1080 or higher resolution
- Record at 30fps minimum
- Use system audio capture if showing any sound effects
- Keep mouse movements slow and deliberate
- Pause briefly after each click to let the audience register what happened

### If things go wrong

- If HSP API is slow, trim the wait in editing
- If wallet connection fails, pre-connect to HashKey Fork Local before recording
- Have a backup screenshot of a confirmed intent if live agent execution fails
- Keep a pre-recorded clip of the terminal agent E2E run as fallback
