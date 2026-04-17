import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { PaymentIntent } from '@/types';

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json() as { agentAddress: string };

    const intents = await readIntents();
    const intent = intents.find(i => i.intentId === id);

    if (!intent) {
      return NextResponse.json({ error: 'Intent not found' }, { status: 404 });
    }

    if (intent.status !== 'pending') {
      return NextResponse.json(
        { error: `Intent is ${intent.status}, cannot ACK` },
        { status: 409 },
      );
    }

    if (Date.now() > intent.expiresAtMs) {
      intent.status = 'expired';
      intent.updatedAtMs = Date.now();
      await writeIntents(intents);
      return NextResponse.json({ error: 'Intent has expired' }, { status: 410 });
    }

    intent.status = 'claimed';
    intent.agentAddress = body.agentAddress || intent.agentAddress;
    intent.claimedAtMs = Date.now();
    intent.attemptCount += 1;
    intent.updatedAtMs = Date.now();
    await writeIntents(intents);

    return NextResponse.json({ intent });
  } catch (error) {
    console.error('[HashKey intents] ACK error:', error);
    return NextResponse.json({ error: 'Failed to ACK intent' }, { status: 500 });
  }
}
