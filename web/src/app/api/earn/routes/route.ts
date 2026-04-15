import { NextRequest, NextResponse } from 'next/server';

const COMPOSER_API = 'https://li.quest';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const params = new URLSearchParams();

    for (const [key, value] of searchParams.entries()) {
      params.set(key, value);
    }

    const apiKey = process.env.NEXT_PUBLIC_LIFI_API_KEY;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (apiKey) {
      headers['x-lifi-api-key'] = apiKey;
    }

    const res = await fetch(`${COMPOSER_API}/v1/routes?${params.toString()}`, {
      headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `LI.FI Routes API error: ${res.status}`, details: text.slice(0, 500) },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('LI.FI routes proxy error:', error);
    return NextResponse.json({ error: 'Failed to get routes' }, { status: 500 });
  }
}
