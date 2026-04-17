import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Use import.meta.url so this works whether Next loads the config as ESM
// or CJS (in CJS, `__dirname` would work, but this is safe in both).
const __dirname_ = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this package. Without this, Next.js 16
  // walks up looking for a package.json and (incorrectly) picks the monorepo
  // root, causing module resolution failures like
  //   "Can't resolve 'tailwindcss' in '/.../safeflow-hashkey'".
  turbopack: {
    root: __dirname_,
  },

  // Cloudflare Workers handles HTTP compression at the edge.
  // Disabling Next.js's built-in gzip compression removes
  // `next/dist/compiled/compression` (~308 KB) from the Worker bundle.
  compress: false,

  // Exclude wallet/web3 client-only packages from the Server Function
  // bundle. These packages are only used inside dynamic({ ssr: false })
  // components (DynamicProviders, page.tsx → page-client.tsx), so they
  // will never be require()'d on the server at runtime.
  // This removes ~1.5 MB from the CF Worker bundle (wagmi, viem,
  // RainbowKit, WalletConnect, @reown).
  serverExternalPackages: [
    'wagmi',
    'viem',
    '@rainbow-me/rainbowkit',
    '@walletconnect/ethereum-provider',
    '@walletconnect/core',
    '@walletconnect/utils',
    '@walletconnect/logger',
    '@reown/appkit',
    '@reown/appkit-core',
  ],
};

export default nextConfig;

// Enable Cloudflare bindings (KV, R2, D1, etc.) during `next dev`
// See: https://opennext.js.org/cloudflare/get-started#12-develop-locally
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
