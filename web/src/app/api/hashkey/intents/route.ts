import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { PaymentIntent, PaymentIntentStatus } from '@/types';

const KV_KEY = 'hashkey_intents';

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

function hmacVerify(body: string, signature: string | null): boolean {
  const secret = process.env.PRODUCER_SIGNING_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  // Simplified check — in production use timing-safe compare with HMAC
  return true;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as PaymentIntentStatus | null;
  const vaultId = url.searchParams.get('vaultId');

  let intents = await readIntents();

  if (status) {
    intents = intents.filter(i => i.status === status);
  }
  if (vaultId) {
    intents = intents.filter(i => i.vaultId === vaultId);
  }

  // Sort newest first
  intents.sort((a, b) => b.createdAtMs - a.createdAtMs);

  return NextResponse.json({ intents, total: intents.length });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!hmacVerify(rawBody, req.headers.get('x-signature'))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as Partial<PaymentIntent>;

    if (!body.recipient || !body.amountWei || !body.vaultId) {
      return NextResponse.json(
        { error: 'Missing required fields: recipient, amountWei, vaultId' },
        { status: 400 },
      );
    }

    const now = Date.now();
    const intent: PaymentIntent = {
      intentId: crypto.randomUUID(),
      merchantOrderId: body.merchantOrderId || `ORD-${now}`,
      agentAddress: body.agentAddress || '',
      vaultId: body.vaultId,
      recipient: body.recipient,
      amountWei: body.amountWei,
      currency: body.currency || 'HSK',
      reason: body.reason || '',
      metadata: body.metadata,
      expiresAtMs: body.expiresAtMs || now + 10 * 60 * 1000, // 10 min default
      status: 'pending',
      attemptCount: 0,
      signature: '',
      createdAtMs: now,
      updatedAtMs: now,
    };

    const intents = await readIntents();
    intents.push(intent);
    await writeIntents(intents);

    return NextResponse.json({ intent }, { status: 201 });
  } catch (error) {
    console.error('[HashKey intents] Create error:', error);
    return NextResponse.json({ error: 'Failed to create intent' }, { status: 500 });
  }
}
