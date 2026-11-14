import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  buscarDadosEmpresaPorCnpj,
  CalculoSimplesNacional,
  consultarConvenioMunicipio,
  ConvenioMunicipio,
  EmpresaEmissora,
  mensagemDeErro,
  obterCalculoSimples,
  obterMinhaEmpresa,
  salvarMinhaEmpresa,
  ImportacaoHospitais,
  importarHospitaisDasNotas,
  statusImportacaoHospitais,
  acompanharImportacaoHospitais,
  descreverImportacao,
} from "../src/api";
import { CORES } from "../src/theme";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "MinhaEmpresa">;

/**
 * Dados fiscais da empresa que EMITE a NFS-e (a PJ do médico). Substitui
 * o cadastro que antes só era possível por curl. Também mostra o estado
 * do certificado digital, o cálculo atual do Simples Nacional e permite
 * consultar se o município já aderiu ao Emissor Nacional.
 */

const OPCOES_SIMPLES: { valor: number; rotulo: string }[] = [
  { valor: 3, rotulo: "ME/EPP (Simples)" },
  { valor: 2, rotulo: "MEI" },
  { valor: 1, rotulo: "Não optante" },
];

function soDigitos(t: string) {
  return t.replace(/\D/g, "");
}

function formatarCnpj(d: string): string {
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatarMoeda(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function MinhaEmpresaScreen({ navigation }: Props) {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [empresa, setEmpresa] = useState<EmpresaEmissora | null>(null);
  const [calculo, setCalculo] = useState<CalculoSimplesNacional | null>(null);
  const [convenio, setConvenio] = useState<ConvenioMunicipio | null>(null);
  const [consultandoConvenio, setConsultandoConvenio] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [importacao, setImportacao] = useState<ImportacaoHospitais | null>(null);
  const [importando, setImportando] = useState(false);
  const telaAberta = useRef(true);
  useEffect(() => {
    telaAberta.current = true;
    return () => {
      telaAberta.current = false;
    };
  }, []);

  const [cnpj, setCnpj] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [cep, setCep] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [codigoMunicipio, setCodigoMunicipio] = useState("");
  const [opSimpNac, setOpSimpNac] = useState(3);
  const [codigoTribNac, setCodigoTribNac] = useState("040101");
  const [codigoNbs, setCodigoNbs] = useState("123012200");
  const [ambiente, setAmbiente] = useState<"homologacao" | "producao">("homologacao");

  function preencher(e: EmpresaEmissora) {
    setCnpj(e.cnpj);
    setRazaoSocial(e.razao_social);
    setInscricaoMunicipal(e.inscricao_municipal ?? "");
    setTelefone(e.telefone ?? "");
    setEmail(e.email ?? "");
    setCep(e.cep);
    setLogradouro(e.logradouro);
    setNumero(e.numero);
    setComplemento(e.complemento ?? "");
    setBairro(e.bairro);
    setCodigoMunicipio(e.codigo_municipio_ibge);
    setOpSimpNac(Number(e.op_simp_nac));
    setCodigoTribNac(e.codigo_trib_nac);
    setCodigoNbs(e.codigo_nbs ?? "");
    setAmbiente(e.ambiente === "producao" ? "producao" : "homologacao");
  }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroGeral(null);
    try {
      const e = await obterMinhaEmpresa();
      setEmpresa(e);
      if (e) {
        preencher(e);
        obterCalculoSimples().then(setCalculo).catch(() => setCalculo(null));
        statusImportacaoHospitais()
          .then((i) => {
            setImportacao(i);
            // Se já tem uma rodando (ex: disparada ao cadastrar o
            // certificado), acompanha até terminar.
            if (i?.status === "executando") acompanhar();
          })
          .catch(() => undefined);
      }
    } catch (err: any) {
      setErroGeral(mensagemDeErro(err, "Não foi possível carregar os dados da empresa."));
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  async function handleBuscarCnpj() {
    if (cnpj.length !== 14) {
      Alert.alert("CNPJ", "Digite os 14 dígitos do CNPJ antes de buscar.");
      return;
    }
    setBuscandoCnpj(true);
    try {
      const d = await buscarDadosEmpresaPorCnpj(cnpj);
      setRazaoSocial(d.razao_social || razaoSocial);
      setLogradouro(d.logradouro || "");
      setNumero(d.numero || "");
      setComplemento(d.complemento || "");
      setBairro(d.bairro || "");
      setCep(d.cep || "");
      setCodigoMunicipio(d.codigo_municipio_ibge ?? "");
      if (d.email) setEmail(d.email.toLowerCase());
      if (d.telefone) setTelefone(soDigitos(d.telefone));
    } catch (err: any) {
      Alert.alert("CNPJ", mensagemDeErro(err, "Não foi possível consultar esse CNPJ."));
    } finally {
      setBuscandoCnpj(false);
    }
  }

  function validar(): string | null {
    if (cnpj.length !== 14) return "CNPJ precisa ter 14 dígitos.";
    if (!razaoSocial.trim()) return "Preencha a razão social.";
    if (soDigitos(cep).length !== 8) return "CEP precisa ter 8 dígitos.";
    if (!logradouro.trim() || !numero.trim() || !bairro.trim())
      return "Preencha logradouro, número e bairro.";
    if (!/^\d{7}$/.test(codigoMunicipio))
      return "Código IBGE do município precisa ter 7 dígitos (use o botão Buscar pelo CNPJ).";
    if (!/^\d{6}$/.test(codigoTribNac))
      return "Código de tributação nacional precisa ter 6 dígitos (Medicina = 040101).";
    return null;
  }

  async function salvar() {
    const erro = validar();
    if (erro) {
      setErroGeral(erro);
      return;
    }
    setErroGeral(null);
    setSalvando(true);
    try {
      const salva = await salvarMinhaEmpresa({
        cnpj,
        razao_social: razaoSocial.trim(),
        inscricao_municipal: inscricaoMunicipal.trim() || undefined,
        codigo_municipio_ibge: codigoMunicipio,
        cep: soDigitos(cep),
        logradouro: logradouro.trim(),
        numero: numero.trim(),
        complemento: complemento.trim() || undefined,
        bairro: bairro.trim(),
        telefone: soDigitos(telefone) || undefined,
        email: email.trim() || undefined,
        op_simp_nac: opSimpNac,
        reg_ap_trib_sn: 1,
        codigo_trib_nac: codigoTribNac,
        codigo_nbs: soDigitos(codigoNbs) || undefined,
        ambiente,
      });
      setEmpresa((anterior) => ({ ...(anterior ?? {}), ...salva }) as EmpresaEmissora);
      Alert.alert("Pronto", "Dados da empresa salvos.");
      obterCalculoSimples().then(setCalculo).catch(() => setCalculo(null));
    } catch (err: any) {
      setErroGeral(mensagemDeErro(err, "Não foi possível salvar os dados da empresa."));
    } finally {
      setSalvando(false);
    }
  }

  function handleSalvar() {
    if (ambiente === "producao" && empresa?.ambiente !== "producao") {
      Alert.alert(
        "Produção",
        "Em PRODUÇÃO as notas emitidas têm validade fiscal de verdade. Confirma?",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar", style: "destructive", onPress: salvar },
        ]
      );
      return;
    }
    salvar();
  }

  async function acompanhar() {
    setImportando(true);
    try {
      await acompanharImportacaoHospitais(setImportacao, () => !telaAberta.current);
    } finally {
      setImportando(false);
    }
  }

  async function handleImportarHospitais() {
    if (importando) return;
    try {
      setImportacao(await importarHospitaisDasNotas());
      await acompanhar();
    } catch (err: any) {
      Alert.alert("Importação", mensagemDeErro(err, "Não foi possível importar agora."));
    }
  }

  async function handleConsultarConvenio() {
    setConsultandoConvenio(true);
    try {
      setConvenio(await consultarConvenioMunicipio());
    } catch (err: any) {
      Alert.alert("Convênio", mensagemDeErro(err, "Não foi possível consultar agora."));
    } finally {
      setConsultandoConvenio(false);
    }
  }

  if (carregando) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={CORES.acaoPrincipal} />
      </View>
    );
  }

  const certificadoVencido =
    !!empresa?.certificado_validade &&
    new Date(empresa.certificado_validade).getTime() < Date.now();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {!empresa && (
          <Text style={styles.aviso}>
            Cadastre aqui os dados da sua empresa (PJ) — eles saem como prestador em todas as
            notas fiscais emitidas pelo app.
          </Text>
        )}

        <Text style={styles.secao}>Empresa</Text>

        <Text style={styles.label}>CNPJ</Text>
        <View style={styles.linha}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="00.000.000/0000-00"
            value={formatarCnpj(cnpj)}
            onChangeText={(t) => setCnpj(soDigitos(t).slice(0, 14))}
            keyboardType="numeric"
          />
          <TouchableOpacity style={styles.botaoBuscar} onPress={handleBuscarCnpj} disabled={buscandoCnpj}>
            {buscandoCnpj ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.botaoBuscarTexto}>Buscar</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Razão social</Text>
        <TextInput style={styles.input} value={razaoSocial} onChangeText={setRazaoSocial} />

        <Text style={styles.label}>Inscrição municipal</Text>
        <TextInput
          style={styles.input}
          value={inscricaoMunicipal}
          onChangeText={setInscricaoMunicipal}
          keyboardType="numeric"
        />
        <Text style={styles.dica}>
          Em homologação (testes) o app não envia a inscrição municipal — o ambiente de testes do
          governo recusa. Ela só vai na nota em produção.
        </Text>

        <Text style={styles.label}>E-mail</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Telefone</Text>
        <TextInput style={styles.input} value={telefone} onChangeText={setTelefone} keyboardType="phone-pad" />

        <Text style={styles.secao}>Endereço</Text>
        <Text style={styles.label}>CEP</Text>
        <TextInput style={styles.input} value={cep} onChangeText={setCep} keyboardType="numeric" />
        <Text style={styles.label}>Logradouro</Text>
        <TextInput style={styles.input} value={logradouro} onChangeText={setLogradouro} />
        <View style={styles.linha}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.label}>Número</Text>
            <TextInput style={styles.input} value={numero} onChangeText={setNumero} />
          </View>
          <View style={{ flex: 2 }}>
            <Text style={styles.label}>Complemento</Text>
            <TextInput style={styles.input} value={complemento} onChangeText={setComplemento} />
          </View>
        </View>
        <Text style={styles.label}>Bairro</Text>
        <TextInput style={styles.input} value={bairro} onChangeText={setBairro} />
        <Text style={styles.label}>Código IBGE do município</Text>
        <TextInput
          style={styles.input}
          value={codigoMunicipio}
          onChangeText={(t) => setCodigoMunicipio(soDigitos(t).slice(0, 7))}
          keyboardType="numeric"
          placeholder="Preenchido pelo botão Buscar"
        />

        <Text style={styles.secao}>Tributação</Text>
        <Text style={styles.label}>Opção pelo Simples Nacional</Text>
        <View style={styles.segmentos}>
          {OPCOES_SIMPLES.map((o) => (
            <TouchableOpacity
              key={o.valor}
              style={[styles.segmento, opSimpNac === o.valor && styles.segmentoAtivo]}
              onPress={() => setOpSimpNac(o.valor)}
            >
              <Text style={[styles.segmentoTexto, opSimpNac === o.valor && styles.segmentoTextoAtivo]}>
                {o.rotulo}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Código de tributação nacional</Text>
        <TextInput
          style={styles.input}
          value={codigoTribNac}
          onChangeText={(t) => setCodigoTribNac(soDigitos(t).slice(0, 6))}
          keyboardType="numeric"
        />
        <Text style={styles.dica}>Medicina = 040101 (item 4.01 da LC 116).</Text>

        <Text style={styles.label}>Código NBS</Text>
        <TextInput
          style={styles.input}
          value={codigoNbs}
          onChangeText={(t) => setCodigoNbs(soDigitos(t).slice(0, 9))}
          keyboardType="numeric"
        />
        <Text style={styles.dica}>Serviços médicos especializados = 123012200.</Text>

        <Text style={styles.label}>Ambiente de emissão</Text>
        <View style={styles.segmentos}>
          {(["homologacao", "producao"] as const).map((a) => (
            <TouchableOpacity
              key={a}
              style={[
                styles.segmento,
                ambiente === a && (a === "producao" ? styles.segmentoProducao : styles.segmentoAtivo),
              ]}
              onPress={() => setAmbiente(a)}
            >
              <Text style={[styles.segmentoTexto, ambiente === a && styles.segmentoTextoAtivo]}>
                {a === "homologacao" ? "Homologação (testes)" : "Produção (valendo)"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {erroGeral && <Text style={styles.erro}>{erroGeral}</Text>}

        <TouchableOpacity style={styles.botaoSalvar} onPress={handleSalvar} disabled={salvando}>
          {salvando ? <ActivityIndicator color="#fff" /> : <Text style={styles.botaoSalvarTexto}>Salvar</Text>}
        </TouchableOpacity>

        {empresa && (
          <>
            <Text style={styles.secao}>Certificado digital</Text>
            <View style={styles.cartao}>
              {empresa.certificado_cadastrado ? (
                <>
                  <Text style={styles.cartaoTitulo}>{empresa.certificado_titular}</Text>
                  <Text style={certificadoVencido ? styles.textoAlerta : styles.cartaoTexto}>
                    {certificadoVencido ? "VENCIDO em " : "Válido até "}
                    {empresa.certificado_validade
                      ? new Date(empresa.certificado_validade).toLocaleDateString("pt-BR")
                      : "—"}
                  </Text>
                </>
              ) : (
                <Text style={styles.cartaoTexto}>
                  Nenhum certificado próprio cadastrado. Enquanto isso, o app usa o certificado
                  padrão do servidor — que só funciona se for do mesmo CNPJ. Para cadastrar o
                  certificado A1 (.pfx) desta empresa, peça à contabilidade.
                </Text>
              )}
            </View>

            <Text style={styles.secao}>Simples Nacional (calculado automaticamente)</Text>
            <View style={styles.cartao}>
              {calculo ? (
                <>
                  <Text style={styles.cartaoTitulo}>
                    Alíquota efetiva: {calculo.aliquotaEfetivaPercentual.toFixed(2).replace(".", ",")}%
                  </Text>
                  <Text style={styles.cartaoTexto}>
                    Anexo {calculo.anexo} · Receita 12 meses: {formatarMoeda(calculo.rbt12)}
                  </Text>
                  <Text style={styles.cartaoTexto}>
                    Fator R: {calculo.fatorRPercentual.toFixed(1).replace(".", ",")}%
                  </Text>
                  {calculo.semHistoricoSuficiente && (
                    <Text style={styles.dica}>
                      Ainda sem histórico de faturamento — usando a 1ª faixa do Anexo V até as
                      primeiras notas entrarem.
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.cartaoTexto}>Cálculo indisponível no momento.</Text>
              )}
            </View>

            <Text style={styles.secao}>Município no Emissor Nacional</Text>
            <View style={styles.cartao}>
              {convenio ? (
                <>
                  <Text
                    style={
                      convenio.aderente === false ? styles.textoAlerta : styles.cartaoTitulo
                    }
                  >
                    {convenio.aderente === true
                      ? "Município aderente"
                      : convenio.aderente === false
                      ? "Município NÃO aderente"
                      : "Situação não identificada"}
                  </Text>
                  <Text style={styles.cartaoTexto}>{convenio.resumo}</Text>
                </>
              ) : (
                <Text style={styles.cartaoTexto}>
                  Consulte direto no governo se o município da empresa já aderiu ao Emissor
                  Nacional.
                </Text>
              )}
              <TouchableOpacity
                style={styles.botaoSecundario}
                onPress={handleConsultarConvenio}
                disabled={consultandoConvenio}
              >
                {consultandoConvenio ? (
                  <ActivityIndicator color={CORES.acaoPrincipal} size="small" />
                ) : (
                  <Text style={styles.botaoSecundarioTexto}>Consultar agora</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {empresa && (
          <>
            <Text style={styles.secao}>Hospitais das notas emitidas</Text>
            <View style={styles.cartao}>
              <Text style={styles.cartaoTexto}>
                Com o certificado digital da empresa, o app lê as notas que ela emitiu nos
                últimos 24 meses (ou desde a abertura) e cadastra sozinho os hospitais pra quem
                você já prestou serviço — eles aparecem prontos na hora de marcar um plantão.
              </Text>
              {importacao && (
                <Text
                  style={[
                    styles.cartaoTexto,
                    { marginTop: 8, fontWeight: "600" },
                    importacao.status === "erro" && { color: CORES.destrutivo },
                  ]}
                >
                  {descreverImportacao(importacao)}
                </Text>
              )}
              <TouchableOpacity
                style={styles.botaoSecundario}
                onPress={handleImportarHospitais}
                disabled={importando}
              >
                {importando ? (
                  <ActivityIndicator color={CORES.acaoPrincipal} size="small" />
                ) : (
                  <Text style={styles.botaoSecundarioTexto}>
                    {importacao ? "Buscar de novo" : "Buscar hospitais nas notas"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        <TouchableOpacity style={styles.voltar} onPress={() => navigation.goBack()}>
          <Text style={styles.voltarTexto}>Voltar</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centro: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: CORES.fundoTela },
  container: { padding: 20, backgroundColor: CORES.fundoTela, flexGrow: 1, paddingBottom: 60 },
  aviso: {
    backgroundColor: CORES.circuloIcone,
    color: CORES.navy,
    padding: 12,
    borderRadius: 10,
    fontSize: 13,
    marginBottom: 8,
  },
  secao: {
    fontSize: 15,
    fontWeight: "800",
    color: CORES.navy,
    marginTop: 24,
    marginBottom: 4,
  },
  label: { fontSize: 13, color: "#4F4F4F", marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  linha: { flexDirection: "row", alignItems: "flex-end" },
  botaoBuscar: {
    marginLeft: 10,
    backgroundColor: CORES.acaoPrincipal,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  botaoBuscarTexto: { color: "#fff", fontWeight: "600" },
  dica: { fontSize: 12, color: "#828282", marginTop: 4 },
  segmentos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  segmento: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CORES.cardBorda,
    backgroundColor: "#fff",
  },
  segmentoAtivo: { backgroundColor: CORES.acaoPrincipal, borderColor: CORES.acaoPrincipal },
  segmentoProducao: { backgroundColor: CORES.destrutivo, borderColor: CORES.destrutivo },
  segmentoTexto: { color: CORES.navy, fontSize: 13, fontWeight: "600" },
  segmentoTextoAtivo: { color: "#fff" },
  erro: { color: CORES.destrutivo, marginTop: 16, textAlign: "center" },
  botaoSalvar: {
    backgroundColor: CORES.acaoPrincipal,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 24,
  },
  botaoSalvarTexto: { color: "#fff", fontSize: 16, fontWeight: "600" },
  cartao: {
    backgroundColor: CORES.cardFundo,
    borderWidth: 1,
    borderColor: CORES.cardBorda,
    borderRadius: 12,
    padding: 14,
    marginTop: 6,
  },
  cartaoTitulo: { fontSize: 15, fontWeight: "700", color: CORES.navy, marginBottom: 4 },
  cartaoTexto: { fontSize: 13, color: CORES.cinzaTexto, marginTop: 2 },
  textoAlerta: { fontSize: 15, fontWeight: "700", color: CORES.destrutivo, marginBottom: 4 },
  botaoSecundario: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: CORES.acaoPrincipal,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  botaoSecundarioTexto: { color: CORES.acaoPrincipal, fontWeight: "600" },
  voltar: { marginTop: 24, alignItems: "center" },
  voltarTexto: { color: CORES.cinzaTexto, fontSize: 14 },
});
