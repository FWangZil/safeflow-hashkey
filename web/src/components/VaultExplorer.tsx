'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { Search, ArrowUpDown, Coins, TrendingUp } from 'lucide-react';
import type { EarnVault } from '@/types';
import { CHAIN_IDS } from '@/types';
import { fetchVaults, formatApy, formatTvl, type VaultFilters } from '@/lib/earn-api';
import { useTranslation } from '@/i18n';
import { useSafeFlowResources } from '@/lib/safeflow-resources';
import { isHashKeyChain } from '@/lib/mode';

interface VaultExplorerProps {
  onSelectVault?: (vault: EarnVault) => void;
  onOpenChat?: () => void;
  onOpenSettings?: () => void;
}

export default function VaultExplorer({ onSelectVault, onOpenChat, onOpenSettings }: VaultExplorerProps) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const onHashKey = isHashKeyChain(chainId);
  const { currentWallets, currentAgentCaps, isHydrated } = useSafeFlowResources();
  const [vaults, setVaults] = useState<EarnVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedChain, setSelectedChain] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [selectedProtocol, setSelectedProtocol] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'apy' | 'tvl'>('apy');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const { t } = useTranslation();
  // The wallet/cap readiness signal comes from queries against the SafeFlowVault
  // ABI, which doesn't match SafeFlowVaultHashKey. On HashKey chains the setup
  // happens inline inside HspPayActionCard, so suppress the SessionManager-bound
  // notice here to avoid pointing users at a dead-end UI.
  const needsWalletSetup = !onHashKey && isConnected && isHydrated && currentWallets.length === 0;
  const needsCapSetup = !onHashKey && isConnected && isHydrated && currentWallets.length > 0 && currentAgentCaps.length === 0;
  const hasActiveFilters = Boolean(search) || selectedChain !== 'all' || selectedTag !== 'all' || selectedProtocol !== 'all';
  const shouldShowSetupNotice = needsWalletSetup || needsCapSetup;

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
      if (selectedProtocol !== 'all') {
        filters.protocol = selectedProtocol;
      }
      const result = await fetchVaults(filters);
      setVaults(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vaults');
    } finally {
      setLoading(false);
    }
  }, [selectedChain, selectedTag, selectedProtocol, sortBy, sortOrder]);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  const filteredVaults = vaults.filter(v => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      v.name?.toLowerCase().includes(q) ||
      v.protocol?.name?.toLowerCase().includes(q) ||
      v.underlyingTokens?.some(tk => tk.symbol?.toLowerCase().includes(q))
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

  const resetFilters = () => {
    setSearch('');
    setSelectedChain('all');
    setSelectedTag('all');
    setSelectedProtocol('all');
    setSortBy('apy');
    setSortOrder('desc');
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('explore.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/50 transition-all"
          />
        </div>

        <select
          value={selectedChain}
          onChange={e => setSelectedChain(e.target.value)}
          className="px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          <option value="all">{t('explore.allChains')}</option>
          {Object.keys(CHAIN_IDS).map(chain => (
            <option key={chain} value={chain}>
              {chain.charAt(0).toUpperCase() + chain.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={selectedTag}
          onChange={e => setSelectedTag(e.target.value)}
          className="px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          <option value="all">{t('explore.allTags')}</option>
          <option value="stablecoin">Stablecoin</option>
          <option value="blue-chip">Blue Chip</option>
          <option value="lsd">LSD</option>
        </select>

        <select
          value={selectedProtocol}
          onChange={e => setSelectedProtocol(e.target.value)}
          className="px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          <option value="all">{t('explore.allProtocols')}</option>
          <option value="morpho">Morpho</option>
          <option value="aave">Aave V3</option>
          <option value="euler">Euler V2</option>
          <option value="pendle">Pendle</option>
          <option value="fluid">Fluid</option>
        </select>
      </div>

      {shouldShowSetupNotice && (
        <div className="rounded-[1.5rem] border border-border bg-card/60 p-4 glow-border">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                {t('explore.setupEyebrow')}
              </div>
              <div className="text-sm font-semibold tracking-tight">
                {needsWalletSetup ? t('explore.setupWalletTitle') : t('explore.setupCapTitle')}
              </div>
              <p className="max-w-[72ch] text-xs leading-relaxed text-muted-foreground">
                {needsWalletSetup ? t('explore.setupWalletDescription') : t('explore.setupCapDescription')}
              </p>
            </div>
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:translate-y-[1px]"
              >
                {t('explore.openSettingsCta')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden glow-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/40 border-b border-border">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t('explore.tableHeaders.vault')}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t('explore.tableHeaders.protocol')}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t('explore.tableHeaders.chain')}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t('explore.tableHeaders.token')}</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <button onClick={() => toggleSort('apy')} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    {t('explore.tableHeaders.apy')} <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <button onClick={() => toggleSort('tvl')} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    {t('explore.tableHeaders.tvl')} <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-center px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t('explore.tableHeaders.tags')}</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs">{t('explore.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : filteredVaults.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-xs">
                    <div className="mx-auto max-w-2xl rounded-[1.5rem] border border-dashed border-border bg-secondary/20 px-6 py-8">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Search className="w-5 h-5" />
                      </div>
                      <div className="text-sm font-semibold text-foreground">{t('explore.emptyTitle')}</div>
                      <p className="mx-auto mt-2 max-w-[58ch] text-xs leading-relaxed text-muted-foreground">
                        {hasActiveFilters ? t('explore.emptyDescriptionFiltered') : t('explore.emptyDescriptionDefault')}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                        {hasActiveFilters && (
                          <button
                            onClick={resetFilters}
                            className="rounded-xl border border-primary/20 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary transition hover:border-primary/30 hover:bg-primary/15"
                          >
                            {t('explore.resetFiltersCta')}
                          </button>
                        )}
                        {onOpenChat && (
                          <button
                            onClick={onOpenChat}
                            className="rounded-xl border border-border bg-card/70 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-card"
                          >
                            {t('explore.askAgentCta')}
                          </button>
                        )}
                        {shouldShowSetupNotice && onOpenSettings && (
                          <button
                            onClick={onOpenSettings}
                            className="rounded-xl border border-border bg-secondary/70 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-secondary"
                          >
                            {t('explore.openSettingsCta')}
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredVaults.slice(0, 50).map((vault, i) => (
                  <tr
                    key={`${vault.address}-${vault.chainId}-${i}`}
                    className="border-b border-border/50 last:border-0 hover:bg-primary/[0.03] cursor-pointer transition-colors duration-150 group"
                    onClick={() => onSelectVault?.(vault)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground truncate max-w-[200px] group-hover:text-primary transition-colors">{vault.name}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{vault.protocol?.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-secondary/80 rounded-md text-[11px] font-semibold">
                        {vault.network || `Chain ${vault.chainId}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-xs">
                        <Coins className="w-3 h-3 text-muted-foreground" />
                        <span className="font-data">{vault.underlyingTokens?.map(tk => tk.symbol).join(' / ') || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-success font-bold font-data text-xs">
                        {formatApy(vault.analytics?.apy?.total)}
                      </span>
                      {vault.analytics?.apy?.reward != null && vault.analytics.apy.reward > 0 && (
                        <div className="text-[10px] text-muted-foreground font-data">
                          +{formatApy(vault.analytics.apy.reward)} reward
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-data text-xs">
                      {formatTvl(vault.analytics?.tvl?.usd)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-wrap gap-1 justify-center">
                        {vault.tags?.slice(0, 2).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 bg-primary/10 text-primary rounded-md text-[10px] font-semibold">
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
                        className="px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-[11px] font-semibold hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                      >
                        {t('explore.deposit')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      {!loading && filteredVaults.length > 0 && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground/50">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            {t('explore.showing', { shown: Math.min(filteredVaults.length, 50), total: filteredVaults.length })}
          </span>
          <span>{t('explore.dataSource')}</span>
        </div>
      )}
    </div>
  );
}
