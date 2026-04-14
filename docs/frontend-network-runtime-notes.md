# Frontend Network Runtime Notes

## Purpose

This document summarizes the recent frontend runtime fixes around modal layout, wallet chain switching, and localhost Base fork support. It also records the follow-up options that can be selected next, along with the rationale and recommended order.

---

## Background

Recent frontend work focused on two closely related UX/runtime issues:

1. The vault detail / deposit modal opened from AI Assistant recommendations was visually misplaced instead of appearing centered as an overlay.
2. The deposit flow only reminded the user to switch chain, instead of actually helping the wallet switch to the correct network.
3. Local testing now uses `localhost:8545` with a Base fork, which creates a conflict if the fork reuses Base mainnet chain id `8453` inside the wallet.

---

## Completed Changes

### 1. Fixed modal overlay positioning

**Problem**

The vault deposit modal was rendered with Tailwind's `fixed` utility, but a global CSS rule overrode `.fixed` to `position: relative`. That caused the modal to fall back into normal document flow and appear pushed to the lower part of the page.

**Fix**

Removed the global `.fixed` override from `web/src/app/globals.css` while keeping the layering rules for `#app-root`, `main`, `header`, and `footer`.

**Result**

The vault modal now renders as a real viewport overlay again and stays centered when opened from the AI Assistant recommendation cards.

---

### 2. Upgraded wrong-chain reminder into a real wallet action

**Problem**

The deposit flow previously displayed a passive warning such as:

`Please switch to Base (Chain 8453) to deposit.`

That is weaker than the UX provided by mature DeFi products, which usually trigger wallet switching directly and often help add the missing chain as well.

**Fix**

`web/src/components/DepositModal.tsx` now:

- Detects when the connected wallet is on the wrong chain.
- Shows an actionable switch button instead of a passive warning.
- Calls `wagmi` `useSwitchChain()` first.
- Falls back to `wallet_addEthereumChain` when the wallet does not yet know the target chain.
- Displays explicit user-facing error messages when the wallet rejects or fails the request.

**Result**

The deposit modal now behaves more like a production DeFi app: it attempts to do the chain switch for the user instead of pushing the task back to the user manually.

---

### 3. Added localhost Base fork support without colliding with real Base

**Problem**

Local testing uses `localhost:8545` as a Base fork. If the fork reuses chain id `8453`, wallet UX becomes ambiguous because the wallet already knows real Base as `8453`. In practice this makes real Base and local Base fork collide in the wallet network layer.

**Root Cause**

The frontend originally treated `vault.chainId` as both:

- the source chain for vault data / quote context, and
- the execution chain that the wallet must connect to

That assumption works on public networks, but it breaks for local fork testing.

**Fix**

A shared chain runtime helper was introduced at `web/src/lib/chains.ts`.

It now provides:

- Built-in wallet chain registry for production/testnet chains.
- Optional local fork chain definition.
- `vaultChainId -> executionChainId` mapping.
- Execution chain display name resolution.
- Explorer URL resolution based on the actual execution chain.
- Validation that the local fork chain id does not conflict with built-in chains.

`web/src/app/providers.tsx` now consumes this shared chain registry, so RainbowKit and wagmi can expose the local fork network in wallet UIs when enabled.

`web/src/components/DepositModal.tsx` now separates:

- **Vault source chain**: still used for quote context and vault metadata.
- **Execution chain**: used for wallet switching, public client, contract writes, and success-state explorer links.

**Result**

The UI can keep showing Base vaults while executing against a local fork network such as `Base Fork Local (31337)`.

---

### 4. Added `local_base_fork` deploy/configure workflow

**Problem**

The frontend runtime could already execute against localhost, but the deployment helper script still only treated public/test networks as first-class targets.

**Fix**

`scripts/deploy-contract-and-configure-web.mjs` now supports `--network local_base_fork`.

It provides two modes:

- Default mode: deploy or reuse the contract and only update `NEXT_PUBLIC_SAFEFLOW_CONTRACT`.
- Sync mode: when `--sync-local-fork-env` is passed, also write the full `NEXT_PUBLIC_LOCAL_FORK_*` runtime bundle into the selected web env file.

The script also records local fork deployment metadata separately under `docs/deployments/latest.local_base_fork.json`, including execution-chain identity and whether runtime env synchronization was requested.

**Result**

Local fork deployment/configuration is now a first-class workflow instead of a manual follow-up step.

---

### 5. Added a visible runtime badge for Base vs local fork

**Problem**

Even after splitting source chain from execution chain, operators could still lose track of whether the app was currently pointed at public Base or a local Base fork.

**Fix**

The page shell now reads runtime state from `web/src/lib/chains.ts` and renders:

- A header status chip on `sm+` breakpoints.
- A footer runtime label across all breakpoints.

Both states distinguish `Base Mainnet` from `Base Fork Local`, and the local mode exposes the RPC host in a native tooltip.

**Result**

The current runtime mode is now obvious during demos, QA, and local testing.

---

## Current File Changes

### Updated files

- `web/src/app/globals.css`
- `web/src/app/page.tsx`
- `web/src/app/providers.tsx`
- `web/src/components/DepositModal.tsx`
- `web/src/i18n/en.json`
- `web/src/i18n/zh.json`
- `web/.env.example`
- `scripts/deploy-contract-and-configure-web.mjs`

### New file

- `web/src/lib/chains.ts`

---

## Local Fork Configuration

Add the following values to `web/.env` when testing against a local Base fork:

```dotenv
NEXT_PUBLIC_LOCAL_FORK_ENABLED=true
NEXT_PUBLIC_LOCAL_FORK_CHAIN_ID=31337
NEXT_PUBLIC_LOCAL_FORK_SOURCE_CHAIN_ID=8453
NEXT_PUBLIC_LOCAL_FORK_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_LOCAL_FORK_NAME=Base Fork Local
```

Optional:

```dotenv
NEXT_PUBLIC_LOCAL_FORK_EXPLORER_URL=
```

If you do not run a local block explorer, the field can stay empty.

### Deployment helper usage

Contract-only update:

```bash
node scripts/deploy-contract-and-configure-web.mjs --network local_base_fork
```

Contract update plus full local runtime env sync:

```bash
node scripts/deploy-contract-and-configure-web.mjs --network local_base_fork --sync-local-fork-env
```

---

## Recommended Local Node Setup

When starting a local Base fork, do **not** reuse `8453` as the wallet-facing chain id.

Recommended approach:

```bash
anvil --fork-url $BASE_RPC_URL --chain-id 31337
```

### Why this is recommended

- Real Base remains `8453`.
- Local Base fork becomes a distinct chain, e.g. `31337`.
- Wallets can show both networks without ambiguity.
- The app can still interpret Base vaults as Base-origin assets while executing on the local fork.

---

## Why reusing `8453` is a problem

If localhost fork and real Base both claim chain id `8453`:

- Wallet network management becomes ambiguous.
- The user cannot reliably distinguish real Base from local Base fork.
- Wallet-add / wallet-switch behavior may become confusing or inconsistent.
- The frontend loses the ability to express a safe distinction between source-chain semantics and local execution semantics.

For this reason, the runtime now treats a local Base fork as a separate execution chain and expects a distinct chain id.

---

## Current Runtime Model

### Source chain vs execution chain

For Base fork local testing, the runtime model is now:

- **Source chain**: `8453` (Base)
- **Execution chain**: `31337` (or whichever dedicated local chain id is configured)

This means:

- Vault discovery and quote context still understand the asset as Base-native.
- Wallet switching and contract execution happen on the local fork.
- Success links only go to an explorer if the execution chain has one configured.
- If no explorer exists, the UI falls back to showing the tx hash.

---

## Validation Status

The changed frontend files were checked directly with:

```bash
npx eslint src/app/page.tsx src/app/providers.tsx src/components/DepositModal.tsx src/lib/chains.ts
```

Status:

- The files touched by this work pass ESLint.
- The repository still contains unrelated historical lint issues outside the scope of this change.

The deploy helper can also be smoke-tested without mutating your main env file by passing a disposable env path:

```bash
node scripts/deploy-contract-and-configure-web.mjs --network local_base_fork --web-env web/.env.localfork
node scripts/deploy-contract-and-configure-web.mjs --network local_base_fork --sync-local-fork-env --web-env web/.env.localfork
```

---

## Reusable Chain Switching

The switch-chain / add-chain flow has now been extracted into a shared frontend hook:

- `web/src/lib/useSwitchOrAddChain.ts`

It centralizes:

- `wagmi` switch-chain execution
- `wallet_addEthereumChain` fallback
- standardized unsupported-network handling
- standardized wallet-rejection messaging

`web/src/components/DepositModal.tsx` now consumes this hook instead of owning the wallet network mutation logic directly.

`web/src/components/SessionManager.tsx` also uses the same hook for wallet-creation and SessionCap management flows, so Settings now follows the same local fork chain-switch behavior as the deposit modal.

---

## Current Decision Record

### Selected / completed now

- Fix modal overlay centering.
- Replace passive wrong-chain warning with actionable wallet switching.
- Support local Base fork as a distinct execution chain in frontend runtime.
- Add `local_base_fork` support to the deploy/configure helper script.
- Add a visible UI runtime badge for `Base Mainnet` vs `Base Fork Local`.
- Extract chain switching into a reusable frontend hook.

### Not implemented yet

- No additional local-fork runtime follow-up is currently required for correctness.

---

## Short Summary

The frontend now:

- Opens vault deposit modals correctly as centered overlays.
- Helps the wallet switch/add the target chain instead of only showing a reminder.
- Supports localhost Base fork testing safely by separating Base source-chain semantics from local execution-chain behavior.
- Exposes the current runtime mode directly in the app shell.
- Can deploy/configure the local fork workflow through the helper script instead of manual env editing.

This removes the wallet conflict with real Base as long as the local fork uses a dedicated chain id such as `31337`.
