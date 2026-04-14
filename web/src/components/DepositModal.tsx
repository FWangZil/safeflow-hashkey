'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Loader2, CheckCircle, ExternalLink, AlertTriangle, Coins, Shield } from 'lucide-react';
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { keccak256, parseUnits, stringToHex } from 'viem';
import type { EarnVault, ComposerQuote } from '@/types';
import { formatTvl } from '@/lib/earn-api';
import { getChainExplorerTxUrl, getExecutionChainDisplayName, getExecutionChainId, getSupportedWalletChain } from '@/lib/chains';
import { ERC20_ABI, getSafeFlowAddress, SAFEFLOW_VAULT_ABI } from '@/lib/contracts';
import { useSwitchOrAddChain } from '@/lib/useSwitchOrAddChain';
import { useTranslation } from '@/i18n';
import { useSafeFlowResources } from '@/lib/safeflow-resources';

interface DepositModalProps {
  vault: EarnVault;
  onClose: () => void;
  onOpenSettings?: () => void;
}

type DepositStep = 'input' | 'quoting' | 'confirm' | 'executing' | 'success' | 'error';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function isCapExpired(expiresAt: bigint | undefined) {
  if (!expiresAt) return false;
  return Number(expiresAt) * 1000 < Date.now();
}

function isEmptyCapData(cap?: {
  walletId: bigint;
  agent: string;
  maxSpendPerInterval: bigint;
  maxSpendTotal: bigint;
  intervalSeconds: bigint;
  expiresAt: bigint;
  active: boolean;
}) {
  if (!cap) return false;
  return (
    cap.walletId === 0n &&
    cap.agent.toLowerCase() === ZERO_ADDRESS &&
    cap.maxSpendPerInterval === 0n &&
    cap.maxSpendTotal === 0n &&
    cap.intervalSeconds === 0n &&
    cap.expiresAt === 0n &&
    !cap.active
  );
}

function getCapStatus(cap: { active?: boolean; expiresAt?: string | bigint }) {
  if (cap.active === false) return 'inactive';
  if (isCapExpired(typeof cap.expiresAt === 'string' ? BigInt(cap.expiresAt) : cap.expiresAt)) return 'expired';
  return 'ready';
}

export default function DepositModal({ vault, onClose, onOpenSettings }: DepositModalProps) {
  const { t } = useTranslation();
  const { address, isConnected, chainId } = useAccount();
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [capId, setCapId] = useState('');
  const [step, setStep] = useState<DepositStep>('input');
  const [quote, setQuote] = useState<ComposerQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();
  const { currentAgentCaps, currentWallets, currentCaps, importCap, lastUsed, rememberLastUsed } = useSafeFlowResources();

  const underlyingToken = vault.underlyingTokens?.[0];
  const tokenSymbol = underlyingToken?.symbol || '?';
  const tokenDecimals = underlyingToken?.decimals || 18;
  const executionChainId = getExecutionChainId(vault.chainId);
  const executionChainName = getExecutionChainDisplayName(vault.network, vault.chainId);
  const targetChain = getSupportedWalletChain(executionChainId);
  const { isSwitchingChain, switchError, switchOrAddChain } = useSwitchOrAddChain(targetChain, executionChainId);
  const publicClient = usePublicClient({ chainId: executionChainId });
  const safeFlowAddress = (() => {
    try {
      return getSafeFlowAddress();
    } catch {
      return null;
    }
  })();
  const amountWei = amount && parseFloat(amount) > 0 ? parseUnits(amount, tokenDecimals) : BigInt(0);

  const { data: capData, isLoading: isCapLoading } = useReadContract({
    address: safeFlowAddress ?? undefined,
    abi: SAFEFLOW_VAULT_ABI,
    functionName: 'getSessionCap',
    args: safeFlowAddress ? [BigInt(capId || '0')] : undefined,
    query: { enabled: Boolean(safeFlowAddress && capId !== '') },
  });

  const { data: remainingAllowance } = useReadContract({
    address: safeFlowAddress ?? undefined,
    abi: SAFEFLOW_VAULT_ABI,
    functionName: 'getRemainingAllowance',
    args: safeFlowAddress ? [BigInt(capId || '0')] : undefined,
    query: { enabled: Boolean(safeFlowAddress && capId !== '') },
  });

  const { data: tokenAllowance } = useReadContract({
    address: underlyingToken?.address as `0x${string}` | undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && safeFlowAddress ? [address, safeFlowAddress] : undefined,
    query: { enabled: Boolean(address && safeFlowAddress && underlyingToken?.address) },
  });

  const suggestedResources = useMemo(() => {
    const pairedResources = currentAgentCaps
      .map(cap => ({
        cap,
        wallet: currentWallets.find(wallet => wallet.walletId === cap.walletId),
      }))
      .filter(resource => Boolean(resource.wallet));

    return pairedResources.sort((left, right) => {
      if (lastUsed?.capId === left.cap.capId) return -1;
      if (lastUsed?.capId === right.cap.capId) return 1;
      return right.cap.createdAt - left.cap.createdAt;
    });
  }, [currentAgentCaps, currentWallets, lastUsed]);

  const parsedCapData = capData as {
    walletId: bigint;
    agent: string;
    maxSpendPerInterval: bigint;
    maxSpendTotal: bigint;
    intervalSeconds: bigint;
    expiresAt: bigint;
    totalSpent: bigint;
    active: boolean;
  } | undefined;

  const capNotFound = Boolean(capId && parsedCapData && isEmptyCapData(parsedCapData));
  const knownCap = currentCaps.find(resource => resource.capId === capId);

  useEffect(() => {
    if (walletId || capId) return;

    if (lastUsed) {
      setWalletId(lastUsed.walletId);
      setCapId(lastUsed.capId);
      return;
    }

    if (suggestedResources.length === 1) {
      setWalletId(suggestedResources[0].wallet.walletId);
      setCapId(suggestedResources[0].cap.capId);
    }
  }, [capId, lastUsed, suggestedResources, walletId]);

  useEffect(() => {
    if (!parsedCapData || capNotFound) return;
    const nextWalletId = String(parsedCapData.walletId);
    if (walletId !== nextWalletId) {
      setWalletId(nextWalletId);
    }
  }, [capNotFound, parsedCapData, walletId]);

  const capValidation = useMemo(() => {
    if (!capId) return null;
    if (isCapLoading) {
      return { tone: 'info' as const, message: t('vaultModal.capLoading') };
    }
    if (!parsedCapData || capNotFound) {
      return { tone: 'error' as const, message: t('vaultModal.capNotFound') };
    }
    if (!parsedCapData.active) {
      return { tone: 'error' as const, message: t('vaultModal.capInactive') };
    }
    if (isCapExpired(parsedCapData.expiresAt)) {
      return { tone: 'error' as const, message: t('vaultModal.capExpired') };
    }
    if (address && parsedCapData.agent.toLowerCase() !== address.toLowerCase()) {
      return { tone: 'error' as const, message: t('vaultModal.capWrongAgent') };
    }
    return { tone: 'success' as const, message: t('vaultModal.capReady') };
  }, [address, capId, capNotFound, isCapLoading, parsedCapData, t]);

  const fetchQuote = useCallback(async () => {
    if (!address || !amount || parseFloat(amount) <= 0 || !safeFlowAddress || !underlyingToken) return;

    setStep('quoting');
    setError(null);

    try {
      if (!capData) {
        throw new Error('SessionCap not found. Please enter a valid cap ID.');
      }

      const cap = capData as {
        walletId: bigint;
        agent: string;
        expiresAt: bigint;
        active: boolean;
      };

      if (!cap.active) {
        throw new Error('SessionCap is not active.');
      }
      if (isCapExpired(cap.expiresAt)) {
        throw new Error('SessionCap has expired. Create or import a fresh cap before depositing.');
      }
      if (cap.walletId !== BigInt(walletId)) {
        throw new Error('Wallet ID does not match the selected SessionCap.');
      }
      if (cap.agent.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Connected wallet is not the authorized SessionCap agent.');
      }

      const fromAmount = parseUnits(amount, tokenDecimals).toString();

      const params = new URLSearchParams({
        fromChain: String(vault.chainId),
        toChain: String(vault.chainId),
        fromToken: underlyingToken.address,
        toToken: vault.address,
        fromAddress: safeFlowAddress,
        toAddress: safeFlowAddress,
        fromAmount,
      });

      const res = await fetch(`/api/earn/quote?${params.toString()}`);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Quote failed (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      setQuote(data);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get quote');
      setStep('error');
    }
  }, [address, amount, capData, safeFlowAddress, tokenDecimals, underlyingToken, vault, walletId]);

  const executeDeposit = useCallback(async () => {
    if (!quote?.transactionRequest || !safeFlowAddress || !underlyingToken || !publicClient || !address) return;

    setStep('executing');
    setError(null);

    try {
      const tx = quote.transactionRequest;
      if (BigInt(tx.value || '0') !== BigInt(0)) {
        throw new Error('SafeFlow executeDeposit currently supports ERC-20 deposits only.');
      }

      const cap = capData as {
        walletId: bigint;
        agent: string;
        active: boolean;
      } | undefined;

      if (!cap?.active) {
        throw new Error('SessionCap is not active.');
      }
      if (isCapExpired((capData as { expiresAt: bigint } | undefined)?.expiresAt)) {
        throw new Error('SessionCap has expired. Create or import a fresh cap before depositing.');
      }
      if (cap.walletId !== BigInt(walletId)) {
        throw new Error('Wallet ID does not match the selected SessionCap.');
      }
      if (cap.agent.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Connected wallet is not the authorized SessionCap agent.');
      }
      if (chainId !== executionChainId) {
        throw new Error(`Please switch to ${executionChainName} (Chain ${executionChainId}) before depositing.`);
      }

      if (remainingAllowance) {
        const [intervalRemaining, totalRemaining] = remainingAllowance as [bigint, bigint];
        if (intervalRemaining < amountWei) {
          throw new Error('Amount exceeds the remaining per-interval SessionCap allowance.');
        }
        if (totalRemaining < amountWei) {
          throw new Error('Amount exceeds the remaining total SessionCap allowance.');
        }
      }

      const evidencePayload = JSON.stringify({
        walletId,
        capId,
        vault: vault.address,
        target: tx.to,
        token: underlyingToken.address,
        symbol: tokenSymbol,
        amount,
        chainId: executionChainId,
        sourceChainId: vault.chainId,
      });
      const evidenceHash = keccak256(stringToHex(evidencePayload));

      const auditRes = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentAddress: address,
          action: 'executeDeposit',
          vault: tx.to,
          vaultName: vault.name,
          token: tokenSymbol,
          amount: amountWei.toString(),
          reasoning: `SafeFlow wallet ${walletId} executes SessionCap ${capId} deposit into ${vault.name} on ${executionChainName}`,
          riskScore: 1,
        }),
      });
      const auditData = await auditRes.json().catch(() => null);

      if ((tokenAllowance as bigint | undefined) === undefined || (tokenAllowance as bigint) < amountWei) {
        setProgressLabel('Approving token to SafeFlowVault...');
        const approvalHash = await writeContractAsync({
          address: underlyingToken.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [safeFlowAddress, amountWei],
          chainId: executionChainId,
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      }

      setProgressLabel('Funding SafeFlow wallet...');
      const fundHash = await writeContractAsync({
        address: safeFlowAddress,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'deposit',
        args: [BigInt(walletId), underlyingToken.address as `0x${string}`, amountWei],
        chainId: executionChainId,
      });
      await publicClient.waitForTransactionReceipt({ hash: fundHash });

      setProgressLabel('Executing SessionCap-protected deposit...');
      const execHash = await writeContractAsync({
        address: safeFlowAddress,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'executeDeposit',
        args: [
          BigInt(capId),
          underlyingToken.address as `0x${string}`,
          amountWei,
          tx.to as `0x${string}`,
          evidenceHash,
          tx.data as `0x${string}`,
        ],
        chainId: executionChainId,
      });

      await publicClient.waitForTransactionReceipt({ hash: execHash });
      setTxHash(execHash);

      if (parsedCapData && !knownCap) {
        importCap({
          capId,
          walletId,
          agentAddress: parsedCapData.agent as `0x${string}`,
          chainId: executionChainId,
          maxSpendPerInterval: String(parsedCapData.maxSpendPerInterval),
          maxSpendTotal: String(parsedCapData.maxSpendTotal),
          intervalSeconds: String(parsedCapData.intervalSeconds),
          expiresAt: String(parsedCapData.expiresAt),
          totalSpent: String(parsedCapData.totalSpent),
          active: parsedCapData.active,
        });
      }
      rememberLastUsed({ walletId, capId });

      if (auditData?.entry?.id) {
        await fetch('/api/audit', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: auditData.entry.id, txHash: execHash, status: 'executed' }),
        });
      }

      setStep('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      if (msg.includes('User rejected') || msg.includes('denied')) {
        setStep('confirm');
        setProgressLabel('');
        return;
      }
      setError(msg);
      setProgressLabel('');
      setStep('error');
    }
  }, [address, amount, amountWei, capData, capId, chainId, executionChainId, executionChainName, importCap, knownCap, parsedCapData, publicClient, quote, rememberLastUsed, remainingAllowance, safeFlowAddress, tokenAllowance, tokenSymbol, underlyingToken, vault, walletId, writeContractAsync]);

  const explorerUrl = getChainExplorerTxUrl(executionChainId, txHash);

  const isWrongChain = isConnected && chainId !== executionChainId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in-up" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold leading-tight">{vault.name}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{vault.protocol?.name} · {vault.network}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          <div className="p-3 bg-input rounded-xl border border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('vaultModal.totalApy')}</div>
            <div className="text-lg font-bold text-success font-data text-glow-success mt-0.5">
              {vault.analytics?.apy?.total?.toFixed(2) ?? t('common.na')}%
            </div>
          </div>
          <div className="p-3 bg-input rounded-xl border border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('vaultModal.tvl')}</div>
            <div className="text-lg font-bold font-data mt-0.5">
              {formatTvl(vault.analytics?.tvl?.usd)}
            </div>
          </div>
          <div className="p-3 bg-input rounded-xl border border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('vaultModal.baseApy')}</div>
            <div className="font-medium font-data mt-0.5">{vault.analytics?.apy?.base?.toFixed(2) ?? t('common.na')}%</div>
          </div>
          <div className="p-3 bg-input rounded-xl border border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('vaultModal.rewardApy')}</div>
            <div className="font-medium font-data mt-0.5">{vault.analytics?.apy?.reward?.toFixed(2) ?? '0'}%</div>
          </div>
        </div>

        {/* APY Trends */}
        {(vault.analytics?.apy1d != null || vault.analytics?.apy7d != null || vault.analytics?.apy30d != null) && (
          <div className="flex gap-2 mb-4">
            {vault.analytics.apy1d != null && (
              <div className="flex-1 p-2 bg-secondary/50 rounded-lg text-center">
                <div className="text-[9px] text-muted-foreground uppercase">1d</div>
                <div className="text-xs font-bold font-data">{vault.analytics.apy1d.toFixed(2)}%</div>
              </div>
            )}
            {vault.analytics.apy7d != null && (
              <div className="flex-1 p-2 bg-secondary/50 rounded-lg text-center">
                <div className="text-[9px] text-muted-foreground uppercase">7d</div>
                <div className="text-xs font-bold font-data">{vault.analytics.apy7d.toFixed(2)}%</div>
              </div>
            )}
            {vault.analytics.apy30d != null && (
              <div className="flex-1 p-2 bg-secondary/50 rounded-lg text-center">
                <div className="text-[9px] text-muted-foreground uppercase">30d</div>
                <div className="text-xs font-bold font-data">{vault.analytics.apy30d.toFixed(2)}%</div>
              </div>
            )}
          </div>
        )}

        {/* Tokens & Tags */}
        <div className="flex flex-wrap gap-1.5 mb-5">
          {vault.underlyingTokens?.map(vt => (
            <span key={vt.address} className="px-2.5 py-1 bg-secondary rounded-md text-xs font-semibold font-data flex items-center gap-1">
              <Coins className="w-3 h-3" />{vt.symbol}
            </span>
          ))}
          {vault.tags?.map(tag => (
            <span key={tag} className="px-2.5 py-1 bg-primary/10 text-primary rounded-md text-[11px] font-medium">{tag}</span>
          ))}
        </div>

        {/* Deposit Flow */}
        {!isConnected ? (
          <div className="p-4 bg-secondary/50 rounded-xl text-center text-sm text-muted-foreground">
            Please connect your wallet to deposit.
          </div>
        ) : !safeFlowAddress ? (
          <div className="p-4 bg-warning/10 border border-warning/20 rounded-xl text-center text-sm">
            <AlertTriangle className="w-4 h-4 inline mr-1.5 text-warning" />
            SafeFlow contract is not configured. Deploy the contract and set `NEXT_PUBLIC_SAFEFLOW_CONTRACT` first.
          </div>
        ) : isWrongChain ? (
          <div className="p-4 bg-warning/10 border border-warning/20 rounded-xl text-center text-sm space-y-3">
            <div>
              <AlertTriangle className="w-4 h-4 inline mr-1.5 text-warning" />
              Switch your wallet to {executionChainName} (Chain {executionChainId}) to continue.
            </div>
            {switchError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-xs text-left">
                {switchError}
              </div>
            )}
            <button
              onClick={switchOrAddChain}
              disabled={isSwitchingChain || !targetChain}
              className="w-full px-4 py-3 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isSwitchingChain ? 'Waiting for wallet...' : `Switch to ${executionChainName}`}
            </button>
            {!targetChain && (
              <div className="text-xs text-muted-foreground">
                This network is not configured in the app yet.
              </div>
            )}
          </div>
        ) : step === 'input' || step === 'error' ? (
          <div className="space-y-3">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-xs">
                {error}
              </div>
            )}

            {suggestedResources.length > 0 ? (
              <div className="rounded-2xl border border-border bg-secondary/30 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{t('vaultModal.savedResourcesTitle')}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{t('vaultModal.savedResourcesSubtitle')}</div>
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t('vaultModal.savedResourcesCount', { count: suggestedResources.length })}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {suggestedResources.slice(0, 3).map(({ cap, wallet }) => {
                    const selected = capId === cap.capId;
                    const status = getCapStatus(cap);

                    return (
                      <button
                        key={cap.capId}
                        onClick={() => {
                          setCapId(cap.capId);
                          setWalletId(wallet.walletId);
                          setError(null);
                        }}
                        className={`w-full rounded-2xl border p-3 text-left transition ${selected ? 'border-primary/30 bg-primary/10 shadow-lg shadow-primary/5' : 'border-border bg-card/60 hover:border-primary/20 hover:bg-card'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold font-data">{t('vaultModal.capPairLabel', { capId: cap.capId, walletId: wallet.walletId })}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${status === 'ready' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                                {status === 'ready' ? t('vaultModal.capReadyBadge') : status === 'expired' ? t('vaultModal.capExpiredBadge') : t('vaultModal.capInactiveBadge')}
                              </span>
                              {lastUsed?.capId === cap.capId && (
                                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                  {t('vaultModal.lastUsedBadge')}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {t('vaultModal.capAgentPair', { agent: cap.agentAddress.slice(0, 6) + '...' + cap.agentAddress.slice(-4), expiry: cap.expiresAt ? new Date(Number(cap.expiresAt) * 1000).toLocaleString() : '—' })}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-primary">{selected ? t('vaultModal.selectedResource') : t('vaultModal.useResource')}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-warning/20 bg-warning/10 p-3.5 text-sm">
                <div className="font-semibold">{t('vaultModal.noSavedResourcesTitle')}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {currentWallets.length > 0 ? t('vaultModal.noEligibleCaps') : t('vaultModal.noSavedResourcesDescription')}
                </p>
                {onOpenSettings && (
                  <button
                    onClick={() => {
                      onOpenSettings();
                      onClose();
                    }}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:border-primary/30 hover:bg-primary/15"
                  >
                    {t('vaultModal.openResourceCenter')}
                  </button>
                )}
              </div>
            )}

            <div>
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wider font-medium">
                {t('vaultModal.capIdLabel')}
              </label>
              <input
                type="number"
                min="0"
                value={capId}
                onChange={e => setCapId(e.target.value)}
                className="w-full px-4 py-3 bg-input border border-border rounded-xl text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/40 mb-3"
              />
              <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground/70">
                {t('vaultModal.capIdHint')}
              </p>

              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wider font-medium">
                {t('vaultModal.walletIdLabel')}
              </label>
              <input
                type="number"
                min="0"
                value={walletId}
                onChange={e => setWalletId(e.target.value)}
                className="w-full px-4 py-3 bg-input border border-border rounded-xl text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/40 mb-3"
              />
              <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground/70">
                {t('vaultModal.walletIdHint')}
              </p>

              {capValidation && (
                <div className={`mb-3 rounded-xl border p-3 text-[11px] ${capValidation.tone === 'success' ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200' : capValidation.tone === 'error' ? 'border-destructive/20 bg-destructive/10 text-destructive' : 'border-border bg-secondary/40 text-muted-foreground'}`}>
                  <div className="font-semibold">{capValidation.message}</div>
                  {parsedCapData && !capNotFound && (
                    <div className="mt-2 space-y-1 font-data">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('vaultModal.capAgent')}</span>
                        <span className={parsedCapData.agent.toLowerCase() === address?.toLowerCase() ? 'text-success' : ''}>
                          {parsedCapData.agent.slice(0, 6)}...{parsedCapData.agent.slice(-4)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('vaultModal.capWallet')}</span>
                        <span>{String(parsedCapData.walletId)}</span>
                      </div>
                      {remainingAllowance && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('vaultModal.intervalRemaining')}</span>
                            <span>{String((remainingAllowance as [bigint, bigint])[0])}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('vaultModal.totalRemaining')}</span>
                            <span>{String((remainingAllowance as [bigint, bigint])[1])}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {parsedCapData && !capNotFound && !knownCap && capValidation.tone === 'success' && (
                    <button
                      onClick={() => importCap({
                        capId,
                        walletId: String(parsedCapData.walletId),
                        agentAddress: parsedCapData.agent as `0x${string}`,
                        chainId: executionChainId,
                        maxSpendPerInterval: String(parsedCapData.maxSpendPerInterval),
                        maxSpendTotal: String(parsedCapData.maxSpendTotal),
                        intervalSeconds: String(parsedCapData.intervalSeconds),
                        expiresAt: String(parsedCapData.expiresAt),
                        totalSpent: String(parsedCapData.totalSpent),
                        active: parsedCapData.active,
                      })}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary transition hover:border-primary/30 hover:bg-primary/15"
                    >
                      {t('vaultModal.saveCapForLater')}
                    </button>
                  )}
                </div>
              )}

              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wider font-medium">
                {t('vaultModal.amountLabel', { tokenSymbol })}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={`0.00 ${tokenSymbol}`}
                className="w-full px-4 py-3 bg-input border border-border rounded-xl text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <div className="flex gap-1.5 mt-1.5">
                {['0.01', '0.02', '0.05', '0.1'].map(preset => (
                  <button
                    key={preset}
                    onClick={() => setAmount(preset)}
                    className="px-2 py-0.5 bg-secondary/80 rounded-md text-[10px] font-data hover:bg-secondary transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={fetchQuote}
              disabled={!amount || parseFloat(amount) <= 0 || !walletId || !capId || capValidation?.tone === 'error'}
              className="w-full px-4 py-3 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t('vaultModal.buildQuote')}
            </button>
          </div>
        ) : step === 'quoting' ? (
          <div className="p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Building SafeFlow-compatible transaction via LI.FI Composer...</p>
          </div>
        ) : step === 'confirm' && quote ? (
          <div className="space-y-3">
            <div className="p-3 bg-secondary/50 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Wallet ID</span>
                <span className="font-data">{walletId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">SessionCap ID</span>
                <span className="font-data">{capId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deposit</span>
                <span className="font-data font-semibold">{amount} {tokenSymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vault</span>
                <span className="font-data">{vault.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Execution</span>
                <span className="font-data">approve → fund wallet → executeDeposit</span>
              </div>
              {quote.estimate?.gasCosts?.[0] && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Gas</span>
                  <span className="font-data">${quote.estimate.gasCosts[0].amountUSD}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Chain</span>
                <span className="font-data">{executionChainName}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('input'); setQuote(null); }}
                className="flex-1 px-4 py-3 border border-border rounded-xl text-sm font-semibold hover:bg-secondary transition-colors"
              >
                Back
              </button>
              <button
                onClick={executeDeposit}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
              >
                Execute via SafeFlow
              </button>
            </div>
          </div>
        ) : step === 'executing' ? (
          <div className="p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{progressLabel || 'Preparing SafeFlow transaction flow...'}</p>
          </div>
        ) : step === 'success' ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-8 h-8 text-success mx-auto mb-3" />
            <p className="text-sm font-semibold">SessionCap-Protected Deposit Successful!</p>
            <p className="text-xs text-muted-foreground mt-1">
              {amount} {tokenSymbol} moved through SafeFlow wallet {walletId} into {vault.name}
            </p>
            {txHash && explorerUrl && (
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-3 text-xs text-primary hover:underline">
                View executeDeposit on Explorer <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {txHash && !explorerUrl && (
              <div className="mt-3 text-xs text-muted-foreground font-data break-all">
                Tx Hash: {txHash}
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full mt-4 px-4 py-3 border border-border rounded-xl text-sm font-semibold hover:bg-secondary transition-colors"
            >
              Close
            </button>
          </div>
        ) : null}

        {step === 'input' && (
          <p className="text-[10px] text-muted-foreground/50 text-center mt-2 flex items-center justify-center gap-1">
            <Shield className="w-3 h-3" />
            SessionCap protection is enforced by SafeFlowVault.executeDeposit()
          </p>
        )}
      </div>
    </div>
  );
}
