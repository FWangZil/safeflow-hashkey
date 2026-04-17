'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle,
  ExternalLink,
  Loader2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '@/i18n';

interface HspStatus {
  healthy: boolean;
  checks: {
    appKeyConfigured: boolean;
    appSecretConfigured: boolean;
    merchantKeyConfigured: boolean;
    payToConfigured: boolean;
    baseUrl: string;
    merchantName: string;
  };
  mode: string;
  timestamp: string;
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle className="w-3.5 h-3.5" />
          Configured
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-red-500 dark:text-red-400">
          <XCircle className="w-3.5 h-3.5" />
          Missing
        </span>
      )}
    </div>
  );
}

export default function HspPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HspStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hashkey/hsp/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as HspStatus;
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{t('hashkey.hspTitle') || 'HSP Settlement'}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('hashkey.hspDesc') || 'HashKey Settlement Protocol configuration & status'}
          </p>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh') || 'Refresh'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !status && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">{t('common.loading') || 'Loading...'}</span>
        </div>
      )}

      {/* Status Card */}
      {status && (
        <div className="space-y-3">
          {/* Health badge */}
          <div className={`rounded-xl border p-4 ${
            status.healthy
              ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-500/5'
              : 'border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-500/5'
          }`}>
            <div className="flex items-center gap-2">
              {status.healthy ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Activity className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              )}
              <div>
                <div className="text-sm font-semibold">
                  {status.healthy
                    ? (t('hashkey.hspHealthy') || 'HSP Connected')
                    : (t('hashkey.hspNotConfigured') || 'HSP Not Fully Configured')}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t('hashkey.merchantName') || 'Merchant'}: {status.checks.merchantName}
                </div>
              </div>
            </div>
          </div>

          {/* Config checks */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-0.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t('hashkey.configChecks') || 'Configuration'}
            </h4>
            <CheckRow label="HSP App Key" ok={status.checks.appKeyConfigured} />
            <CheckRow label="HSP App Secret" ok={status.checks.appSecretConfigured} />
            <CheckRow label="Merchant Private Key (ES256K)" ok={status.checks.merchantKeyConfigured} />
            <CheckRow label="Pay-To Address" ok={status.checks.payToConfigured} />
            <div className="flex items-center justify-between py-1.5 border-t border-border mt-1.5 pt-2">
              <span className="text-xs text-muted-foreground">Base URL</span>
              <a
                href={status.checks.baseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-mono"
              >
                {status.checks.baseUrl.replace('https://', '')}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Info */}
          <div className="rounded-xl border border-border bg-card/50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t('hashkey.hspInfo') || 'About HSP'}
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('hashkey.hspInfoDesc') || 'The HashKey Settlement Protocol (HSP) enables stablecoin payments on HashKey Chain. Configure your merchant credentials to create checkout links and receive webhook notifications for payment status updates.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
