# Frontend Network Runtime Notes

## Purpose

This document summarizes the frontend runtime design for HashKey Chain support: wallet chain switching, modal layout, local fork coexistence, and the runtime badge that surfaces the current execution environment.

---

## Background

Frontend network runtime work addressed three closely related UX issues:

1. The payment/session modal opened from AI Assistant recommendations was visually misplaced instead of appearing centered as an overlay.
2. The payment flow only reminded the user to switch chain instead of actively helping the wallet switch.
3. Local development uses an anvil fork of HashKey Testnet, which creates wallet conflicts if the fork reuses chain ID 133 — the wallet can't distinguish real HashKey Testnet from the local fork.

---

## Completed Changes

### 1. Fixed modal overlay positioning

**Problem**

The payment modal was rendered with Tailwind's `fixed` utility, but a global CSS rule overrode `.fixed` to `position: relative`. That caused the modal to fall back into normal document flow and appear pushed to the lower part of the page.

**Fix**

Removed the global `.fixed` override from `web/src/app/globals.css` while keeping the layering rules for `#app-root`, `main`, `header`, and `footer`.

**Result**

The payment/session modal now renders as a real viewport overlay again and stays centered.

---

### 2. Actionable wallet chain switching

**Problem**

The payment flow previously displayed a passive warning such as:

`Please switch to HashKey Chain Testnet (Chain 133) to continue.`

That is weaker UX than mature wallet integrations, which trigger wallet switching directly and can also help add the missing chain definition.

**Fix**

`web/src/lib/useSwitchOrAddChain.ts` encapsulates:

- `wagmi` `useSwitchChain()` as the primary action
- `wallet_addEthereumChain` fallback when the wallet doesn't know the target chain
- Standardized unsupported-network handling
- Standardized wallet-rejection messaging

`web/src/components/DepositModal.tsx`, `SessionManager.tsx`, and other flows all consume the shared hook.

**Result**

Chain switching now behaves like a production wallet integration: attempts switch automatically, adds the chain if missing, and surfaces clear errors on rejection.

---

### 3. HashKey local fork coexistence

**Problem**

Local testing uses `http://127.0.0.1:8546` as an anvil fork of HashKey Testnet. If the fork reuses chain ID `133`, the wallet can't tell real HashKey Testnet from the local fork, making network switching ambiguous.

**Root Cause**

Early versions treated `connectedChainId` as both the source chain for API context and the execution chain for writes. That assumption works on public networks but breaks for local forks.

**Fix**

`web/src/lib/chains.ts` provides:

- Built-in chain registry for HashKey Testnet (133), Mainnet (177), and Local Fork (31338)
- `localHashKeyForkChain` defined via `defineChain()` with distinct RPC URL and name
- `walletChains` array dynamically including the fork when `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED=true`
- Validation that the local fork chain ID doesn't conflict with built-in HashKey chains

`web/src/lib/mode.ts` provides:

- `isHashKeyChain(chainId)` — true for 133, 177, or the configured local fork chain
- `getModeForChain(chainId)` — returns `hashkey` for any HashKey chain

`web/src/app/providers.tsx` consumes the shared chain registry, so RainbowKit and wagmi expose all three HashKey networks in wallet UIs.

**Result**

The UI correctly distinguishes real HashKey Testnet from the local fork. The wallet lists both as separate networks. SessionCap writes, deposits, and payments execute against whichever chain is currently connected.

---

### 4. Runtime badge for HashKey network mode

**Problem**

Operators could lose track of whether the app was pointed at production HashKey Mainnet, Testnet, or the local fork.

**Fix**

The page shell reads runtime state from `web/src/lib/chains.ts` and `web/src/lib/mode.ts` and renders:

- A header status chip on `sm+` breakpoints showing the current chain name
- A footer runtime label across all breakpoints with the RPC host in a tooltip for local fork

Chain name examples: `HashKey Testnet`, `HashKey Mainnet`, `HashKey Fork Local`.

**Result**

The current runtime mode is obvious during demos, QA, and local testing.

---

### 5. Chain-based mode switching in UI

**Problem**

Originally the UI mode was driven by a single `NEXT_PUBLIC_SAFEFLOW_MODE` environment variable. This forced the operator to manually sync env and chain, which was error-prone.

**Fix**

`web/src/app/page-client.tsx` now reads the connected chain via `useChainId()` and derives the UI mode through `getModeForChain(chainId)`. When the wallet switches to a HashKey chain, the HashKey tabs (Vault, Sessions, History, HSP) activate automatically. Tab selection also resets appropriately on mode change.

**Result**

Connecting a wallet to HashKey Chain instantly surfaces the HashKey payment UI. No env variable changes or page reload required.

---

## Current File Layout

### Core runtime modules

| File | Purpose |
|------|---------|
| `web/src/lib/mode.ts` | Chain-based HashKey mode detection + fork detection |
| `web/src/lib/chains.ts` | HashKey testnet/mainnet/fork definitions, walletChains builder |
| `web/src/lib/contracts.ts` | `SafeFlowVaultHashKey` ABI + chain-aware address resolution |
| `web/src/lib/useSwitchOrAddChain.ts` | Shared chain switch/add hook |

### UI shell

| File | Purpose |
|------|---------|
| `web/src/app/providers.tsx` | wagmi + RainbowKit config consuming dynamic `walletChains` |
| `web/src/app/page-client.tsx` | Chain-driven tab selection |
| `web/src/app/globals.css` | Layout + overlay layering |

### Components using chain runtime

| File | Consumes |
|------|----------|
| `web/src/components/DepositModal.tsx` | `useSwitchOrAddChain`, explorer URL helper |
| `web/src/components/SessionManager.tsx` | `useSwitchOrAddChain`, contract helpers |
| `web/src/components/PaymentHistory.tsx` | Explorer URL helper for tx links |

---

## HashKey Chain Runtime Reference

### Networks

| Network | Chain ID | RPC | Role |
|---------|----------|-----|------|
| HashKey Mainnet | 177 | `https://mainnet.hsk.xyz` | Production |
| HashKey Testnet | 133 | `https://testnet.hsk.xyz` | Development |
| HashKey Fork Local | 31338 | `http://127.0.0.1:8546` | Local testing |

### Environment Variables

Local fork activation:

```env
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED=true
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID=31338
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL=http://127.0.0.1:8546
NEXT_PUBLIC_HASHKEY_LOCAL_FORK_NAME=HashKey Fork Local
# NEXT_PUBLIC_HASHKEY_LOCAL_FORK_EXPLORER_URL=
```

HashKey chain global activation:

```env
NEXT_PUBLIC_HASHKEY_ENABLED=true
NEXT_PUBLIC_HASHKEY_CONTRACT=0xDeployedAddress
NEXT_PUBLIC_HASHKEY_CHAIN_ID=133
```

### Why reusing `133` is a problem

If localhost fork and real HashKey Testnet both claim chain ID `133`:

- Wallet network management becomes ambiguous
- The user cannot reliably distinguish real Testnet from local fork
- Wallet-add / wallet-switch behavior becomes confusing
- The frontend loses the ability to express the distinction between source-chain semantics and local execution semantics

For this reason, the runtime expects a dedicated local fork chain ID such as `31338`.

### Starting a local fork

```bash
# One-click: fork + deploy + configure + state persistence
./scripts/start-hashkey-fork.sh

# Fresh state
./scripts/start-hashkey-fork.sh --fresh
```

---

## Chain Switching Utility

The switch-chain / add-chain flow is owned by the shared hook:

**File:** `web/src/lib/useSwitchOrAddChain.ts`

It centralizes:

- `wagmi` switch-chain execution
- `wallet_addEthereumChain` fallback
- Standardized unsupported-network handling
- Standardized wallet-rejection messaging

All flows that need to change the wallet network consume this hook rather than embedding the logic directly.

---

## Validation Status

The touched frontend files were checked directly with ESLint:

```bash
npx eslint \
  src/app/page-client.tsx \
  src/app/providers.tsx \
  src/lib/mode.ts \
  src/lib/chains.ts \
  src/lib/contracts.ts \
  src/lib/useSwitchOrAddChain.ts
```

Status:

- The files touched by this work pass ESLint
- The repository still contains unrelated historical lint issues outside this scope

The deploy helper can also be smoke-tested without mutating your main env file by passing a disposable env path:

```bash
node scripts/deploy-contract-and-configure-web.mjs \
  --network local_hashkey_fork \
  --sync-hashkey-fork-env \
  --web-env web/.env.localfork
```

---

## Short Summary

The frontend now:

- Opens modals correctly as centered overlays
- Helps the wallet switch/add HashKey chains instead of only warning
- Supports HashKey Testnet, Mainnet, and local fork as distinct execution chains
- Exposes the current runtime mode directly in the app shell
- Activates HashKey payment UI automatically when the wallet connects to any HashKey chain
- Can deploy/configure the local fork workflow through `scripts/start-hashkey-fork.sh` instead of manual env editing
