import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  completarValorPlantao,
  excluirPlantao,
  marcarNaoRealizado,
  emitirNfPlantao,
  mensagemDeErro,
  listarPlantoes,
  logout,
  Plantao,
} from "../src/api";
import { STATUS_MAP } from "../src/statusPlantao";
import {
  formatarDataVindaDoBackend,
  formatarHoraVindaDoBackend,
  isDataFuturaOuHoje,
  isoParaPartes,
} from "../src/utils/dataHora";
import { aplicarMascaraMoeda, moedaParaNumero } from "../src/utils/moeda";
import { CORES } from "../src/theme";
import CabecalhoTopo from "../src/components/CabecalhoTopo";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "Plantoes">;

const pad = (n: number) => String(n).padStart(2, "0");

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

function formatarValor(valor: string | null) {
  if (valor === null) return "Valor não informado";
  const numero = Number(valor);
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Agrupa os plantões por data ("AAAA-MM-DD"), para o calendário. */
function agruparPorData(plantoes: Plantao[]): Record<string, Plantao[]> {
  const mapa: Record<string, Plantao[]> = {};
  for (const p of plantoes) {
    const partes = isoParaPartes(p.data);
    const chave = `${partes.ano}-${pad(partes.mes)}-${pad(partes.dia)}`;
    if (!mapa[chave]) mapa[chave] = [];
    mapa[chave].push(p);
  }
  return mapa;
}

/** Gera as células do grid do mês (múltiplos de 7, com null nas pontas). */
function gerarCelulas(mesReferencia: Date): (number | null)[] {
  const ano = mesReferencia.getFullYear();
  const mes = mesReferencia.getMonth();
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const celulas: (number | null)[] = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);
  while (celulas.length % 7 !== 0) celulas.push(null);
  return celulas;
}

function abreviarHospital(nome: string): string {
  const primeira = nome.split(" ")[0];
  return primeira.length > 8 ? primeira.slice(0, 7) + "…" : primeira;
}

export default function PlantoesScreen({ navigation }: Props) {
  const [plantoes, setPlantoes] = useState<Plantao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<"lista" | "calendario">("lista");
  const [mesCalendario, setMesCalendario] = useState(() => new Date());

  // Fila de plantões passados sem valor definido, que precisam ser
  // completados antes que a NF possa ser emitida. Mostrados um de cada
  // vez, do mais antigo para o mais recente.
  const [filaPendencias, setFilaPendencias] = useState<Plantao[]>([]);
  const [valorPendenteTexto, setValorPendenteTexto] = useState("");
  const [descricaoPendente, setDescricaoPendente] = useState("");
  const [erroPendencia, setErroPendencia] = useState<string | null>(null);
  const [salvandoPendencia, setSalvandoPendencia] = useState(false);
  // Plantão cuja NF está sendo emitida/cancelada agora (conversando com o
  // governo) — desabilita os botões dele pra evitar toque duplo.
  const [processandoId, setProcessandoId] = useState<string | null>(null);

  async function carregar() {
    setErro(null);
    try {
      const dados = await listarPlantoes();
      setPlantoes(dados);

      const pendentes = dados
        .filter(
          (p) =>
            p.valor === null &&
            p.status !== "cancelado" &&
            !isDataFuturaOuHoje(p.data)
        )
        .sort((a, b) => a.data.localeCompare(b.data));
      setFilaPendencias(pendentes);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        await logout();
        navigation.replace("Login");
        return;
      }
      setErro("Não foi possível carregar os plantões.");
    } finally {
      setCarregando(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [])
  );

  const plantoesPorData = useMemo(() => agruparPorData(plantoes), [plantoes]);

  async function handleSair() {
    await logout();
    navigation.replace("Login");
  }

  function handleAbrirPlantao(item: Plantao) {
    if (!isDataFuturaOuHoje(item.data) || !item.tomador_id) {
      return;
    }
    navigation.navigate("NovoPlantao", {
      plantaoId: item.id,
      plantaoData: item.data,
      plantaoHorario: item.horario,
      plantaoTomadorId: item.tomador_id,
      plantaoTomadorNome: item.hospital,
      plantaoValor: item.valor ?? undefined,
      plantaoDescricaoNf: item.descricao_nf ?? undefined,
    });
  }

  async function handleConfirmarPendencia() {
    const item = filaPendencias[0];
    const valorNumerico = valorPendenteTexto ? moedaParaNumero(valorPendenteTexto) : NaN;

    if (!valorPendenteTexto || Number.isNaN(valorNumerico) || valorNumerico <= 0) {
      setErroPendencia("Informe um valor numérico válido.");
      return;
    }

    setErroPendencia(null);
    setSalvandoPendencia(true);
    try {
      await completarValorPlantao(item.id, {
        valor: valorNumerico,
        descricao_nf: descricaoPendente || undefined,
      });
      const resto = filaPendencias.slice(1);
      setFilaPendencias(resto);
      setValorPendenteTexto("");
      setDescricaoPendente("");
      if (resto.length === 0) {
        carregar();
      }
    } catch (err: any) {
      const mensagem =
        err?.response?.data?.erro ?? "Não foi possível salvar o valor.";
      setErroPendencia(mensagem);
    } finally {
      setSalvandoPendencia(false);
    }
  }

  function handleAdiarPendencia() {
    // Não persiste a dispensa — só fecha por essa sessão. Volta a
    // aparecer na próxima vez que a tela recarregar (ex: reabrir o app).
    setFilaPendencias([]);
    setValorPendenteTexto("");
    setDescricaoPendente("");
    setErroPendencia(null);
  }

  async function emitirNf(item: Plantao) {
    setProcessandoId(item.id);
    try {
      const atualizado = await emitirNfPlantao(item.id);
      Alert.alert(
        "NF emitida",
        atualizado.nfse_chave_acesso
          ? `A NFS-e foi emitida com sucesso.\n\nChave de acesso:\n${atualizado.nfse_chave_acesso}`
          : "A NFS-e foi emitida com sucesso."
      );
    } catch (err: any) {
      Alert.alert("NF não emitida", mensagemDeErro(err, "Não foi possível emitir a NF."));
    } finally {
      setProcessandoId(null);
      carregar();
    }
  }

  function handleMarcarNfEmitida(item: Plantao) {
    if (processandoId) return;
    Alert.alert(
      "Emitir NF",
      `Emitir a nota fiscal de ${formatarValor(item.valor)} para ${item.hospital}?\n\nA nota será enviada ao Sistema Nacional da NFS-e.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Emitir", onPress: () => emitirNf(item) },
      ]
    );
  }

  async function prosseguirNaoRealizado(
    item: Plantao,
    respostas: {
      simplesJaEntregue?: boolean;
      dasJaPaga?: boolean;
      observacaoCancelamento?: string;
    } = {}
  ) {
    setProcessandoId(item.id);
    try {
      const resultado = await marcarNaoRealizado(item.id, respostas);
      if (resultado.acao === "excluido") {
        Alert.alert("Plantão excluído", "Como a NF ainda não tinha sido emitida, o plantão foi excluído.");
      } else if (resultado.acao === "cancelado") {
        Alert.alert(
          "NF cancelada — atenção fiscal",
          [resultado.mensagemNf, resultado.mensagemFiscal].filter(Boolean).join("\n\n")
        );
      } else if (resultado.acao === "processo_administrativo" && resultado.mensagem) {
        Alert.alert("Processo administrativo aberto", resultado.mensagem);
      }
      setProcessandoId(null);
      carregar();
    } catch (err: any) {
      setProcessandoId(null);
      const codigoErro = err?.response?.data?.erro;
      if (codigoErro === "PRECISA_RESPOSTA_SIMPLES") {
        Alert.alert(
          "Simples Nacional",
          "O Simples Nacional desse mês já foi entregue?",
          [
            {
              text: "Não",
              onPress: () =>
                prosseguirNaoRealizado(item, {
                  ...respostas,
                  simplesJaEntregue: false,
                }),
            },
            {
              text: "Sim",
              onPress: () =>
                Alert.alert("DAS", "A guia DAS desse mês já foi paga?", [
                  {
                    text: "Não",
                    onPress: () =>
                      prosseguirNaoRealizado(item, {
                        ...respostas,
                        simplesJaEntregue: true,
                        dasJaPaga: false,
                      }),
                  },
                  {
                    text: "Sim",
                    onPress: () =>
                      prosseguirNaoRealizado(item, {
                        ...respostas,
                        simplesJaEntregue: true,
                        dasJaPaga: true,
                      }),
                  },
                ]),
            },
          ]
        );
      } else {
        Alert.alert("Erro", mensagemDeErro(err, "Não foi possível processar. Tente novamente."));
      }
    }
  }

  function handleMarcarNaoRealizado(item: Plantao) {
    Alert.alert(
      "Marcar como não realizado",
      "Confirma que este plantão não foi realizado?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: () => prosseguirNaoRealizado(item) },
      ]
    );
  }

  function handleExcluirDireto(item: Plantao) {
    Alert.alert(
      "Excluir plantão",
      `Tem certeza que deseja excluir o plantão de ${formatarDataVindaDoBackend(
        item.data
      )} no ${item.hospital}? Essa ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            try {
              await excluirPlantao(item.id);
              carregar();
            } catch (err: any) {
              const mensagem =
                err?.response?.data?.erro ?? "Não foi possível excluir o plantão.";
              setErro(mensagem);
            }
          },
        },
      ]
    );
  }

  function renderItem({ item }: { item: Plantao }) {
    const status = STATUS_MAP[item.status];
    const editavel = isDataFuturaOuHoje(item.data) && !!item.tomador_id;
    const passadoAcionavel =
      !isDataFuturaOuHoje(item.data) && item.status !== "cancelado";

    return (
      <View style={styles.card}>
        <View style={styles.linhaTopo}>
          <View style={styles.linhaHospital}>
            <View style={[styles.pontoStatus, { backgroundColor: status.cor }]} />
            <Text style={styles.hospital} numberOfLines={1}>
              {item.hospital}
            </Text>
          </View>
          {editavel && (
            <View style={styles.acoesCard}>
              <TouchableOpacity
                onPress={() => handleAbrirPlantao(item)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="create-outline" size={18} color={CORES.cinzaTexto} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleExcluirDireto(item)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="trash-outline" size={18} color={CORES.destrutivo} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        <Text style={styles.dataHorario}>
          {formatarDataVindaDoBackend(item.data)} às{" "}
          {formatarHoraVindaDoBackend(item.horario)}
        </Text>
        <Text style={[styles.statusTexto, { color: status.cor }]}>
          {status.label}
        </Text>
        <Text
          style={item.valor === null ? styles.valorPendente : styles.valor}
        >
          {formatarValor(item.valor)}
        </Text>
        {passadoAcionavel && processandoId === item.id && (
          <View style={styles.linhaAcoesPassado}>
            <ActivityIndicator size="small" color={CORES.acaoPrincipal} />
            <Text style={styles.linkAcaoPassado}>Conversando com o governo…</Text>
          </View>
        )}
        {passadoAcionavel && processandoId !== item.id && (
          <View style={styles.linhaAcoesPassado}>
            {item.status === "agendado" && item.valor !== null && (
              <TouchableOpacity
                disabled={!!processandoId}
                onPress={() => handleMarcarNfEmitida(item)}
              >
                <Text style={styles.linkAcaoPassado}>Emitir NF</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              disabled={!!processandoId}
              onPress={() => handleMarcarNaoRealizado(item)}
            >
              <Text style={styles.linkAcaoPassadoDestrutivo}>
                Marcar como não realizado
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {item.status === "cancelamento_administrativo" && (
          <Text style={styles.avisoProcessoAdm}>
            Processo administrativo de cancelamento em andamento
            {item.observacao_cancelamento ? `: ${item.observacao_cancelamento}` : "."}
          </Text>
        )}
      </View>
    );
  }

  function renderCalendario() {
    const celulas = gerarCelulas(mesCalendario);
    const semanas: (number | null)[][] = [];
    for (let i = 0; i < celulas.length; i += 7) {
      semanas.push(celulas.slice(i, i + 7));
    }

    const hoje = new Date();
    const ano = mesCalendario.getFullYear();
    const mes = mesCalendario.getMonth();

    function irParaMesAnterior() {
      setMesCalendario(new Date(ano, mes - 1, 1));
    }

    function irParaProximoMes() {
      setMesCalendario(new Date(ano, mes + 1, 1));
    }

    return (
      <ScrollView contentContainerStyle={styles.calendarioContainer}>
        <View style={styles.calendarioNavegacao}>
          <TouchableOpacity
            onPress={irParaMesAnterior}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={22} color={CORES.acaoPrincipal} />
          </TouchableOpacity>
          <Text style={styles.calendarioMesTitulo}>
            {NOMES_MES[mes]} {ano}
          </Text>
          <TouchableOpacity
            onPress={irParaProximoMes}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-forward" size={22} color={CORES.acaoPrincipal} />
          </TouchableOpacity>
        </View>

        <View style={styles.linhaDiasSemana}>
          {DIAS_SEMANA.map((d, i) => (
            <Text key={i} style={styles.diaSemanaTexto}>
              {d}
            </Text>
          ))}
        </View>

        {semanas.map((semana, indiceSemana) => (
          <View key={indiceSemana} style={styles.linhaSemana}>
            {semana.map((dia, indiceDia) => {
              if (dia === null) {
                return <View key={indiceDia} style={styles.celulaVazia} />;
              }
              const chave = `${ano}-${pad(mes + 1)}-${pad(dia)}`;
              const itensDoDia = plantoesPorData[chave] ?? [];
              const ehHoje =
                dia === hoje.getDate() &&
                mes === hoje.getMonth() &&
                ano === hoje.getFullYear();

              return (
                <View
                  key={indiceDia}
                  style={[styles.celulaDia, ehHoje && styles.celulaDiaHoje]}
                >
                  <Text style={styles.celulaDiaNumero}>{dia}</Text>
                  {itensDoDia.slice(0, 2).map((item) => {
                    const status = STATUS_MAP[item.status];
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.celulaChip, { backgroundColor: status.cor }]}
                        onPress={() => handleAbrirPlantao(item)}
                      >
                        <Text style={styles.celulaChipTexto} numberOfLines={1}>
                          {abreviarHospital(item.hospital)}
                        </Text>
                        <Text style={styles.celulaChipHora} numberOfLines={1}>
                          {formatarHoraVindaDoBackend(item.horario)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {itensDoDia.length > 2 && (
                    <Text style={styles.celulaMais}>+{itensDoDia.length - 2}</Text>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <CabecalhoTopo
        onSair={handleSair}
        aoTocarMenu={() => navigation.navigate("Home")}
      />

      <View style={styles.corpo}>
        <Text style={styles.tituloPagina}>AGENDA DE PLANTÕES</Text>

        <View style={styles.seletorModo}>
          <TouchableOpacity
            style={[styles.botaoModo, modo === "lista" && styles.botaoModoAtivo]}
            onPress={() => setModo("lista")}
          >
            <Ionicons
              name="list-outline"
              size={18}
              color={modo === "lista" ? "#fff" : CORES.cinzaTexto}
            />
            <Text
              style={[
                styles.botaoModoTexto,
                modo === "lista" && styles.botaoModoTextoAtivo,
              ]}
            >
              Lista
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.botaoModo,
              modo === "calendario" && styles.botaoModoAtivo,
            ]}
            onPress={() => setModo("calendario")}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={modo === "calendario" ? "#fff" : CORES.cinzaTexto}
            />
            <Text
              style={[
                styles.botaoModoTexto,
                modo === "calendario" && styles.botaoModoTextoAtivo,
              ]}
            >
              Calendário
            </Text>
          </TouchableOpacity>
        </View>

        {erro && <Text style={styles.erro}>{erro}</Text>}

        {modo === "lista" ? (
          <FlatList
            data={plantoes}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={
              plantoes.length === 0 ? styles.listaVazia : styles.lista
            }
            refreshControl={
              <RefreshControl refreshing={carregando} onRefresh={carregar} />
            }
            ListEmptyComponent={
              !carregando ? (
                <Text style={styles.vazioTexto}>
                  Nenhum plantão cadastrado ainda.
                </Text>
              ) : null
            }
          />
        ) : (
          renderCalendario()
        )}
      </View>

      <TouchableOpacity
        style={styles.botaoNovo}
        onPress={() => navigation.navigate("NovoPlantao")}
      >
        <Text style={styles.botaoNovoTexto}>+ Novo plantão</Text>
      </TouchableOpacity>

      {filaPendencias.length > 0 && (
        <Modal visible transparent animationType="fade">
          <KeyboardAvoidingView
            style={styles.modalFundo}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={styles.modalConteudo}>
              <Text style={styles.modalTitulo}>Falta o valor deste plantão</Text>
              <Text style={styles.modalSubtitulo}>
                {filaPendencias[0].hospital} —{" "}
                {formatarDataVindaDoBackend(filaPendencias[0].data)} às{" "}
                {formatarHoraVindaDoBackend(filaPendencias[0].horario)}
              </Text>
              <Text style={styles.modalTexto}>
                Esse plantão já passou e ainda não tem valor definido. Sem
                isso, a nota fiscal não pode ser emitida automaticamente.
              </Text>

              <Text style={styles.label}>Valor (R$)</Text>
              <TextInput
                style={[styles.inputModal, erroPendencia && styles.inputErro]}
                placeholder="0,00"
                value={valorPendenteTexto}
                onChangeText={(texto) =>
                  setValorPendenteTexto(aplicarMascaraMoeda(texto))
                }
                keyboardType="numeric"
              />

              <Text style={styles.label}>Observações para a NF (opcional)</Text>
              <TextInput
                style={[styles.inputModal, styles.inputModalMultilinha]}
                placeholder="Plantão noturno - pronto-socorro"
                value={descricaoPendente}
                onChangeText={setDescricaoPendente}
                multiline
              />

              {erroPendencia && <Text style={styles.erro}>{erroPendencia}</Text>}
              {filaPendencias.length > 1 && (
                <Text style={styles.modalContador}>
                  Mais {filaPendencias.length - 1} plantão(ões) pendente(s)
                  depois deste.
                </Text>
              )}

              <TouchableOpacity
                style={styles.modalBotaoConfirmar}
                onPress={handleConfirmarPendencia}
                disabled={salvandoPendencia}
              >
                {salvandoPendencia ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBotaoConfirmarTexto}>Confirmar</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAdiarPendencia}
                disabled={salvandoPendencia}
              >
                <Text style={styles.modalBotaoAdiarTexto}>Preencher depois</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CORES.fundoTela,
  },
  corpo: {
    flex: 1,
    paddingTop: 16,
  },
  tituloPagina: {
    fontSize: 17,
    fontWeight: "800",
    color: CORES.navy,
    textAlign: "center",
    letterSpacing: 0.4,
    marginBottom: 14,
  },
  seletorModo: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  botaoModo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CORES.cardBorda,
    backgroundColor: "#fff",
  },
  botaoModoAtivo: {
    backgroundColor: CORES.acaoPrincipal,
    borderColor: CORES.acaoPrincipal,
  },
  botaoModoTexto: {
    fontSize: 13,
    fontWeight: "600",
    color: CORES.cinzaTexto,
  },
  botaoModoTextoAtivo: {
    color: "#fff",
  },
  erro: {
    color: CORES.destrutivo,
    textAlign: "center",
    marginBottom: 8,
  },
  lista: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  listaVazia: {
    flexGrow: 1,
    justifyContent: "center",
  },
  vazioTexto: {
    textAlign: "center",
    color: "#828282",
    fontSize: 15,
  },
  card: {
    backgroundColor: CORES.cardFundo,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CORES.cardBorda,
    padding: 14,
    marginBottom: 12,
  },
  linhaTopo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  linhaHospital: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  pontoStatus: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  hospital: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: CORES.navy,
  },
  acoesCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dataHorario: {
    fontSize: 13,
    color: CORES.cinzaTexto,
    marginBottom: 4,
    marginLeft: 18,
  },
  statusTexto: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
    marginLeft: 18,
  },
  linhaInferior: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginLeft: 18,
  },
  valor: {
    fontSize: 15,
    fontWeight: "700",
    color: CORES.acaoPrincipal,
  },
  valorPendente: {
    fontSize: 13,
    fontWeight: "700",
    color: "#B8860B",
    fontStyle: "italic",
  },
  linhaAcoesPassado: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: CORES.cardBorda,
  },
  linkAcaoPassado: {
    fontSize: 12,
    color: CORES.acaoPrincipal,
    fontWeight: "600",
  },
  linkAcaoPassadoDestrutivo: {
    fontSize: 12,
    color: CORES.destrutivo,
    fontWeight: "600",
  },
  avisoProcessoAdm: {
    fontSize: 12,
    color: CORES.destrutivo,
    marginTop: 8,
    fontStyle: "italic",
  },
  dicaEditar: {
    fontSize: 12,
    color: CORES.acaoPrincipal,
  },
  botaoNovo: {
    position: "absolute",
    bottom: 24,
    left: 20,
    right: 20,
    backgroundColor: CORES.acaoPrincipal,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    elevation: 3,
  },
  botaoNovoTexto: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  calendarioContainer: {
    paddingHorizontal: 12,
    paddingBottom: 110,
  },
  calendarioNavegacao: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  calendarioMesTitulo: {
    fontSize: 17,
    fontWeight: "700",
    color: CORES.navy,
  },
  linhaDiasSemana: {
    flexDirection: "row",
    marginBottom: 4,
  },
  diaSemanaTexto: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: CORES.cinzaTexto,
  },
  linhaSemana: {
    flexDirection: "row",
  },
  celulaVazia: {
    flex: 1,
    aspectRatio: 0.8,
    margin: 1,
  },
  celulaDia: {
    flex: 1,
    aspectRatio: 0.8,
    margin: 1,
    backgroundColor: CORES.cardFundo,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: CORES.cardBorda,
    padding: 2,
  },
  celulaDiaHoje: {
    borderColor: CORES.acaoPrincipal,
    borderWidth: 2,
  },
  celulaDiaNumero: {
    fontSize: 11,
    fontWeight: "600",
    color: CORES.navy,
  },
  celulaChip: {
    borderRadius: 3,
    paddingHorizontal: 2,
    paddingVertical: 1,
    marginTop: 1,
  },
  celulaChipTexto: {
    fontSize: 8,
    fontWeight: "700",
    color: "#fff",
  },
  celulaChipHora: {
    fontSize: 7,
    color: "#fff",
  },
  celulaMais: {
    fontSize: 8,
    color: CORES.cinzaTexto,
    marginTop: 1,
  },
  label: {
    fontSize: 13,
    color: "#4F4F4F",
    marginBottom: 6,
    marginTop: 12,
  },
  inputModal: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  inputModalMultilinha: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  inputErro: {
    borderColor: CORES.destrutivo,
  },
  modalFundo: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 20,
  },
  modalConteudo: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  modalTitulo: {
    fontSize: 17,
    fontWeight: "700",
    color: CORES.navy,
    marginBottom: 6,
  },
  modalSubtitulo: {
    fontSize: 14,
    fontWeight: "600",
    color: CORES.navy,
    marginBottom: 8,
  },
  modalTexto: {
    fontSize: 13,
    color: CORES.cinzaTexto,
    marginBottom: 4,
  },
  modalContador: {
    fontSize: 12,
    color: CORES.cinzaTexto,
    marginTop: 8,
    fontStyle: "italic",
  },
  modalBotaoConfirmar: {
    backgroundColor: CORES.acaoPrincipal,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  modalBotaoConfirmarTexto: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modalBotaoAdiarTexto: {
    textAlign: "center",
    color: CORES.cinzaTexto,
    fontSize: 14,
    marginTop: 12,
  },
});
