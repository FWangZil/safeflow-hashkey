'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { BarChart3, Loader2, Wallet, RefreshCw, Coins, ArrowDownToLine } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useSafeFlowResources } from '@/lib/safeflow-resources';
import type { RecallActionData } from '@/types';
import { LOCAL_FORK_ENABLED, LOCAL_FORK_CHAIN_ID, LOCAL_FORK_NAME } from '@/lib/chains';
import { SAFEFLOW_VAULT_ABI, getSafeFlowAddress } from '@/lib/contracts';

interface PortfolioProps {
  onOpenExplore?: () => void;
  onOpenSettings?: () => void;
  onOpenChat?: (message: string, recallData?: RecallActionData) => void;
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

if (LOCAL_FORK_ENABLED) {
  CHAIN_NAMES[LOCAL_FORK_CHAIN_ID] = LOCAL_FORK_NAME;
}

interface AuditEntry {
  id: string;
  agentAddress: string;
  action: string;
  vault: string;
  vaultName: string;
  token: string;
  amount: string;
  status: 'pending' | 'executed' | 'failed' | 'withdrawn';
  txHash?: string;
  chainId?: number;
  decimals?: number;
  walletId?: string;
  tokenAddress?: string;
  vaultAddress?: string;
  capId?: string;
  timestamp: number;
}

function formatAuditAmount(amountWei: string, decimals: number): string {
  try {
    const d = decimals || 18;
    const raw = BigInt(amountWei);
    const factor = BigInt(10 ** d);
    const whole = raw / factor;
    const frac = raw % factor;
    const fracStr = frac.toString().padStart(d, '0').replace(/0+$/, '').slice(0, 4);
    return fracStr ? `${whole}.${fracStr}` : `${whole}`;
  } catch {
    return amountWei;
  }
}

/** Compute USD value from token amount and price. Returns formatted string or null. */
function computeUsd(nativeAmount: string, priceUsd: number | undefined): string | null {
  if (priceUsd == null) return null;
  const n = parseFloat(nativeAmount);
  if (isNaN(n) || n === 0) return '0.00';
  return (n * priceUsd).toFixed(2);
}

// ── Per-wallet live balance row ───────────────────────────────────────────────
interface WalletBalanceRowProps {
  walletId: string;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  chainId: number;
  /** Total amount ever deposited into DeFi (wei), from audit trail */
  depositedAmountRaw: bigint;
  /** USD price per 1 token, from Binance */
  priceUsd?: number;
  /** Most-recent DeFi vault name this pair was deployed into */
  vaultName?: string;
  onOpenChat?: (message: string) => void;
}

function WalletBalanceRow({ walletId, tokenAddress, symbol, decimals, chainId, depositedAmountRaw, priceUsd, vaultName, onOpenChat }: WalletBalanceRowProps) {
  const safeFlowAddress = getSafeFlowAddress();
  const { writeContractAsync } = useWriteContract();
  const [withdrawTx, setWithdrawTx] = useState<`0x${string}` | undefined>();
  const [withdrawing, setWithdrawing] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const { data: rawBalance, refetch } = useReadContract({
    address: safeFlowAddress,
    abi: SAFEFLOW_VAULT_ABI,
    functionName: 'getBalance',
    args: [BigInt(walletId), tokenAddress as `0x${string}`],
    chainId,
  });

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: withdrawTx, chainId });

  useEffect(() => {
    if (txConfirmed) {
      setWithdrawTx(undefined);
      setWithdrawing(false);
      refetch();
    }
  }, [txConfirmed, refetch]);

  const balance = typeof rawBalance === 'bigint' ? rawBalance : BigInt(0);
  const factor = BigInt(10 ** (decimals || 18));

  function formatRaw(raw: bigint): string {
    const whole = raw / factor;
    const frac = (raw % factor).toString().padStart(decimals || 18, '0').replace(/0+$/, '').slice(0, 4);
    return frac ? `${whole}.${frac}` : `${whole}`;
  }

  const displayBalance = formatRaw(balance);
  const displayDeposited = formatRaw(depositedAmountRaw);
  const isDeployed = balance === BigInt(0) && depositedAmountRaw > BigInt(0);

  const handleWithdrawAll = async () => {
    if (balance === BigInt(0)) return;
    setWithdrawing(true);
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: safeFlowAddress,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'withdraw',
        args: [BigInt(walletId), tokenAddress as `0x${string}`, balance],
        chainId,
      });
      setWithdrawTx(hash);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : 'Withdraw failed');
      setWithdrawing(false);
    }
  };

  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-primary/[0.03] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary/70" />
          <div>
            <div className="font-semibold">{symbol}</div>
            <div className="text-[10px] text-muted-foreground">Wallet #{walletId}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground text-xs">SafeFlowVault</td>
      <td className="px-4 py-3">
        <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-md text-[11px] font-semibold border border-primary/20">
          {LOCAL_FORK_NAME}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-data text-xs">
        {isDeployed ? (
          <div className="space-y-0.5">
            <div className="text-muted-foreground/50 text-[10px] line-through">{displayDeposited} {symbol}</div>
            <div className="dark:text-amber-400 text-amber-700 text-[10px] font-semibold">0 in SafeFlow</div>
          </div>
        ) : (
          <span className="font-semibold">{displayBalance} {symbol}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right font-data font-semibold">
        {(() => {
          const amount = isDeployed ? displayDeposited : displayBalance;
          const usd = computeUsd(amount, priceUsd);
          if (!usd) return <span className="text-muted-foreground text-xs">fetching…</span>;
          return (
            <span className={isDeployed ? 'dark:text-amber-400 text-amber-700' : undefined}>
              ≈ ${usd}
              {isDeployed && <span className="text-[9px] dark:text-amber-400/60 text-amber-600 ml-1">in vault</span>}
            </span>
          );
        })()}
      </td>
      <td className="px-4 py-3 text-right">
        {txError && <div className="text-destructive text-[10px] mb-1">{txError}</div>}
        {isDeployed ? (
          <div className="flex flex-col items-end gap-1">
            <div className="text-[10px] dark:text-amber-400/80 text-amber-700 font-medium">Deployed to DeFi vault</div>
            {onOpenChat ? (
              <button
                onClick={() => onOpenChat(
                  `Recall my ${displayDeposited} ${symbol} from the ${
                    vaultName || 'DeFi vault'
                  } back into SafeFlow Wallet #${walletId} (token ${tokenAddress}). ` +
                  `Use executeCall() to withdraw from the vault and credit the balance back.`
                )}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg dark:bg-amber-500/10 bg-amber-100 dark:border-amber-400/20 border-amber-400/40 dark:text-amber-300 text-amber-800 text-[10px] font-semibold hover:bg-amber-500/20 transition-colors"
              >
                <ArrowDownToLine className="w-2.5 h-2.5" />
                Ask AI to Recall
              </button>
            ) : (
              <span className="text-[10px] text-muted-foreground/50">Ask AI agent to recall</span>
            )}
          </div>
        ) : balance > BigInt(0) ? (
          <button
            onClick={handleWithdrawAll}
            disabled={withdrawing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[11px] font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {withdrawing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
            {withdrawing ? 'Withdrawing…' : 'Withdraw to Wallet'}
          </button>
        ) : (
          <span className="text-[10px] text-muted-foreground/50">No balance</span>
        )}
      </td>
    </tr>
  );
}

export default function Portfolio({ onOpenExplore, onOpenSettings, onOpenChat }: PortfolioProps) {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const { currentWallets, currentAgentCaps } = useSafeFlowResources();
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalUsd, setTotalUsd] = useState(0);
  const hasReadyResources = currentWallets.length > 0 && currentAgentCaps.length > 0;
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});

  const fetchPositions = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      if (LOCAL_FORK_ENABLED) {
        // In local fork mode, LI.FI doesn't know about local chain — read from audit trail
        const res = await fetch('/api/audit');
        if (!res.ok) throw new Error(`Audit API error: ${res.status}`);
        const data = await res.json() as { entries?: AuditEntry[] };
        const entries: AuditEntry[] = data.entries || [];
        const executed = entries.filter(
          (e) => (e.status === 'executed') && e.agentAddress?.toLowerCase() === address.toLowerCase()
        );
        setAuditEntries(executed);

        // Fetch real token prices from Binance via our proxy
        const symbols = [...new Set(executed.map((e) => e.token.toUpperCase()))].filter(Boolean);
        let prices: Record<string, number> = {};
        try {
          const priceRes = await fetch(`/api/prices?symbols=${symbols.join(',')}`);
          if (priceRes.ok) prices = await priceRes.json() as Record<string, number>;
        } catch { /* non-blocking */ }
        setTokenPrices(prices);

        const pos: PortfolioPosition[] = executed.map((e) => {
          const dec = e.decimals ?? 18;
          const native = formatAuditAmount(e.amount, dec);
          const priceUsd = prices[e.token.toUpperCase()];
          return {
            chainId: e.chainId ?? LOCAL_FORK_CHAIN_ID,
            protocolName: e.vaultName || e.vault || 'SafeFlow',
            asset: {
              address: e.vault,
              name: e.token,
              symbol: e.token,
              decimals: dec,
            },
            balanceUsd: computeUsd(native, priceUsd) ?? '0',
            balanceNative: `${native} ${e.token}`,
            vaultAddress: e.vault,
            vaultName: e.vaultName,
          };
        });
        setPositions(pos);
        setTotalUsd(pos.reduce((sum, p) => sum + parseFloat(p.balanceUsd || '0'), 0));
      } else {
        const res = await fetch(`/api/earn/portfolio/${address}`);
        if (!res.ok) {
          if (res.status === 404) {
            setPositions([]);
            setTotalUsd(0);
            return;
          }
          throw new Error(`API error: ${res.status}`);
        }
        const data = await res.json() as PortfolioPosition[] | { positions?: PortfolioPosition[]; data?: PortfolioPosition[] };
        // Handle both array and object response
        const pos: PortfolioPosition[] = Array.isArray(data) ? data : (data.positions || data.data || []);
        setPositions(pos);
        setTotalUsd(pos.reduce((sum: number, p: PortfolioPosition) => sum + parseFloat(p.balanceUsd || '0'), 0));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (isConnected && address) {
      fetchPositions();
      // Poll every 15s so Portfolio auto-refreshes after entries are marked withdrawn
      const id = setInterval(() => fetchPositions(), 15_000);
      return () => clearInterval(id);
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
            {loading ? '…' : `$${totalUsd.toFixed(2)}`}
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
          <p className="text-sm text-muted-foreground">
            {LOCAL_FORK_ENABLED ? 'Reading audit trail…' : 'Loading positions from LI.FI Earn API...'}
          </p>
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

      {/* Deposit history (LI.FI positions or local audit trail) */}
      {positions.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden glow-border">
          {LOCAL_FORK_ENABLED && (
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">
              Executed Deposits (Audit Trail)
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/40 border-b border-border">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Asset</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Vault</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Chain</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Deposited</th>
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
                  <td className="px-4 py-3 text-right font-data font-semibold">
                    {LOCAL_FORK_ENABLED
                      ? (pos.balanceUsd && pos.balanceUsd !== '0'
                          ? `≈ $${pos.balanceUsd}`
                          : <span className="text-muted-foreground text-xs" title="No price oracle on local fork">—</span>)
                      : `$${parseFloat(pos.balanceUsd || '0').toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SafeFlow Wallet Balances — live on-chain reads (local fork only) */}
      {LOCAL_FORK_ENABLED && auditEntries.some(e => e.walletId && e.tokenAddress) && (() => {
        const seen = new Set<string>();
        // Aggregate total deposited per (walletId, tokenAddress) pair — skip withdrawn entries
        const depositedTotals = new Map<string, bigint>();
        const auditIdsByPair = new Map<string, string[]>();
        const vaultNamesMap = new Map<string, string>();
        const vaultAddressMap = new Map<string, string>();
        const capIdMap = new Map<string, string>();
        for (const e of auditEntries) {
          if (!e.walletId || !e.tokenAddress) continue;
          const key = `${e.walletId}:${e.tokenAddress}`;
          const prev = depositedTotals.get(key) ?? BigInt(0);
          try { depositedTotals.set(key, prev + BigInt(e.amount)); } catch { /* ignore */ }
          auditIdsByPair.set(key, [...(auditIdsByPair.get(key) ?? []), e.id]);
          if (e.vaultName && !vaultNamesMap.has(key)) vaultNamesMap.set(key, e.vaultName);
          if (e.vaultAddress && !vaultAddressMap.has(key)) vaultAddressMap.set(key, e.vaultAddress);
          if (e.capId && !capIdMap.has(key)) capIdMap.set(key, e.capId);
        }
        const pairs = auditEntries
          .filter(e => e.walletId && e.tokenAddress)
          .filter(e => {
            const key = `${e.walletId}:${e.tokenAddress}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          // Hide rows where all deposits have been withdrawn (depositedTotal == 0 after filtering)
          .filter(e => (depositedTotals.get(`${e.walletId}:${e.tokenAddress}`) ?? BigInt(0)) > BigInt(0));
        return (
          <div className="border border-primary/20 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/20 text-[11px] text-primary font-semibold uppercase tracking-wider flex items-center gap-2">
              <ArrowDownToLine className="w-3.5 h-3.5" />
              SafeFlow Wallet Balances
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/40 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Asset</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Source</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Chain</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Balance</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Value (USD)</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map(e => (
                  <WalletBalanceRow
                    key={`${e.walletId}:${e.tokenAddress}`}
                    walletId={e.walletId!}
                    tokenAddress={e.tokenAddress!}
                    symbol={e.token}
                    decimals={e.decimals ?? 18}
                    chainId={e.chainId ?? LOCAL_FORK_CHAIN_ID}
                    depositedAmountRaw={depositedTotals.get(`${e.walletId}:${e.tokenAddress}`) ?? BigInt(0)}
                    priceUsd={tokenPrices[e.token.toUpperCase()]}
                    vaultName={vaultNamesMap.get(`${e.walletId}:${e.tokenAddress}`)}
                    onOpenChat={onOpenChat ? (msg) => {
                      const key = `${e.walletId}:${e.tokenAddress}`;
                      const recallData: RecallActionData = {
                        walletId: e.walletId!,
                        capId: capIdMap.get(key),
                        tokenAddress: e.tokenAddress!,
                        vaultAddress: vaultAddressMap.get(key),
                        symbol: e.token,
                        decimals: e.decimals ?? 18,
                        amountWei: (depositedTotals.get(key) ?? BigInt(0)).toString(),
                        chainId: e.chainId ?? LOCAL_FORK_CHAIN_ID,
                        auditEntryIds: auditIdsByPair.get(key),
                      };
                      onOpenChat(msg, recallData);
                    } : undefined}
                  />
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 bg-secondary/20 text-[10px] text-muted-foreground/60">
              Balance reads live from SafeFlowVault on-chain. When funds are deployed to a DeFi vault, ask the AI agent to recall them — it will use <span className="font-mono">executeCall()</span> to credit them back here.
            </div>
          </div>
        );
      })()}

      <div className="text-[11px] text-muted-foreground/50 text-center">
        {LOCAL_FORK_ENABLED
          ? `${LOCAL_FORK_NAME} · audit trail · ${address?.slice(0, 6)}...${address?.slice(-4)}`
          : `${t('portfolio.dataSource')} · ${address?.slice(0, 6)}...${address?.slice(-4)}`}
      </div>
    </div>
  );
}
