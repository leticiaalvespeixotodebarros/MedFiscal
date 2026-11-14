import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { logout } from "../src/api";
import { CORES } from "../src/theme";
import CabecalhoTopo from "../src/components/CabecalhoTopo";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

interface ItemMenu {
  titulo: string;
  subtitulo: string;
  icone: keyof typeof Ionicons.glyphMap;
  disponivel: boolean;
  aoTocar?: () => void;
}

export default function HomeScreen({ navigation }: Props) {
  async function handleSair() {
    await logout();
    navigation.replace("Login");
  }

  const itemDestaque: ItemMenu = {
    titulo: "Agenda",
    subtitulo: "Agenda de Plantões",
    icone: "calendar",
    disponivel: true,
    aoTocar: () => navigation.navigate("Plantoes"),
  };

  const itensGrade: ItemMenu[] = [
    {
      titulo: "Minha Empresa",
      subtitulo: "Dados fiscais e NF",
      icone: "business-outline",
      disponivel: true,
      aoTocar: () => navigation.navigate("MinhaEmpresa"),
    },
    {
      titulo: "Faturamento",
      subtitulo: "Faturamento Mensal",
      icone: "bar-chart-outline",
      disponivel: false,
    },
    {
      titulo: "Calendário Pagamento",
      subtitulo: "Calendário de Pagamentos",
      icone: "calendar-outline",
      disponivel: false,
    },
    {
      titulo: "Simulação IRPF",
      subtitulo: "Simulação IRPF e Lucros",
      icone: "calculator-outline",
      disponivel: false,
    },
    {
      titulo: "Fale Conosco",
      subtitulo: "Suporte VIP",
      icone: "chatbubble-ellipses-outline",
      disponivel: false,
    },
    {
      titulo: "Controle de Despesas",
      subtitulo: "Gestão de Despesas",
      icone: "wallet-outline",
      disponivel: false,
    },
    {
      titulo: "Documentos da Empresa",
      subtitulo: "Documentos da Empresa",
      icone: "document-text-outline",
      disponivel: false,
    },
  ];

  function renderIconeComCirculo(
    icone: keyof typeof Ionicons.glyphMap,
    disponivel: boolean,
    tamanho: number
  ) {
    return (
      <View
        style={[
          styles.circuloIcone,
          { width: tamanho, height: tamanho, borderRadius: tamanho / 2 },
        ]}
      >
        <Ionicons
          name={icone}
          size={tamanho * 0.5}
          color={disponivel ? CORES.navy : "#B0B0B0"}
        />
        {!disponivel && (
          <View style={styles.cadeado}>
            <Ionicons name="lock-closed" size={12} color="#fff" />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CabecalhoTopo onSair={handleSair} />

      <View style={styles.conteudo}>
        <TouchableOpacity
          style={styles.cardDestaque}
          onPress={itemDestaque.aoTocar}
        >
          <Text style={styles.cardDestaqueTitulo}>
            {itemDestaque.titulo.toUpperCase()}
          </Text>
          {renderIconeComCirculo(itemDestaque.icone, true, 84)}
          <Text style={styles.cardDestaqueSubtitulo}>
            {itemDestaque.subtitulo}
          </Text>
        </TouchableOpacity>

        <View style={styles.grade}>
          {itensGrade.map((item) => (
            <TouchableOpacity
              key={item.titulo}
              style={styles.card}
              onPress={item.aoTocar}
              disabled={!item.disponivel}
            >
              <Text style={styles.cardTitulo}>{item.titulo.toUpperCase()}</Text>
              {renderIconeComCirculo(item.icone, item.disponivel, 56)}
              <Text style={styles.cardSubtitulo} numberOfLines={1}>
                {item.subtitulo}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CORES.fundoTela,
  },
  conteudo: {
    padding: 16,
  },
  cardDestaque: {
    backgroundColor: CORES.cardFundo,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CORES.cardBorda,
    paddingVertical: 20,
    alignItems: "center",
    marginBottom: 14,
  },
  cardDestaqueTitulo: {
    fontSize: 16,
    fontWeight: "800",
    color: CORES.navy,
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  cardDestaqueSubtitulo: {
    fontSize: 14,
    fontWeight: "600",
    color: CORES.navy,
    marginTop: 12,
  },
  grade: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
  card: {
    width: "47.5%",
    backgroundColor: CORES.cardFundo,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CORES.cardBorda,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  cardTitulo: {
    fontSize: 11,
    fontWeight: "800",
    color: CORES.navy,
    textAlign: "center",
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  cardSubtitulo: {
    fontSize: 11,
    fontWeight: "600",
    color: CORES.cinzaTexto,
    marginTop: 8,
    textAlign: "center",
  },
  circuloIcone: {
    backgroundColor: CORES.circuloIcone,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  cadeado: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: CORES.ouro,
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
});

/**
 * BACKLOG (não implementado agora, por instrução da usuária): banner de
 * "Notificações Críticas" no rodapé desta tela, no estilo do mockup —
 * ícone de sino dourado à esquerda, título em negrito, lista de itens
 * críticos com uma tag colorida entre parênteses indicando o tipo/origem
 * (ex: "(Vermelho)" para NF em processo administrativo, "(Azul)" para
 * guia DAS vencendo). Só deve ser implementado quando existir uma fonte
 * de dados real para essas notificações — não deve ser preenchido com
 * dados fictícios.
 */
