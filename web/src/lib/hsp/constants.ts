export type HspEnvironment = 'qa' | 'staging' | 'production';

export const HSP_BASE_URLS: Record<HspEnvironment, string> = {
  qa: 'https://merchant-qa.hashkeymerchant.com',
  staging: 'https://merchant-stg.hashkeymerchant.com',
  production: 'https://merchant.hashkey.com',
};

export const HSP_TESTNET_TOKENS = {
  USDC: {
    network: 'hashkey-testnet',
    chain_id: 133,
    contract_address: '0x79AEc4EeA31D50792F61D1Ca0733C18c89524C9e',
    decimals: 6,
    protocol: 'eip3009',
  },
  USDT: {
    network: 'hashkey-testnet',
    chain_id: 133,
    contract_address: '0x372325443233fEbaC1F6998aC750276468c83CC6',
    decimals: 6,
    protocol: 'permit2',
  },
} as const;

export const HSP_MAINNET_TOKENS = {
  USDC: {
    network: 'hashkey',
    chain_id: 177,
    contract_address: '0x054ed45810DbBAb8B27668922D110669c9D88D0a',
    decimals: 6,
    protocol: 'eip3009',
  },
  USDT: {
    network: 'hashkey',
    chain_id: 177,
    contract_address: '0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029',
    decimals: 6,
    protocol: 'permit2',
  },
} as const;
