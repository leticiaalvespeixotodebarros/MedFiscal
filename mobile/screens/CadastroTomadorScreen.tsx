import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { buscarDadosCnpj, criarTomador, nomeExibicaoTomador } from "../src/api";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "CadastroTomador">;

interface Erros {
  cnpj?: string;
  razaoSocial?: string;
  endereco?: string;
  email?: string;
  telefone?: string;
  geral?: string;
}

function formatarCnpjExibicao(digitos: string): string {
  if (digitos.length !== 14) return digitos;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(
    5,
    8
  )}/${digitos.slice(8, 12)}-${digitos.slice(12, 14)}`;
}

export default function CadastroTomadorScreen({ navigation }: Props) {
  const [cnpj, setCnpj] = useState(""); // sempre só dígitos internamente
  const [apelido, setApelido] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");
  const [endereco, setEndereco] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  // Campos estruturados de endereço — não aparecem na tela (a usuária só
  // vê o campo "Endereço" de sempre), mas são necessários pra emitir
  // NFS-e de verdade depois. Preenchidos sozinhos quando a busca por
  // CNPJ funciona; ficam vazios se o cadastro for feito manualmente.
  const [logradouro, setLogradouro] = useState("");
  const [numeroEndereco, setNumeroEndereco] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cep, setCep] = useState("");
  const [codigoMunicipioIbge, setCodigoMunicipioIbge] = useState<string | null>(
    null
  );
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<Erros>({});

  function handleChangeCnpj(texto: string) {
    const digitos = texto.replace(/\D/g, "").slice(0, 14);
    setCnpj(digitos);
    setErros((atual) => ({ ...atual, cnpj: undefined }));
  }

  async function handleBuscarCnpj() {
    if (cnpj.length !== 14) {
      setErros((atual) => ({ ...atual, cnpj: "CNPJ deve ter 14 dígitos." }));
      return;
    }
    setBuscandoCnpj(true);
    setErros((atual) => ({ ...atual, cnpj: undefined, geral: undefined }));
    try {
      const dados = await buscarDadosCnpj(cnpj);
      setRazaoSocial(dados.razao_social || "");
      setEndereco(dados.endereco || "");
      setEmail(dados.email || "");
      setTelefone(dados.telefone || "");
      setLogradouro(dados.logradouro || "");
      setNumeroEndereco(dados.numero || "");
      setComplemento(dados.complemento || "");
      setBairro(dados.bairro || "");
      setCep(dados.cep || "");
      setCodigoMunicipioIbge(dados.codigo_municipio_ibge ?? null);
    } catch (err: any) {
      const mensagem =
        err?.response?.data?.erro ??
        "Não foi possível consultar esse CNPJ agora. Preencha os dados manualmente.";
      setErros((atual) => ({ ...atual, geral: mensagem }));
    } finally {
      setBuscandoCnpj(false);
    }
  }

  async function handleSalvar() {
    const novosErros: Erros = {};
    if (cnpj.length !== 14) novosErros.cnpj = "CNPJ deve ter 14 dígitos.";
    if (!razaoSocial) novosErros.razaoSocial = "Informe a razão social.";
    if (!endereco) novosErros.endereco = "Informe o endereço.";
    if (!email) novosErros.email = "Informe o e-mail.";
    if (!telefone) novosErros.telefone = "Informe o telefone.";

    if (Object.keys(novosErros).length > 0) {
      setErros(novosErros);
      return;
    }

    setErros({});
    setSalvando(true);
    try {
      const tomador = await criarTomador({
        cnpj,
        apelido: apelido || undefined,
        razao_social: razaoSocial,
        endereco,
        email,
        telefone,
        logradouro: logradouro || undefined,
        numero: numeroEndereco || undefined,
        complemento: complemento || undefined,
        bairro: bairro || undefined,
        cep: cep || undefined,
        codigo_municipio_ibge: codigoMunicipioIbge || undefined,
      });
      // Volta para a tela de Novo Plantão já com esse hospital selecionado.
      navigation.navigate("NovoPlantao", {
        tomadorSelecionadoId: tomador.id,
        tomadorSelecionadoNome: nomeExibicaoTomador(tomador),
      });
    } catch (err: any) {
      const mensagem =
        err?.response?.data?.erro ?? "Não foi possível cadastrar o hospital.";
      setErros({ geral: mensagem });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
      <Text style={styles.titulo}>Novo hospital</Text>

      <Text style={styles.label}>CNPJ</Text>
      <View style={styles.linha}>
        <TextInput
          style={[styles.input, styles.inputFlex, erros.cnpj && styles.inputErro]}
          placeholder="00.000.000/0000-00"
          value={formatarCnpjExibicao(cnpj)}
          onChangeText={handleChangeCnpj}
          keyboardType="numeric"
        />
        <TouchableOpacity
          style={styles.botaoBuscar}
          onPress={handleBuscarCnpj}
          disabled={buscandoCnpj}
        >
          {buscandoCnpj ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.botaoBuscarTexto}>Buscar</Text>
          )}
        </TouchableOpacity>
      </View>
      {erros.cnpj && <Text style={styles.erroCampo}>{erros.cnpj}</Text>}

      <Text style={styles.label}>Apelido (opcional)</Text>
      <TextInput
        style={styles.input}
        placeholder="Como você quer chamar esse hospital no app"
        value={apelido}
        onChangeText={setApelido}
      />
      <Text style={styles.dicaApelido}>
        Se não preencher, o app mostra a razão social completa.
      </Text>

      <Text style={styles.label}>Razão social</Text>
      <TextInput
        style={[styles.input, erros.razaoSocial && styles.inputErro]}
        placeholder="Hospital Exemplo Ltda"
        value={razaoSocial}
        onChangeText={setRazaoSocial}
      />
      {erros.razaoSocial && <Text style={styles.erroCampo}>{erros.razaoSocial}</Text>}

      <Text style={styles.label}>Endereço</Text>
      <TextInput
        style={[styles.input, erros.endereco && styles.inputErro]}
        placeholder="Rua Exemplo, 123, São Paulo, SP"
        value={endereco}
        onChangeText={setEndereco}
      />
      {erros.endereco && <Text style={styles.erroCampo}>{erros.endereco}</Text>}

      <Text style={styles.label}>E-mail</Text>
      <TextInput
        style={[styles.input, erros.email && styles.inputErro]}
        placeholder="contato@hospital.com.br"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {erros.email && <Text style={styles.erroCampo}>{erros.email}</Text>}

      <Text style={styles.label}>Telefone</Text>
      <TextInput
        style={[styles.input, erros.telefone && styles.inputErro]}
        placeholder="(62) 3000-0000"
        value={telefone}
        onChangeText={setTelefone}
        keyboardType="phone-pad"
      />
      {erros.telefone && <Text style={styles.erroCampo}>{erros.telefone}</Text>}

      {erros.geral && <Text style={styles.erro}>{erros.geral}</Text>}

      <TouchableOpacity
        style={styles.botaoSalvar}
        onPress={handleSalvar}
        disabled={salvando}
      >
        {salvando ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.botaoSalvarTexto}>Salvar hospital</Text>
        )}
      </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 30,
    backgroundColor: "#F5F7FA",
    flexGrow: 1,
  },
  titulo: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 20,
    color: "#1A1A1A",
  },
  label: {
    fontSize: 13,
    color: "#4F4F4F",
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  linha: {
    flexDirection: "row",
    alignItems: "center",
  },
  inputFlex: {
    flex: 1,
  },
  botaoBuscar: {
    marginLeft: 10,
    backgroundColor: "#0B5FFF",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  botaoBuscarTexto: {
    color: "#fff",
    fontWeight: "600",
  },
  inputErro: {
    borderColor: "#EB5757",
  },
  dicaApelido: {
    fontSize: 12,
    color: "#828282",
    marginTop: 4,
  },
  erroCampo: {
    color: "#EB5757",
    fontSize: 12,
    marginTop: 4,
  },
  erro: {
    color: "#EB5757",
    marginTop: 16,
    textAlign: "center",
  },
  botaoSalvar: {
    backgroundColor: "#0B5FFF",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 28,
  },
  botaoSalvarTexto: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
