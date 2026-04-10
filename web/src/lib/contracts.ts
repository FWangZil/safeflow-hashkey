export const SAFEFLOW_VAULT_ABI = [
  {
    type: 'function',
    name: 'createWallet',
    inputs: [],
    outputs: [{ name: 'walletId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'walletId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'walletId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createSessionCap',
    inputs: [
      { name: 'walletId', type: 'uint256' },
      { name: 'agent', type: 'address' },
      { name: 'maxSpendPerInterval', type: 'uint64' },
      { name: 'maxSpendTotal', type: 'uint256' },
      { name: 'intervalSeconds', type: 'uint64' },
      { name: 'expiresAt', type: 'uint64' },
    ],
    outputs: [{ name: 'capId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeSessionCap',
    inputs: [{ name: 'capId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeDeposit',
    inputs: [
      { name: 'capId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'vault', type: 'address' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'callData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getBalance',
    inputs: [
      { name: 'walletId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSessionCap',
    inputs: [{ name: 'capId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'walletId', type: 'uint256' },
          { name: 'agent', type: 'address' },
          { name: 'maxSpendPerInterval', type: 'uint64' },
          { name: 'maxSpendTotal', type: 'uint256' },
          { name: 'intervalSeconds', type: 'uint64' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'totalSpent', type: 'uint256' },
          { name: 'lastSpendTime', type: 'uint64' },
          { name: 'currentIntervalSpent', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getWallet',
    inputs: [{ name: 'walletId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRemainingAllowance',
    inputs: [{ name: 'capId', type: 'uint256' }],
    outputs: [
      { name: 'intervalRemaining', type: 'uint256' },
      { name: 'totalRemaining', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'WalletCreated',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'walletId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'walletId', type: 'uint256', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SessionCapCreated',
    inputs: [
      { name: 'walletId', type: 'uint256', indexed: true },
      { name: 'capId', type: 'uint256', indexed: true },
      { name: 'agent', type: 'address', indexed: true },
      { name: 'maxSpendPerInterval', type: 'uint64', indexed: false },
      { name: 'maxSpendTotal', type: 'uint256', indexed: false },
      { name: 'intervalSeconds', type: 'uint64', indexed: false },
      { name: 'expiresAt', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DepositExecuted',
    inputs: [
      { name: 'walletId', type: 'uint256', indexed: true },
      { name: 'capId', type: 'uint256', indexed: true },
      { name: 'vault', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

export function getSafeFlowAddress(): `0x${string}` {
  const addr = process.env.NEXT_PUBLIC_SAFEFLOW_CONTRACT;
  if (!addr || addr === '0x0000000000000000000000000000000000000000') {
    throw new Error('SafeFlow contract address not configured. Set NEXT_PUBLIC_SAFEFLOW_CONTRACT in .env.local');
  }
  return addr as `0x${string}`;
}
