import { defineChain, type Chain } from 'viem';
import { arbitrum, arbitrumSepolia, base, baseSepolia, mainnet } from 'wagmi/chains';

const BUILTIN_CHAINS = [base, baseSepolia, arbitrum, arbitrumSepolia, mainnet] as const;

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

export const walletChains: WalletChains = LOCAL_FORK_ENABLED
  ? [localBaseForkChain, ...BUILTIN_CHAINS]
  : [...BUILTIN_CHAINS];

export function getSupportedWalletChain(chainId: number): Chain | undefined {
  return walletChains.find(chain => chain.id === chainId);
}

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
