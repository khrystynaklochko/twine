import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  ConsentScopeId,
  OwnerWorkspaceState,
  RunMode,
  TwinProfile,
} from '../types/twin';

const OWNER_STORAGE_KEY = 'twinme_individual_owner_id';
const DEMO_STORAGE_KEY = 'twinme_demo_sandbox_owner_id';

function getOrCreateGuestId(): string {
  const existing = localStorage.getItem(OWNER_STORAGE_KEY);
  if (existing && existing.length >= 4) return existing;
  const generated = `ind_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(OWNER_STORAGE_KEY, generated);
  return generated;
}

function getActiveDemoId(): string | null {
  const existing = sessionStorage.getItem(DEMO_STORAGE_KEY);
  return existing && existing.startsWith('demo_') ? existing : null;
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export interface HealthStatus {
  ok: boolean;
  geminiConfigured: boolean;
  storageMode: string;
  firestoreEnabled: boolean;
  workspaceOAuthEnabled: boolean;
}

interface TwinContextValue {
  ownerId: string;
  demoActive: boolean;
  firebaseUser: User | null;
  workspace: OwnerWorkspaceState | null;
  health: HealthStatus | null;
  loading: boolean;
  error: string | null;
  apiFetch: <T = any>(url: string, init?: RequestInit) => Promise<T>;
  refreshWorkspace: () => Promise<void>;
  enterDemoSandbox: () => string;
  exitDemoSandbox: () => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOutAccount: () => Promise<void>;
  completeOnboarding: (payload: {
    displayName: string;
    headline: string;
    timezone: string;
    primaryGoal: string;
    workingConstraints: string[];
    consents: Record<ConsentScopeId, boolean>;
  }) => Promise<void>;
  updateProfile: (patch: Partial<TwinProfile> & { note?: string }) => Promise<void>;
  toggleConsent: (scope: ConsentScopeId, granted: boolean) => Promise<void>;
  grantSite: (origin: string, label: string, teachAllowed: boolean, agentAllowed: boolean) => Promise<void>;
  revokeSite: (origin: string) => Promise<void>;
  setRunMode: (mode: RunMode) => Promise<void>;
}

const TwinContext = createContext<TwinContextValue | null>(null);

export const TwinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ownerId, setOwnerId] = useState<string>(() => getActiveDemoId() || getOrCreateGuestId());
  const [demoActive, setDemoActive] = useState<boolean>(() => Boolean(getActiveDemoId()));
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<OwnerWorkspaceState | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (getActiveDemoId()) {
        return;
      }
      if (user?.uid) {
        setOwnerId(`g_${user.uid}`);
      } else {
        setOwnerId(getOrCreateGuestId());
      }
    });
    return () => unsub();
  }, []);

  const apiFetch = useCallback(
    async <T = any,>(url: string, init: RequestInit = {}): Promise<T> => {
      const headers = new Headers(init.headers);
      if (!headers.has('x-twin-owner')) {
        headers.set('x-twin-owner', ownerId);
      }
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      const res = await fetch(url, { ...init, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data as T;
    },
    [ownerId],
  );

  const refreshWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const isDemo = Boolean(getActiveDemoId());
      const accountType = !isDemo && firebaseUser ? 'google' : 'guest';
      const emailParam = !isDemo && firebaseUser?.email ? `&email=${encodeURIComponent(firebaseUser.email)}` : '';
      const [ws, hl] = await Promise.all([
        apiFetch<OwnerWorkspaceState>(`/api/workspace?accountType=${accountType}${emailParam}`),
        fetch('/api/health').then((r) => r.json() as Promise<HealthStatus>),
      ]);
      setWorkspace(ws);
      setHealth(hl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load personal twin workspace.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, firebaseUser]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const enterDemoSandbox = useCallback((): string => {
    const existing = getActiveDemoId();
    const id = existing || `demo_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(DEMO_STORAGE_KEY, id);
    setDemoActive(true);
    setOwnerId(id);
    return id;
  }, []);

  const exitDemoSandbox = useCallback(async () => {
    const demoId = getActiveDemoId();
    if (demoId) {
      try {
        await fetch('/api/privacy/account', {
          method: 'DELETE',
          headers: { 'x-twin-owner': demoId },
        });
      } catch {
        // ignore cleanup network errors
      }
      sessionStorage.removeItem(DEMO_STORAGE_KEY);
    }
    setDemoActive(false);
    setOwnerId(firebaseUser?.uid ? `g_${firebaseUser.uid}` : getOrCreateGuestId());
  }, [firebaseUser]);

  const signInGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    if (result.user && !getActiveDemoId()) {
      setOwnerId(`g_${result.user.uid}`);
    }
  };

  const signOutAccount = async () => {
    await signOut(auth);
    if (!getActiveDemoId()) {
      setOwnerId(getOrCreateGuestId());
    }
  };

  const completeOnboarding = async (payload: {
    displayName: string;
    headline: string;
    timezone: string;
    primaryGoal: string;
    workingConstraints: string[];
    consents: Record<ConsentScopeId, boolean>;
  }) => {
    const updated = await apiFetch<OwnerWorkspaceState>('/api/onboarding', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setWorkspace(updated);
  };

  const updateProfile = async (patch: Partial<TwinProfile> & { note?: string }) => {
    const updatedProfile = await apiFetch<TwinProfile>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setWorkspace((prev) => (prev ? { ...prev, profile: updatedProfile } : prev));
  };

  const toggleConsent = async (scope: ConsentScopeId, granted: boolean) => {
    await apiFetch('/api/consents', {
      method: 'POST',
      body: JSON.stringify({ scope, granted }),
    });
    await refreshWorkspace();
  };

  const grantSite = async (origin: string, label: string, teachAllowed: boolean, agentAllowed: boolean) => {
    await apiFetch('/api/sites', {
      method: 'POST',
      body: JSON.stringify({ origin, label, teachAllowed, agentAllowed }),
    });
    await refreshWorkspace();
  };

  const revokeSite = async (origin: string) => {
    await apiFetch(`/api/sites?origin=${encodeURIComponent(origin)}`, {
      method: 'DELETE',
    });
    await refreshWorkspace();
  };

  const setRunMode = async (mode: RunMode) => {
    await apiFetch('/api/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
    await refreshWorkspace();
  };

  return (
    <TwinContext.Provider
      value={{
        ownerId,
        demoActive,
        firebaseUser,
        workspace,
        health,
        loading,
        error,
        apiFetch,
        refreshWorkspace,
        enterDemoSandbox,
        exitDemoSandbox,
        signInGoogle,
        signOutAccount,
        completeOnboarding,
        updateProfile,
        toggleConsent,
        grantSite,
        revokeSite,
        setRunMode,
      }}
    >
      {children}
    </TwinContext.Provider>
  );
};

export function useTwin() {
  const ctx = useContext(TwinContext);
  if (!ctx) throw new Error('useTwin must be used inside TwinProvider');
  return ctx;
}
