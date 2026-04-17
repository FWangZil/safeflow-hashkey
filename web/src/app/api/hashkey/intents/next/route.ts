import { NextResponse } from 'next/server';
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

export async function GET() {
  const intents = await readIntents();
  const now = Date.now();

  // Find oldest non-expired pending intent
  const pending = intents
    .filter(i => i.status === 'pending' && i.expiresAtMs > now)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  if (pending.length === 0) {
    return NextResponse.json({ intent: null });
  }

  return NextResponse.json({ intent: pending[0] });
}
