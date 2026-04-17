import { NextResponse } from 'next/server';

export async function GET() {
  const appKey = process.env.HSP_APP_KEY;
  const appSecret = process.env.HSP_APP_SECRET;
  const merchantKey = process.env.HSP_MERCHANT_PRIVATE_KEY;
  const baseUrl = process.env.HSP_BASE_URL || 'https://merchant-qa.hashkeymerchant.com';
  const payTo = process.env.HSP_PAY_TO;

  const checks = {
    appKeyConfigured: !!appKey,
    appSecretConfigured: !!appSecret,
    merchantKeyConfigured: !!merchantKey,
    payToConfigured: !!payTo,
    baseUrl,
    merchantName: process.env.HSP_MERCHANT_NAME || 'SafeFlow Agent',
  };

  const healthy = checks.appKeyConfigured && checks.appSecretConfigured;

  return NextResponse.json({
    healthy,
    checks,
    mode: process.env.NEXT_PUBLIC_SAFEFLOW_MODE || 'defi',
    timestamp: new Date().toISOString(),
  });
}
