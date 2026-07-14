import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  AuthContext,
  clearToken,
  getToken,
  setToken,
  type AuthCompany,
  type AuthState,
  type AuthUser,
} from "../lib/auth";
import { colors } from "../lib/colors";
import { trpc } from "../lib/trpc";

/**
 * Root layout: restores the session token, hydrates the user/company via
 * `auth.me`, and gates every route behind `/login` until signed in. This is
 * the only place navigation decisions based on auth state are made — screens
 * underneath assume they're already authenticated.
 */
export default function RootLayout() {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<AuthCompany | null>(null);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getToken();
      if (!stored) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      try {
        const me = await trpc.auth.me.query();
        if (cancelled) return;
        setTokenState(stored);
        setUser(me.user);
        setCompany(
          me.companyId
            ? {
                id: me.companyId,
                name: me.companyName ?? "",
                slug: me.memberships.find((m) => m.companyId === me.companyId)?.companySlug ?? "",
                role: me.role ?? "operator",
              }
            : null,
        );
        setStatus("signedIn");
      } catch {
        // Expired/invalid session — fall back to the login screen.
        await clearToken();
        if (!cancelled) setStatus("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    const onLoginScreen = segments[0] === "login";
    if (status === "signedOut" && !onLoginScreen) {
      router.replace("/login");
    } else if (status === "signedIn" && onLoginScreen) {
      router.replace("/");
    }
  }, [status, segments, router]);

  const signIn = useCallback(
    async (nextToken: string, nextUser: AuthUser, nextCompany: AuthCompany | null) => {
      await setToken(nextToken);
      setTokenState(nextToken);
      setUser(nextUser);
      setCompany(nextCompany);
      setStatus("signedIn");
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await trpc.auth.logout.mutate();
    } catch {
      // Best-effort server-side session invalidation — always clear locally.
    }
    await clearToken();
    setTokenState(null);
    setUser(null);
    setCompany(null);
    setStatus("signedOut");
  }, []);

  const authValue = useMemo<AuthState>(
    () => ({ status, token, user, company, signIn, signOut }),
    [status, token, user, company, signIn, signOut],
  );

  if (status === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthContext.Provider value={authValue}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerTitleStyle: { color: colors.textPrimary },
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="login" options={{ headerShown: false }} />
          {/* Defer data-fetching screens until auth is ready so they never hit
              the API without a token (avoids a flash-fetch on cold start). */}
          {status === "signedIn" ? (
            <>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen
                name="inspect/new"
                options={{ title: "New Inspection", presentation: "modal" }}
              />
              <Stack.Screen name="inspect/[id]" options={{ title: "Inspection" }} />
            </>
          ) : null}
        </Stack>
      </AuthContext.Provider>
    </SafeAreaProvider>
  );
}
