import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext } from "react";

/** AsyncStorage key holding the current session token. */
export const TOKEN_KEY = "ds_token";

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
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
