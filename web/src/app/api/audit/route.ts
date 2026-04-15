import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const KV_KEY = 'audit_entries';

interface AuditEntry {
  id: string;
  timestamp: number;
  agentAddress: string;
  action: string;
  vault: string;
  vaultName: string;
  token: string;
  amount: string;
  reasoning: string;
  riskScore: number;
  evidenceHash: string;
  ipfsCid?: string;
  txHash?: string;
  status: 'pending' | 'executed' | 'failed' | 'withdrawn';
  chainId?: number;
  decimals?: number;
  walletId?: string;
  tokenAddress?: string;
  vaultAddress?: string;
  capId?: string;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function readEntries(): Promise<AuditEntry[]> {
  const { env } = getCloudflareContext();
  const raw = await env.AUDIT_KV.get(KV_KEY);
  return raw ? (JSON.parse(raw) as AuditEntry[]) : [];
}

async function writeEntries(entries: AuditEntry[]): Promise<void> {
  const { env } = getCloudflareContext();
  await env.AUDIT_KV.put(KV_KEY, JSON.stringify(entries));
}

export async function GET() {
  const entries = await readEntries();
  return NextResponse.json({ entries, total: entries.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<AuditEntry> & Record<string, unknown>;

    const payload = JSON.stringify({
      timestamp: body.timestamp || Date.now(),
      agentAddress: body.agentAddress,
      action: body.action,
      vault: body.vault,
      amount: body.amount,
      reasoning: body.reasoning,
    });

    const evidenceHash = '0x' + (await sha256Hex(payload));

    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: body.timestamp || Date.now(),
      agentAddress: body.agentAddress || '0x0',
      action: body.action || 'deposit',
      vault: body.vault || '',
      vaultName: body.vaultName || '',
      token: body.token || '',
      amount: body.amount || '0',
      reasoning: body.reasoning || '',
      riskScore: body.riskScore ?? 0,
      evidenceHash,
      status: 'pending',
      ...(body.chainId !== undefined && { chainId: Number(body.chainId) }),
      ...(body.decimals !== undefined && { decimals: Number(body.decimals) }),
      ...(body.walletId !== undefined && { walletId: String(body.walletId) }),
      ...(body.tokenAddress !== undefined && { tokenAddress: String(body.tokenAddress) }),
      ...(body.vaultAddress !== undefined && { vaultAddress: String(body.vaultAddress) }),
      ...(body.capId !== undefined && { capId: String(body.capId) }),
    };

    const entries = await readEntries();
    entries.push(entry);
    await writeEntries(entries);

    return NextResponse.json({ entry, evidenceHash });
  } catch (error) {
    console.error('Audit write error:', error);
    return NextResponse.json({ error: 'Failed to create audit entry' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { id: string; txHash?: string; ipfsCid?: string; status?: AuditEntry['status'] };
    const { id, txHash, ipfsCid, status } = body;

    const entries = await readEntries();
    const entry = entries.find(e => e.id === id);
    if (!entry) {
      return NextResponse.json({ error: 'Audit entry not found' }, { status: 404 });
    }

    if (txHash) entry.txHash = txHash;
    if (ipfsCid) entry.ipfsCid = ipfsCid;
    if (status) entry.status = status;

    await writeEntries(entries);
    return NextResponse.json({ entry });
  } catch (error) {
    console.error('Audit update error:', error);
    return NextResponse.json({ error: 'Failed to update audit entry' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await writeEntries([]);
    return NextResponse.json({ cleared: true });
  } catch (error) {
    console.error('Audit clear error:', error);
    return NextResponse.json({ error: 'Failed to clear audit entries' }, { status: 500 });
  }
}
