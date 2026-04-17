'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { getChainExplorerTxUrl } from '@/lib/chains';
import { HASHKEY_CHAIN_ID } from '@/lib/mode';
import type { PaymentIntent, PaymentIntentStatus } from '@/types';

function statusBadge(status: PaymentIntentStatus) {
  switch (status) {
    case 'pending':
      return { icon: <Clock className="w-3.5 h-3.5" />, label: 'Pending', cls: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300' };
    case 'claimed':
      return { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, label: 'Claimed', cls: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300' };
    case 'executed':
      return { icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Executed', cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300' };
    case 'failed':
      return { icon: <XCircle className="w-3.5 h-3.5" />, label: 'Failed', cls: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300' };
    case 'expired':
      return { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: 'Expired', cls: 'text-gray-500 bg-gray-50 dark:bg-gray-500/10 dark:text-gray-400' };
    case 'cancelled':
      return { icon: <XCircle className="w-3.5 h-3.5" />, label: 'Cancelled', cls: 'text-gray-500 bg-gray-50 dark:bg-gray-500/10 dark:text-gray-400' };
  }
}

function shortenAddress(address: string) {
  if (!address || address.length < 10) return address || '—';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatHsk(amountWei: string): string {
  try {
    const val = BigInt(amountWei);
    const whole = val / BigInt(1e18);
    const frac = val % BigInt(1e18);
    const fracStr = frac.toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return amountWei;
  }
}

export default function PaymentHistory() {
  const { t } = useTranslation();
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIntents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hashkey/intents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { intents?: PaymentIntent[] };
      setIntents(data.intents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchIntents(); }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{t('hashkey.paymentHistory') || 'Payment History'}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('hashkey.paymentHistoryDesc') || 'PaymentIntent lifecycle tracking'}
          </p>
        </div>
        <button
          onClick={fetchIntents}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh') || 'Refresh'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && intents.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">{t('common.loading') || 'Loading...'}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && intents.length === 0 && !error && (
        <div className="rounded-xl border border-border bg-card/50 p-8 text-center">
          <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {t('hashkey.noIntents') || 'No payment intents yet'}
          </p>
        </div>
      )}

      {/* Intent list */}
      {intents.length > 0 && (
        <div className="space-y-2">
          {intents.map(intent => {
            const badge = statusBadge(intent.status);
            const txUrl = intent.txHash
              ? getChainExplorerTxUrl(HASHKEY_CHAIN_ID, intent.txHash as `0x${string}`)
              : null;

            return (
              <div
                key={intent.intentId}
                className="rounded-xl border border-border bg-card p-3.5 space-y-2 shadow-sm"
              >
                {/* Row 1: status + amount + time */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${badge.cls}`}>
                      {badge.icon}
                      {badge.label}
                    </span>
                    <span className="text-sm font-semibold">
                      {formatHsk(intent.amountWei)} {intent.currency}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(intent.createdAtMs).toLocaleString()}
                  </span>
                </div>

                {/* Row 2: details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground/70">{t('hashkey.recipient') || 'Recipient'}:</span>{' '}
                    <span className="font-mono">{shortenAddress(intent.recipient)}</span>
                  </div>
                  <div>
                    <span className="font-medium text-foreground/70">{t('hashkey.vault') || 'Vault'}:</span>{' '}
                    #{intent.vaultId}
                  </div>
                  {intent.reason && (
                    <div className="col-span-2 truncate">
                      <span className="font-medium text-foreground/70">{t('hashkey.reason') || 'Reason'}:</span>{' '}
                      {intent.reason}
                    </div>
                  )}
                  {intent.errorMessage && (
                    <div className="col-span-2 text-red-600 dark:text-red-400">
                      {intent.errorMessage}
                    </div>
                  )}
                </div>

                {/* Tx link */}
                {txUrl && (
                  <a
                    href={txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t('common.viewTx') || 'View Transaction'}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
