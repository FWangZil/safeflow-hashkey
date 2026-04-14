'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount } from 'wagmi';

export type SafeFlowWalletResource = {
  walletId: string;
  savedForAddress: `0x${string}`;
  chainId?: number;
  txHash?: `0x${string}`;
  source: 'created' | 'imported';
  createdAt: number;
};

export type SafeFlowCapResource = {
  capId: string;
  walletId: string;
  agentAddress: `0x${string}`;
  savedForAddress: `0x${string}`;
  chainId?: number;
  maxSpendPerInterval?: string;
  maxSpendTotal?: string;
  intervalSeconds?: string;
  expiresAt?: string;
  totalSpent?: string;
  active?: boolean;
  txHash?: `0x${string}`;
  source: 'created' | 'imported';
  createdAt: number;
};

type SafeFlowLastUsed = {
  walletId: string;
  capId: string;
  updatedAt: number;
};

type SafeFlowResourceState = {
  wallets: SafeFlowWalletResource[];
  caps: SafeFlowCapResource[];
  lastUsedByAddress: Record<string, SafeFlowLastUsed>;
};

type ImportCapParams = {
  capId: string;
  walletId: string;
  agentAddress: `0x${string}`;
  chainId?: number;
  maxSpendPerInterval?: string;
  maxSpendTotal?: string;
  intervalSeconds?: string;
  expiresAt?: string;
  totalSpent?: string;
  active?: boolean;
  txHash?: `0x${string}`;
  savedForAddress?: `0x${string}`;
};

type SafeFlowResourceContextValue = {
  isHydrated: boolean;
  wallets: SafeFlowWalletResource[];
  caps: SafeFlowCapResource[];
  currentWallets: SafeFlowWalletResource[];
  currentCaps: SafeFlowCapResource[];
  currentAgentCaps: SafeFlowCapResource[];
  lastUsed?: SafeFlowLastUsed;
  upsertWallet: (wallet: Omit<SafeFlowWalletResource, 'createdAt'> & { createdAt?: number }) => void;
  upsertCap: (cap: Omit<SafeFlowCapResource, 'createdAt'> & { createdAt?: number }) => void;
  importCap: (cap: ImportCapParams) => void;
  rememberLastUsed: (selection: { walletId: string; capId: string; savedForAddress?: `0x${string}` }) => void;
};

const STORAGE_KEY = 'safeflow-resource-library:v1';

const EMPTY_STATE: SafeFlowResourceState = {
  wallets: [],
  caps: [],
  lastUsedByAddress: {},
};

const SafeFlowResourceContext = createContext<SafeFlowResourceContextValue | null>(null);

function normalizeAddress(value?: string | null): `0x${string}` | undefined {
  if (!value) return undefined;
  return value.toLowerCase() as `0x${string}`;
}

function readStoredState(): SafeFlowResourceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;

    const parsed = JSON.parse(raw) as Partial<SafeFlowResourceState>;
    return {
      wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [],
      caps: Array.isArray(parsed.caps) ? parsed.caps : [],
      lastUsedByAddress:
        parsed.lastUsedByAddress && typeof parsed.lastUsedByAddress === 'object' ? parsed.lastUsedByAddress : {},
    };
  } catch {
    return EMPTY_STATE;
  }
}

function upsertWalletInState(
  state: SafeFlowResourceState,
  wallet: Omit<SafeFlowWalletResource, 'createdAt'> & { createdAt?: number },
  fallbackAddress?: `0x${string}`,
): SafeFlowResourceState {
  const savedForAddress = normalizeAddress(wallet.savedForAddress) ?? fallbackAddress;
  if (!savedForAddress) return state;

  const nextWallet: SafeFlowWalletResource = {
    ...wallet,
    savedForAddress,
    createdAt: wallet.createdAt ?? Date.now(),
  };

  const existingIndex = state.wallets.findIndex(
    resource => resource.walletId === nextWallet.walletId && resource.savedForAddress === savedForAddress,
  );

  if (existingIndex === -1) {
    return {
      ...state,
      wallets: [nextWallet, ...state.wallets].sort((left, right) => right.createdAt - left.createdAt),
    };
  }

  const nextWallets = [...state.wallets];
  nextWallets[existingIndex] = {
    ...nextWallets[existingIndex],
    ...nextWallet,
    createdAt: nextWallets[existingIndex].createdAt,
  };

  return {
    ...state,
    wallets: nextWallets,
  };
}

function upsertCapInState(
  state: SafeFlowResourceState,
  cap: Omit<SafeFlowCapResource, 'createdAt'> & { createdAt?: number },
  fallbackAddress?: `0x${string}`,
): SafeFlowResourceState {
  const savedForAddress = normalizeAddress(cap.savedForAddress) ?? fallbackAddress;
  if (!savedForAddress) return state;

  const nextCap: SafeFlowCapResource = {
    ...cap,
    savedForAddress,
    agentAddress: normalizeAddress(cap.agentAddress) ?? cap.agentAddress,
    createdAt: cap.createdAt ?? Date.now(),
  };

  const existingIndex = state.caps.findIndex(
    resource => resource.capId === nextCap.capId && resource.savedForAddress === savedForAddress,
  );

  if (existingIndex === -1) {
    return {
      ...state,
      caps: [nextCap, ...state.caps].sort((left, right) => right.createdAt - left.createdAt),
    };
  }

  const nextCaps = [...state.caps];
  nextCaps[existingIndex] = {
    ...nextCaps[existingIndex],
    ...nextCap,
    createdAt: nextCaps[existingIndex].createdAt,
  };

  return {
    ...state,
    caps: nextCaps,
  };
}

export function SafeFlowResourceProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const normalizedAddress = normalizeAddress(address);
  const [state, setState] = useState<SafeFlowResourceState>(EMPTY_STATE);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const nextState = readStoredState();
    const frame = window.requestAnimationFrame(() => {
      setState(nextState);
      setIsHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isHydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [isHydrated, state]);

  const upsertWallet = useCallback(
    (wallet: Omit<SafeFlowWalletResource, 'createdAt'> & { createdAt?: number }) => {
      setState(current => upsertWalletInState(current, wallet, normalizedAddress));
    },
    [normalizedAddress],
  );

  const upsertCap = useCallback(
    (cap: Omit<SafeFlowCapResource, 'createdAt'> & { createdAt?: number }) => {
      setState(current => upsertCapInState(current, cap, normalizedAddress));
    },
    [normalizedAddress],
  );

  const importCap = useCallback(
    (cap: ImportCapParams) => {
      const savedForAddress = normalizeAddress(cap.savedForAddress) ?? normalizedAddress;
      if (!savedForAddress) return;

      setState(current => {
        let nextState = upsertWalletInState(
          current,
          {
            walletId: cap.walletId,
            savedForAddress,
            chainId: cap.chainId,
            txHash: cap.txHash,
            source: 'imported',
          },
          savedForAddress,
        );

        nextState = upsertCapInState(
          nextState,
          {
            capId: cap.capId,
            walletId: cap.walletId,
            agentAddress: cap.agentAddress,
            savedForAddress,
            chainId: cap.chainId,
            maxSpendPerInterval: cap.maxSpendPerInterval,
            maxSpendTotal: cap.maxSpendTotal,
            intervalSeconds: cap.intervalSeconds,
            expiresAt: cap.expiresAt,
            totalSpent: cap.totalSpent,
            active: cap.active,
            txHash: cap.txHash,
            source: 'imported',
          },
          savedForAddress,
        );

        return nextState;
      });
    },
    [normalizedAddress],
  );

  const rememberLastUsed = useCallback(
    ({ walletId, capId, savedForAddress }: { walletId: string; capId: string; savedForAddress?: `0x${string}` }) => {
      const resolvedAddress = normalizeAddress(savedForAddress) ?? normalizedAddress;
      if (!resolvedAddress) return;

      setState(current => ({
        ...current,
        lastUsedByAddress: {
          ...current.lastUsedByAddress,
          [resolvedAddress]: {
            walletId,
            capId,
            updatedAt: Date.now(),
          },
        },
      }));
    },
    [normalizedAddress],
  );

  const currentWallets = useMemo(() => {
    if (!normalizedAddress) return [];
    return state.wallets.filter(wallet => wallet.savedForAddress === normalizedAddress);
  }, [normalizedAddress, state.wallets]);

  const currentCaps = useMemo(() => {
    if (!normalizedAddress) return [];
    return state.caps.filter(cap => cap.savedForAddress === normalizedAddress);
  }, [normalizedAddress, state.caps]);

  const currentAgentCaps = useMemo(() => {
    if (!normalizedAddress) return [];
    return currentCaps.filter(cap => normalizeAddress(cap.agentAddress) === normalizedAddress);
  }, [currentCaps, normalizedAddress]);

  const lastUsed = normalizedAddress ? state.lastUsedByAddress[normalizedAddress] : undefined;

  const value = useMemo(
    () => ({
      isHydrated,
      wallets: state.wallets,
      caps: state.caps,
      currentWallets,
      currentCaps,
      currentAgentCaps,
      lastUsed,
      upsertWallet,
      upsertCap,
      importCap,
      rememberLastUsed,
    }),
    [currentAgentCaps, currentCaps, currentWallets, importCap, isHydrated, lastUsed, state.caps, state.wallets, rememberLastUsed, upsertCap, upsertWallet],
  );

  return <SafeFlowResourceContext.Provider value={value}>{children}</SafeFlowResourceContext.Provider>;
}

export function useSafeFlowResources() {
  const context = useContext(SafeFlowResourceContext);
  if (!context) throw new Error('useSafeFlowResources must be used within SafeFlowResourceProvider');
  return context;
}