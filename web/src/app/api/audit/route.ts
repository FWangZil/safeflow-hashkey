import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'audit.json');

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
  status: 'pending' | 'executed' | 'failed';
}

function ensureDb(): AuditEntry[] {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, '[]');
    return [];
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function saveDb(entries: AuditEntry[]) {
  fs.writeFileSync(DB_FILE, JSON.stringify(entries, null, 2));
}

export async function GET() {
  const entries = ensureDb();
  return NextResponse.json({ entries, total: entries.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entries = ensureDb();

    const payload = JSON.stringify({
      timestamp: body.timestamp || Date.now(),
      agentAddress: body.agentAddress,
      action: body.action,
      vault: body.vault,
      amount: body.amount,
      reasoning: body.reasoning,
    });

    const evidenceHash = '0x' + crypto.createHash('sha256').update(payload).digest('hex');

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
    };

    entries.push(entry);
    saveDb(entries);

    return NextResponse.json({ entry, evidenceHash });
  } catch (error) {
    console.error('Audit write error:', error);
    return NextResponse.json({ error: 'Failed to create audit entry' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, txHash, ipfsCid, status } = body;

    const entries = ensureDb();
    const entry = entries.find(e => e.id === id);
    if (!entry) {
      return NextResponse.json({ error: 'Audit entry not found' }, { status: 404 });
    }

    if (txHash) entry.txHash = txHash;
    if (ipfsCid) entry.ipfsCid = ipfsCid;
    if (status) entry.status = status;

    saveDb(entries);
    return NextResponse.json({ entry });
  } catch (error) {
    console.error('Audit update error:', error);
    return NextResponse.json({ error: 'Failed to update audit entry' }, { status: 500 });
  }
}
