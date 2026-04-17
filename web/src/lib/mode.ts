export type SafeFlowMode = 'defi' | 'hashkey';

// ─── HashKey Chain IDs ────────────────────────────────────────────
export const HASHKEY_TESTNET_CHAIN_ID = 133;
export const HASHKEY_MAINNET_CHAIN_ID = 177;

// ─── HashKey Enabled flag ─────────────────────────────────────────
// When true, HashKey chains appear in the wallet picker.
// The actual mode is determined at runtime by the connected chain.
export const HASHKEY_ENABLED =
  process.env.NEXT_PUBLIC_HASHKEY_ENABLED === 'true';

// ─── HashKey local fork ───────────────────────────────────────────
const hashkeyForkRequested =
  process.env.NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED === 'true';

export const HASHKEY_LOCAL_FORK_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID || '31338',
);
export const HASHKEY_LOCAL_FORK_RPC_URL =
  process.env.NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL || 'http://127.0.0.1:8546';
export const HASHKEY_LOCAL_FORK_NAME =
  process.env.NEXT_PUBLIC_HASHKEY_LOCAL_FORK_NAME || 'HashKey Fork Local';
export const HASHKEY_LOCAL_FORK_EXPLORER_URL =
  process.env.NEXT_PUBLIC_HASHKEY_LOCAL_FORK_EXPLORER_URL || '';

// Treat fork-enabled as implicitly hashkey-enabled
export const HASHKEY_LOCAL_FORK_ENABLED = hashkeyForkRequested;

// The canonical set of chain IDs that trigger HashKey mode
const HASHKEY_CHAIN_IDS = new Set<number>([
  HASHKEY_TESTNET_CHAIN_ID,
  HASHKEY_MAINNET_CHAIN_ID,
  ...(HASHKEY_LOCAL_FORK_ENABLED ? [HASHKEY_LOCAL_FORK_CHAIN_ID] : []),
]);

// ─── Runtime mode helpers ─────────────────────────────────────────

/** Check if a given chain ID belongs to HashKey (including local fork). */
export function isHashKeyChain(chainId: number | undefined): boolean {
  if (!chainId) return false;
  return HASHKEY_CHAIN_IDS.has(chainId);
}

/**
 * Legacy zero-arg helper — returns true when HashKey is enabled at build time.
 * Use `isHashKeyChain(chainId)` for runtime chain-based detection.
 */
export function isHashKeyMode(): boolean {
  return HASHKEY_ENABLED || HASHKEY_LOCAL_FORK_ENABLED;
}

export function isDefiMode(): boolean {
  return !isHashKeyMode();
}

/** Determine mode from the connected chain ID. */
export function getModeForChain(chainId: number | undefined): SafeFlowMode {
  return isHashKeyChain(chainId) ? 'hashkey' : 'defi';
}

/** Primary HashKey chain id (fork > env > testnet default). */
export const HASHKEY_CHAIN_ID: number = HASHKEY_LOCAL_FORK_ENABLED
  ? HASHKEY_LOCAL_FORK_CHAIN_ID
  : Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID || String(HASHKEY_TESTNET_CHAIN_ID));
