import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MEDICO_NOME_STORAGE_KEY } from "../api";
import { CORES } from "../theme";

interface Props {
  onSair: () => void;
  /** Se informado, o ícone de menu vira um atalho pra essa ação (ex:
   * voltar pro menu inicial). Se omitido, o ícone fica só decorativo. */
  aoTocarMenu?: () => void;
}

export default function CabecalhoTopo({ onSair, aoTocarMenu }: Props) {
  const [nomeMedico, setNomeMedico] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(MEDICO_NOME_STORAGE_KEY).then(setNomeMedico);
  }, []);

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.headerEsquerda}>
          <TouchableOpacity
            onPress={aoTocarMenu}
            disabled={!aoTocarMenu}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={aoTocarMenu ? "chevron-back" : "menu"}
              size={26}
              color={CORES.navy}
            />
          </TouchableOpacity>
          <Text style={styles.tituloApp}>MedFiscal</Text>
        </View>
        <TouchableOpacity style={styles.perfil} onPress={onSair}>
          <View style={styles.avatarCirculo}>
            <Ionicons name="person" size={20} color={CORES.navy} />
          </View>
          <View>
            <Text style={styles.nomeMedico} numberOfLines={1}>
              {nomeMedico ?? "Médico(a)"}
            </Text>
            <Text style={styles.sair}>Sair</Text>
          </View>
        </TouchableOpacity>
      </View>
      <View style={styles.headerLinhaOuro} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: CORES.headerFundo,
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerLinhaOuro: {
    height: 3,
    backgroundColor: CORES.headerBorda,
  },
  headerEsquerda: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  tituloApp: {
    fontSize: 19,
    fontWeight: "800",
    color: CORES.navy,
    letterSpacing: 0.5,
  },
  perfil: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatarCirculo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: CORES.ouro,
    alignItems: "center",
    justifyContent: "center",
  },
  nomeMedico: {
    fontSize: 12,
    fontWeight: "700",
    color: CORES.navy,
    maxWidth: 110,
  },
  sair: {
    fontSize: 11,
    color: "#EB5757",
    fontWeight: "600",
  },
});
