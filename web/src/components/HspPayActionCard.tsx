'use client';

/**
 * HspPayActionCard
 *
 * Chat-driven demo of how SafeFlow + HSP fit together:
 *   1. Agent builds a HashKey Settlement Protocol (HSP) Cart Mandate locally
 *      (no external gateway call \u2014 signed only if a merchant key is set).
 *   2. The canonical JSON SHA-256 of the cart (cart_hash) is pinned on-chain
 *      as the `reasonHash` argument of SafeFlowVaultHashKey.executePayment.
 *   3. SessionCap (rate-limit / total-cap / expiry) in the contract gates the
 *      actual spend \u2014 a hostile or buggy agent cannot exceed the user's cap.
 *   4. A PaymentIntent row is written to the intent store so it also shows up
 *      in the Payment History tab.
 *
 * All of this is wired through chat: user says \u201cpay 0.01 HSK to 0x\u2026\u201d and the
 * agent produces an `action: { type: 'hsp_pay', hspPayData }` payload.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileSignature,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { HASHKEY_VAULT_ABI } from '@/lib/contracts';
import { getChainExplorerTxUrl } from '@/lib/chains';
import { HASHKEY_CHAIN_ID, isHashKeyChain } from '@/lib/mode';
import { useSafeFlowResources } from '@/lib/safeflow-resources';
import type { HspPayActionData } from '@/types';

type PrepareResponse = {
  cart: Record<string, unknown>;
  cartHash: string;         // 64-char hex, no 0x prefix
  cartHashBytes32: `0x${string}`;
  merchantJwt: string | null;
  amountWei: string;
  recipient: `0x${string}`;
  reason: string;
  orderId: string;
  merchantName: string;
  coin: string;
  currency: string;
};

type Phase = 'idle' | 'preparing' | 'prepared' | 'executing' | 'executed' | 'error';

const HASHKEY_CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_HASHKEY_CONTRACT ||
  '0x0000000000000000000000000000000000000000') as `0x${string}`;
const HASHKEY_CONFIGURED = HASHKEY_CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000';

function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address || '\u2014';
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`;
}

function shortHash(hash: string, left = 10, right = 8): string {
  if (!hash) return '\u2014';
  return hash.length > left + right + 2 ? `${hash.slice(0, left)}\u2026${hash.slice(-right)}` : hash;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

export default function HspPayActionCard({
  amount,
  recipient,
  recipientName,
  recipientTagline,
  recipientEmoji,
  reason,
  coin,
  currency,
}: HspPayActionData) {
  const { address: connectedAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const onHashKey = isHashKeyChain(chainId);

  const { currentWallets, currentAgentCaps } = useSafeFlowResources();

  // The demo works when the connected wallet is BOTH the vault owner (granted
  // a SessionCap) AND the agent (i.e. the caller of executePayment). This is
  // the simplest single-wallet demo topology \u2014 in production the agent would
  // be a separate backend key.
  const defaultVaultId = useMemo(() => {
    // Prefer a cap where agent == connectedAddress, since that is what the
    // contract will actually check in executePayment.
    const agentCap = currentAgentCaps[0];
    if (agentCap?.walletId) return agentCap.walletId;
    if (currentWallets[0]?.walletId) return currentWallets[0].walletId;
    return '';
  }, [currentAgentCaps, currentWallets]);

  const [vaultId, setVaultId] = useState<string>(defaultVaultId);
  useEffect(() => {
    if (!vaultId && defaultVaultId) setVaultId(defaultVaultId);
  }, [defaultVaultId, vaultId]);

  const [prepared, setPrepared] = useState<PrepareResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);

  // \u2500\u2500\u2500 Step 1: prepare Cart Mandate via local API \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const prepare = useCallback(async () => {
    setPhase('preparing');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/hashkey/hsp-demo/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          recipient,
          reason,
          coin,
          currency,
          merchantName: recipientName,
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `Prepare failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as PrepareResponse;
      setPrepared(data);
      setPhase('prepared');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to prepare HSP cart mandate');
      setPhase('error');
    }
  }, [amount, recipient, reason, coin, currency, recipientName]);

  useEffect(() => {
    if (phase === 'idle') void prepare();
    // Only auto-run once on mount \u2014 re-triggering is via the Retry button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // \u2500\u2500\u2500 Step 2: execute on-chain via SafeFlowVaultHashKey.executePayment \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: isConfirming, isSuccess, isError: receiptError, error: receiptErr } =
    useWaitForTransactionReceipt({ hash: txHash, chainId });

  useEffect(() => {
    if (!txHash) return;
    if (isSuccess) setPhase('executed');
    if (receiptError) {
      setPhase('error');
      setErrorMessage(receiptErr?.message || 'Transaction reverted on-chain');
    }
  }, [txHash, isSuccess, receiptError, receiptErr]);

  const canExecute =
    phase === 'prepared' && !!prepared && isConnected && onHashKey && HASHKEY_CONFIGURED && !!vaultId;

  const executeOnChain = useCallback(async () => {
    if (!prepared) return;
    if (!vaultId) {
      setErrorMessage('No vault selected \u2014 open the Vault tab to create one first.');
      return;
    }
    setPhase('executing');
    setErrorMessage(null);
    try {
      const hash = await writeContractAsync({
        address: HASHKEY_CONTRACT_ADDRESS,
        abi: HASHKEY_VAULT_ABI,
        functionName: 'executePayment',
        args: [
          BigInt(vaultId),
          prepared.recipient,
          BigInt(prepared.amountWei),
          prepared.cartHashBytes32,
          reason?.slice(0, 200) || `HSP order ${prepared.orderId}`,
        ],
      });
      setTxHash(hash);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to submit transaction';
      setErrorMessage(extractRevertReason(rawMsg));
      setPhase('error');
    }
  }, [prepared, vaultId, writeContractAsync, reason]);

  // \u2500\u2500\u2500 Step 3: record the executed intent in PaymentHistory \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const [intentRecorded, setIntentRecorded] = useState(false);
  useEffect(() => {
    if (phase !== 'executed' || !prepared || !txHash || intentRecorded) return;
    (async () => {
      try {
        // Walk the full intent lifecycle so PaymentHistory shows Executed.
        // Any step can fail silently \u2014 the authoritative record is on-chain.
        const createRes = await fetch('/api/hashkey/intents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchantOrderId: prepared.orderId,
            agentAddress: connectedAddress ?? '',
            vaultId: String(vaultId),
            recipient: prepared.recipient,
            amountWei: prepared.amountWei,
            currency: prepared.coin,
            reason: reason || `HSP demo payment (${prepared.orderId})`,
            metadata: {
              source: 'hsp-chat-demo',
              cartHash: prepared.cartHash,
              merchantName: prepared.merchantName,
              orderId: prepared.orderId,
              cart: prepared.cart,
            },
            expiresAtMs: Date.now() + 10 * 60 * 1000,
          }),
        });
        if (!createRes.ok) return;
        const { intent } = (await createRes.json()) as { intent?: { intentId: string } };
        if (!intent?.intentId) return;

        await fetch(`/api/hashkey/intents/${intent.intentId}/ack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentAddress: connectedAddress ?? '' }),
        });
        await fetch(`/api/hashkey/intents/${intent.intentId}/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            txHash,
            reasonHash: prepared.cartHashBytes32,
          }),
        });
      } catch {
        // Non-fatal; the on-chain tx is authoritative.
      } finally {
        setIntentRecorded(true);
      }
    })();
  }, [phase, prepared, txHash, intentRecorded, connectedAddress, vaultId, reason]);

  // \u2500\u2500\u2500 Pre-flight gating \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const connectionBlocker = (() => {
    if (!HASHKEY_CONFIGURED) {
      return 'HashKey contract address is not configured (NEXT_PUBLIC_HASHKEY_CONTRACT).';
    }
    if (!isConnected) return 'Connect your wallet to run the demo.';
    if (!onHashKey) return `Switch to a HashKey chain (id ${HASHKEY_CHAIN_ID}) to execute the payment.`;
    return null;
  })();

  const explorerTxUrl = txHash ? getChainExplorerTxUrl(chainId, txHash) : null;

  // \u2500\u2500\u2500 Render \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  return (
    <div className="mt-2 rounded-2xl border border-primary/20 bg-card/80 shadow-[0_20px_60px_-36px_rgba(99,102,241,0.35)] overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border bg-gradient-to-r from-indigo-500/5 to-purple-500/5">
        <div className="flex items-center gap-3 min-w-0">
          {/* Merchant avatar */}
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/15 to-purple-500/15 border border-primary/20 flex items-center justify-center text-lg">
            {recipientEmoji ?? '\ud83d\udcb3'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Sparkles className="w-3 h-3" />
              HSP \u00d7 SafeFlow payment
            </div>
            <div className="text-sm font-semibold text-foreground mt-0.5 truncate">
              Pay <span className="font-data">{amount} {coin ?? 'HSK'}</span> to{' '}
              {recipientName ? (
                <span className="text-foreground">{recipientName}</span>
              ) : (
                <span className="font-data text-foreground">{shortenAddress(recipient)}</span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {recipientTagline ? <span>{recipientTagline} \u00b7 </span> : null}
              {recipientName && (
                <span className="font-data">{shortenAddress(recipient)}</span>
              )}
              {!recipientName && <span>Unlisted address</span>}
            </div>
            {reason && (
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate italic">
                \u201c{reason}\u201d
              </div>
            )}
          </div>
        </div>
        <StatusPill phase={phase} isConfirming={isConfirming} />
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Connection blocker */}
        {connectionBlocker && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
            <Wallet className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{connectionBlocker}</span>
          </div>
        )}

        {/* Step 1: HSP Cart Mandate */}
        <Step
          index={1}
          title="Build HSP Cart Mandate"
          description="Canonical-JSON hash (RFC 8785) of the order descriptor. Signed locally \u2014 no gateway call."
          icon={<FileSignature className="w-3.5 h-3.5" />}
          state={
            phase === 'preparing'
              ? 'running'
              : prepared
                ? 'done'
                : phase === 'error' && !prepared
                  ? 'error'
                  : 'pending'
          }
        >
          {prepared ? (
            <div className="space-y-1.5">
              <KeyValue label="cart_hash">
                <button
                  type="button"
                  onClick={() => void copyToClipboard(prepared.cartHashBytes32)}
                  className="font-data text-[11px] text-foreground hover:text-primary inline-flex items-center gap-1"
                  title="Copy full hash"
                >
                  {shortHash(prepared.cartHashBytes32, 12, 10)}
                  <Copy className="w-3 h-3 opacity-60" />
                </button>
              </KeyValue>
              <KeyValue label="order_id">
                <span className="font-data text-[11px]">{prepared.orderId}</span>
              </KeyValue>
              <KeyValue label="merchant_jwt">
                <span className={`text-[11px] font-data ${prepared.merchantJwt ? 'text-emerald-600 dark:text-emerald-300' : 'text-muted-foreground'}`}>
                  {prepared.merchantJwt ? `ES256K signed (${prepared.merchantJwt.length} bytes)` : 'not signed (HSP_MERCHANT_PRIVATE_KEY unset)'}
                </span>
              </KeyValue>
              <button
                type="button"
                onClick={() => setShowCart(v => !v)}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                {showCart ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showCart ? 'Hide' : 'Show'} cart_mandate.contents
              </button>
              {showCart && (
                <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-background/60 p-2 text-[10px] leading-relaxed font-data text-muted-foreground">
                  {JSON.stringify(prepared.cart, null, 2)}
                </pre>
              )}
            </div>
          ) : phase === 'preparing' ? (
            <span className="text-[11px] text-muted-foreground">Hashing canonical JSON\u2026</span>
          ) : (
            <button
              type="button"
              onClick={() => void prepare()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-secondary transition-colors"
            >
              Retry prepare
            </button>
          )}
        </Step>

        {/* Step 2: On-chain execution */}
        <Step
          index={2}
          title="Pin cart_hash on-chain via SessionCap"
          description="SafeFlowVaultHashKey.executePayment(vaultId, recipient, amount, reasonHash = cart_hash, memo)"
          icon={<ShieldCheck className="w-3.5 h-3.5" />}
          state={
            phase === 'executing' || isConfirming
              ? 'running'
              : phase === 'executed'
                ? 'done'
                : phase === 'error' && prepared
                  ? 'error'
                  : prepared
                    ? 'ready'
                    : 'pending'
          }
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground w-16">vaultId</label>
              <input
                type="text"
                inputMode="numeric"
                value={vaultId}
                onChange={e => setVaultId(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="e.g. 0"
                disabled={phase === 'executing' || phase === 'executed' || isConfirming}
                className="flex-1 rounded-md border border-border bg-input px-2 py-1 text-[11px] font-data focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
              />
            </div>
            {phase !== 'executed' ? (
              <button
                type="button"
                onClick={() => void executeOnChain()}
                disabled={!canExecute || isConfirming}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {phase === 'executing' || isConfirming ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {isConfirming ? 'Waiting for receipt\u2026' : 'Confirm in wallet\u2026'}
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Execute via SafeFlow
                  </>
                )}
              </button>
            ) : null}
            {txHash && (
              <div className="space-y-1">
                <KeyValue label="tx_hash">
                  {explorerTxUrl ? (
                    <a
                      href={explorerTxUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-data text-[11px] text-primary hover:underline"
                    >
                      {shortHash(txHash, 12, 10)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="font-data text-[11px]">{shortHash(txHash, 12, 10)}</span>
                  )}
                </KeyValue>
              </div>
            )}
          </div>
        </Step>

        {/* Step 3: evidence bound */}
        {phase === 'executed' && prepared && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-400/40 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              <div className="font-semibold">Evidence bound on-chain</div>
              <div className="text-[11px] leading-relaxed">
                The HSP <span className="font-data">cart_hash</span> is now stored as{' '}
                <span className="font-data">reasonHash</span> in the{' '}
                <span className="font-data">PaymentExecuted</span> event \u2014 any auditor can replay the
                cart JSON and verify this payment was authorized by exactly that order.
              </div>
            </div>
          </div>
        )}

        {/* Error surface */}
        {phase === 'error' && errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-red-400/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="space-y-1 min-w-0">
              <div className="font-semibold">Execution blocked</div>
              <div className="text-[11px] break-words">{errorMessage}</div>
              {prepared && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setPhase('prepared');
                  }}
                  className="mt-1 inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-0.5 text-[10px] font-semibold hover:bg-red-500/10"
                >
                  Reset & retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// \u2500\u2500\u2500 Sub-components \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

type StepState = 'pending' | 'ready' | 'running' | 'done' | 'error';

function Step({
  index,
  title,
  description,
  icon,
  state,
  children,
}: {
  index: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  state: StepState;
  children?: React.ReactNode;
}) {
  const badgeClass =
    state === 'done'
      ? 'bg-emerald-500 text-white'
      : state === 'running'
        ? 'bg-primary text-primary-foreground'
        : state === 'error'
          ? 'bg-red-500 text-white'
          : state === 'ready'
            ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
            : 'bg-secondary text-muted-foreground';
  return (
    <div className="rounded-xl border border-border/70 bg-background/40 p-3">
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${badgeClass}`}>
          {state === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : state === 'done' ? <CheckCircle2 className="w-3.5 h-3.5" /> : index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
            {icon}
            {title}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{description}</div>
          {children && <div className="mt-2">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground uppercase tracking-wider text-[10px] w-[88px] flex-shrink-0">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function StatusPill({ phase, isConfirming }: { phase: Phase; isConfirming: boolean }) {
  const [label, cls, Icon] = (() => {
    if (phase === 'executed')
      return ['Executed', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', CheckCircle2];
    if (phase === 'executing' || isConfirming)
      return ['Executing', 'bg-primary/15 text-primary border-primary/30', Loader2];
    if (phase === 'preparing')
      return ['Preparing', 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30', Loader2];
    if (phase === 'prepared')
      return ['Ready to execute', 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border-indigo-500/20', ShieldCheck];
    if (phase === 'error')
      return ['Blocked', 'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30', AlertCircle];
    return ['Idle', 'bg-secondary text-muted-foreground border-border', Sparkles];
  })() as [string, string, React.ComponentType<{ className?: string }>];

  const animate = phase === 'preparing' || phase === 'executing' || isConfirming;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap flex-shrink-0 ${cls}`}>
      <Icon className={`w-3 h-3 ${animate ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}

/**
 * Pull the revert reason out of a viem / wagmi error string. Falls back to the
 * raw message when no structured reason is detected.
 */
function extractRevertReason(raw: string): string {
  const reasonMatch = raw.match(/reason:\s*([^\n]+)/i) || raw.match(/reverted with (?:custom error|reason)[^:]*:?\s*([^\n]+)/i);
  if (reasonMatch) return reasonMatch[1].trim();
  const errorMatch = raw.match(/Error:\s*([^\n]+)/);
  if (errorMatch) return errorMatch[1].trim();
  return raw.length > 240 ? `${raw.slice(0, 240)}\u2026` : raw;
}
