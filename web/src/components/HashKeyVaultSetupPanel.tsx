'use client';

/**
 * HashKeyVaultSetupPanel
 *
 * Inline onboarding for the SafeFlowVaultHashKey contract. The contract has a
 * different surface than the DeFi SafeFlowVault:
 *   - createVault()          (no args, emits VaultCreated)
 *   - deposit(vaultId)       (payable, native HSK)
 *   - grantSession(vaultId, agent, maxSpendPerSec, maxSpendTotal, expiresAtSec)
 *
 * This panel exposes the three write calls plus a way to paste an existing
 * vaultId, so users can bring a chat-driven HSP payment all the way from
 * "nothing on chain yet" to "executePayment succeeds" without leaving the
 * chat surface. See `HspPayActionCard` for the consumer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { decodeEventLog, parseEther } from 'viem';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PackagePlus,
  PiggyBank,
  ShieldPlus,
} from 'lucide-react';
import { HASHKEY_VAULT_ABI } from '@/lib/contracts';
import { getChainExplorerTxUrl } from '@/lib/chains';
import { HASHKEY_CHAIN_ID, isHashKeyChain } from '@/lib/mode';

const HASHKEY_CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_HASHKEY_CONTRACT ||
  '0x0000000000000000000000000000000000000000') as `0x${string}`;
const HASHKEY_CONFIGURED = HASHKEY_CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000';

type SessionTuple = readonly [bigint, bigint, bigint, bigint, bigint, boolean];
type VaultTuple = readonly [`0x${string}`, bigint, boolean];

export interface HashKeyVaultSetupPanelProps {
  /** Current vaultId string — empty when not selected yet. */
  vaultId: string;
  onVaultIdChange: (next: string) => void;
  /** Minimum deposit amount (human-readable HSK) the caller needs for a pending payment. */
  requiredDepositHsk?: string;
  /** Called when every gate (vault + balance + session) is satisfied. */
  onReady?: () => void;
}

function shortTx(hash?: `0x${string}`): string {
  if (!hash) return '—';
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export default function HashKeyVaultSetupPanel({
  vaultId,
  onVaultIdChange,
  requiredDepositHsk,
  onReady,
}: HashKeyVaultSetupPanelProps) {
  const { address: connected, isConnected } = useAccount();
  const chainId = useChainId();
  const onHashKey = isHashKeyChain(chainId);

  // ─── Inputs ─────────────────────────────────────────────────────
  const defaultDeposit = useMemo(() => {
    if (!requiredDepositHsk) return '0.1';
    // Default to 10× the pending payment so small rate-limit caps still pass.
    const n = Number(requiredDepositHsk);
    if (!Number.isFinite(n) || n <= 0) return '0.1';
    return (n * 10).toString();
  }, [requiredDepositHsk]);
  const [depositAmount, setDepositAmount] = useState<string>(defaultDeposit);
  useEffect(() => {
    setDepositAmount(defaultDeposit);
  }, [defaultDeposit]);

  // SessionCap defaults — loose on rate, tight on expiry so demos stay safe.
  const defaultMaxPerSec = useMemo(() => {
    // If there is a pending amount, allow one full payment per second worth of
    // burst (simplest demo). Otherwise default to 0.01 HSK / sec.
    if (requiredDepositHsk) {
      try {
        return parseEther(requiredDepositHsk).toString();
      } catch {
        /* fallthrough */
      }
    }
    return parseEther('0.01').toString();
  }, [requiredDepositHsk]);

  const defaultMaxTotal = useMemo(() => {
    // 100× the single-payment amount (or 10 HSK by default).
    if (requiredDepositHsk) {
      try {
        const one = parseEther(requiredDepositHsk);
        return (one * 100n).toString();
      } catch {
        /* fallthrough */
      }
    }
    return parseEther('10').toString();
  }, [requiredDepositHsk]);

  const [expiryHours, setExpiryHours] = useState<string>('24');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ─── Read current on-chain state for the selected vaultId ───────
  const hasVaultId = vaultId.length > 0 && /^\d+$/.test(vaultId);
  const { data: vaultData, refetch: refetchVault } = useReadContract({
    address: HASHKEY_CONTRACT_ADDRESS,
    abi: HASHKEY_VAULT_ABI,
    functionName: 'getVault',
    args: hasVaultId ? [BigInt(vaultId)] : undefined,
    chainId,
    query: { enabled: HASHKEY_CONFIGURED && onHashKey && hasVaultId },
  });
  const { data: sessionData, refetch: refetchSession } = useReadContract({
    address: HASHKEY_CONTRACT_ADDRESS,
    abi: HASHKEY_VAULT_ABI,
    functionName: 'getSession',
    args: hasVaultId && connected ? [BigInt(vaultId), connected] : undefined,
    chainId,
    query: { enabled: HASHKEY_CONFIGURED && onHashKey && hasVaultId && !!connected },
  });

  const vault = vaultData as VaultTuple | undefined;
  const session = sessionData as SessionTuple | undefined;

  const vaultExists = !!vault?.[2];
  const vaultIsOwned = !!vault && !!connected && vault[0].toLowerCase() === connected.toLowerCase();
  const vaultBalance = vault?.[1] ?? 0n;
  const sessionExists = !!session?.[5];
  const sessionExpiresAt = session?.[4] ?? 0n;
  const sessionActive = sessionExists && sessionExpiresAt * 1000n > BigInt(Date.now());

  const requiredWei = useMemo(() => {
    if (!requiredDepositHsk) return 0n;
    try {
      return parseEther(requiredDepositHsk);
    } catch {
      return 0n;
    }
  }, [requiredDepositHsk]);

  const needsVault = !hasVaultId || !vaultExists;
  const needsBalance = hasVaultId && vaultExists && vaultBalance < requiredWei;
  const needsSession = hasVaultId && vaultExists && !sessionActive;
  const everythingReady = hasVaultId && vaultExists && vaultIsOwned && !needsBalance && sessionActive;

  useEffect(() => {
    if (everythingReady) onReady?.();
  }, [everythingReady, onReady]);

  // ─── Write: createVault ────────────────────────────────────────
  const { writeContractAsync } = useWriteContract();
  const [createTx, setCreateTx] = useState<`0x${string}` | undefined>();
  const { data: createReceipt, isLoading: createConfirming, isSuccess: createMined } =
    useWaitForTransactionReceipt({ hash: createTx, chainId });

  useEffect(() => {
    if (!createMined || !createReceipt) return;
    for (const log of createReceipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: HASHKEY_VAULT_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === 'VaultCreated') {
          const next = String(decoded.args.vaultId);
          onVaultIdChange(next);
          break;
        }
      } catch {
        /* ignore non-matching logs */
      }
    }
    void refetchVault();
    void refetchSession();
  }, [createMined, createReceipt, onVaultIdChange, refetchSession, refetchVault]);

  const createVault = useCallback(async () => {
    setErrorMessage(null);
    try {
      const hash = await writeContractAsync({
        address: HASHKEY_CONTRACT_ADDRESS,
        abi: HASHKEY_VAULT_ABI,
        functionName: 'createVault',
        args: [],
      });
      setCreateTx(hash);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create vault');
    }
  }, [writeContractAsync]);

  // ─── Write: deposit ────────────────────────────────────────────
  const [depositTx, setDepositTx] = useState<`0x${string}` | undefined>();
  const { isLoading: depositConfirming, isSuccess: depositMined } =
    useWaitForTransactionReceipt({ hash: depositTx, chainId });
  useEffect(() => {
    if (depositMined) {
      void refetchVault();
    }
  }, [depositMined, refetchVault]);

  const deposit = useCallback(async () => {
    setErrorMessage(null);
    if (!hasVaultId) return;
    let value: bigint;
    try {
      value = parseEther(depositAmount);
    } catch {
      setErrorMessage(`Invalid HSK amount: ${depositAmount}`);
      return;
    }
    if (value === 0n) {
      setErrorMessage('Deposit amount must be greater than zero');
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: HASHKEY_CONTRACT_ADDRESS,
        abi: HASHKEY_VAULT_ABI,
        functionName: 'deposit',
        args: [BigInt(vaultId)],
        value,
      });
      setDepositTx(hash);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to deposit');
    }
  }, [depositAmount, hasVaultId, vaultId, writeContractAsync]);

  // ─── Write: grantSession ───────────────────────────────────────
  const [grantTx, setGrantTx] = useState<`0x${string}` | undefined>();
  const { isLoading: grantConfirming, isSuccess: grantMined } =
    useWaitForTransactionReceipt({ hash: grantTx, chainId });
  useEffect(() => {
    if (grantMined) {
      void refetchSession();
    }
  }, [grantMined, refetchSession]);

  const grantSession = useCallback(async () => {
    setErrorMessage(null);
    if (!hasVaultId || !connected) return;
    const hours = Math.max(1, Math.floor(Number(expiryHours) || 24));
    const expiresAtSec = BigInt(Math.floor(Date.now() / 1000) + hours * 3600);
    try {
      const hash = await writeContractAsync({
        address: HASHKEY_CONTRACT_ADDRESS,
        abi: HASHKEY_VAULT_ABI,
        functionName: 'grantSession',
        args: [
          BigInt(vaultId),
          connected,
          BigInt(defaultMaxPerSec),
          BigInt(defaultMaxTotal),
          expiresAtSec,
        ],
      });
      setGrantTx(hash);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to grant session');
    }
  }, [connected, defaultMaxPerSec, defaultMaxTotal, expiryHours, hasVaultId, vaultId, writeContractAsync]);

  // ─── Gating copy ───────────────────────────────────────────────
  const blocker = (() => {
    if (!HASHKEY_CONFIGURED) return 'HashKey contract address is not configured (NEXT_PUBLIC_HASHKEY_CONTRACT).';
    if (!isConnected) return 'Connect your wallet to set up the HashKey vault.';
    if (!onHashKey) return `Switch to a HashKey chain (id ${HASHKEY_CHAIN_ID}) to run setup.`;
    return null;
  })();

  if (everythingReady) return null;

  const explorerCreate = createTx ? getChainExplorerTxUrl(chainId, createTx) : null;
  const explorerDeposit = depositTx ? getChainExplorerTxUrl(chainId, depositTx) : null;
  const explorerGrant = grantTx ? getChainExplorerTxUrl(chainId, grantTx) : null;

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <ShieldPlus className="w-4 h-4 mt-0.5 text-indigo-500 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground">Setup SafeFlow on HashKey</div>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            HashKey vault needs three tiny steps before the agent can pay:
            <span className="font-data"> createVault → deposit HSK → grantSession</span>. Defaults below are safe
            for this demo payment; tweak if you know what you&apos;re doing.
          </div>
        </div>
      </div>

      {blocker && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {blocker}
        </div>
      )}

      {/* Step A: create vault */}
      <MiniStep
        index="A"
        icon={<PackagePlus className="w-3.5 h-3.5" />}
        title="Vault"
        status={hasVaultId && vaultExists ? 'done' : createConfirming ? 'running' : 'pending'}
      >
        {hasVaultId && vaultExists ? (
          <div className="text-[11px] font-data text-muted-foreground">
            vaultId <span className="text-foreground">{vaultId}</span> · balance {(Number(vaultBalance) / 1e18).toFixed(6)} HSK
            {!vaultIsOwned && (
              <div className="mt-1 text-amber-600 dark:text-amber-300">
                You are not the owner of this vault — deposits still work, but grantSession must be called by the owner.
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void createVault()}
              disabled={!!blocker || createConfirming}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {createConfirming ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <PackagePlus className="w-3 h-3" /> Create new vault
                </>
              )}
            </button>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>or paste existing id</span>
              <input
                type="text"
                inputMode="numeric"
                value={vaultId}
                onChange={e => onVaultIdChange(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="e.g. 0"
                className="w-20 rounded border border-border bg-input px-1.5 py-0.5 font-data text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            {explorerCreate && (
              <a
                href={explorerCreate}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                {shortTx(createTx)} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </MiniStep>

      {/* Step B: deposit */}
      <MiniStep
        index="B"
        icon={<PiggyBank className="w-3.5 h-3.5" />}
        title="Deposit"
        status={
          !hasVaultId || !vaultExists
            ? 'pending'
            : !needsBalance
              ? 'done'
              : depositConfirming
                ? 'running'
                : 'ready'
        }
      >
        {hasVaultId && vaultExists && !needsBalance ? (
          <div className="text-[11px] font-data text-muted-foreground">
            Vault balance {(Number(vaultBalance) / 1e18).toFixed(6)} HSK — enough for the pending payment.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
              placeholder="0.1"
              disabled={!hasVaultId || depositConfirming}
              className="w-20 rounded border border-border bg-input px-1.5 py-0.5 font-data text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
            />
            <span className="text-[11px] text-muted-foreground">HSK</span>
            <button
              type="button"
              onClick={() => void deposit()}
              disabled={!hasVaultId || depositConfirming || !!blocker}
              className="inline-flex items-center gap-1 rounded-md bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {depositConfirming ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Depositing…
                </>
              ) : (
                <>Deposit</>
              )}
            </button>
            {explorerDeposit && (
              <a
                href={explorerDeposit}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                {shortTx(depositTx)} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </MiniStep>

      {/* Step C: grant session */}
      <MiniStep
        index="C"
        icon={<ShieldPlus className="w-3.5 h-3.5" />}
        title="SessionCap"
        status={
          !hasVaultId || !vaultExists
            ? 'pending'
            : sessionActive
              ? 'done'
              : grantConfirming
                ? 'running'
                : 'ready'
        }
      >
        {sessionActive ? (
          <div className="text-[11px] font-data text-muted-foreground">
            Active session for <span className="text-foreground">{connected ? `${connected.slice(0, 6)}…${connected.slice(-4)}` : '—'}</span>
            {' '}· expires {new Date(Number(sessionExpiresAt) * 1000).toLocaleString()}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">expire in</span>
            <input
              type="text"
              inputMode="numeric"
              value={expiryHours}
              onChange={e => setExpiryHours(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="24"
              disabled={!hasVaultId || grantConfirming}
              className="w-14 rounded border border-border bg-input px-1.5 py-0.5 font-data text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
            />
            <span className="text-[11px] text-muted-foreground">hours</span>
            <button
              type="button"
              onClick={() => void grantSession()}
              disabled={!hasVaultId || !vaultExists || grantConfirming || !!blocker || sessionExists}
              className="inline-flex items-center gap-1 rounded-md bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              title={sessionExists && !sessionActive ? 'Session already exists (and is expired/revoked). Revoke from chain to re-grant.' : undefined}
            >
              {grantConfirming ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Granting…
                </>
              ) : (
                <>Grant to me</>
              )}
            </button>
            {explorerGrant && (
              <a
                href={explorerGrant}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                {shortTx(grantTx)} <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {sessionExists && !sessionActive && (
              <div className="w-full text-[11px] text-amber-600 dark:text-amber-300">
                A session already exists for your address on this vault but is expired/inactive. Call{' '}
                <span className="font-data">revokeSession</span> on-chain first, then retry.
              </div>
            )}
          </div>
        )}
      </MiniStep>

      {errorMessage && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-400/40 bg-red-50 dark:bg-red-500/10 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span className="break-words min-w-0">{errorMessage}</span>
        </div>
      )}

      {everythingReady && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Vault, deposit and SessionCap ready — execute the payment below.
        </div>
      )}
    </div>
  );
}

function MiniStep({
  index,
  icon,
  title,
  status,
  children,
}: {
  index: string;
  icon: React.ReactNode;
  title: string;
  status: 'pending' | 'ready' | 'running' | 'done';
  children: React.ReactNode;
}) {
  const badgeClass =
    status === 'done'
      ? 'bg-emerald-500 text-white'
      : status === 'running'
        ? 'bg-primary text-primary-foreground'
        : status === 'ready'
          ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
          : 'bg-secondary text-muted-foreground';
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-2">
      <div className="flex items-start gap-2">
        <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${badgeClass}`}>
          {status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : status === 'done' ? <CheckCircle2 className="w-3 h-3" /> : index}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-foreground">
            {icon}
            {title}
          </div>
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}
