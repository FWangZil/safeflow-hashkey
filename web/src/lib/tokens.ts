import { isHashKeyChain } from './mode';

// LI.FI convention for native ETH (across all EVM chains)
export const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
  isNative?: boolean;
}

// HashKey Chain native token address (LI.FI convention for native tokens)
export const HSK_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const COMMON_TOKENS_BY_CHAIN: Record<number, TokenInfo[]> = {
  // Ethereum Mainnet
  1: [
    { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Ethereum', isNative: true },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27ead9083C756Cc2', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
  ],
  // Base
  8453: [
    { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Ethereum', isNative: true },
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
  ],
  // Arbitrum One
  42161: [
    { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Ethereum', isNative: true },
    { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
  ],
  // Base Sepolia
  84532: [
    { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Ethereum', isNative: true },
    { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  ],
  // HashKey Chain Testnet
  133: [
    { address: HSK_ADDRESS, symbol: 'HSK', decimals: 18, name: 'HashKey Token', isNative: true },
  ],
  // HashKey Chain Mainnet
  177: [
    { address: HSK_ADDRESS, symbol: 'HSK', decimals: 18, name: 'HashKey Token', isNative: true },
  ],
};

/**
 * Returns common swap-source tokens for a chain, excluding the vault's underlying token
 * so we don't offer "USDC → USDC" swaps.
 * Falls back to HashKey tokens for HashKey forks, Base tokens for other unknowns.
 */
export function getSwapTokensForChain(chainId: number, excludeAddress?: string): TokenInfo[] {
  let tokens = COMMON_TOKENS_BY_CHAIN[chainId];
  if (!tokens) {
    tokens = isHashKeyChain(chainId)
      ? COMMON_TOKENS_BY_CHAIN[133]
      : COMMON_TOKENS_BY_CHAIN[8453];
  }
  if (!excludeAddress) return tokens;
  return tokens.filter(t => t.address.toLowerCase() !== excludeAddress.toLowerCase());
}
