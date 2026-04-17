import { defineChain, type Chain } from 'viem';
import { arbitrum, arbitrumSepolia, base, baseSepolia, mainnet } from 'wagmi/chains';
import {
  HASHKEY_ENABLED,
  HASHKEY_ONLY,
  HASHKEY_LOCAL_FORK_ENABLED,
  HASHKEY_LOCAL_FORK_CHAIN_ID,
  HASHKEY_LOCAL_FORK_RPC_URL,
  HASHKEY_LOCAL_FORK_NAME,
  HASHKEY_LOCAL_FORK_EXPLORER_URL,
  HASHKEY_TESTNET_CHAIN_ID,
  HASHKEY_MAINNET_CHAIN_ID,
  HASHKEY_CHAIN_ID,
} from './mode';

const BUILTIN_CHAINS = [base, baseSepolia, arbitrum, arbitrumSepolia, mainnet] as const;

// ─── HashKey Chain definitions ──────────────────────────────────────

export const hashkeyTestnet = defineChain({
  id: HASHKEY_TESTNET_CHAIN_ID,
  name: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet.hsk.xyz'] },
    public: { http: ['https://testnet.hsk.xyz'] },
  },
  blockExplorers: {
    default: {
      name: 'HashKey Explorer',
      url: 'https://testnet-explorer.hsk.xyz',
    },
  },
  testnet: true,
});

export const hashkeyMainnet = defineChain({
  id: HASHKEY_MAINNET_CHAIN_ID,
  name: 'HashKey Chain',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://mainnet.hsk.xyz'] },
    public: { http: ['https://mainnet.hsk.xyz'] },
  },
  blockExplorers: {
    default: {
      name: 'HashKey Explorer',
      url: 'https://hashkey.blockscout.com',
    },
  },
});

// ─── HashKey local fork chain ────────────────────────────────────

export const localHashKeyForkChain = defineChain({
  id: HASHKEY_LOCAL_FORK_CHAIN_ID,
  name: HASHKEY_LOCAL_FORK_NAME,
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: {
    default: { http: [HASHKEY_LOCAL_FORK_RPC_URL] },
    public: { http: [HASHKEY_LOCAL_FORK_RPC_URL] },
  },
  blockExplorers: HASHKEY_LOCAL_FORK_EXPLORER_URL
    ? { default: { name: 'Local Explorer', url: HASHKEY_LOCAL_FORK_EXPLORER_URL } }
    : undefined,
});

function buildHashKeyChains(): Chain[] {
  const ordered: Chain[] = HASHKEY_CHAIN_ID === HASHKEY_MAINNET_CHAIN_ID
    ? [hashkeyMainnet, hashkeyTestnet]
    : [hashkeyTestnet, hashkeyMainnet];
  if (HASHKEY_LOCAL_FORK_ENABLED) {
    return [localHashKeyForkChain, ...ordered];
  }
  return ordered;
}

const HASHKEY_CHAINS: Chain[] = buildHashKeyChains();

type WalletChains = [Chain, ...Chain[]];

const localForkRequested = process.env.NEXT_PUBLIC_LOCAL_FORK_ENABLED === 'true';
const localForkChainId = Number(process.env.NEXT_PUBLIC_LOCAL_FORK_CHAIN_ID || '31337');
const localForkSourceChainId = Number(process.env.NEXT_PUBLIC_LOCAL_FORK_SOURCE_CHAIN_ID || String(base.id));
const localForkRpcUrl = process.env.NEXT_PUBLIC_LOCAL_FORK_RPC_URL || 'http://127.0.0.1:8545';
const localForkName = process.env.NEXT_PUBLIC_LOCAL_FORK_NAME || 'Base Fork Local';
const localForkExplorerUrl = process.env.NEXT_PUBLIC_LOCAL_FORK_EXPLORER_URL || '';
const localForkChainIdConflicts = BUILTIN_CHAINS.some(chain => chain.id === localForkChainId);

export const LOCAL_FORK_CONFIG_ERROR = localForkRequested && localForkChainIdConflicts
  ? `NEXT_PUBLIC_LOCAL_FORK_CHAIN_ID=${localForkChainId} conflicts with a built-in wallet chain. Use a dedicated local chain ID such as 31337 for your Base fork.`
  : null;

export const LOCAL_FORK_ENABLED = localForkRequested && !localForkChainIdConflicts;
export const LOCAL_FORK_CHAIN_ID = localForkChainId;
export const LOCAL_FORK_SOURCE_CHAIN_ID = localForkSourceChainId;
export const LOCAL_FORK_NAME = localForkName;
export const LOCAL_FORK_RPC_URL = localForkRpcUrl;

export const localBaseForkChain = defineChain({
  id: localForkChainId,
  name: localForkName,
  nativeCurrency: base.nativeCurrency,
  rpcUrls: {
    default: { http: [localForkRpcUrl] },
    public: { http: [localForkRpcUrl] },
  },
  blockExplorers: localForkExplorerUrl
    ? {
        default: {
          name: 'Local Explorer',
          url: localForkExplorerUrl,
        },
      }
    : undefined,
});

function buildWalletChains(): WalletChains {
  const chains: Chain[] = [];

  // HashKey-only deployment: expose nothing but HashKey chains so the
  // wallet defaults to HashKey and the UI starts in HashKey mode.
  if (HASHKEY_ONLY) {
    chains.push(...HASHKEY_CHAINS);
    return chains as WalletChains;
  }

  // Base local fork (if enabled)
  if (LOCAL_FORK_ENABLED) chains.push(localBaseForkChain);

  // HashKey chains (if enabled via flag or fork)
  if (HASHKEY_ENABLED || HASHKEY_LOCAL_FORK_ENABLED) {
    chains.push(...HASHKEY_CHAINS);
  }

  // Built-in DeFi chains always available
  chains.push(...BUILTIN_CHAINS);

  return chains as WalletChains;
}

export const walletChains: WalletChains = buildWalletChains();

export function getSupportedWalletChain(chainId: number): Chain | undefined {
  return walletChains.find(chain => chain.id === chainId);
}

// The chain where the SafeFlow contract is deployed (non-fork mode)
export const SAFEFLOW_CHAIN_ID: number | undefined = process.env.NEXT_PUBLIC_SAFEFLOW_CHAIN_ID
  ? Number(process.env.NEXT_PUBLIC_SAFEFLOW_CHAIN_ID)
  : undefined;

export function getExecutionChainId(vaultChainId: number): number {
  if (LOCAL_FORK_ENABLED && vaultChainId === LOCAL_FORK_SOURCE_CHAIN_ID) {
    return localBaseForkChain.id;
  }
  return vaultChainId;
}

export function isLocalForkExecution(vaultChainId: number): boolean {
  return LOCAL_FORK_ENABLED && vaultChainId === LOCAL_FORK_SOURCE_CHAIN_ID;
}

export function getExecutionChainDisplayName(vaultNetwork: string, vaultChainId: number): string {
  if (isLocalForkExecution(vaultChainId)) {
    return localBaseForkChain.name;
  }
  return vaultNetwork || `Chain ${vaultChainId}`;
}

export function getChainExplorerTxUrl(chainId: number, txHash?: `0x${string}`): string | null {
  if (!txHash) return null;

  const chain = getSupportedWalletChain(chainId);
  const explorerUrl = chain?.blockExplorers?.default?.url;
  if (!explorerUrl) return null;

  return `${explorerUrl.replace(/\/$/, '')}/tx/${txHash}`;
}

export function getChainExplorerAddressUrl(chainId: number, address?: `0x${string}`): string | null {
  if (!address) return null;

  const chain = getSupportedWalletChain(chainId);
  const explorerUrl = chain?.blockExplorers?.default?.url;
  if (!explorerUrl) return null;

  return `${explorerUrl.replace(/\/$/, '')}/address/${address}`;
}

function getRpcHostLabel(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return rpcUrl;
  }
}

export function getAppRuntimeMode() {
  const executionChain = LOCAL_FORK_ENABLED ? localBaseForkChain : base;
  const sourceChain = getSupportedWalletChain(LOCAL_FORK_SOURCE_CHAIN_ID) || base;

  return {
    isLocalFork: LOCAL_FORK_ENABLED,
    executionChainId: executionChain.id,
    executionChainName: executionChain.name,
    sourceChainId: sourceChain.id,
    sourceChainName: sourceChain.name,
    rpcHostLabel: LOCAL_FORK_ENABLED ? getRpcHostLabel(LOCAL_FORK_RPC_URL) : null,
  };
}
