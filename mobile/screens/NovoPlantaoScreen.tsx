import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  criarPlantao,
  editarPlantao,
  excluirPlantao,
  listarHistoricoPlantao,
  listarTomadores,
  nomeExibicaoTomador,
  HistoricoPlantao,
  Tomador,
  importarHospitaisDasNotas,
  acompanharImportacaoHospitais,
  descreverImportacao,
  mensagemDeErro,
} from "../src/api";
import type { RootStackParamList } from "../App";
import {
  parseDataFlexivel,
  parseHoraFlexivel,
  formatarDataBR,
  formatarHoraBR,
  formatarDataVindaDoBackend,
  formatarHoraVindaDoBackend,
  dataParaISO,
  isoParaPartes,
  isDataFuturaOuHoje,
  dataHojeISO,
  dia20DoMesSubsequente,
  DataPartes,
} from "../src/utils/dataHora";
import { aplicarMascaraMoeda, moedaParaNumero } from "../src/utils/moeda";

type Props = NativeStackScreenProps<RootStackParamList, "NovoPlantao">;

interface Erros {
  data?: string;
  horario?: string;
  hospital?: string;
  valor?: string;
  geral?: string;
}

const CAMPO_LABEL: Record<string, string> = {
  data: "Data",
  horario: "Horário",
  hospital: "Hospital",
  valor: "Valor",
  descricao_nf: "Descrição da NF",
  status: "Status",
};

// Concordância de gênero: só "Data" é feminino, os demais são masculinos.
const CAMPO_ALTERADO: Record<string, string> = {
  data: "alterada",
  horario: "alterado",
  hospital: "alterado",
  valor: "alterado",
  descricao_nf: "alterada",
  status: "alterado",
};

function formatarValorHistorico(campo: string, valor: string | null): string {
  if (valor === null) return "-";
  if (campo === "data") return formatarDataVindaDoBackend(valor);
  if (campo === "horario") return formatarHoraVindaDoBackend(valor);
  if (campo === "valor") {
    const numero = Number(valor);
    return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return valor;
}

function formatarQuando(editadoEm: string): string {
  const dt = new Date(editadoEm);
  const data = dt.toLocaleDateString("pt-BR");
  const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${data} às ${hora}`;
}

export default function NovoPlantaoScreen({ navigation, route }: Props) {
  const editando = !!route.params?.plantaoId;
  const jaPreencheuEdicao = useRef(false);

  const [dataTexto, setDataTexto] = useState("");
  const [horarioTexto, setHorarioTexto] = useState("");
  const [tomadorId, setTomadorId] = useState<string | null>(null);
  const [tomadorNome, setTomadorNome] = useState<string | null>(null);
  const [valorTexto, setValorTexto] = useState("");
  const [naoSeiValor, setNaoSeiValor] = useState(false);
  const [descricaoNf, setDescricaoNf] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erros, setErros] = useState<Erros>({});
  const [historico, setHistorico] = useState<HistoricoPlantao[]>([]);

  const [mostrarCalendario, setMostrarCalendario] = useState(false);
  const [mostrarRelogio, setMostrarRelogio] = useState(false);

  const [mostrarSeletorHospital, setMostrarSeletorHospital] = useState(false);
  const [tomadores, setTomadores] = useState<Tomador[]>([]);
  const [carregandoTomadores, setCarregandoTomadores] = useState(false);
  const [buscaHospital, setBuscaHospital] = useState("");
  // Importação dos hospitais a partir das notas já emitidas (segundo plano).
  const [importando, setImportando] = useState(false);
  const [textoImportacao, setTextoImportacao] = useState<string | null>(null);
  const telaAberta = useRef(true);
  useEffect(() => {
    telaAberta.current = true;
    return () => {
      telaAberta.current = false;
    };
  }, []);

  // Ao abrir em modo de edição, pré-preenche o formulário uma única vez
  // e busca o histórico de edições já feitas nesse plantão.
  useEffect(() => {
    if (editando && !jaPreencheuEdicao.current) {
      jaPreencheuEdicao.current = true;
      const p = route.params!;
      navigation.setOptions({ title: "Editar plantão" });
      if (p.plantaoData) {
        setDataTexto(formatarDataBR(isoParaPartes(p.plantaoData)));
      }
      if (p.plantaoHorario) {
        setHorarioTexto(formatarHoraVindaDoBackend(p.plantaoHorario));
      }
      if (p.plantaoTomadorId) {
        setTomadorId(p.plantaoTomadorId);
        setTomadorNome(p.plantaoTomadorNome ?? null);
      }
      if (p.plantaoValor) {
        setValorTexto(aplicarMascaraMoeda(p.plantaoValor));
      } else {
        setNaoSeiValor(true);
      }
      if (p.plantaoDescricaoNf) {
        setDescricaoNf(p.plantaoDescricaoNf);
      }

      listarHistoricoPlantao(p.plantaoId!)
        .then(setHistorico)
        .catch(() => setHistorico([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando]);

  // Quando voltamos da tela de cadastro de hospital, o novo tomador já
  // vem selecionado via parâmetros de navegação.
  useEffect(() => {
    if (route.params?.tomadorSelecionadoId) {
      setTomadorId(route.params.tomadorSelecionadoId);
      setTomadorNome(route.params.tomadorSelecionadoNome ?? null);
      setErros((atual) => ({ ...atual, hospital: undefined }));
    }
  }, [route.params?.tomadorSelecionadoId]);

  async function recarregarTomadores() {
    setCarregandoTomadores(true);
    try {
      const lista = await listarTomadores();
      setTomadores(lista);
    } catch {
      setTomadores([]);
    } finally {
      setCarregandoTomadores(false);
    }
  }

  async function handleAbrirSeletorHospital() {
    setBuscaHospital("");
    setMostrarSeletorHospital(true);
    await recarregarTomadores();
  }

  async function handleImportarDasNotas() {
    if (importando) return;
    setImportando(true);
    setTextoImportacao("Iniciando a leitura das suas notas…");
    try {
      await importarHospitaisDasNotas();
      const final = await acompanharImportacaoHospitais(
        (i) => setTextoImportacao(descreverImportacao(i)),
        () => !telaAberta.current
      );
      if (final) setTextoImportacao(descreverImportacao(final));
      await recarregarTomadores();
    } catch (err: any) {
      setTextoImportacao(mensagemDeErro(err, "Não foi possível importar agora."));
    } finally {
      setImportando(false);
    }
  }

  const tomadoresFiltrados = (() => {
    const termo = buscaHospital.trim().toLowerCase();
    if (!termo) return tomadores;
    const termoDigitos = termo.replace(/\D/g, "");
    return tomadores.filter(
      (t) =>
        nomeExibicaoTomador(t).toLowerCase().includes(termo) ||
        t.razao_social.toLowerCase().includes(termo) ||
        (t.municipio ?? "").toLowerCase().includes(termo) ||
        (termoDigitos.length >= 3 && t.cnpj.includes(termoDigitos))
    );
  })();

  function descreverUsoTomador(t: Tomador): string | null {
    const partes: string[] = [];
    if (t.municipio) partes.push(t.uf ? `${t.municipio}-${t.uf}` : t.municipio);
    if (t.ultimo_uso) {
      const [a, m, d] = String(t.ultimo_uso).slice(0, 10).split("-");
      partes.push(`último uso ${d}/${m}/${a}`);
    }
    return partes.length ? partes.join(" · ") : null;
  }

  function handleSelecionarTomador(tomador: Tomador) {
    setTomadorId(tomador.id);
    setTomadorNome(nomeExibicaoTomador(tomador));
    setErros((atual) => ({ ...atual, hospital: undefined }));
    setMostrarSeletorHospital(false);
  }

  function handleCadastrarNovoHospital() {
    setMostrarSeletorHospital(false);
    navigation.navigate("CadastroTomador");
  }

  function handleBlurData() {
    if (!dataTexto) return;
    const { erro } = parseDataFlexivel(dataTexto);
    setErros((atual) => ({ ...atual, data: erro ?? undefined }));
  }

  function handleBlurHorario() {
    if (!horarioTexto) return;
    const { erro } = parseHoraFlexivel(horarioTexto);
    setErros((atual) => ({ ...atual, horario: erro ?? undefined }));
  }

  function handleChangeValor(texto: string) {
    setValorTexto(aplicarMascaraMoeda(texto));
    setErros((atual) => ({ ...atual, valor: undefined }));
  }

  function obterDataParaPicker(): Date {
    const { partes } = parseDataFlexivel(dataTexto);
    if (partes) {
      return new Date(partes.ano, partes.mes - 1, partes.dia);
    }
    return new Date();
  }

  function obterHoraParaPicker(): Date {
    const { partes } = parseHoraFlexivel(horarioTexto);
    const base = new Date();
    if (partes) {
      base.setHours(partes.hora, partes.minuto, 0, 0);
    }
    return base;
  }

  function handleDataSelecionada(event: DateTimePickerEvent, dataEscolhida?: Date) {
    if (Platform.OS === "android") {
      setMostrarCalendario(false);
    }
    if (event.type === "dismissed" || !dataEscolhida) {
      return;
    }
    setDataTexto(
      formatarDataBR({
        dia: dataEscolhida.getDate(),
        mes: dataEscolhida.getMonth() + 1,
        ano: dataEscolhida.getFullYear(),
      })
    );
    setErros((atual) => ({ ...atual, data: undefined }));
  }

  function handleHoraSelecionada(event: DateTimePickerEvent, horaEscolhida?: Date) {
    if (Platform.OS === "android") {
      setMostrarRelogio(false);
    }
    if (event.type === "dismissed" || !horaEscolhida) {
      return;
    }
    setHorarioTexto(
      formatarHoraBR({
        hora: horaEscolhida.getHours(),
        minuto: horaEscolhida.getMinutes(),
      })
    );
    setErros((atual) => ({ ...atual, horario: undefined }));
  }

  async function handleSalvar() {
    const resultadoData = parseDataFlexivel(dataTexto);
    const resultadoHora = parseHoraFlexivel(horarioTexto);

    const novosErros: Erros = {};
    if (!resultadoData.partes) {
      novosErros.data = resultadoData.erro ?? "Data inválida.";
    }
    if (!resultadoHora.partes) {
      novosErros.horario = resultadoHora.erro ?? "Horário inválido.";
    }
    if (!tomadorId) {
      novosErros.hospital = "Selecione o hospital.";
    }

    const valorNumerico = valorTexto ? moedaParaNumero(valorTexto) : NaN;
    if (!naoSeiValor) {
      if (!valorTexto) {
        novosErros.valor = "Informe o valor.";
      } else if (Number.isNaN(valorNumerico) || valorNumerico <= 0) {
        novosErros.valor = "Informe um valor numérico válido.";
      }
    }

    if (editando && resultadoData.partes) {
      const isoDaNovaData = dataParaISO(resultadoData.partes);
      if (!isDataFuturaOuHoje(isoDaNovaData)) {
        novosErros.data = "A nova data não pode ser no passado.";
      }
    }

    if (Object.keys(novosErros).length > 0) {
      setErros(novosErros);
      return;
    }

    setErros({});

    const payload = {
      data: dataParaISO(resultadoData.partes!),
      horario: formatarHoraBR(resultadoHora.partes!),
      tomador_id: tomadorId!,
      valor: naoSeiValor ? undefined : valorNumerico,
      descricao_nf: descricaoNf || undefined,
    };

    // Plantão retroativo (data no passado) só existe no fluxo de CRIAÇÃO —
    // editar já bloqueia data passada mais acima. Nesse caso, antes de
    // salvar, precisa confirmar com a usuária e perguntar sobre a data da
    // NF e o Simples Nacional daquela competência.
    if (!editando && !isDataFuturaOuHoje(payload.data)) {
      iniciarConfirmacaoRetroativa(payload, resultadoData.partes!);
      return;
    }

    await salvarPlantao(payload);
  }

  async function salvarPlantao(
    payload: {
      data: string;
      horario: string;
      tomador_id: string;
      valor?: number;
      descricao_nf?: string;
    },
    dataEmissaoNf?: string
  ) {
    setSalvando(true);
    try {
      if (editando) {
        await editarPlantao(route.params!.plantaoId!, payload);
      } else {
        await criarPlantao(
          dataEmissaoNf ? { ...payload, data_emissao_nf: dataEmissaoNf } : payload
        );
      }
      navigation.goBack();
    } catch (err: any) {
      const mensagem =
        err?.response?.data?.erro ??
        (editando
          ? "Não foi possível editar o plantão."
          : "Não foi possível salvar o plantão.");
      setErros({ geral: mensagem });
    } finally {
      setSalvando(false);
    }
  }

  // Passo 1: confirmar que a data retroativa está certa.
  function iniciarConfirmacaoRetroativa(
    payload: {
      data: string;
      horario: string;
      tomador_id: string;
      valor?: number;
      descricao_nf?: string;
    },
    dataPartes: DataPartes
  ) {
    Alert.alert(
      "Plantão retroativo",
      `Você está criando um plantão que já ocorreu. Confirma a data de ${formatarDataBR(
        dataPartes
      )}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: () => perguntarDataDaNf(payload),
        },
      ]
    );
  }

  // Passo 2: qual data usar na nota fiscal (a do plantão, ou hoje).
  function perguntarDataDaNf(payload: {
    data: string;
    horario: string;
    tomador_id: string;
    valor?: number;
    descricao_nf?: string;
  }) {
    Alert.alert(
      "Data da nota fiscal",
      "Como o plantão já foi realizado, a nota fiscal já será emitida agora. Qual data você quer usar para a nota fiscal?",
      [
        {
          text: "Data do plantão",
          onPress: () => perguntarDasGerada(payload, payload.data),
        },
        {
          text: "Data de hoje",
          onPress: () => verificarPrazoEFinalizar(payload, dataHojeISO()),
        },
      ]
    );
  }

  // Passo 3a: só perguntado se a NF vai sair com a data do plantão — nesse
  // caso pode já existir uma DAS gerada para aquela competência.
  function perguntarDasGerada(
    payload: {
      data: string;
      horario: string;
      tomador_id: string;
      valor?: number;
      descricao_nf?: string;
    },
    dataEmissaoEscolhida: string
  ) {
    Alert.alert(
      "Simples Nacional",
      "Já foi gerada a guia DAS do Simples Nacional da competência (mês) desse plantão?",
      [
        {
          text: "Não",
          onPress: () => verificarPrazoEFinalizar(payload, dataEmissaoEscolhida),
        },
        {
          text: "Sim",
          onPress: () =>
            Alert.alert(
              "DAS já foi paga?",
              "Já houve pagamento da DAS anteriormente entregue?",
              [
                {
                  text: "Não",
                  onPress: () => {
                    Alert.alert(
                      "Nova DAS necessária",
                      "Será necessário entregar declaração retificadora com esse novo faturamento. Como a DAS anterior ainda não foi paga, ela será substituída por uma nova DAS integral, já com o valor corrigido."
                    );
                    verificarPrazoEFinalizar(payload, dataEmissaoEscolhida);
                  },
                },
                {
                  text: "Sim",
                  onPress: () => {
                    Alert.alert(
                      "DAS avulsa necessária",
                      "Será necessário entregar declaração retificadora com esse novo faturamento. Como a DAS anterior já foi paga, será necessário gerar uma DAS avulsa cobrando só a diferença."
                    );
                    verificarPrazoEFinalizar(payload, dataEmissaoEscolhida);
                  },
                },
              ]
            ),
        },
      ]
    );
  }

  // Passo 3b: se a data de emissão escolhida já passou do dia 20 do mês
  // seguinte à competência do plantão, avisa sobre juros/multa e dá a
  // chance de trocar a data da NF antes de salvar de vez.
  function verificarPrazoEFinalizar(
    payload: {
      data: string;
      horario: string;
      tomador_id: string;
      valor?: number;
      descricao_nf?: string;
    },
    dataEmissaoEscolhida: string
  ) {
    const dia20Limite = dia20DoMesSubsequente(payload.data);
    const foraDoPrazo = dataEmissaoEscolhida > dia20Limite;

    if (!foraDoPrazo) {
      salvarPlantao(payload, dataEmissaoEscolhida);
      return;
    }

    Alert.alert(
      "Prazo do Simples Nacional já passou",
      "Já passou do prazo de pagamento do Simples Nacional da competência desse plantão. A geração de nota fiscal dessa competência em atraso pode gerar juros e multa (valor exato a calcular com sua contadora). Qual data você quer manter para a nota fiscal?",
      [
        {
          text: "Data do plantão",
          onPress: () => salvarPlantao(payload, payload.data),
        },
        {
          text: "Data de hoje",
          onPress: () => salvarPlantao(payload, dataHojeISO()),
        },
      ]
    );
  }

  function handleExcluir() {
    Alert.alert(
      "Excluir plantão",
      "Tem certeza que deseja excluir este plantão? Essa ação não pode ser desfeita.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            setExcluindo(true);
            try {
              await excluirPlantao(route.params!.plantaoId!);
              navigation.goBack();
            } catch (err: any) {
              const mensagem =
                err?.response?.data?.erro ?? "Não foi possível excluir o plantão.";
              setErros({ geral: mensagem });
            } finally {
              setExcluindo(false);
            }
          },
        },
      ]
    );
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
      <Text style={styles.titulo}>{editando ? "Editar plantão" : "Novo plantão"}</Text>

      <Text style={styles.label}>Data</Text>
      <View style={styles.linhaComIcone}>
        <TextInput
          style={[styles.input, styles.inputComIcone, erros.data && styles.inputErro]}
          placeholder="dd/mm/aaaa"
          value={dataTexto}
          onChangeText={setDataTexto}
          onBlur={handleBlurData}
          keyboardType="default"
        />
        <TouchableOpacity
          style={styles.iconeBotao}
          onPress={() => setMostrarCalendario(true)}
        >
          <Ionicons name="calendar-outline" size={22} color="#0B5FFF" />
        </TouchableOpacity>
      </View>
      {erros.data && <Text style={styles.erroCampo}>{erros.data}</Text>}

      <Text style={styles.label}>Horário</Text>
      <View style={styles.linhaComIcone}>
        <TextInput
          style={[styles.input, styles.inputComIcone, erros.horario && styles.inputErro]}
          placeholder="19:00"
          value={horarioTexto}
          onChangeText={setHorarioTexto}
          onBlur={handleBlurHorario}
          keyboardType="default"
        />
        <TouchableOpacity
          style={styles.iconeBotao}
          onPress={() => setMostrarRelogio(true)}
        >
          <Ionicons name="time-outline" size={22} color="#0B5FFF" />
        </TouchableOpacity>
      </View>
      {erros.horario && <Text style={styles.erroCampo}>{erros.horario}</Text>}

      <Text style={styles.label}>Hospital</Text>
      <TouchableOpacity
        style={[styles.input, styles.seletorHospital, erros.hospital && styles.inputErro]}
        onPress={handleAbrirSeletorHospital}
      >
        <Text style={tomadorNome ? styles.seletorTexto : styles.seletorPlaceholder}>
          {tomadorNome ?? "Selecionar hospital"}
        </Text>
        <Ionicons name="chevron-down" size={18} color="#828282" />
      </TouchableOpacity>
      {erros.hospital && <Text style={styles.erroCampo}>{erros.hospital}</Text>}

      <Text style={styles.label}>Valor (R$)</Text>
      <View style={styles.linhaComIcone}>
        <Text style={styles.prefixoMoeda}>R$</Text>
        <TextInput
          style={[
            styles.input,
            styles.inputComPrefixo,
            erros.valor && styles.inputErro,
          ]}
          placeholder="0,00"
          value={valorTexto}
          onChangeText={handleChangeValor}
          keyboardType="numeric"
          editable={!naoSeiValor}
        />
      </View>
      {erros.valor && <Text style={styles.erroCampo}>{erros.valor}</Text>}

      <View style={styles.linhaNaoSeiValor}>
        <Switch
          value={naoSeiValor}
          onValueChange={(valor) => {
            setNaoSeiValor(valor);
            if (valor) {
              setValorTexto("");
              setErros((atual) => ({ ...atual, valor: undefined }));
            }
          }}
        />
        <Text style={styles.naoSeiValorTexto}>Não sei o valor ainda</Text>
      </View>
      {naoSeiValor && (
        <Text style={styles.naoSeiValorAviso}>
          Sem o valor, a nota fiscal não poderá ser emitida automaticamente
          quando a data do plantão passar. O app vai pedir esse valor mais
          tarde.
        </Text>
      )}

      <Text style={styles.label}>Descrição para a NF (opcional)</Text>
      <TextInput
        style={[styles.input, styles.inputMultilinha]}
        placeholder="Plantão noturno - pronto-socorro"
        value={descricaoNf}
        onChangeText={setDescricaoNf}
        multiline
      />

      {erros.geral && <Text style={styles.erro}>{erros.geral}</Text>}

      <TouchableOpacity
        style={styles.botao}
        onPress={handleSalvar}
        disabled={salvando || excluindo}
      >
        {salvando ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.botaoTexto}>
            {editando ? "Salvar alterações" : "Salvar plantão"}
          </Text>
        )}
      </TouchableOpacity>

      {editando && (
        <TouchableOpacity
          style={styles.botaoExcluir}
          onPress={handleExcluir}
          disabled={salvando || excluindo}
        >
          {excluindo ? (
            <ActivityIndicator color="#EB5757" />
          ) : (
            <Text style={styles.botaoExcluirTexto}>Excluir plantão</Text>
          )}
        </TouchableOpacity>
      )}

      {editando && historico.length > 0 && (
        <View style={styles.historicoContainer}>
          <Text style={styles.historicoTitulo}>Histórico de edições</Text>
          {historico.map((item) => (
            <Text key={item.id} style={styles.historicoItem}>
              {CAMPO_LABEL[item.campo] ?? item.campo}{" "}
              {CAMPO_ALTERADO[item.campo] ?? "alterado"} de{" "}
              <Text style={styles.historicoDestaque}>
                {formatarValorHistorico(item.campo, item.valor_anterior)}
              </Text>{" "}
              para{" "}
              <Text style={styles.historicoDestaque}>
                {formatarValorHistorico(item.campo, item.valor_novo)}
              </Text>
              {"\n"}
              <Text style={styles.historicoQuando}>{formatarQuando(item.editado_em)}</Text>
            </Text>
          ))}
        </View>
      )}

      {/* Modal do seletor de hospital: lista com rolagem + cadastrar novo */}
      <Modal
        visible={mostrarSeletorHospital}
        transparent
        animationType="slide"
        onRequestClose={() => setMostrarSeletorHospital(false)}
      >
        <View style={styles.modalFundo}>
          <View style={styles.modalConteudo}>
            <Text style={styles.modalTitulo}>Selecionar hospital</Text>

            {tomadores.length > 5 && (
              <TextInput
                style={[styles.input, styles.buscaHospital]}
                placeholder="Buscar por nome, cidade ou CNPJ"
                value={buscaHospital}
                onChangeText={setBuscaHospital}
                autoCorrect={false}
              />
            )}

            {carregandoTomadores && tomadores.length === 0 ? (
              <ActivityIndicator color="#0B5FFF" style={{ marginVertical: 24 }} />
            ) : (
              <FlatList
                data={tomadoresFiltrados}
                keyExtractor={(item) => item.id}
                style={styles.listaHospitais}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const uso = descreverUsoTomador(item);
                  return (
                    <TouchableOpacity
                      style={styles.itemHospital}
                      onPress={() => handleSelecionarTomador(item)}
                    >
                      <View style={styles.itemHospitalLinha}>
                        <Text style={[styles.itemHospitalTexto, { flex: 1 }]} numberOfLines={1}>
                          {nomeExibicaoTomador(item)}
                        </Text>
                        {item.origem === "importado_nfse" && (
                          <Text style={styles.seloImportado}>das suas notas</Text>
                        )}
                      </View>
                      {item.apelido && (
                        <Text style={styles.itemHospitalRazaoSocial} numberOfLines={1}>
                          {item.razao_social}
                        </Text>
                      )}
                      {uso && (
                        <Text style={styles.itemHospitalRazaoSocial} numberOfLines={1}>
                          {uso}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.listaVaziaTexto}>
                    {buscaHospital
                      ? "Nenhum hospital encontrado com essa busca."
                      : "Nenhum hospital cadastrado ainda. Busque nas notas que você já emitiu ou cadastre um novo."}
                  </Text>
                }
              />
            )}

            <TouchableOpacity
              style={styles.itemCadastrarNovo}
              onPress={handleCadastrarNovoHospital}
            >
              <Ionicons name="add-circle-outline" size={20} color="#0B5FFF" />
              <Text style={styles.itemCadastrarNovoTexto}>
                Cadastrar novo hospital
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.itemImportar}
              onPress={handleImportarDasNotas}
              disabled={importando}
            >
              {importando ? (
                <ActivityIndicator size="small" color="#0B5FFF" />
              ) : (
                <Ionicons name="cloud-download-outline" size={20} color="#0B5FFF" />
              )}
              <Text style={styles.itemCadastrarNovoTexto}>
                {importando ? "Buscando nas suas notas…" : "Buscar hospitais nas notas emitidas"}
              </Text>
            </TouchableOpacity>
            {textoImportacao && (
              <Text style={styles.textoImportacao}>{textoImportacao}</Text>
            )}

            <TouchableOpacity
              style={styles.modalBotaoFechar}
              onPress={() => setMostrarSeletorHospital(false)}
            >
              <Text style={styles.modalBotaoFecharTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Android: o próprio picker já abre como um diálogo por cima da tela */}
      {Platform.OS === "android" && mostrarCalendario && (
        <DateTimePicker
          value={obterDataParaPicker()}
          mode="date"
          display="calendar"
          onChange={handleDataSelecionada}
        />
      )}
      {Platform.OS === "android" && mostrarRelogio && (
        <DateTimePicker
          value={obterHoraParaPicker()}
          mode="time"
          display="clock"
          is24Hour
          onChange={handleHoraSelecionada}
        />
      )}

      {/* iOS: precisa de um Modal manual para ter o comportamento de popup */}
      {Platform.OS === "ios" && (
        <Modal visible={mostrarCalendario} transparent animationType="slide">
          <View style={styles.modalFundo}>
            <View style={styles.modalConteudo}>
              <DateTimePicker
                value={obterDataParaPicker()}
                mode="date"
                display="inline"
                onChange={handleDataSelecionada}
              />
              <TouchableOpacity
                style={styles.modalBotao}
                onPress={() => setMostrarCalendario(false)}
              >
                <Text style={styles.modalBotaoTexto}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
      {Platform.OS === "ios" && (
        <Modal visible={mostrarRelogio} transparent animationType="slide">
          <View style={styles.modalFundo}>
            <View style={styles.modalConteudo}>
              <DateTimePicker
                value={obterHoraParaPicker()}
                mode="time"
                display="spinner"
                is24Hour
                onChange={handleHoraSelecionada}
              />
              <TouchableOpacity
                style={styles.modalBotao}
                onPress={() => setMostrarRelogio(false)}
              >
                <Text style={styles.modalBotaoTexto}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 60,
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
  linhaComIcone: {
    flexDirection: "row",
    alignItems: "center",
  },
  inputComIcone: {
    flex: 1,
  },
  iconeBotao: {
    marginLeft: 10,
    padding: 10,
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  seletorHospital: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  seletorTexto: {
    fontSize: 16,
    color: "#1A1A1A",
  },
  seletorPlaceholder: {
    fontSize: 16,
    color: "#9E9E9E",
  },
  prefixoMoeda: {
    fontSize: 16,
    color: "#4F4F4F",
    fontWeight: "600",
    marginRight: 8,
  },
  inputComPrefixo: {
    flex: 1,
  },
  inputErro: {
    borderColor: "#EB5757",
  },
  erroCampo: {
    color: "#EB5757",
    fontSize: 12,
    marginTop: 4,
  },
  linhaNaoSeiValor: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
  },
  naoSeiValorTexto: {
    fontSize: 14,
    color: "#4F4F4F",
    marginLeft: 10,
  },
  naoSeiValorAviso: {
    fontSize: 12,
    color: "#B8860B",
    marginTop: 6,
    fontStyle: "italic",
  },
  inputMultilinha: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  erro: {
    color: "#EB5757",
    marginTop: 16,
    textAlign: "center",
  },
  botao: {
    backgroundColor: "#0B5FFF",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 28,
  },
  botaoTexto: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  botaoExcluir: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#EB5757",
  },
  botaoExcluirTexto: {
    color: "#EB5757",
    fontSize: 16,
    fontWeight: "600",
  },
  historicoContainer: {
    marginTop: 28,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  historicoTitulo: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 10,
  },
  historicoItem: {
    fontSize: 13,
    color: "#4F4F4F",
    marginBottom: 12,
    lineHeight: 19,
  },
  historicoDestaque: {
    fontWeight: "600",
    color: "#1A1A1A",
  },
  historicoQuando: {
    fontSize: 11,
    color: "#9E9E9E",
  },
  modalFundo: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalConteudo: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: "70%",
  },
  modalTitulo: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 12,
  },
  listaHospitais: {
    maxHeight: 260,
  },
  itemHospital: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  itemHospitalTexto: {
    fontSize: 16,
    color: "#1A1A1A",
  },
  itemHospitalLinha: {
    flexDirection: "row",
    alignItems: "center",
  },
  seloImportado: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8A6D00",
    backgroundColor: "#FBEBC9",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
    overflow: "hidden",
  },
  buscaHospital: {
    marginBottom: 8,
    paddingVertical: 10,
  },
  itemImportar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  textoImportacao: {
    fontSize: 12,
    color: "#5B6B76",
    marginBottom: 6,
  },
  itemHospitalRazaoSocial: {
    fontSize: 12,
    color: "#9E9E9E",
    marginTop: 2,
  },
  listaVaziaTexto: {
    textAlign: "center",
    color: "#828282",
    paddingVertical: 24,
  },
  itemCadastrarNovo: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  itemCadastrarNovoTexto: {
    color: "#0B5FFF",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  modalBotaoFechar: {
    alignItems: "center",
    paddingVertical: 12,
  },
  modalBotaoFecharTexto: {
    color: "#828282",
    fontSize: 15,
  },
  modalBotao: {
    backgroundColor: "#0B5FFF",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  modalBotaoTexto: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
