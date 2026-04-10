'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, ArrowUpDown, Coins } from 'lucide-react';
import type { EarnVault } from '@/types';
import { CHAIN_IDS } from '@/types';
import { fetchVaults, formatApy, formatTvl, type VaultFilters } from '@/lib/earn-api';

interface VaultExplorerProps {
  onSelectVault?: (vault: EarnVault) => void;
}

export default function VaultExplorer({ onSelectVault }: VaultExplorerProps) {
  const [vaults, setVaults] = useState<EarnVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedChain, setSelectedChain] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'apy' | 'tvl'>('apy');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const loadVaults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: VaultFilters = {
        onlyTransactional: true,
        sortBy,
        sortOrder,
        limit: 100,
      };
      if (selectedChain !== 'all') {
        filters.chainId = CHAIN_IDS[selectedChain];
      }
      if (selectedTag !== 'all') {
        filters.tag = selectedTag;
      }
      const result = await fetchVaults(filters);
      setVaults(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vaults');
    } finally {
      setLoading(false);
    }
  }, [selectedChain, selectedTag, sortBy, sortOrder]);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  const filteredVaults = vaults.filter(v => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      v.name?.toLowerCase().includes(q) ||
      v.protocol?.name?.toLowerCase().includes(q) ||
      v.underlyingTokens?.some(t => t.symbol?.toLowerCase().includes(q))
    );
  });

  const toggleSort = (field: 'apy' | 'tvl') => {
    if (sortBy === field) {
      setSortOrder(prev => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search vaults, protocols, tokens..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
          />
        </div>

        <select
          value={selectedChain}
          onChange={e => setSelectedChain(e.target.value)}
          className="px-3 py-2.5 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="all">All Chains</option>
          {Object.keys(CHAIN_IDS).map(chain => (
            <option key={chain} value={chain}>
              {chain.charAt(0).toUpperCase() + chain.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={selectedTag}
          onChange={e => setSelectedTag(e.target.value)}
          className="px-3 py-2.5 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="all">All Tags</option>
          <option value="stablecoin">Stablecoin</option>
          <option value="blue-chip">Blue Chip</option>
          <option value="lsd">LSD</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vault</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Protocol</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Chain</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Token</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                  <button onClick={() => toggleSort('apy')} className="inline-flex items-center gap-1 hover:text-foreground">
                    APY <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                  <button onClick={() => toggleSort('tvl')} className="inline-flex items-center gap-1 hover:text-foreground">
                    TVL <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Tags</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      Loading vaults from LI.FI Earn API...
                    </div>
                  </td>
                </tr>
              ) : filteredVaults.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    No vaults found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredVaults.slice(0, 50).map((vault, i) => (
                  <tr
                    key={`${vault.address}-${vault.chainId}-${i}`}
                    className="border-b border-border last:border-0 hover:bg-card/50 cursor-pointer transition-colors"
                    onClick={() => onSelectVault?.(vault)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground truncate max-w-[200px]">{vault.name}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{vault.protocol?.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-secondary rounded text-xs font-medium">
                        {vault.network || `Chain ${vault.chainId}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Coins className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{vault.underlyingTokens?.map(t => t.symbol).join(' / ') || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-success font-medium">
                        {formatApy(vault.analytics?.apy?.total)}
                      </span>
                      {vault.analytics?.apy?.reward != null && vault.analytics.apy.reward > 0 && (
                        <div className="text-xs text-muted-foreground">
                          +{formatApy(vault.analytics.apy.reward)} reward
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatTvl(vault.analytics?.tvl?.usd)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-wrap gap-1 justify-center">
                        {vault.tags?.slice(0, 2).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onSelectVault?.(vault);
                        }}
                        className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 transition-colors"
                      >
                        Deposit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && (
        <div className="text-xs text-muted-foreground text-right">
          Showing {Math.min(filteredVaults.length, 50)} of {filteredVaults.length} vaults • Data from LI.FI Earn API
        </div>
      )}
    </div>
  );
}
