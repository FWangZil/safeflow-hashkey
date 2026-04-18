'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { decodeEventLog } from 'viem';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Wallet,
} from 'lucide-react';
import { SAFEFLOW_VAULT_ABI } from '@/lib/contracts';
import {
  getChainExplorerAddressUrl,
  getChainExplorerTxUrl,
  getSupportedWalletChain,
  LOCAL_FORK_CHAIN_ID,
  LOCAL_FORK_ENABLED,
  LOCAL_FORK_NAME,
  SAFEFLOW_CHAIN_ID,
} from '@/lib/chains';
import { HASHKEY_LOCAL_FORK_CHAIN_ID, HASHKEY_LOCAL_FORK_ENABLED, isHashKeyChain, HASHKEY_ONLY } from '@/lib/mode';
import { useSwitchOrAddChain } from '@/lib/useSwitchOrAddChain';
import { useTranslation } from '@/i18n';
import { useSafeFlowResources, type SafeFlowCapResource, type SafeFlowWalletResource } from '@/lib/safeflow-resources';

type SessionCapData = {
  walletId: bigint;
  agent: `0x${string}`;
  maxSpendPerInterval: bigint;
  maxSpendTotal: bigint;
  totalSpent: bigint;
  intervalSeconds: bigint;
  expiresAt: bigint;
  active: boolean;
};

type RemainingAllowanceData = readonly [bigint, bigint];

type Step = 'idle' | 'pending' | 'success' | 'error';

const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_SAFEFLOW_CONTRACT || '0x0000000000000000000000000000000000000000') as `0x${string}`;
const IS_CONFIGURED = CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatExpiry(expiresAt: bigint | string | undefined) {
  if (!expiresAt) return '—';
  const value = typeof expiresAt === 'string' ? Number(expiresAt) : Number(expiresAt);
  if (!value) return '—';
  return new Date(value * 1000).toLocaleString();
}

function isExpired(expiresAt: bigint | string | undefined) {
  if (!expiresAt) return false;
  const value = typeof expiresAt === 'string' ? Number(expiresAt) : Number(expiresAt);
  if (!value) return false;
  return value * 1000 < Date.now();
}

function getCapStatusLabel(cap: { active?: boolean; expiresAt?: string | bigint }, t: (key: string) => string) {
  if (cap.active === false) return t('settings.statusInactive');
  if (isExpired(cap.expiresAt)) return t('settings.statusExpired');
  return t('settings.statusReady');
}

function isEmptyCap(cap: SessionCapData | undefined) {
  if (!cap) return false;
  return (
    cap.walletId === BigInt(0) &&
    cap.agent.toLowerCase() === ZERO_ADDRESS &&
    cap.maxSpendPerInterval === BigInt(0) &&
    cap.maxSpendTotal === BigInt(0) &&
    cap.totalSpent === BigInt(0) &&
    cap.intervalSeconds === BigInt(0) &&
    cap.expiresAt === BigInt(0) &&
    !cap.active
  );
}

export default function SessionManager() {
  const { t } = useTranslation();
  const { address, isConnected, chainId } = useAccount();
  const { currentWallets, currentCaps, importCap, upsertCap, upsertWallet, clearCurrentResources, isSyncing, chainSyncError } = useSafeFlowResources();
  const requiredChainId = HASHKEY_LOCAL_FORK_ENABLED
    ? HASHKEY_LOCAL_FORK_CHAIN_ID
    : LOCAL_FORK_ENABLED
      ? LOCAL_FORK_CHAIN_ID
      : SAFEFLOW_CHAIN_ID;
  const contractChainId = requiredChainId ?? chainId;
  const targetChain = requiredChainId != null ? getSupportedWalletChain(requiredChainId) : undefined;
  const { isSwitchingChain, switchError, switchOrAddChain } = useSwitchOrAddChain(targetChain, requiredChainId ?? chainId ?? 1);
  const isWrongExecutionChain = requiredChainId != null && chainId !== requiredChainId;
  // When the user is connected to (or the deployment targets) a HashKey chain,
  // the vault at CONTRACT_ADDRESS is SafeFlowVaultHashKey, which exposes
  // createVault()/grantSession(...) — not createWallet(string)/createSessionCap(...).
  // Hide the DeFi-shaped forms here and redirect users to the HSP payment flow.
  const isHashKeyContext =
    isHashKeyChain(chainId) ||
    isHashKeyChain(requiredChainId) ||
    HASHKEY_LOCAL_FORK_ENABLED ||
    HASHKEY_ONLY;
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [lastCreatedWalletId, setLastCreatedWalletId] = useState('');
  const [lastCreatedCapId, setLastCreatedCapId] = useState('');
  const [savedQueryCapId, setSavedQueryCapId] = useState('');
  const [resetFeedbackVisible, setResetFeedbackVisible] = useState(false);

  const [walletName, setWalletName] = useState('');
  const [walletStep, setWalletStep] = useState<Step>('idle');
  const [walletError, setWalletError] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();
  const [walletTxHash, setWalletTxHash] = useState<`0x${string}` | undefined>();
  const {
    data: walletReceipt,
    isSuccess: walletTxSuccess,
    isError: walletTxIsError,
    error: walletTxError,
  } = useWaitForTransactionReceipt({ hash: walletTxHash, chainId: contractChainId });

  const [capStep, setCapStep] = useState<Step>('idle');
  const [capError, setCapError] = useState<string | null>(null);
  const [capForm, setCapForm] = useState({
    walletId: '0',
    agentAddress: '',
    maxPerInterval: '1000000',
    maxTotal: '5000000',
    intervalSeconds: '3600',
    expiryHours: '24',
    name: '',
  });
  const [capTxHash, setCapTxHash] = useState<`0x${string}` | undefined>();
  const {
    data: capReceipt,
    isSuccess: capTxSuccess,
    isError: capTxIsError,
    error: capTxError,
  } = useWaitForTransactionReceipt({ hash: capTxHash, chainId: contractChainId });

  const [revokeCapId, setRevokeCapId] = useState('');
  const [revokeStep, setRevokeStep] = useState<Step>('idle');
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeTxHash, setRevokeTxHash] = useState<`0x${string}` | undefined>();
  const {
    data: revokeReceipt,
    isSuccess: revokeTxSuccess,
    isError: revokeTxIsError,
    error: revokeTxError,
  } = useWaitForTransactionReceipt({ hash: revokeTxHash, chainId: contractChainId });

  const [queryCapId, setQueryCapId] = useState('');
  const [queryEnabled, setQueryEnabled] = useState(false);
  const [expandedCapId, setExpandedCapId] = useState<string | null>(null);

  const { data: capData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAFEFLOW_VAULT_ABI,
    functionName: 'getSessionCap',
    args: queryEnabled ? [BigInt(queryCapId || '0')] : undefined,
    chainId: contractChainId,
    query: { enabled: queryEnabled && IS_CONFIGURED },
  });

  const { data: allowanceData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAFEFLOW_VAULT_ABI,
    functionName: 'getRemainingAllowance',
    args: queryEnabled ? [BigInt(queryCapId || '0')] : undefined,
    chainId: contractChainId,
    query: { enabled: queryEnabled && IS_CONFIGURED },
  });

  const contractExplorerUrl = contractChainId ? getChainExplorerAddressUrl(contractChainId, CONTRACT_ADDRESS) : null;
  const walletTxUrl = contractChainId ? getChainExplorerTxUrl(contractChainId, walletTxHash) : null;
  const capTxUrl = contractChainId ? getChainExplorerTxUrl(contractChainId, capTxHash) : null;
  const currentWalletLookup = useMemo(() => new Set(currentWallets.map(wallet => wallet.walletId)), [currentWallets]);
  const knownQueryCap = currentCaps.find(cap => cap.capId === queryCapId);
  const queriedCap = capData as SessionCapData | undefined;
  const queriedCapMissing = queryEnabled && isEmptyCap(queriedCap);

  useEffect(() => {
    if (!address || capForm.agentAddress) return;
    setCapForm(current => ({ ...current, agentAddress: address }));
  }, [address, capForm.agentAddress]);

  useEffect(() => {
    if (!currentWallets.length) return;
    if (capForm.walletId !== '0' && capForm.walletId !== '') return;
    setCapForm(current => ({ ...current, walletId: currentWallets[0].walletId }));
  }, [capForm.walletId, currentWallets]);

  useEffect(() => {
    if (walletStep !== 'pending') return;
    if (walletTxIsError && walletTxError) {
      console.error('[SessionManager] wallet receipt error:', walletTxError);
      setWalletError(walletTxError.message || t('settings.txFailed'));
      setWalletStep('error');
      return;
    }
    if (walletReceipt && walletReceipt.status === 'reverted') {
      setWalletError(t('settings.txReverted') || 'Transaction reverted on-chain.');
      setWalletStep('error');
      return;
    }
    if (!walletTxSuccess || !walletReceipt || !address) return;

    setWalletStep('success');

    for (const log of walletReceipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: SAFEFLOW_VAULT_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== 'WalletCreated') continue;

        const walletId = String(decoded.args.walletId);
        setLastCreatedWalletId(walletId);
        setCapForm(current => ({ ...current, walletId }));
        const decodedName = 'name' in decoded.args ? String(decoded.args.name) : undefined;
        upsertWallet({
          walletId,
          name: walletName || decodedName || undefined,
          savedForAddress: address,
          chainId: contractChainId,
          txHash: walletTxHash,
          source: 'created',
        });
        break;
      } catch {
        continue;
      }
    }
  }, [address, contractChainId, t, upsertWallet, walletReceipt, walletStep, walletTxError, walletTxHash, walletTxIsError, walletTxSuccess]);

  useEffect(() => {
    if (capStep !== 'pending') return;
    if (capTxIsError && capTxError) {
      console.error('[SessionManager] cap receipt error:', capTxError);
      setCapError(capTxError.message || t('settings.txFailed'));
      setCapStep('error');
      return;
    }
    if (capReceipt && capReceipt.status === 'reverted') {
      setCapError(t('settings.txReverted') || 'Transaction reverted on-chain.');
      setCapStep('error');
      return;
    }
    if (!capTxSuccess || !capReceipt || !address) return;

    setCapStep('success');

    for (const log of capReceipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: SAFEFLOW_VAULT_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== 'SessionCapCreated') continue;

        const capId = String(decoded.args.capId);
        const walletId = String(decoded.args.walletId);
        const agentAddress = decoded.args.agent as `0x${string}`;

        setLastCreatedCapId(capId);
        setQueryCapId(capId);
        setQueryEnabled(true);
        upsertCap({
          capId,
          walletId,
          name: capForm.name || undefined,
          agentAddress,
          savedForAddress: address,
          chainId: contractChainId,
          maxSpendPerInterval: capForm.maxPerInterval,
          maxSpendTotal: capForm.maxTotal,
          intervalSeconds: capForm.intervalSeconds,
          expiresAt: String(Math.floor(Date.now() / 1000) + parseInt(capForm.expiryHours, 10) * 3600),
          active: true,
          txHash: capTxHash,
          source: 'created',
        });
        break;
      } catch {
        continue;
      }
    }
  }, [address, capForm.expiryHours, capForm.intervalSeconds, capForm.maxPerInterval, capForm.maxTotal, capReceipt, capStep, capTxError, capTxHash, capTxIsError, capTxSuccess, contractChainId, t, upsertCap]);

  useEffect(() => {
    if (revokeStep !== 'pending') return;
    if (revokeTxIsError && revokeTxError) {
      console.error('[SessionManager] revoke receipt error:', revokeTxError);
      setRevokeError(revokeTxError.message || t('settings.txFailed'));
      setRevokeStep('error');
      return;
    }
    if (revokeReceipt && revokeReceipt.status === 'reverted') {
      setRevokeError(t('settings.txReverted') || 'Transaction reverted on-chain.');
      setRevokeStep('error');
      return;
    }
    if (revokeTxSuccess) setRevokeStep('success');
  }, [revokeReceipt, revokeStep, revokeTxError, revokeTxIsError, revokeTxSuccess, t]);

  useEffect(() => {
    if (!resetFeedbackVisible) return;

    const timer = window.setTimeout(() => setResetFeedbackVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [resetFeedbackVisible]);

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(label);
      window.setTimeout(() => setCopiedValue(current => (current === label ? null : current)), 1600);
    } catch (error) {
      console.error(error);
    }
  }

  const createWallet = async () => {
    setWalletError(null);
    try {
      if (isWrongExecutionChain || !contractChainId) {
        setWalletError(t('settings.wrongChain') || 'Wrong network. Please switch to the target chain.');
        setWalletStep('error');
        return;
      }

      setWalletStep('pending');
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'createWallet',
        args: [walletName],
        chainId: contractChainId,
      });
      setWalletTxHash(hash);
    } catch (error) {
      console.error('[SessionManager] createWallet failed:', error);
      const message = error instanceof Error ? (error as { shortMessage?: string }).shortMessage || error.message : String(error);
      setWalletError(message || t('settings.txFailed'));
      setWalletStep('error');
    }
  };

  const createSessionCap = async () => {
    setCapError(null);
    try {
      if (isWrongExecutionChain || !contractChainId) {
        setCapError(t('settings.wrongChain') || 'Wrong network. Please switch to the target chain.');
        setCapStep('error');
        return;
      }

      setCapStep('pending');
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + parseInt(capForm.expiryHours, 10) * 3600);
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'createSessionCap',
        args: [
          BigInt(capForm.walletId),
          capForm.agentAddress as `0x${string}`,
          BigInt(capForm.maxPerInterval),
          BigInt(capForm.maxTotal),
          BigInt(capForm.intervalSeconds),
          expiresAt,
          capForm.name,
        ],
        chainId: contractChainId,
      });
      setCapTxHash(hash);
    } catch (error) {
      console.error('[SessionManager] createSessionCap failed:', error);
      const message = error instanceof Error ? (error as { shortMessage?: string }).shortMessage || error.message : String(error);
      setCapError(message || t('settings.txFailed'));
      setCapStep('error');
    }
  };

  const revokeSessionCap = async () => {
    setRevokeError(null);
    try {
      if (isWrongExecutionChain || !contractChainId) {
        setRevokeError(t('settings.wrongChain') || 'Wrong network. Please switch to the target chain.');
        setRevokeStep('error');
        return;
      }

      setRevokeStep('pending');
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'revokeSessionCap',
        args: [BigInt(revokeCapId)],
        chainId: contractChainId,
      });
      setRevokeTxHash(hash);
    } catch (error) {
      console.error('[SessionManager] revokeSessionCap failed:', error);
      const message = error instanceof Error ? (error as { shortMessage?: string }).shortMessage || error.message : String(error);
      setRevokeError(message || t('settings.txFailed'));
      setRevokeStep('error');
    }
  };

  const importQueriedCap = () => {
    if (!queriedCap || queriedCapMissing) return;
    importCap({
      capId: queryCapId,
      walletId: String(queriedCap.walletId),
      agentAddress: queriedCap.agent,
      chainId: contractChainId,
      maxSpendPerInterval: String(queriedCap.maxSpendPerInterval),
      maxSpendTotal: String(queriedCap.maxSpendTotal),
      intervalSeconds: String(queriedCap.intervalSeconds),
      expiresAt: String(queriedCap.expiresAt),
      totalSpent: String(queriedCap.totalSpent),
      active: queriedCap.active,
    });
    setSavedQueryCapId(queryCapId);
  };

  const handleResetLocalResources = () => {
    clearCurrentResources();
    setLastCreatedWalletId('');
    setLastCreatedCapId('');
    setSavedQueryCapId('');
    setQueryCapId('');
    setQueryEnabled(false);
    setRevokeCapId('');
    setWalletStep('idle');
    setCapStep('idle');
    setRevokeStep('idle');
    setWalletTxHash(undefined);
    setCapTxHash(undefined);
    setRevokeTxHash(undefined);
    setCapForm(current => ({ ...current, walletId: '0' }));
    setResetFeedbackVisible(true);
  };

  function renderTxReference(txHash?: `0x${string}`, explorerUrl?: string | null) {
    if (!txHash) return null;

    if (explorerUrl) {
      return (
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
          {t('settings.viewTx')} <ExternalLink className="w-3 h-3" />
        </a>
      );
    }

    return <span className="break-all font-data text-muted-foreground">Tx: {txHash}</span>;
  }

  function renderCopyButton(label: string, value: string) {
    return (
      <button
        onClick={() => copyValue(label, value)}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
      >
        <Copy className="w-3 h-3" />
        {copiedValue === label ? t('settings.copied') : t('settings.copy')}
      </button>
    );
  }

  function renderResourceCenter() {
    const steps = [
      {
        id: 'wallet',
        title: t('settings.stepCreateWallet'),
        description: t('settings.stepCreateWalletDescription'),
        complete: currentWallets.length > 0,
      },
      {
        id: 'cap',
        title: t('settings.stepCreateCap'),
        description: t('settings.stepCreateCapDescription'),
        complete: currentCaps.length > 0,
      },
      {
        id: 'deposit',
        title: t('settings.stepReturnToDeposit'),
        description: t('settings.stepReturnToDepositDescription'),
        complete: currentWallets.length > 0 && currentCaps.length > 0,
      },
    ];

    return (
      <div className="sm:col-span-2 overflow-hidden rounded-[1.75rem] border border-border bg-card/70 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] glow-border">
        <div className="grid gap-5 lg:grid-cols-[1.3fr_0.9fr] lg:items-start">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              {t('settings.resourceCenterEyebrow')}
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight">{t('settings.resourceCenterTitle')}</h3>
              <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{t('settings.resourceCenterSubtitle')}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-muted-foreground">
              <span className="rounded-full border border-border bg-secondary/40 px-3 py-1">{t('settings.walletCount', { count: currentWallets.length })}</span>
              <span className="rounded-full border border-border bg-secondary/40 px-3 py-1">{t('settings.capCount', { count: currentCaps.length })}</span>
            </div>
          </div>

          <div className="grid gap-3">
            {steps.map((step, index) => (
              <div key={step.id} className="rounded-2xl border border-border bg-secondary/30 p-3.5">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step.complete ? 'bg-emerald-500/15 text-emerald-300' : 'bg-primary/10 text-primary'}`}>
                    {step.complete ? <CheckCircle className="w-3.5 h-3.5" /> : index + 1}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{step.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${step.complete ? 'bg-emerald-500/15 text-emerald-300' : 'bg-secondary text-muted-foreground'}`}>
                        {step.complete ? t('settings.stepReady') : t('settings.stepPending')}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderResourceLibrary() {
    const hasSavedResources = currentWallets.length > 0 || currentCaps.length > 0;

    return (
      <div className="sm:col-span-2 rounded-[1.5rem] border border-border bg-card/60 p-5 glow-border">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">{t('settings.libraryTitle')}</h3>
            <p className="mt-1 max-w-[62ch] text-xs leading-relaxed text-muted-foreground">{t('settings.librarySubtitle')}</p>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            {hasSavedResources && (
              <div className="flex flex-col items-start gap-2 lg:items-end">
                <button
                  onClick={handleResetLocalResources}
                  className="inline-flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-2 text-xs font-semibold text-destructive transition hover:border-destructive/30 hover:bg-destructive/15 active:translate-y-[1px]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t('settings.resetLocalResources')}
                </button>
                <p className="max-w-[30ch] text-right text-[11px] leading-relaxed text-muted-foreground">
                  {t('settings.resetLocalResourcesHint')}
                </p>
              </div>
            )}
            {(lastCreatedWalletId || lastCreatedCapId) && (
              <div className="grid gap-2 text-xs font-data sm:grid-cols-2">
                {lastCreatedWalletId && (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-emerald-200">
                    <div className="text-[10px] uppercase tracking-[0.18em]">{t('settings.latestWallet')}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span>{lastCreatedWalletId}</span>
                      {renderCopyButton(`wallet-${lastCreatedWalletId}`, lastCreatedWalletId)}
                    </div>
                  </div>
                )}
                {lastCreatedCapId && (
                  <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-primary">
                    <div className="text-[10px] uppercase tracking-[0.18em]">{t('settings.latestCap')}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span>{lastCreatedCapId}</span>
                      {renderCopyButton(`cap-${lastCreatedCapId}`, lastCreatedCapId)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {resetFeedbackVisible && (
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
            {t('settings.localResourcesReset')}
          </div>
        )}

        {!hasSavedResources ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-5 text-sm text-muted-foreground">
            {t('settings.noResources')}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-2">
              {t('settings.walletLibrary')}
              {isSyncing && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
            </div>
            {chainSyncError && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                {t('settings.chainSyncError')}: {chainSyncError}
              </div>
            )}
              {currentWallets.map((wallet: SafeFlowWalletResource) => (
                <div key={`${wallet.savedForAddress}-${wallet.walletId}`} className="rounded-2xl border border-border bg-secondary/30 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{t('settings.walletId')}</div>
                      <div className="mt-1 font-data text-base font-semibold">{wallet.name ? `${wallet.name} · #${wallet.walletId}` : wallet.walletId}</div>
                    </div>
                    {renderCopyButton(`wallet-${wallet.walletId}`, wallet.walletId)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-muted-foreground">
                    <span className="rounded-full border border-border bg-card/80 px-2.5 py-1">{wallet.source === 'created' ? t('settings.sourceCreated') : wallet.source === 'synced-chain' ? t('settings.sourceSyncedChain') : t('settings.sourceImported')}</span>
                    <button
                      onClick={() => setCapForm(current => ({ ...current, walletId: wallet.walletId }))}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary transition hover:border-primary/30 hover:bg-primary/15"
                    >
                      {t('settings.useForCap')}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('settings.capLibrary')}</div>
              {currentCaps.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-5 text-sm text-muted-foreground">
                  {t('settings.noCapsYet')}
                </div>
              ) : (
                currentCaps.map((cap: SafeFlowCapResource) => (
                  <div key={`${cap.savedForAddress}-${cap.capId}`} className="rounded-2xl border border-border bg-secondary/30 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="font-data text-base font-semibold">{cap.name ? `${cap.name} · #${cap.capId}` : t('settings.capShort', { capId: cap.capId })}</div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${cap.active === false || isExpired(cap.expiresAt) ? 'bg-destructive/15 text-destructive' : 'bg-emerald-500/15 text-emerald-300'}`}>
                            {getCapStatusLabel(cap, t)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">{t('settings.capWalletPair', { walletId: cap.walletId, agent: shortenAddress(cap.agentAddress) })}</div>
                        <div className="text-xs text-muted-foreground">{t('settings.capExpiry', { expiry: formatExpiry(cap.expiresAt) })}</div>
                      </div>
                      {renderCopyButton(`cap-${cap.capId}`, cap.capId)}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-muted-foreground">
                      <span className="rounded-full border border-border bg-card/80 px-2.5 py-1">{cap.source === 'created' ? t('settings.sourceCreated') : cap.source === 'synced-chain' ? t('settings.sourceSyncedChain') : t('settings.sourceImported')}</span>
                      <button
                        onClick={() => {
                          const next = expandedCapId === cap.capId ? null : cap.capId;
                          setExpandedCapId(next);
                          if (next) {
                            setQueryCapId(cap.capId);
                            setQueryEnabled(true);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary transition hover:border-primary/30 hover:bg-primary/15"
                      >
                        {expandedCapId === cap.capId ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {t('settings.useForQuery')}
                      </button>
                    </div>

                    {/* Inline inspect panel */}
                    {expandedCapId === cap.capId && (
                      <div className="mt-3 rounded-xl border border-border bg-background/60 p-3 text-xs font-data space-y-1.5">
                        {!queriedCap || (queryCapId !== cap.capId) ? (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" /> Loading from chain…
                          </div>
                        ) : queriedCapMissing ? (
                          <div className="text-destructive">{t('settings.capNotFound')}</div>
                        ) : (
                          <>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Wallet ID</span><span>{String(queriedCap.walletId)}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Agent</span><span className="max-w-[200px] truncate">{String(queriedCap.agent)}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Max / Interval</span><span>{String(queriedCap.maxSpendPerInterval)}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Max Total</span><span>{String(queriedCap.maxSpendTotal)}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Total Spent</span><span>{String(queriedCap.totalSpent)}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Status</span><span>{getCapStatusLabel(queriedCap, t)}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Expires</span><span>{formatExpiry(queriedCap.expiresAt)}</span></div>
                            {allowanceData && (
                              <>
                                <div className="border-t border-border pt-1.5" />
                                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Interval Remaining</span><span>{String((allowanceData as RemainingAllowanceData)[0])}</span></div>
                                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Total Remaining</span><span>{String((allowanceData as RemainingAllowanceData)[1])}</span></div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderCapResult() {
    if (!queryEnabled || !queriedCap) return null;

    if (queriedCapMissing) {
      return (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
          {t('settings.capNotFound')}
        </div>
      );
    }

    return (
      <div className="space-y-3 rounded-2xl border border-border bg-secondary/40 p-3 text-xs font-data">
        <div className="grid gap-1.5">
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.walletId')}</span><span>{String(queriedCap.walletId)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.agentAddress')}</span><span className="max-w-[200px] truncate">{String(queriedCap.agent)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.maxPerInterval')}</span><span>{String(queriedCap.maxSpendPerInterval)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.maxTotal')}</span><span>{String(queriedCap.maxSpendTotal)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.totalSpent')}</span><span>{String(queriedCap.totalSpent)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.capStatusLabel')}</span><span>{getCapStatusLabel(queriedCap, t)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.expiry')}</span><span>{formatExpiry(queriedCap.expiresAt)}</span></div>
          {allowanceData && (
            <>
              <div className="mt-1 border-t border-border pt-2" />
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.intervalRemaining')}</span><span>{String((allowanceData as RemainingAllowanceData)[0])}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('settings.totalRemaining')}</span><span>{String((allowanceData as RemainingAllowanceData)[1])}</span></div>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={importQueriedCap}
            disabled={knownQueryCap?.capId === queryCapId || savedQueryCapId === queryCapId}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary transition hover:border-primary/30 hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {knownQueryCap?.capId === queryCapId || savedQueryCapId === queryCapId ? t('settings.savedToLibrary') : t('settings.saveCap')}
          </button>
          {renderCopyButton(`query-cap-${queryCapId}`, queryCapId)}
          {!currentWalletLookup.has(String(queriedCap.walletId)) && renderCopyButton(`query-wallet-${String(queriedCap.walletId)}`, String(queriedCap.walletId))}
        </div>
      </div>
    );
  }

  function renderHashKeyNotice() {
    return (
      <div className="sm:col-span-2 rounded-[1.5rem] border border-primary/25 bg-primary/10 p-5 text-sm text-primary glow-border">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">{t('settings.hashkeyNoticeTitle')}</h3>
            <p className="leading-relaxed text-muted-foreground">{t('settings.hashkeyNoticeBody')}</p>
            <p className="leading-relaxed text-muted-foreground">{t('settings.hashkeyNoticeCta')}</p>
          </div>
        </div>
      </div>
    );
  }

  function renderCapFormUI() {
    return (
      <>
        {renderResourceCenter()}
        {renderResourceLibrary()}

        <div className="rounded-[1.5rem] border border-border bg-card/60 p-5 glow-border">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Wallet className="w-4 h-4" /> {t('settings.createWallet')}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('settings.createWalletDescription')}</p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.walletNameLabel')}</label>
              <input
                type="text"
                placeholder={t('settings.walletNamePlaceholder')}
                value={walletName}
                onChange={event => setWalletName(event.target.value)}
                className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            {walletStep === 'success' ? (
              <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/10 p-3 text-xs text-primary">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>{t('settings.walletCreated')}</span>
                </div>
                {lastCreatedWalletId && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-data">{t('settings.walletId')}: {lastCreatedWalletId}</span>
                    {renderCopyButton(`wallet-created-${lastCreatedWalletId}`, lastCreatedWalletId)}
                  </div>
                )}
                {renderTxReference(walletTxHash, walletTxUrl)}
              </div>
            ) : (
              <button
                onClick={createWallet}
                disabled={walletStep === 'pending' || !IS_CONFIGURED || isWrongExecutionChain}
                className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-30"
              >
                {walletStep === 'pending' ? <Loader2 className="mx-auto w-4 h-4 animate-spin" /> : t('settings.createWallet')}
              </button>
            )}
            {walletStep === 'error' && (
              <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 w-3.5 h-3.5 flex-shrink-0" />
                <div className="break-words">{walletError || t('settings.txFailed')}</div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card/60 p-5 glow-border">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="w-4 h-4" /> {t('settings.createSessionCap')}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('settings.createCapDescription')}</p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.walletId')}</label>
              {currentWallets.length > 0 ? (
                <select
                  value={capForm.walletId}
                  onChange={event => setCapForm(current => ({ ...current, walletId: event.target.value }))}
                  className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {currentWallets.map(wallet => (
                    <option key={`${wallet.savedForAddress}-${wallet.walletId}`} value={wallet.walletId}>
                      {wallet.name ? `${wallet.name} · #${wallet.walletId}` : `#${wallet.walletId}`}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min="0"
                  value={capForm.walletId}
                  onChange={event => setCapForm(current => ({ ...current, walletId: event.target.value }))}
                  className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.agentAddress')}</label>
                {address && (
                  <button
                    onClick={() => setCapForm(current => ({ ...current, agentAddress: address }))}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    {t('settings.useConnectedWallet')}
                  </button>
                )}
              </div>
              <input
                type="text"
                placeholder="0x..."
                value={capForm.agentAddress}
                onChange={event => setCapForm(current => ({ ...current, agentAddress: event.target.value }))}
                className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.maxPerInterval')}</label>
                <input
                  type="text"
                  placeholder="1000000"
                  value={capForm.maxPerInterval}
                  onChange={event => setCapForm(current => ({ ...current, maxPerInterval: event.target.value }))}
                  className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="mt-1 text-[10px] text-muted-foreground/70">{t('settings.rawUnitsHint')}</p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.maxTotal')}</label>
                <input
                  type="text"
                  placeholder="5000000"
                  value={capForm.maxTotal}
                  onChange={event => setCapForm(current => ({ ...current, maxTotal: event.target.value }))}
                  className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.intervalSeconds')}</label>
                <input
                  type="text"
                  placeholder="3600"
                  value={capForm.intervalSeconds}
                  onChange={event => setCapForm(current => ({ ...current, intervalSeconds: event.target.value }))}
                  className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.expiryHours')}</label>
                <input
                  type="text"
                  placeholder="24"
                  value={capForm.expiryHours}
                  onChange={event => setCapForm(current => ({ ...current, expiryHours: event.target.value }))}
                  className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.capNameLabel')}</label>
              <input
                type="text"
                placeholder={t('settings.capNamePlaceholder')}
                value={capForm.name}
                onChange={event => setCapForm(current => ({ ...current, name: event.target.value }))}
                className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {capStep === 'success' ? (
              <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/10 p-3 text-xs text-primary">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>{t('settings.capCreated')}</span>
                </div>
                {lastCreatedCapId && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-data">{t('settings.capId')}: {lastCreatedCapId}</span>
                    {renderCopyButton(`cap-created-${lastCreatedCapId}`, lastCreatedCapId)}
                  </div>
                )}
                {renderTxReference(capTxHash, capTxUrl)}
              </div>
            ) : (
              <button
                onClick={createSessionCap}
                disabled={capStep === 'pending' || !capForm.agentAddress || !IS_CONFIGURED || isWrongExecutionChain}
                className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-30"
              >
                {capStep === 'pending' ? <Loader2 className="mx-auto w-4 h-4 animate-spin" /> : t('settings.createSessionCap')}
              </button>
            )}
            {capStep === 'error' && (
              <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 w-3.5 h-3.5 flex-shrink-0" />
                <div className="break-words">{capError || t('settings.txFailed')}</div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card/60 p-5 glow-border">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldOff className="w-4 h-4" /> {t('settings.revokeCapTitle')}
          </h3>
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.capId')}</label>
              <input
                type="number"
                min="0"
                value={revokeCapId}
                onChange={event => setRevokeCapId(event.target.value)}
                className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            {revokeStep === 'success' ? (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle className="w-4 h-4" />
                {t('settings.capRevoked')}
              </div>
            ) : (
              <button
                onClick={revokeSessionCap}
                disabled={revokeStep === 'pending' || !revokeCapId || !IS_CONFIGURED || isWrongExecutionChain}
                className="w-full rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-destructive-foreground transition hover:opacity-90 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-30"
              >
                {revokeStep === 'pending' ? <Loader2 className="mx-auto w-4 h-4 animate-spin" /> : t('settings.revokeButton')}
              </button>
            )}
            {revokeStep === 'error' && (
              <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 w-3.5 h-3.5 flex-shrink-0" />
                <div className="break-words">{revokeError || t('settings.txFailed')}</div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card/60 p-5 glow-border">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Key className="w-4 h-4" /> {t('settings.importCapTitle')}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('settings.importCapDescription')}</p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('settings.capId')}</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  value={queryCapId}
                  onChange={event => {
                    setQueryCapId(event.target.value);
                    setQueryEnabled(false);
                  }}
                  className="flex-1 rounded-xl border border-border bg-input px-3 py-2 text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  onClick={() => setQueryEnabled(true)}
                  disabled={!queryCapId || !IS_CONFIGURED}
                  className="rounded-xl bg-secondary px-4 py-2 text-sm font-semibold transition hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {t('settings.queryButton')}
                </button>
              </div>
            </div>
            {renderCapResult()}
          </div>
        </div>
      </>
    );
  }

  if (!isConnected) {
    return (
      <div className="rounded-[1.5rem] border border-border bg-card/60 p-10 text-center glow-border">
        <Wallet className="mx-auto mb-3 w-10 h-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('settings.connectPrompt')}</p>
      </div>
    );
  }

  if (!IS_CONFIGURED) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 rounded-2xl border border-warning/20 bg-warning/10 p-4 text-sm text-warning-foreground">
          <AlertTriangle className="mr-1.5 inline w-4 h-4 text-warning" />
          {t('settings.contractMissing')}
        </div>
        {renderResourceCenter()}
        {renderResourceLibrary()}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-secondary/30 p-3 text-xs">
        <span className="text-muted-foreground">{t('settings.contractAddress')}</span>
        {contractExplorerUrl ? (
          <a href={contractExplorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-data text-primary hover:underline">
            {CONTRACT_ADDRESS.slice(0, 6)}...{CONTRACT_ADDRESS.slice(-4)}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="font-data text-muted-foreground">{CONTRACT_ADDRESS.slice(0, 6)}...{CONTRACT_ADDRESS.slice(-4)}</span>
        )}
      </div>
      {isHashKeyContext ? (
        <>
          {renderHashKeyNotice()}
          {renderResourceCenter()}
          {renderResourceLibrary()}
        </>
      ) : (
        renderCapFormUI()
      )}
    </div>
  );
}
