'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { encodeFunctionData, keccak256, toHex } from 'viem';
import { Loader2, ArrowDownToLine, CheckCircle2, AlertCircle, Wallet, ShieldPlus, ChevronDown, ChevronUp } from 'lucide-react';
import { getSafeFlowAddress, SAFEFLOW_VAULT_ABI, ERC20_ABI } from '@/lib/contracts';
import { useSafeFlowResources } from '@/lib/safeflow-resources';
import type { RecallActionData } from '@/types';

// Minimal ERC4626 ABI for redeem
const ERC4626_REDEEM_ABI = [
  {
    type: 'function',
    name: 'redeem',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export default function RecallActionCard({
  walletId,
  capId: initialCapId,
  tokenAddress,
  vaultAddress,
  symbol,
  decimals,
  amountWei,
  chainId,
  auditEntryIds,
}: RecallActionData) {
  const safeFlowAddress = getSafeFlowAddress();
  const { currentAgentCaps, upsertCap } = useSafeFlowResources();
  const { writeContractAsync } = useWriteContract();
  const { address: connectedAddress } = useAccount();

  // Only show caps that are active AND not expired
  const nowSec = Math.floor(Date.now() / 1000);
  const walletCaps = currentAgentCaps.filter(c =>
    String(c.walletId) === walletId &&
    c.active &&
    (!c.expiresAt || Number(c.expiresAt) > nowSec)
  );

  // If the initialCapId is itself expired, fall back to the first valid cap
  const resolvedInitialCapId = (() => {
    if (!initialCapId) return walletCaps[0] ? String(walletCaps[0].capId) : '';
    const init = currentAgentCaps.find(c => String(c.capId) === initialCapId);
    if (init && init.active && (!init.expiresAt || Number(init.expiresAt) > nowSec)) return initialCapId;
    return walletCaps[0] ? String(walletCaps[0].capId) : initialCapId; // preserve as text fallback
  })();
  const [selectedCapId, setSelectedCapId] = useState<string>(resolvedInitialCapId);

  // Inline "create cap" mini-panel state
  const [showCreateCap, setShowCreateCap] = useState(false);
  const [newCapExpiryHours, setNewCapExpiryHours] = useState('24');
  const [createCapTx, setCreateCapTx] = useState<`0x${string}` | undefined>();
  const [createCapStep, setCreateCapStep] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const { isSuccess: createCapConfirmed, data: createCapReceipt } = useWaitForTransactionReceipt({ hash: createCapTx, chainId });

  useEffect(() => {
    if (!createCapConfirmed || !createCapReceipt) return;
    // Parse the new capId from CapCreated event (topic[1] is capId as uint256)
    // Find log from our contract — topic[1] carries the new capId (indexed uint256)
    const log = createCapReceipt.logs.find(l => l.address.toLowerCase() === safeFlowAddress?.toLowerCase());
    let newCapId = '';
    if (log && log.topics[1]) {
      newCapId = BigInt(log.topics[1]).toString();
    }
    if (newCapId) {
      setSelectedCapId(newCapId);
      upsertCap({
        capId: newCapId,
        walletId,
        agentAddress: (connectedAddress ?? '0x0') as `0x${string}`,
        savedForAddress: (connectedAddress ?? '0x0') as `0x${string}`,
        chainId,
        expiresAt: String(Math.floor(Date.now() / 1000) + parseInt(newCapExpiryHours, 10) * 3600),
        active: true,
        source: 'created',
      });
    }
    setCreateCapStep('done');
    setShowCreateCap(false);
  }, [createCapConfirmed, createCapReceipt, safeFlowAddress, walletId, connectedAddress, chainId, newCapExpiryHours, upsertCap]);

  const handleCreateCap = async () => {
    if (!connectedAddress) return;
    setCreateCapStep('pending');
    try {
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + parseInt(newCapExpiryHours, 10) * 3600);
      const hash = await writeContractAsync({
        address: safeFlowAddress,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'createSessionCap',
        args: [
          BigInt(walletId),
          connectedAddress,           // agent = self (owner acts as agent for recall)
          BigInt('999999999999999999'), // maxSpendPerInterval — high, recall uses amountIn=0
          BigInt('999999999999999999'), // maxSpendTotal
          BigInt(3600),               // intervalSeconds
          expiresAt,
          'Recall Cap',
        ],
        chainId,
      });
      setCreateCapTx(hash);
    } catch (err) {
      setCreateCapStep('error');
      console.error(err);
    }
  };

  const [step1Tx, setStep1Tx] = useState<`0x${string}` | undefined>();
  const [step2Tx, setStep2Tx] = useState<`0x${string}` | undefined>();
  const [step1Done, setStep1Done] = useState(false);
  const [step2Done, setStep2Done] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // SafeFlow holds share tokens in the vault (ERC4626: vault addr = share token)
  const { data: shareBalanceRaw } = useReadContract({
    address: vaultAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [safeFlowAddress],
    chainId,
    query: { enabled: !!vaultAddress && vaultAddress.startsWith('0x') },
  });

  // SafeFlow internal balance — increases after step 1 recall
  const { data: internalBalanceRaw, refetch: refetchInternalBalance } = useReadContract({
    address: safeFlowAddress,
    abi: SAFEFLOW_VAULT_ABI,
    functionName: 'getBalance',
    args: [BigInt(walletId), tokenAddress as `0x${string}`],
    chainId,
  });

  const { isSuccess: step1Confirmed } = useWaitForTransactionReceipt({ hash: step1Tx, chainId });
  const { isSuccess: step2Confirmed } = useWaitForTransactionReceipt({ hash: step2Tx, chainId });

  useEffect(() => {
    if (step1Confirmed) {
      setStep1Done(true);
      setLoading(false);
      setStep1Tx(undefined);
      refetchInternalBalance();
    }
  }, [step1Confirmed, refetchInternalBalance]);

  useEffect(() => {
    if (step2Confirmed) {
      setStep2Done(true);
      setLoading(false);
      setStep2Tx(undefined);
      refetchInternalBalance();
      // Mark audit entries as withdrawn so Portfolio hides the row on next poll
      if (auditEntryIds && auditEntryIds.length > 0) {
        Promise.all(
          auditEntryIds.map(id =>
            fetch('/api/audit', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, status: 'withdrawn' }),
            })
          )
        ).catch(console.error);
      }
    }
  }, [step2Confirmed, refetchInternalBalance, auditEntryIds]);

  const shares = typeof shareBalanceRaw === 'bigint' ? shareBalanceRaw : BigInt(0);
  const internalBalance = typeof internalBalanceRaw === 'bigint' ? internalBalanceRaw : BigInt(0);
  const factor = BigInt(10 ** Math.max(0, decimals));

  function fmtRaw(raw: bigint): string {
    const w = raw / factor;
    const f = (raw % factor).toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 4);
    return f ? `${w}.${f}` : `${w}`;
  }

  // Determine if balance is already recalled (SafeFlow has tokens but step 1 hasn't been clicked)
  const alreadyRecalled = !step1Done && internalBalance > BigInt(0);
  // When no vault address: funds are either already in SafeFlow (alreadyRecalled) or this is a legacy entry
  const noVaultAddr = !vaultAddress;
  const canStep1 = !step1Done && !alreadyRecalled && !noVaultAddr && shares > BigInt(0) && !!selectedCapId;
  const noShares = !step1Done && !alreadyRecalled && !noVaultAddr && shares === BigInt(0);
  // Step 2 is available whenever SafeFlow has an internal balance (regardless of vault address)
  const canStep2 = !step2Done && internalBalance > BigInt(0) && (step1Done || alreadyRecalled || noVaultAddr);

  const handleStep1 = async () => {
    if (!canStep1 || !vaultAddress) return;
    setError(null);
    setLoading(true);
    try {
      // ERC4626: redeem(shares, receiver=safeFlow, owner=safeFlow)
      const callData = encodeFunctionData({
        abi: ERC4626_REDEEM_ABI,
        functionName: 'redeem',
        args: [shares, safeFlowAddress, safeFlowAddress],
      });
      const evidenceHash = keccak256(toHex(`recall:${walletId}:${tokenAddress}:${Date.now()}`));
      const hash = await writeContractAsync({
        address: safeFlowAddress,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'executeCall',
        args: [
          BigInt(selectedCapId),
          vaultAddress as `0x${string}`,
          callData,
          ZERO_ADDRESS,
          BigInt(0),
          tokenAddress as `0x${string}`,
          evidenceHash,
        ],
        chainId,
      });
      setStep1Tx(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Step 1 failed');
      setLoading(false);
    }
  };

  const handleStep2 = async () => {
    if (!canStep2) return;
    setError(null);
    setLoading(true);
    try {
      const hash = await writeContractAsync({
        address: safeFlowAddress,
        abi: SAFEFLOW_VAULT_ABI,
        functionName: 'withdraw',
        args: [BigInt(walletId), tokenAddress as `0x${string}`, internalBalance],
        chainId,
      });
      setStep2Tx(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Step 2 failed');
      setLoading(false);
    }
  };

  if (step2Done) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/5 px-4 py-3 text-emerald-400 text-sm">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        {symbol} fully withdrawn to your wallet!
      </div>
    );
  }

  return (
    <div className="mt-3 border border-amber-500/20 rounded-xl overflow-hidden bg-amber-500/5">
      <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
        <Wallet className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[11px] text-amber-300 font-semibold uppercase tracking-wider">
          Recall {symbol} → SafeFlow Wallet #{walletId}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Cap selector */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground w-28 shrink-0">Session Cap</span>
          {walletCaps.length > 0 ? (
            <select
              value={selectedCapId}
              onChange={e => setSelectedCapId(e.target.value)}
              disabled={step1Done || alreadyRecalled}
              className="flex-1 text-xs bg-background border border-border rounded-md px-2 py-1.5 disabled:opacity-50"
            >
              {walletCaps.map(c => {
                const expSec = c.expiresAt ? Number(c.expiresAt) : 0;
                const expLabel = expSec ? new Date(expSec * 1000).toLocaleDateString() : '∞';
                return (
                  <option key={String(c.capId)} value={String(c.capId)}>
                    {c.name ? `${c.name} · #${c.capId}` : `Cap #${c.capId}`} · exp {expLabel}
                  </option>
                );
              })}
            </select>
          ) : (
            <input
              type="text"
              value={selectedCapId}
              onChange={e => setSelectedCapId(e.target.value)}
              placeholder="Enter Cap ID"
              disabled={step1Done || alreadyRecalled}
              className="flex-1 text-xs bg-background border border-border rounded-md px-2 py-1.5 disabled:opacity-50"
            />
          )}
        </div>

        {/* No valid caps — inline create panel */}
        {walletCaps.length === 0 && !step1Done && !alreadyRecalled && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 overflow-hidden">
            <button
              onClick={() => setShowCreateCap(v => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-rose-300 hover:bg-rose-500/10 transition-colors"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                <ShieldPlus className="w-3.5 h-3.5" />
                All session caps expired — create a new one to proceed
              </span>
              {showCreateCap ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showCreateCap && (
              <div className="px-3 pb-3 space-y-2.5 border-t border-rose-500/20 pt-2.5">
                <p className="text-[10px] text-muted-foreground/70">
                  A temporary <span className="text-rose-300/80">Recall Cap</span> will be created with your address as agent.
                  <br/>It only covers the recall operation — spending limits are set to maximum.
                </p>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0">Expires in</span>
                  <select
                    value={newCapExpiryHours}
                    onChange={e => setNewCapExpiryHours(e.target.value)}
                    disabled={createCapStep === 'pending'}
                    className="flex-1 text-xs bg-background border border-border rounded-md px-2 py-1.5"
                  >
                    <option value="1">1 hour</option>
                    <option value="6">6 hours</option>
                    <option value="24">24 hours</option>
                    <option value="72">3 days</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0">Agent</span>
                  <span className="text-[10px] font-mono text-muted-foreground/80 break-all">
                    {connectedAddress ?? '—'} (you)
                  </span>
                </div>

                {createCapStep === 'error' && (
                  <div className="text-[10px] text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />Transaction failed — check wallet and retry
                  </div>
                )}

                <button
                  onClick={handleCreateCap}
                  disabled={createCapStep === 'pending' || !!createCapTx}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] font-semibold hover:bg-rose-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createCapStep === 'pending' || createCapTx ? (
                    <><Loader2 className="w-3 h-3 animate-spin" />Creating cap…</>
                  ) : (
                    <><ShieldPlus className="w-3 h-3" />Create Recall Cap on-chain</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Shares held by SafeFlow */}
        {!noVaultAddr && !alreadyRecalled && (
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground w-28 shrink-0">Vault shares</span>
            <span className="text-xs font-mono text-amber-300/80">
              {shares > BigInt(0) ? `${fmtRaw(shares)} shares` : noShares ? '0 (no shares — may not be ERC4626)' : '…'}
            </span>
          </div>
        )}

        {/* SafeFlow internal balance — show whenever non-zero */}
        {internalBalance > BigInt(0) && (
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground w-28 shrink-0">SafeFlow balance</span>
            <span className="text-xs font-mono text-emerald-400">{fmtRaw(internalBalance)} {symbol}</span>
          </div>
        )}

        {alreadyRecalled && (
          <div className="text-[11px] text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            Funds already recalled — skip to Step 2 below.
          </div>
        )}

        {/* Step buttons */}
        <div className="flex flex-col gap-2 pt-1">
          {/* Step 1: Agent execute recall */}
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0 ${
              step1Done || alreadyRecalled
                ? 'border-emerald-400 bg-emerald-400/20 text-emerald-400'
                : 'border-amber-400 text-amber-400'
            }`}>
              {step1Done || alreadyRecalled ? '✓' : '1'}
            </div>
            {step1Done || alreadyRecalled ? (
              <div className="flex items-center gap-2 text-emerald-400 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {alreadyRecalled ? 'Already in SafeFlow' : `Agent executed — ${symbol} credited to SafeFlow`}
              </div>
            ) : noVaultAddr ? (
              <div className="flex items-center gap-2 text-amber-400/60 text-xs">
                <AlertCircle className="w-3.5 h-3.5" />
                Vault address not recorded (legacy deposit) — check SafeFlow balance below
              </div>
            ) : (
              <button
                onClick={handleStep1}
                disabled={!canStep1 || loading}
                title={noShares ? 'SafeFlow holds no vault shares' : ''}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-semibold hover:bg-amber-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && !step1Tx ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : step1Tx ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowDownToLine className="w-3 h-3" />
                )}
                {noShares
                  ? 'No Shares Held'
                  : step1Tx
                  ? 'Waiting for confirmation…'
                  : 'Recall: Agent executeCall (Step 1)'}
              </button>
            )}
          </div>

          {/* Step 2: Owner withdraw to EOA */}
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0 ${
              step2Done ? 'border-emerald-400 bg-emerald-400/20 text-emerald-400'
              : canStep2 ? 'border-primary text-primary'
              : 'border-muted-foreground/30 text-muted-foreground/30'
            }`}>
              {step2Done ? '✓' : '2'}
            </div>
            <button
              onClick={handleStep2}
              disabled={!canStep2 || loading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[11px] font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && step1Done && !step2Tx ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : step2Tx ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowDownToLine className="w-3 h-3" />
              )}
              {step2Tx
                ? 'Waiting for confirmation…'
                : canStep2
                ? `Withdraw ${fmtRaw(internalBalance)} ${symbol} to My Wallet (Step 2)`
                : 'Withdraw to My Wallet (Step 2)'}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-destructive text-[11px] bg-destructive/10 border border-destructive/20 rounded-lg p-2.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {noVaultAddr && !alreadyRecalled && internalBalance === BigInt(0) && (
          <div className="text-[10px] text-amber-400/70 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
            This is a legacy deposit — vault address was not saved. If funds are still deployed in the DeFi vault,
            you&apos;ll need to recall them manually via the vault&apos;s own UI, then return here for Step 2.
          </div>
        )}
      </div>
    </div>
  );
}
