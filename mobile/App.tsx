import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import PlantoesScreen from "./screens/PlantoesScreen";
import NovoPlantaoScreen from "./screens/NovoPlantaoScreen";
import CadastroTomadorScreen from "./screens/CadastroTomadorScreen";
import MinhaEmpresaScreen from "./screens/MinhaEmpresaScreen";
import { TOKEN_STORAGE_KEY } from "./src/api";

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Plantoes: undefined;
  NovoPlantao:
    | {
        // Preenchido ao voltar da tela de cadastro de hospital.
        tomadorSelecionadoId?: string;
        tomadorSelecionadoNome?: string;
        // Preenchido ao abrir a tela para EDITAR um plantão existente
        // (em vez de criar um novo). Quando plantaoId está presente, a
        // tela entra em modo de edição.
        plantaoId?: string;
        plantaoData?: string;
        plantaoHorario?: string;
        plantaoTomadorId?: string;
        plantaoTomadorNome?: string;
        plantaoValor?: string;
        plantaoDescricaoNf?: string;
      }
    | undefined;
  CadastroTomador: undefined;
  MinhaEmpresa: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const screenOptions: NativeStackNavigationOptions = {
  headerShown: false,
};

export default function App() {
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [logado, setLogado] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_STORAGE_KEY).then((token) => {
      setLogado(!!token);
      setCarregandoSessao(false);
    });
  }, []);

  if (carregandoSessao) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#0B5FFF" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={logado ? "Home" : "Login"}
        screenOptions={screenOptions}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Plantoes" component={PlantoesScreen} />
        <Stack.Screen
          name="NovoPlantao"
          component={NovoPlantaoScreen}
          options={{ headerShown: true, title: "Novo plantão" }}
        />
        <Stack.Screen
          name="CadastroTomador"
          component={CadastroTomadorScreen}
          options={{ headerShown: true, title: "Novo hospital" }}
        />
        <Stack.Screen
          name="MinhaEmpresa"
          component={MinhaEmpresaScreen}
          options={{ headerShown: true, title: "Minha empresa" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
