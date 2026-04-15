'use client';

import { RainbowKitProvider, getDefaultConfig, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { I18nProvider } from '@/i18n';
import { LOCAL_FORK_CONFIG_ERROR, walletChains } from '@/lib/chains';
import { SafeFlowResourceProvider } from '@/lib/safeflow-resources';
import '@rainbow-me/rainbowkit/styles.css';

if (LOCAL_FORK_CONFIG_ERROR) {
  console.warn(LOCAL_FORK_CONFIG_ERROR);
}

const config = getDefaultConfig({
  appName: 'SafeFlow Yield Agent',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
  chains: walletChains,
  ssr: false,
});

const queryClient = new QueryClient();

// ---------------------------------------------------------------------------
// Lightweight theme context — replaces next-themes to avoid React 19 script warning
// ---------------------------------------------------------------------------
type Theme = 'dark' | 'light';
interface ThemeCtx { theme: Theme; setTheme: (t: Theme) => void; }
const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', setTheme: () => {} });
export function useTheme() { return useContext(ThemeContext); }

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Read saved preference on mount
  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) as Theme | null;
    const initial: Theme = saved === 'light' ? 'light' : 'dark';
    setThemeState(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
    document.documentElement.classList.toggle('light', initial === 'light');
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem('theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
    document.documentElement.classList.toggle('light', t === 'light');
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
// ---------------------------------------------------------------------------

const lightKitTheme = lightTheme({ accentColor: '#6366f1', borderRadius: 'medium' });
const darkKitTheme = darkTheme({ accentColor: '#6366f1', borderRadius: 'medium' });

function ThemedRainbowKit({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <RainbowKitProvider theme={theme === 'light' ? lightKitTheme : darkKitTheme}>
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <I18nProvider>
            <SafeFlowResourceProvider>
              <ThemedRainbowKit>
                {children}
              </ThemedRainbowKit>
            </SafeFlowResourceProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
