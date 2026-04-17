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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const intents = await readIntents();
  const intent = intents.find(i => i.intentId === id);

  if (!intent) {
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 });
  }

  return NextResponse.json({ intent });
}
