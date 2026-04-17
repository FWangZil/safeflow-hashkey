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
    const body = await req.json() as {
      success: boolean;
      txHash?: string;
      reasonHash?: string;
      errorCode?: string;
      errorMessage?: string;
    };

    const intents = await readIntents();
    const intent = intents.find(i => i.intentId === id);

    if (!intent) {
      return NextResponse.json({ error: 'Intent not found' }, { status: 404 });
    }

    if (intent.status !== 'claimed') {
      return NextResponse.json(
        { error: `Intent is ${intent.status}, expected claimed` },
        { status: 409 },
      );
    }

    intent.status = body.success ? 'executed' : 'failed';
    intent.txHash = body.txHash;
    intent.reasonHash = body.reasonHash;
    intent.errorCode = body.errorCode;
    intent.errorMessage = body.errorMessage;
    intent.finishedAt = Date.now();
    intent.updatedAtMs = Date.now();
    await writeIntents(intents);

    return NextResponse.json({ intent });
  } catch (error) {
    console.error('[HashKey intents] Result error:', error);
    return NextResponse.json({ error: 'Failed to report result' }, { status: 500 });
  }
}
