/**
 * HSP Demo — Prepare endpoint.
 *
 * Purpose: build a HashKey Settlement Protocol Cart Mandate locally for the
 * chat-driven demo, without ever calling the remote HSP merchant gateway.
 * The returned cart_hash is then pinned on-chain as `reasonHash` in
 * `SafeFlowVaultHashKey.executePayment`, proving that the AI agent's spend is
 * bound to an authentic HSP order payload.
 *
 * Input:  { amount: "0.05", recipient: "0x...", reason?: "..." }
 * Output: { cart, cartHash, cartHashBytes32, merchantJwt?, amountWei, recipient, reason }
 */

import { NextRequest, NextResponse } from 'next/server';
import { HspClient, signMerchantAuthorization, parseTokenAmount } from '@/lib/hsp/client';

interface PrepareRequest {
  amount: string;
  recipient: string;
  reason?: string;
  merchantName?: string;
  currency?: string; // display currency (USD by default)
  coin?: string;     // payment coin (HSK by default for the native-token demo)
}

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isDecimalAmount(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PrepareRequest;
    const { amount, recipient, reason } = body;

    if (!amount || !isDecimalAmount(amount)) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    if (!recipient || !isHexAddress(recipient)) {
      return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 });
    }

    // Build Cart Mandate contents. We keep the order self-contained so that the
    // cart hash fully describes the payment intent that the AI agent will
    // execute on-chain.
    const orderId = `SF-DEMO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const merchantName = body.merchantName ?? 'SafeFlow Agent Demo';
    const coin = body.coin ?? 'HSK';
    const currency = body.currency ?? 'USD';

    const cart = HspClient.buildCartMandateContents({
      orderId,
      payTo: recipient,
      amount,
      coin,
      currency,
      // HashKey Chain Testnet as the settlement layer in the mandate body.
      network: 'hashkey-testnet',
      chainId: 133,
      // For the native-token demo we intentionally leave the token contract
      // empty — the mandate is still a valid HSP descriptor, and the on-chain
      // execution happens via SafeFlowVaultHashKey.executePayment (native HSK).
      contractAddress: '',
      merchantName,
      displayItems: [
        {
          label: reason?.slice(0, 64) || 'AI agent payment',
          amount: { currency, value: amount },
        },
      ],
    });

    const cartHashHex = await HspClient.computeCartHash(cart); // 64-char hex, no 0x prefix
    const cartHashBytes32 = `0x${cartHashHex}`;

    // Optionally sign a merchant_authorization JWT if the merchant key is set.
    // In the demo we use Web Crypto (noble curves) for ES256K signing — it only
    // requires a local secp256k1 private key hex, no network access.
    let merchantJwt: string | undefined;
    const merchantKey = process.env.HSP_MERCHANT_PRIVATE_KEY;
    if (merchantKey && /^0x?[a-fA-F0-9]{64}$/.test(merchantKey.startsWith('0x') ? merchantKey.slice(2) : merchantKey)) {
      try {
        merchantJwt = await signMerchantAuthorization(cart, merchantName, merchantKey);
      } catch {
        merchantJwt = undefined;
      }
    }

    // Native HSK has 18 decimals; this matches the vault contract's accounting.
    const amountWei = parseTokenAmount(amount, 18);

    return NextResponse.json({
      cart,
      cartHash: cartHashHex,
      cartHashBytes32,
      merchantJwt: merchantJwt ?? null,
      amountWei,
      recipient,
      reason: reason ?? '',
      orderId,
      merchantName,
      coin,
      currency,
    });
  } catch (err) {
    console.error('[HSP demo prepare] error:', err);
    return NextResponse.json({ error: 'Failed to prepare HSP cart mandate' }, { status: 500 });
  }
}
