'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { BarChart3, Loader2, Wallet, RefreshCw, Coins } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useSafeFlowResources } from '@/lib/safeflow-resources';

interface PortfolioProps {
  onOpenExplore?: () => void;
  onOpenSettings?: () => void;
}

interface PortfolioPosition {
  chainId: number;
  protocolName: string;
  asset: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  balanceUsd: string;
  balanceNative: string;
  vaultAddress?: string;
  vaultName?: string;
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum',
  10: 'Optimism',
  137: 'Polygon',
  56: 'BSC',
  43114: 'Avalanche',
};

export default function Portfolio({ onOpenExplore, onOpenSettings }: PortfolioProps) {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const { currentWallets, currentAgentCaps } = useSafeFlowResources();
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalUsd, setTotalUsd] = useState(0);
  const hasReadyResources = currentWallets.length > 0 && currentAgentCaps.length > 0;

  const fetchPositions = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/earn/portfolio/${address}`);
      if (!res.ok) {
        if (res.status === 404) {
          setPositions([]);
          setTotalUsd(0);
          return;
        }
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      // Handle both array and object response
      const pos: PortfolioPosition[] = Array.isArray(data) ? data : (data.positions || data.data || []);
      setPositions(pos);
      setTotalUsd(pos.reduce((sum: number, p: PortfolioPosition) => sum + parseFloat(p.balanceUsd || '0'), 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (isConnected && address) {
      fetchPositions();
    }
  }, [address, fetchPositions, isConnected]);

  if (!isConnected) {
    return (
      <div className="p-10 border border-border rounded-xl bg-card/60 text-center glow-border">
        <Wallet className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">{t('portfolio.connectPrompt')}</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">{t('portfolio.dataSource')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="p-4 bg-card/60 border border-border rounded-xl glow-border flex-1 mr-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Value</div>
          <div className="text-2xl font-bold font-data mt-1">
            {loading ? '...' : `$${totalUsd.toFixed(2)}`}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 font-data">
            {positions.length} position{positions.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={fetchPositions}
          disabled={loading}
          className="p-3 border border-border rounded-xl hover:bg-secondary transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && positions.length === 0 && (
        <div className="p-10 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading positions from LI.FI Earn API...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && positions.length === 0 && !error && (
        <div className="p-10 border border-border rounded-xl bg-card/60 text-center glow-border">
          <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t('portfolio.emptyTitle')}</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            {hasReadyResources ? t('portfolio.emptyReadyDescription') : t('portfolio.emptySetupDescription')}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            {onOpenExplore && (
              <button
                onClick={onOpenExplore}
                className="rounded-xl border border-primary/20 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary transition hover:border-primary/30 hover:bg-primary/15"
              >
                {t('portfolio.openExploreCta')}
              </button>
            )}
            {onOpenSettings && !hasReadyResources && (
              <button
                onClick={onOpenSettings}
                className="rounded-xl border border-border bg-secondary/70 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-secondary"
              >
                {t('portfolio.openSettingsCta')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Positions list */}
      {positions.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden glow-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/40 border-b border-border">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Asset</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Protocol</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Chain</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Balance</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Value (USD)</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, i) => (
                <tr key={`${pos.chainId}-${pos.asset?.address}-${i}`} className="border-b border-border/50 last:border-0 hover:bg-primary/[0.03] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="font-semibold">{pos.asset?.symbol || '?'}</div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">{pos.asset?.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs capitalize">{pos.protocolName}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-secondary/80 rounded-md text-[11px] font-semibold">
                      {CHAIN_NAMES[pos.chainId] || `Chain ${pos.chainId}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-data text-xs">{pos.balanceNative}</td>
                  <td className="px-4 py-3 text-right font-data font-semibold">${parseFloat(pos.balanceUsd || '0').toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground/50 text-center">
        {t('portfolio.dataSource')} · {address?.slice(0, 6)}...{address?.slice(-4)}
      </div>
    </div>
  );
}
