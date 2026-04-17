import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { PaymentIntent } from '@/types';

const KV_KEY = 'hashkey_intents';
const HSP_WEBHOOK_LOG_KEY = 'hashkey_hsp_webhooks';

async function readIntents(): Promise<PaymentIntent[]> {
  try {
    const { env } = getCloudflareContext();
    const raw = await env.AUDIT_KV.get(KV_KEY);
    return raw ? (JSON.parse(raw) as PaymentIntent[]) : [];
  } catch {
    return [];
  }
}

async function writeIntents(intents: PaymentIntent[]): Promise<void> {
  const { env } = getCloudflareContext();
  await env.AUDIT_KV.put(KV_KEY, JSON.stringify(intents));
}

async function appendWebhookLog(payload: unknown): Promise<void> {
  try {
    const { env } = getCloudflareContext();
    const raw = await env.AUDIT_KV.get(HSP_WEBHOOK_LOG_KEY);
    const logs = raw ? (JSON.parse(raw) as unknown[]) : [];
    logs.push({ receivedAt: new Date().toISOString(), payload });
    // Keep last 100 entries
    const trimmed = logs.slice(-100);
    await env.AUDIT_KV.put(HSP_WEBHOOK_LOG_KEY, JSON.stringify(trimmed));
  } catch {
    // best-effort logging
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('x-webhook-signature') || '';

    // Log the webhook for debugging
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    await appendWebhookLog(payload);

    // Verify signature if HSP_APP_SECRET is configured
    const appSecret = process.env.HSP_APP_SECRET;
    if (appSecret && signatureHeader) {
      // Dynamic import to avoid pulling HspClient into client bundle
      const { HspClient } = await import('@/lib/hsp/client');
      const client = new HspClient({
        appKey: process.env.HSP_APP_KEY || '',
        appSecret,
      });
      const { valid } = await client.verifyWebhookSignature(signatureHeader, rawBody);
      if (!valid) {
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
    }

    // Match webhook to an intent by payment_request_id or tx_signature
    const paymentRequestId = payload.payment_request_id as string | undefined;
    const txSignature = payload.tx_signature as string | undefined;
    const status = payload.status as string | undefined;

    if (paymentRequestId || txSignature) {
      const intents = await readIntents();
      let matched = false;

      for (const intent of intents) {
        if (
          (intent.metadata as Record<string, unknown> | undefined)?.paymentRequestId === paymentRequestId ||
          intent.txHash === txSignature
        ) {
          if (status === 'payment-successful') {
            intent.status = 'executed';
          } else if (status === 'payment-failed') {
            intent.status = 'failed';
            intent.errorMessage = (payload.status_reason as string) || 'HSP payment failed';
          }
          intent.updatedAtMs = Date.now();
          matched = true;
        }
      }

      if (matched) {
        await writeIntents(intents);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[HSP webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
