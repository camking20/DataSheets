import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { PrimaryButton } from "../components/PrimaryButton";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/colors";
import { trpc, trpcErrorMessage } from "../lib/trpc";

const LoginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    const parsed = LoginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details and try again");
      return;
    }
    setSubmitting(true);
    try {
      const result = await trpc.auth.login.mutate(parsed.data);
      await signIn(
        result.token,
        result.user,
        result.company
          ? {
              id: result.company.id,
              name: result.company.name,
              slug: result.company.slug,
              role: result.company.role,
            }
          : null,
      );
    } catch (err) {
      setError(trpcErrorMessage(err, "Couldn't sign in — check your credentials"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <View style={styles.brand}>
            <Text style={styles.wordmark}>DataSheets</Text>
            <Text style={styles.tagline}>Operator sign in</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="operator@yourshop.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <PrimaryButton label="Sign in" onPress={onSubmit} loading={submitting} style={styles.submit} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 40 },
  brand: { alignItems: "center", gap: 6 },
  wordmark: { fontSize: 34, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.5 },
  tagline: { fontSize: 16, color: colors.textSecondary },
  form: { gap: 16 },
  field: { gap: 8 },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 18,
    paddingHorizontal: 16,
  },
  error: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "600",
  },
  submit: { marginTop: 8 },
});
