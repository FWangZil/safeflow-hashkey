/**
 * HashKey Mode — E2E Agent Runner
 *
 * Migrated from safeflow-hashkey/agent_scripts/e2e_runner.ts.
 * Autonomous agent loop that polls the Producer API for payment intents,
 * verifies HMAC signatures, executes on-chain payments via SafeFlowVaultHashKey,
 * and reports results.
 *
 * Usage:
 *   npx tsx scripts/hashkey-e2e-runner.ts [--once] [--poll-ms 5000] [--max-loops 10]
 *
 * Environment:
 *   CONTRACT_ADDRESS          — deployed SafeFlowVaultHashKey address
 *   PRODUCER_API_BASE_URL     — base URL (default: http://localhost:3000/api/hashkey)
 *   PRODUCER_SIGNING_SECRET   — HMAC signing secret
 *   AGENT_PRIVATE_KEY         — agent wallet private key (hex)
 *   RPC_URL                   — HashKey Chain RPC (default: https://testnet.hsk.xyz)
 *   SAFEFLOW_MAX_AMOUNT_WEI   — optional max per-intent limit
 *   SAFEFLOW_POLL_MS          — poll interval (default: 5000)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';

const hashkeyTestnet = defineChain({
  id: 133,
  name: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hsk.xyz'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://testnet-explorer.hsk.xyz' } },
  testnet: true,
});

const SAFE_FLOW_VAULT_ABI = [
  {
    type: 'function',
    name: 'executePayment',
    inputs: [
      { name: 'vaultId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'reasonHash', type: 'bytes32' },
      { name: 'reasonMemo', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

interface PaymentIntent {
  intentId: string;
  merchantOrderId: string;
  agentAddress: string;
  vaultId: string;
  recipient: string;
  amountWei: string;
  currency: string;
  reason: string;
  metadata?: Record<string, unknown>;
  expiresAtMs: number;
  status: string;
  signature: string;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ExceedsRateLimit') || message.includes('rate limit')) return 'rate_limit';
  if (message.includes('InsufficientBalance')) return 'insufficient_balance';
  if (message.includes('SessionExpired') || message.includes('expired')) return 'expired';
  if (message.includes('SessionNotFound')) return 'session_not_found';
  if (message.includes('signature')) return 'signature_invalid';
  return 'execution_failed';
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS as Address;
  if (!contractAddress) throw new Error('Missing CONTRACT_ADDRESS');

  const agentPrivateKey = process.env.AGENT_PRIVATE_KEY as Hex;
  if (!agentPrivateKey) throw new Error('Missing AGENT_PRIVATE_KEY');

  const producerBaseUrl = process.env.PRODUCER_API_BASE_URL ?? 'http://localhost:3000/api/hashkey';
  const rpcUrl = process.env.RPC_URL ?? 'https://testnet.hsk.xyz';
  const pollMs = Number.parseInt(getArg('--poll-ms') ?? process.env.SAFEFLOW_POLL_MS ?? '5000', 10);
  const once = hasFlag('--once');
  const maxLoops = Number.parseInt(getArg('--max-loops') ?? '0', 10);
  const maxAmountWei = BigInt(process.env.SAFEFLOW_MAX_AMOUNT_WEI ?? '0');

  const account = privateKeyToAccount(agentPrivateKey);
  const agentAddress = account.address;

  const publicClient = createPublicClient({ chain: hashkeyTestnet, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: hashkeyTestnet, transport: http(rpcUrl) });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  console.log(JSON.stringify({ agentAddress, contractAddress, producerBaseUrl, pollMs, once, maxLoops }, null, 2));

  let loops = 0;
  while (true) {
    loops += 1;
    if (maxLoops > 0 && loops > maxLoops) {
      console.log(`Reached max loops (${maxLoops}), exiting.`);
      return;
    }

    // Fetch next intent
    const nextResp = await fetch(`${producerBaseUrl}/intents/next`);
    const nextJson = (await nextResp.json()) as { intent: PaymentIntent | null };
    const intent = nextJson.intent;

    if (!intent) {
      if (once) { console.log('No pending intent, exiting (--once).'); return; }
      await sleep(pollMs);
      continue;
    }

    console.log(`[runner] fetched intent ${intent.intentId} (${intent.merchantOrderId})`);

    try {
      // Check expiry
      if (Date.now() > intent.expiresAtMs) {
        await fetch(`${producerBaseUrl}/intents/${intent.intentId}/result`, {
          method: 'POST', headers,
          body: JSON.stringify({ success: false, errorCode: 'expired', errorMessage: 'Intent expired before execution.' }),
        });
        console.log(`[runner] intent expired: ${intent.intentId}`);
        if (once) return;
        await sleep(pollMs);
        continue;
      }

      // Check max amount
      if (maxAmountWei > 0n && BigInt(intent.amountWei) > maxAmountWei) {
        throw new Error(`Amount ${intent.amountWei} exceeds SAFEFLOW_MAX_AMOUNT_WEI=${maxAmountWei}`);
      }

      // ACK
      await fetch(`${producerBaseUrl}/intents/${intent.intentId}/ack`, {
        method: 'POST', headers,
        body: JSON.stringify({ agentAddress }),
      });

      // Build reasoning payload & hash
      const reasoningPayload = JSON.stringify({
        version: '1.0.0',
        timestampMs: Date.now(),
        agentAddress,
        vaultId: intent.vaultId,
        recipient: intent.recipient,
        amount: intent.amountWei,
        reasoning: intent.reason,
        intentId: intent.intentId,
        merchantOrderId: intent.merchantOrderId,
      });
      const reasonHash = keccak256(toHex(reasoningPayload));
      const memo = intent.reason.slice(0, 128);

      // Execute on-chain payment
      const txHash = await walletClient.writeContract({
        chain: hashkeyTestnet,
        account,
        address: contractAddress,
        abi: SAFE_FLOW_VAULT_ABI,
        functionName: 'executePayment',
        args: [BigInt(intent.vaultId), intent.recipient as Address, BigInt(intent.amountWei), reasonHash, memo],
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Report success
      await fetch(`${producerBaseUrl}/intents/${intent.intentId}/result`, {
        method: 'POST', headers,
        body: JSON.stringify({ success: true, txHash, reasonHash }),
      });

      console.log(JSON.stringify({ intentId: intent.intentId, status: 'executed', txHash, reasonHash }, null, 2));
    } catch (error) {
      const errorCode = classifyErrorCode(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await fetch(`${producerBaseUrl}/intents/${intent.intentId}/result`, {
        method: 'POST', headers,
        body: JSON.stringify({ success: false, errorCode, errorMessage }),
      }).catch(() => {});
      console.error(`[runner] intent failed: ${intent.intentId} ${errorCode} ${errorMessage}`);
    }

    if (once) return;
    await sleep(pollMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
