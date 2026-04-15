import type { EarnVault, EarnVaultsResponse, PortfolioPosition } from '@/types';

const EARN_API_BASE = typeof window !== 'undefined' ? '' : 'https://earn.li.fi';

export interface VaultFilters {
  chainId?: number;
  protocol?: string;
  tag?: string;
  minApy?: number;
  minTvl?: number;
  tokenSymbol?: string;
  onlyTransactional?: boolean;
  sortBy?: 'apy' | 'tvl' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export async function fetchVaults(filters: VaultFilters = {}): Promise<EarnVaultsResponse> {
  const params = new URLSearchParams();

  if (filters.chainId) params.set('chainId', String(filters.chainId));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));

  const isClient = typeof window !== 'undefined';
  const url = isClient
    ? `/api/earn/vaults?${params.toString()}`
    : `https://earn.li.fi/v1/earn/vaults?${params.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Earn API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { data?: EarnVault[]; total?: number; hasMore?: boolean } | EarnVault[];
  let vaults: EarnVault[] = (json as { data?: EarnVault[] }).data || (json as EarnVault[]);
  const total = (json as { total?: number }).total ?? vaults.length;

  // Client-side filtering
  if (filters.onlyTransactional) {
    vaults = vaults.filter(v => v.isTransactional === true);
  }
  if (filters.tag) {
    vaults = vaults.filter(v => v.tags?.includes(filters.tag!));
  }
  if (filters.protocol) {
    vaults = vaults.filter(v =>
      v.protocol?.name?.toLowerCase().includes(filters.protocol!.toLowerCase())
    );
  }
  if (filters.tokenSymbol) {
    vaults = vaults.filter(v =>
      v.underlyingTokens?.some(t =>
        t.symbol?.toLowerCase() === filters.tokenSymbol!.toLowerCase()
      )
    );
  }
  if (filters.minApy !== undefined) {
    vaults = vaults.filter(v => (v.analytics?.apy?.total ?? 0) >= filters.minApy!);
  }
  if (filters.minTvl !== undefined) {
    vaults = vaults.filter(v => Number(v.analytics?.tvl?.usd ?? '0') >= filters.minTvl!);
  }

  // Sort
  if (filters.sortBy) {
    const dir = filters.sortOrder === 'asc' ? 1 : -1;
    vaults.sort((a, b) => {
      if (filters.sortBy === 'apy') {
        return dir * ((a.analytics?.apy?.total ?? 0) - (b.analytics?.apy?.total ?? 0));
      }
      if (filters.sortBy === 'tvl') {
        return dir * (Number(a.analytics?.tvl?.usd ?? '0') - Number(b.analytics?.tvl?.usd ?? '0'));
      }
      return dir * (a.name ?? '').localeCompare(b.name ?? '');
    });
  }

  return { data: vaults, total, hasMore: (json as { hasMore?: boolean }).hasMore ?? false };
}

export async function fetchPortfolio(walletAddress: string): Promise<PortfolioPosition[]> {
  const isClient = typeof window !== 'undefined';
  const url = isClient
    ? `/api/earn/portfolio/${walletAddress}`
    : `https://earn.li.fi/v1/earn/portfolio/${walletAddress}/positions`;
  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Portfolio API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export function formatApy(apy: number | null | undefined): string {
  if (apy === null || apy === undefined) return 'N/A';
  return `${apy.toFixed(2)}%`;
}

export function formatTvl(tvlUsd: string | undefined): string {
  if (!tvlUsd) return 'N/A';
  const num = Number(tvlUsd);
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}
