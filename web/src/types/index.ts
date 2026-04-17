export interface EarnVault {
  address: string;
  name: string;
  chainId: number;
  network: string;
  protocol: {
    name: string;
    url?: string;
    logoUrl?: string;
  };
  tags: string[];
  isTransactional: boolean;
  underlyingTokens: {
    address: string;
    symbol: string;
    decimals: number;
    name: string;
    logoUrl?: string;
  }[];
  analytics: {
    apy: {
      total: number;
      base: number;
      reward: number | null;
    };
    apy1d?: number | null;
    apy7d?: number | null;
    apy30d?: number | null;
    tvl: {
      usd: string;
    };
  };
}

export interface EarnVaultsResponse {
  data: EarnVault[];
  total: number;
  hasMore: boolean;
}

export interface ComposerQuote {
  id: string;
  type: string;
  tool: string;
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: { address: string; symbol: string; decimals: number };
    toToken: { address: string; symbol: string; decimals: number };
    fromAmount: string;
  };
  estimate: {
    fromAmount?: string;
    toAmount: string;
    executionDuration: number;
    gasCosts: { amountUSD: string }[];
  };
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    chainId: number;
  };
}

export interface PortfolioPosition {
  vault: EarnVault;
  balanceUsd: string;
  balanceToken: string;
  tokenSymbol: string;
  pnlUsd?: string;
}

export interface AuditRecord {
  id: string;
  timestamp: number;
  agentAddress: string;
  action: string;
  vault: string;
  vaultName: string;
  token: string;
  amount: string;
  reasoning: string;
  riskScore: number;
  evidenceHash: string;
  ipfsCid?: string;
  txHash?: string;
  status: 'pending' | 'executed' | 'failed';
}

/** Structured data for the 2-step recall flow (DeFi vault → SafeFlow → EOA) */
export interface RecallActionData {
  walletId: string;
  capId?: string;
  tokenAddress: string;
  /** ERC4626 vault contract that holds the share tokens */
  vaultAddress?: string;
  symbol: string;
  decimals: number;
  amountWei: string;
  chainId: number;
  /** All audit entry IDs for this walletId:tokenAddress pair — patched to 'withdrawn' after step2 */
  auditEntryIds?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  vaults?: EarnVault[];
  retryText?: string;
  retryUserMsgId?: string;
  action?: {
    type: 'deposit' | 'withdraw' | 'info' | 'recall';
    vault?: EarnVault;
    amount?: string;
    token?: string;
    recallData?: RecallActionData;
  };
}

export interface SessionCapInfo {
  capId: number;
  walletId: number;
  agent: string;
  maxSpendPerInterval: bigint;
  maxSpendTotal: bigint;
  intervalSeconds: number;
  expiresAt: number;
  totalSpent: bigint;
  active: boolean;
  intervalRemaining: bigint;
  totalRemaining: bigint;
}

export const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  polygon: 137,
  avalanche: 43114,
  bsc: 56,
  hashkey_testnet: 133,
  hashkey_mainnet: 177,
};

export const CHAIN_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_IDS).map(([name, id]) => [id, name])
);

// ─── HashKey mode types ─────────────────────────────────────────────

export type PaymentIntentStatus =
  | 'pending'
  | 'claimed'
  | 'executed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface PaymentIntent {
  intentId: string;
  merchantOrderId: string;
  agentAddress: string;
  vaultId: string;
  recipient: string;
  amountWei: string;
  currency: string;
  reason: string;
  metadata?: Record<string, unknown>;
  expiresAtMs: number;
  status: PaymentIntentStatus;
  attemptCount: number;
  signature: string;
  createdAtMs: number;
  updatedAtMs: number;
  claimedAtMs?: number;
  txHash?: string;
  reasonHash?: string;
  errorCode?: string;
  errorMessage?: string;
  finishedAt?: number;
}

export interface HashKeySessionCapInfo {
  vaultId: number;
  agent: string;
  maxSpendPerSecond: bigint;
  maxSpendTotal: bigint;
  totalSpent: bigint;
  lastSpendTimeSec: number;
  expiresAtSec: number;
  exists: boolean;
}

export interface HashKeyVaultInfo {
  vaultId: number;
  owner: string;
  balance: bigint;
  exists: boolean;
}
