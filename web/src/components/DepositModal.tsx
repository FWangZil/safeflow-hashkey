'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, Loader2, CheckCircle, ExternalLink, AlertTriangle, Coins, Shield, ArrowDownUp } from 'lucide-react';
import { useAccount, useBalance, usePublicClient, useReadContract, useSendTransaction, useWriteContract } from 'wagmi';
import { formatUnits, keccak256, parseUnits, stringToHex } from 'viem';
import type { EarnVault, ComposerQuote } from '@/types';
import { formatTvl } from '@/lib/earn-api';
import { getChainExplorerTxUrl, getExecutionChainDisplayName, getExecutionChainId, getSupportedWalletChain, LOCAL_FORK_SOURCE_CHAIN_ID } from '@/lib/chains';
import { ERC20_ABI, getSafeFlowAddress, SAFEFLOW_VAULT_ABI } from '@/lib/contracts';
import { useSwitchOrAddChain } from '@/lib/useSwitchOrAddChain';
import { useTranslation } from '@/i18n';
import { useSafeFlowResources } from '@/lib/safeflow-resources';
import type { LiFiRoute } from '@/lib/composer';
import { type TokenInfo, ETH_ADDRESS, getSwapTokensForChain } from '@/lib/tokens';

interface DepositModalProps {
  vault: EarnVault;
  onClose: () => void;
  onOpenSettings?: () => void;
}

type DepositStep = 'input' | 'quoting' | 'confirm' | 'swapping' | 'executing' | 'success' | 'error';

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

/** Throws a descriptive error if the on-chain transaction reverted. */
async function assertReceipt(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  hash: `0x${string}`,
  label: string,
) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') {
    throw new Error(`Transaction reverted on-chain: ${label} (${hash.slice(0, 10)}…)`);
  }
  return receipt;
}

export default function DepositModal({ vault, onClose, onOpenSettings }: DepositModalProps) {
  const { t } = useTranslation();
  const { address, isConnected, chainId } = useAccount();
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [capId, setCapId] = useState('');
  const [showCustomCapInput, setShowCustomCapInput] = useState(false);
  const [showCustomWalletInput, setShowCustomWalletInput] = useState(false);
  const [step, setStep] = useState<DepositStep>('input');
  const [quote, setQuote] = useState<ComposerQuote | null>(null);
  const [routeInfo, setRouteInfo] = useState<LiFiRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  // Swap-before-deposit state
  const [swapMode, setSwapMode] = useState(false);
  const [swapSourceToken, setSwapSourceToken] = useState<TokenInfo | null>(null);
  const [swapSourceAmount, setSwapSourceAmount] = useState(''); // used when direction='from'
  const [swapDirection, setSwapDirection] = useState<'from' | 'to'>('from');
  const [swapTargetAmount, setSwapTargetAmount] = useState(''); // used when direction='to'
  const [swapPreview, setSwapPreview] = useState<{ fromAmount: string; toAmount: string; rate: string } | null>(null);
  const [swapPreviewLoading, setSwapPreviewLoading] = useState(false);
  const [swapQuote, setSwapQuote] = useState<ComposerQuote | null>(null);
  const swapPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
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

  // The source chain ID used for token address lookups (local fork uses Base token addresses)
  const tokenLookupChainId = isNaN(LOCAL_FORK_SOURCE_CHAIN_ID) ? vault.chainId : LOCAL_FORK_SOURCE_CHAIN_ID;

  // User's balance of the vault's underlying token
  const { data: underlyingBalance } = useBalance({
    address,
    token: underlyingToken?.address as `0x${string}` | undefined,
    chainId: executionChainId,
    query: { enabled: Boolean(address && underlyingToken?.address) },
  });

  // User's balance of the selected swap source token
  const { data: swapSourceBalance } = useBalance({
    address,
    token: (swapSourceToken && !swapSourceToken.isNative) ? swapSourceToken.address as `0x${string}` : undefined,
    chainId: executionChainId,
    query: { enabled: Boolean(address && swapSourceToken) },
  });
  // Native ETH balance (reused when swap source is ETH)
  const { data: nativeBalance } = useBalance({
    address,
    chainId: executionChainId,
    query: { enabled: Boolean(address) },
  });
  const effectiveSwapSourceBalance = swapSourceToken?.isNative ? nativeBalance : swapSourceBalance;

  // Available swap tokens (exclude vault underlying to prevent token→same-token)
  const swapTokenOptions = useMemo(
    () => getSwapTokensForChain(tokenLookupChainId, underlyingToken?.address),
    [tokenLookupChainId, underlyingToken?.address],
  );

  const insufficientUnderlying = Boolean(
    amount && parseFloat(amount) > 0 && underlyingBalance &&
    parseFloat(amount) > parseFloat(underlyingBalance.formatted),
  );

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
      .filter((resource): resource is { cap: typeof resource.cap; wallet: NonNullable<typeof resource.wallet> } => Boolean(resource.wallet));

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
      const first = suggestedResources[0];
      if (first?.wallet && first?.cap) {
        setWalletId(first.wallet.walletId);
        setCapId(first.cap.capId);
      }
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

  // ── Debounced swap preview (auto-computes the other side as user types) ──
  // LI.FI /v1/quote only accepts fromAmount, so for the "to" direction we use
  // a two-step approach: reference quote → derive rate → final quote.
  useEffect(() => {
    if (!swapMode || !swapSourceToken || !underlyingToken) { setSwapPreview(null); return; }
    const activeAmount = swapDirection === 'from' ? swapSourceAmount : swapTargetAmount;
    if (!activeAmount || parseFloat(activeAmount) <= 0) { setSwapPreview(null); return; }

    if (swapPreviewTimer.current) clearTimeout(swapPreviewTimer.current);
    setSwapPreviewLoading(true);

    swapPreviewTimer.current = setTimeout(async () => {
      try {
        const baseParams = {
          fromChain: String(vault.chainId),
          toChain: String(vault.chainId),
          fromToken: swapSourceToken.address,
          toToken: underlyingToken.address,
          fromAddress: address ?? ZERO_ADDRESS,
          toAddress: address ?? ZERO_ADDRESS,
        };

        let finalFromAmt: string;
        let finalToAmt: string;

        if (swapDirection === 'from') {
          // Direct: user typed fromAmount → get toAmount
          const params = new URLSearchParams({
            ...baseParams,
            fromAmount: parseUnits(swapSourceAmount, swapSourceToken.decimals).toString(),
          });
          const res = await fetch(`/api/earn/quote?${params}`);
          if (!res.ok) throw new Error('preview failed');
          const data: ComposerQuote = await res.json();
          finalFromAmt = data.action.fromAmount;
          finalToAmt = data.estimate.toAmount;
        } else {
          // Reverse: user typed desired toAmount (e.g. "10 USDC")
          // LI.FI doesn't accept toAmount, so we:
          // 1. Fetch a reference quote for 1 unit of fromToken to get the rate
          // 2. Compute estimated fromAmount = targetTo / rate
          // 3. Fetch the actual quote with that fromAmount
          const refFromWei = parseUnits('1', swapSourceToken.decimals);
          const refParams = new URLSearchParams({ ...baseParams, fromAmount: refFromWei.toString() });
          const refRes = await fetch(`/api/earn/quote?${refParams}`);
          if (!refRes.ok) throw new Error('ref quote failed');
          const refData: ComposerQuote = await refRes.json();

          const refToHuman = parseFloat(formatUnits(BigInt(refData.estimate.toAmount), tokenDecimals));
          if (refToHuman <= 0) throw new Error('zero rate');

          // rate: how many toToken per 1 fromToken
          const targetToHuman = parseFloat(swapTargetAmount);
          const estimatedFromHuman = targetToHuman / refToHuman;

          // Represent as wei safely — cap to swapSourceToken.decimals precision
          const decimalsToUse = Math.min(swapSourceToken.decimals, 12);
          const estimatedFromWei = parseUnits(estimatedFromHuman.toFixed(decimalsToUse), swapSourceToken.decimals);

          // Actual quote with the computed fromAmount
          const actualParams = new URLSearchParams({ ...baseParams, fromAmount: estimatedFromWei.toString() });
          const actualRes = await fetch(`/api/earn/quote?${actualParams}`);
          if (!actualRes.ok) throw new Error('actual quote failed');
          const actualData: ComposerQuote = await actualRes.json();
          finalFromAmt = actualData.action.fromAmount;
          finalToAmt = actualData.estimate.toAmount;
        }

        const fromHuman = parseFloat(formatUnits(BigInt(finalFromAmt), swapSourceToken.decimals));
        const toHuman = parseFloat(formatUnits(BigInt(finalToAmt), tokenDecimals));
        const rate = fromHuman > 0 ? (toHuman / fromHuman).toFixed(4) : '—';
        setSwapPreview({
          fromAmount: finalFromAmt,
          toAmount: finalToAmt,
          rate: `1 ${swapSourceToken.symbol} ≈ ${rate} ${tokenSymbol}`,
        });
      } catch {
        setSwapPreview(null);
      } finally {
        setSwapPreviewLoading(false);
      }
    }, 600);
  }, [swapMode, swapDirection, swapSourceAmount, swapTargetAmount, swapSourceToken, underlyingToken, address, vault.chainId, tokenDecimals, tokenSymbol]);

  const fetchQuote = useCallback(async () => {
    if (!safeFlowAddress || !underlyingToken || !address) return;

    // In swap mode we need: source token + at least one amount filled
    if (swapMode) {
      const okFrom = swapDirection === 'from' && Boolean(swapSourceToken && swapSourceAmount && parseFloat(swapSourceAmount) > 0);
      const okTo = swapDirection === 'to' && Boolean(swapSourceToken && swapTargetAmount && parseFloat(swapTargetAmount) > 0);
      if (!okFrom && !okTo) return;
    } else {
      if (!amount || parseFloat(amount) <= 0) return;
    }

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

      // ── Step A: if swap mode, get swap quote first (user wallet → user wallet) ──
      let depositFromAmount: string;

      if (swapMode && swapSourceToken) {
        // If we already have a preview quote from the debounced effect, reuse it
        // to avoid an extra round-trip. Otherwise recompute.
        let swapFromAmountWei: bigint;

        if (swapDirection === 'from') {
          swapFromAmountWei = parseUnits(swapSourceAmount, swapSourceToken.decimals);
        } else {
          // Reverse direction: compute fromAmount via reference quote (same algorithm as preview)
          const refFromWei = parseUnits('1', swapSourceToken.decimals);
          const refRes = await fetch(`/api/earn/quote?${new URLSearchParams({
            fromChain: String(vault.chainId),
            toChain: String(vault.chainId),
            fromToken: swapSourceToken.address,
            toToken: underlyingToken.address,
            fromAddress: address,
            toAddress: address,
            fromAmount: refFromWei.toString(),
          })}`);
          if (!refRes.ok) throw new Error('Reference quote failed');
          const refData: ComposerQuote = await refRes.json();
          const refToHuman = parseFloat(formatUnits(BigInt(refData.estimate.toAmount), tokenDecimals));
          if (refToHuman <= 0) throw new Error('Could not determine exchange rate');
          const targetToHuman = parseFloat(swapTargetAmount);
          const estimatedFromHuman = targetToHuman / refToHuman;
          const decimalsToUse = Math.min(swapSourceToken.decimals, 12);
          swapFromAmountWei = parseUnits(estimatedFromHuman.toFixed(decimalsToUse), swapSourceToken.decimals);
        }

        const swapParams = new URLSearchParams({
          fromChain: String(vault.chainId),
          toChain: String(vault.chainId),
          fromToken: swapSourceToken.address,
          toToken: underlyingToken.address,
          fromAddress: address,
          toAddress: address,
          fromAmount: swapFromAmountWei.toString(),
        });
        const swapRes = await fetch(`/api/earn/quote?${swapParams.toString()}`);
        if (!swapRes.ok) {
          const text = await swapRes.text().catch(() => '');
          throw new Error(`Swap quote failed (${swapRes.status}): ${text.slice(0, 200)}`);
        }
        const swapData: ComposerQuote = await swapRes.json();
        setSwapQuote(swapData);

        // Amount of underlying token we'll receive from swap
        depositFromAmount = swapData.estimate.toAmount;
        const depositAmountHuman = formatUnits(BigInt(depositFromAmount), tokenDecimals);
        setAmount(depositAmountHuman);
      } else {
        depositFromAmount = parseUnits(amount, tokenDecimals).toString();
        setSwapQuote(null);
      }

      // ── Step B: get deposit quote (Composer: underlying → vault, via SafeFlow) ──
      const params = new URLSearchParams({
        fromChain: String(vault.chainId),
        toChain: String(vault.chainId),
        fromToken: underlyingToken.address,
        toToken: vault.address,
        fromAddress: safeFlowAddress,
        toAddress: safeFlowAddress,
        fromAmount: depositFromAmount,
      });

      const res = await fetch(`/api/earn/quote?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Deposit quote failed (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = await res.json() as import('@/types').ComposerQuote;
      setQuote(data);

      // Fetch LI.FI routes in parallel for route display (non-blocking)
      fetch(`/api/earn/routes?${new URLSearchParams({
        fromChainId: String(vault.chainId),
        toChainId: String(vault.chainId),
        fromTokenAddress: underlyingToken.address,
        toTokenAddress: vault.address,
        fromAddress: safeFlowAddress,
        fromAmount: depositFromAmount,
      }).toString()}`)
        .then(r => r.ok ? r.json() as Promise<{ routes?: LiFiRoute[] }> : null)
        .then(routeData => {
          if (routeData?.routes?.[0]) setRouteInfo(routeData.routes[0]);
        })
        .catch(() => null);

      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get quote');
      setStep('error');
    }
  }, [address, amount, capData, safeFlowAddress, swapDirection, swapMode, swapSourceAmount, swapSourceToken, swapTargetAmount, tokenDecimals, underlyingToken, vault, walletId]);

  const executeDeposit = useCallback(async () => {
    if (!quote?.transactionRequest || !safeFlowAddress || !underlyingToken || !publicClient || !address) return;

    setError(null);

    try {
      // ── Phase 1: Execute swap if in swap mode ──────────────────────────────
      if (swapMode && swapQuote) {
        setStep('swapping');
        const swapTx = swapQuote.transactionRequest;

        // If swapSourceToken is ERC20, approve the LI.FI router for the exact quote amount
        if (swapSourceToken && !swapSourceToken.isNative) {
          const swapFromAmountWei = BigInt(swapQuote.action.fromAmount);
          setProgressLabel(`Approving ${swapSourceToken.symbol} for swap...`);
          const approvalHash = await writeContractAsync({
            address: swapSourceToken.address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [swapTx.to as `0x${string}`, swapFromAmountWei],
            chainId: executionChainId,
          });
          await assertReceipt(publicClient, approvalHash, `Approve ${swapSourceToken.symbol} for swap`);
        }

        setProgressLabel(`Swapping ${swapSourceToken?.symbol ?? 'token'} → ${tokenSymbol} via LI.FI...`);
        const swapHash = await sendTransactionAsync({
          to: swapTx.to as `0x${string}`,
          data: swapTx.data as `0x${string}`,
          value: BigInt(swapTx.value || '0'),
          chainId: executionChainId,
        });
        await assertReceipt(publicClient, swapHash, `Swap ${swapSourceToken?.symbol ?? 'token'} → ${tokenSymbol}`);
        setProgressLabel('');
      }

      // ── Phase 2: SafeFlow deposit (existing flow) ──────────────────────────
      setStep('executing');

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
          chainId: executionChainId,
          decimals: tokenDecimals,
          walletId: String(walletId),
          tokenAddress: underlyingToken.address,
        }),
      });
      const auditData = await auditRes.json().catch(() => null) as { entry?: { id: string } } | null;

      if ((tokenAllowance as bigint | undefined) === undefined || (tokenAllowance as bigint) < amountWei) {
        setProgressLabel('Approving token to SafeFlowVault...');
        const approvalHash = await writeContractAsync({
          address: underlyingToken.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [safeFlowAddress, amountWei],
          chainId: executionChainId,
        });
        await assertReceipt(publicClient, approvalHash, `Approve ${tokenSymbol} to SafeFlowVault`);
      }

      setProgressLabel('Funding SafeFlow wallet...');
      const fundHash = await writeContractAsync({
        address: safeFlowAddress,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'deposit',
        args: [BigInt(walletId), underlyingToken.address as `0x${string}`, amountWei],
        chainId: executionChainId,
      });
      await assertReceipt(publicClient, fundHash, 'Fund SafeFlow wallet');

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

      await assertReceipt(publicClient, execHash, 'executeDeposit via SafeFlowVault');
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
  }, [address, amount, amountWei, capData, capId, chainId, executionChainId, executionChainName, importCap, knownCap, parsedCapData, publicClient, quote, rememberLastUsed, remainingAllowance, safeFlowAddress, sendTransactionAsync, swapMode, swapQuote, swapSourceAmount, swapSourceToken, tokenAllowance, tokenSymbol, underlyingToken, vault, walletId, writeContractAsync]);

  const explorerUrl = getChainExplorerTxUrl(executionChainId, txHash);

  const isWrongChain = isConnected && chainId !== executionChainId;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-md animate-fade-in-up"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="bg-card border border-border rounded-2xl w-full max-w-4xl shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Header — full width */}
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border">
            <div>
              <h3 className="text-lg font-bold leading-tight">{vault.name}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{vault.protocol?.name} · {vault.network}</p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Two-column body */}
          <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">

            {/* ── Left: Vault info ── */}
            <div className="p-5 space-y-4">
              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-2.5">
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
                <div className="flex gap-2">
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
              <div className="flex flex-wrap gap-1.5">
                {vault.underlyingTokens?.map(vt => (
                  <span key={vt.address} className="px-2.5 py-1 bg-secondary rounded-md text-xs font-semibold font-data flex items-center gap-1">
                    <Coins className="w-3 h-3" />{vt.symbol}
                  </span>
                ))}
                {vault.tags?.map(tag => (
                  <span key={tag} className="px-2.5 py-1 bg-primary/10 text-primary rounded-md text-[11px] font-medium">{tag}</span>
                ))}
              </div>

              {/* ── Session Cap / Wallet selector (always visible) ── */}
              {isConnected && safeFlowAddress && (
                <div className="border-t border-border pt-4">
                  {suggestedResources.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold">{t('vaultModal.savedResourcesTitle')}</div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {t('vaultModal.savedResourcesCount', { count: suggestedResources.length })}
                        </div>
                      </div>
                      <div className="space-y-1.5">
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
                              className={`w-full rounded-xl border p-2.5 text-left transition ${selected ? 'border-primary/40 bg-primary/10 shadow-sm shadow-primary/10' : 'border-border bg-card/60 hover:border-primary/20 hover:bg-secondary/40'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                  <span className="text-xs font-semibold font-data truncate">{cap.name ? `${cap.name} · ` : ''}{t('vaultModal.capPairLabel', { capId: cap.capId, walletId: wallet.walletId })}</span>
                                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${status === 'ready' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                                    {status === 'ready' ? t('vaultModal.capReadyBadge') : status === 'expired' ? t('vaultModal.capExpiredBadge') : t('vaultModal.capInactiveBadge')}
                                  </span>
                                  {lastUsed?.capId === cap.capId && (
                                    <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                      {t('vaultModal.lastUsedBadge')}
                                    </span>
                                  )}
                                </div>
                                <span className="shrink-0 text-[10px] font-semibold text-primary">{selected ? t('vaultModal.selectedResource') : t('vaultModal.useResource')}</span>
                              </div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                                {t('vaultModal.capAgentPair', { agent: cap.agentAddress.slice(0, 6) + '...' + cap.agentAddress.slice(-4), expiry: cap.expiresAt ? new Date(Number(cap.expiresAt) * 1000).toLocaleString() : '—' })}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs">
                      <div className="font-semibold text-warning">{t('vaultModal.noSavedResourcesTitle')}</div>
                      <p className="mt-1 leading-relaxed text-muted-foreground">
                        {currentWallets.length > 0 ? t('vaultModal.noEligibleCaps') : t('vaultModal.noSavedResourcesDescription')}
                      </p>
                      {onOpenSettings && (
                        <button
                          onClick={() => { onOpenSettings(); onClose(); }}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition hover:border-primary/30 hover:bg-primary/15"
                        >
                          {t('vaultModal.openResourceCenter')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Right: Deposit action ── */}
            <div className="p-5 flex flex-col gap-4">
              {!isConnected ? (
                <div className="p-4 bg-secondary/50 rounded-xl text-center text-sm text-muted-foreground">
                  Please connect your wallet to deposit.
                </div>
              ) : !safeFlowAddress ? (
                <div className="p-4 bg-warning/10 border border-warning/20 rounded-xl text-sm">
                  <AlertTriangle className="w-4 h-4 inline mr-1.5 text-warning" />
                  SafeFlow contract is not configured. Deploy the contract and set `NEXT_PUBLIC_SAFEFLOW_CONTRACT` first.
                </div>
              ) : isWrongChain ? (
                <div className="p-4 bg-warning/10 border border-warning/20 rounded-xl text-sm space-y-3">
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

                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wider font-medium">
                      {t('vaultModal.capIdLabel')}
                    </label>
                    {currentAgentCaps.length > 0 && !showCustomCapInput ? (
                      <select
                        value={capId}
                        onChange={e => {
                          if (e.target.value === '__custom__') {
                            setShowCustomCapInput(true);
                            setCapId('');
                          } else {
                            const selected = currentAgentCaps.find(c => c.capId === e.target.value);
                            setCapId(e.target.value);
                            if (selected) setWalletId(selected.walletId);
                            setError(null);
                          }
                        }}
                        className="w-full px-4 py-2.5 bg-input border border-border rounded-xl text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/40 mb-1 cursor-pointer"
                      >
                        <option value="" disabled>{t('vaultModal.selectCapPlaceholder')}</option>
                        {currentAgentCaps.map(cap => {
                          const status = getCapStatus(cap);
                          return (
                            <option key={cap.capId} value={cap.capId}>
                              {status === 'ready' ? '✓' : '✗'} Cap #{cap.capId} · Wallet #{cap.walletId}
                            </option>
                          );
                        })}
                        <option value="__custom__">{t('vaultModal.capSelectCustom')}</option>
                      </select>
                    ) : (
                      <div className="flex gap-2 mb-1">
                        <input
                          type="number"
                          min="0"
                          value={capId}
                          onChange={e => setCapId(e.target.value)}
                          placeholder="Cap ID"
                          className="flex-1 px-4 py-2.5 bg-input border border-border rounded-xl text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                        {currentAgentCaps.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowCustomCapInput(false)}
                            className="px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors whitespace-nowrap"
                          >
                            {t('vaultModal.backToCapList')}
                          </button>
                        )}
                      </div>
                    )}
                    <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground/70">
                      {t('vaultModal.capIdHint')}
                    </p>

                    <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wider font-medium">
                      {t('vaultModal.walletIdLabel')}
                    </label>
                    {currentWallets.length > 0 && !showCustomWalletInput ? (
                      <select
                        value={walletId}
                        onChange={e => {
                          if (e.target.value === '__custom__') {
                            setShowCustomWalletInput(true);
                            setWalletId('');
                          } else {
                            setWalletId(e.target.value);
                          }
                        }}
                        className="w-full px-4 py-2.5 bg-input border border-border rounded-xl text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/40 mb-1 cursor-pointer"
                      >
                        <option value="" disabled>{t('vaultModal.selectWalletPlaceholder')}</option>
                        {currentWallets.map(wallet => (
                          <option key={wallet.walletId} value={wallet.walletId}>
                            Wallet #{wallet.walletId}
                          </option>
                        ))}
                        <option value="__custom__">{t('vaultModal.walletSelectCustom')}</option>
                      </select>
                    ) : (
                      <div className="flex gap-2 mb-1">
                        <input
                          type="number"
                          min="0"
                          value={walletId}
                          onChange={e => setWalletId(e.target.value)}
                          placeholder="Wallet ID"
                          className="flex-1 px-4 py-2.5 bg-input border border-border rounded-xl text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                        {currentWallets.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowCustomWalletInput(false)}
                            className="px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors whitespace-nowrap"
                          >
                            {t('vaultModal.backToWalletList')}
                          </button>
                        )}
                      </div>
                    )}
                    <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground/70">
                      {t('vaultModal.walletIdHint')}
                    </p>

                    {capValidation && (
                      <div className={`mb-3 rounded-xl border p-3 text-[11px] ${capValidation.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : capValidation.tone === 'error' ? 'border-destructive/20 bg-destructive/10 text-destructive' : 'border-border bg-secondary/40 text-muted-foreground'}`}>
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

                    {/* Balance + insufficient warning (non-swap mode) */}
                    {!swapMode && (
                      <>
                        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                          <label className="uppercase tracking-wider font-medium">
                            {t('vaultModal.amountLabel', { tokenSymbol })}
                          </label>
                          {underlyingBalance && (
                            <span className="font-data">Balance: {parseFloat(underlyingBalance.formatted).toFixed(4)} {tokenSymbol}</span>
                          )}
                        </div>
                        {insufficientUnderlying && (
                          <div className="mb-2 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2 text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div className="flex-1">
                              <div className="font-semibold text-amber-700 dark:text-amber-300">Insufficient {tokenSymbol}</div>
                              <button
                                onClick={() => {
                                  setSwapMode(true);
                                  if (swapTokenOptions.length > 0) setSwapSourceToken(swapTokenOptions[0]);
                                }}
                                className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-700 dark:text-amber-200 font-semibold transition"
                              >
                                <ArrowDownUp className="w-3 h-3" />
                                Swap first via LI.FI
                              </button>
                            </div>
                          </div>
                        )}
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                          placeholder={`0.00 ${tokenSymbol}`}
                          className="w-full px-4 py-2.5 bg-input border border-border rounded-xl text-sm font-data focus:outline-none focus:ring-1 focus:ring-primary/40"
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
                      </>
                    )}

                    {/* Swap-mode section — DEX-style two-sided panel */}
                    {swapMode && (
                      <div className="rounded-xl border border-primary/20 bg-card overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                          <span className="text-[10px] uppercase tracking-[0.13em] font-semibold text-primary/70 flex items-center gap-1">
                            <ArrowDownUp className="w-3 h-3" />
                            Swap via LI.FI → deposit
                          </span>
                          <button
                            onClick={() => {
                              setSwapMode(false);
                              setSwapSourceToken(null);
                              setSwapSourceAmount('');
                              setSwapTargetAmount('');
                              setSwapPreview(null);
                              setSwapQuote(null);
                            }}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </div>

                        {/* You Pay */}
                        <div className="mx-2.5 mt-1 p-3 bg-input border border-border rounded-xl">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">You pay</span>
                            {swapSourceToken && effectiveSwapSourceBalance && (
                              <button
                                onClick={() => { setSwapDirection('from'); setSwapSourceAmount(parseFloat(effectiveSwapSourceBalance.formatted).toFixed(6)); setSwapPreview(null); }}
                                className="text-[10px] text-primary hover:underline font-data transition"
                              >
                                Max {parseFloat(effectiveSwapSourceBalance.formatted).toFixed(4)} {swapSourceToken.symbol}
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={swapSourceToken?.address ?? ''}
                              onChange={e => {
                                const tok = swapTokenOptions.find(x => x.address === e.target.value);
                                setSwapSourceToken(tok ?? null);
                                setSwapPreview(null);
                              }}
                              className="shrink-0 px-2.5 py-1.5 bg-secondary border border-border rounded-lg text-sm font-semibold font-data focus:outline-none cursor-pointer"
                            >
                              <option value="" disabled>Select</option>
                              {swapTokenOptions.map(tok => (
                                <option key={tok.address} value={tok.address}>{tok.symbol}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={
                                swapDirection === 'from'
                                  ? swapSourceAmount
                                  : (swapPreview && !swapPreviewLoading
                                      ? parseFloat(formatUnits(BigInt(swapPreview.fromAmount), swapSourceToken?.decimals ?? 18)).toFixed(6)
                                      : '')
                              }
                              onChange={e => { setSwapDirection('from'); setSwapSourceAmount(e.target.value); setSwapPreview(null); }}
                              placeholder="0.00"
                              className={`flex-1 min-w-0 text-right text-lg font-data font-semibold bg-transparent outline-none placeholder:text-muted-foreground/40 ${swapDirection === 'to' && !swapPreviewLoading ? 'text-muted-foreground' : 'text-foreground'}`}
                            />
                          </div>
                        </div>

                        {/* Swap arrow divider */}
                        <div className="flex items-center justify-center py-1.5">
                          <div className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground">
                            <ArrowDownUp className="w-3.5 h-3.5" />
                          </div>
                        </div>

                        {/* You Receive */}
                        <div className="mx-2.5 p-3 bg-secondary/40 border border-border rounded-xl">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">You receive <span className="normal-case">(then deposit)</span></span>
                            {underlyingBalance && (
                              <span className="text-[10px] text-muted-foreground font-data">
                                Bal {parseFloat(underlyingBalance.formatted).toFixed(4)} {tokenSymbol}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="shrink-0 px-2.5 py-1.5 bg-secondary/70 border border-border rounded-lg text-sm font-semibold font-data text-muted-foreground">
                              {tokenSymbol}
                            </div>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={
                                swapDirection === 'to'
                                  ? swapTargetAmount
                                  : (swapPreview && !swapPreviewLoading
                                      ? parseFloat(formatUnits(BigInt(swapPreview.toAmount), tokenDecimals)).toFixed(6)
                                      : '')
                              }
                              onChange={e => { setSwapDirection('to'); setSwapTargetAmount(e.target.value); setSwapPreview(null); }}
                              placeholder="0.00"
                              className={`flex-1 min-w-0 text-right text-lg font-data font-semibold bg-transparent outline-none placeholder:text-muted-foreground/40 ${swapDirection === 'from' && !swapPreviewLoading ? 'text-muted-foreground' : 'text-foreground'}`}
                            />
                          </div>
                        </div>

                        {/* Rate / loading */}
                        <div className="px-3 py-2 min-h-[28px] flex items-center text-[10px] text-muted-foreground">
                          {swapPreviewLoading ? (
                            <span className="flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Fetching rate...
                            </span>
                          ) : swapPreview ? (
                            <span className="font-data">{swapPreview.rate}</span>
                          ) : (
                            <span className="italic opacity-60">Enter an amount on either side</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={fetchQuote}
                    disabled={
                      !walletId || !capId || capValidation?.tone === 'error' ||
                      (swapMode
                        ? !swapSourceToken || (swapDirection === 'from'
                            ? !swapSourceAmount || parseFloat(swapSourceAmount) <= 0
                            : !swapTargetAmount || parseFloat(swapTargetAmount) <= 0)
                        : !amount || parseFloat(amount) <= 0)
                    }
                    className="w-full px-4 py-3 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {swapMode
                      ? `Swap ${swapSourceToken?.symbol ?? ''} → ${tokenSymbol} + Deposit`
                      : t('vaultModal.buildQuote')}
                  </button>
                  <p className="text-[10px] text-muted-foreground/50 text-center flex items-center justify-center gap-1">
                    <Shield className="w-3 h-3" />
                    SessionCap protection is enforced by SafeFlowVault.executeDeposit()
                  </p>
                </div>
              ) : step === 'quoting' ? (
                <div className="flex-1 flex flex-col items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mb-3" />
                  <p className="text-sm text-muted-foreground text-center">Building SafeFlow-compatible transaction via LI.FI Composer...</p>
                </div>
              ) : step === 'swapping' ? (
                <div className="flex-1 flex flex-col items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mb-3" />
                  <p className="text-sm text-muted-foreground text-center">{progressLabel || `Swapping via LI.FI...`}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1 text-center">Step 1 of 2 — swap will be followed by SafeFlow deposit</p>
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

                  {/* Swap preview — shown when swap-before-deposit is active */}
                  {swapQuote && swapSourceToken && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-1.5 text-xs">
                      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-amber-700/80 dark:text-amber-400/70">Step 1 — Swap via LI.FI</div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">From</span>
                        <span className="font-data font-semibold">{swapSourceAmount} {swapSourceToken.symbol}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">To (approx.)</span>
                        <span className="font-data">{formatUnits(BigInt(swapQuote.estimate.toAmount), tokenDecimals)} {tokenSymbol}</span>
                      </div>
                    </div>
                  )}

                  {/* LI.FI Route info */}
                  {routeInfo && routeInfo.steps.length > 0 && (
                    <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl space-y-1.5">
                      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2">
                        LI.FI Route
                      </div>
                      {routeInfo.steps.map((step, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground capitalize">{step.type}</span>
                          <span className="font-semibold font-data text-primary">
                            via {step.toolDetails?.name ?? step.tool}
                          </span>
                        </div>
                      ))}
                      {routeInfo.tags?.includes('RECOMMENDED') && (
                        <div className="text-[10px] text-primary/70 font-medium mt-1">✓ Recommended route</div>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setStep('input'); setQuote(null); setRouteInfo(null); }}
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
                <div className="flex-1 flex flex-col items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mb-3" />
                  <p className="text-sm text-muted-foreground">{progressLabel || 'Preparing SafeFlow transaction flow...'}</p>
                </div>
              ) : step === 'success' ? (
                <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
                  <CheckCircle className="w-8 h-8 text-success mb-3" />
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
