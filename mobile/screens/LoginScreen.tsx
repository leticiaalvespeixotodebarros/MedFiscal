import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { login } from "../src/api";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleLogin() {
    setErro(null);

    if (!email || !senha) {
      setErro("Informe e-mail e senha.");
      return;
    }

    setCarregando(true);
    try {
      await login(email, senha);
      navigation.replace("Home");
    } catch (err: any) {
      const mensagem =
        err?.response?.data?.erro ??
        "Não foi possível entrar. Verifique sua conexão e tente novamente.";
      setErro(mensagem);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.titulo}>MedFiscal</Text>
      <Text style={styles.subtitulo}>Entre com sua conta</Text>

      <TextInput
        style={styles.input}
        placeholder="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder="Senha"
        value={senha}
        onChangeText={setSenha}
        secureTextEntry
      />

      {erro && <Text style={styles.erro}>{erro}</Text>}

      <TouchableOpacity
        style={styles.botao}
        onPress={handleLogin}
        disabled={carregando}
      >
        {carregando ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.botaoTexto}>Entrar</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#F5F7FA",
  },
  titulo: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0B5FFF",
    marginBottom: 4,
    textAlign: "center",
  },
  subtitulo: {
    fontSize: 15,
    color: "#4F4F4F",
    marginBottom: 32,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  erro: {
    color: "#EB5757",
    marginBottom: 12,
    textAlign: "center",
  },
  botao: {
    backgroundColor: "#0B5FFF",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  botaoTexto: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
