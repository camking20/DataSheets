import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext } from "react";

/** Key holding the current session token (SecureStore, with AsyncStorage fallback). */
export const TOKEN_KEY = "ds_token";

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return AsyncStorage.getItem(key);
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Best-effort cleanup of legacy AsyncStorage copy.
    }
  } catch {
    await AsyncStorage.setItem(key, value);
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // SecureStore unavailable — still clear AsyncStorage below.
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function getToken(): Promise<string | null> {
  const fromSecure = await secureGet(TOKEN_KEY);
  if (fromSecure) return fromSecure;

  // Migrate legacy AsyncStorage token into SecureStore when possible.
  try {
    const legacy = await AsyncStorage.getItem(TOKEN_KEY);
    if (!legacy) return null;
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, legacy);
      await AsyncStorage.removeItem(TOKEN_KEY);
    } catch {
      // Keep serving from AsyncStorage if SecureStore cannot accept the write.
    }
    return legacy;
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await secureDelete(TOKEN_KEY);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthCompany {
  id: string;
  name: string;
  slug: string;
  role: "operator" | "engineer" | "admin";
}

export interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  token: string | null;
  user: AuthUser | null;
  company: AuthCompany | null;
  signIn: (token: string, user: AuthUser, company: AuthCompany | null) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
