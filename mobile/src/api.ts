import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

// O Expo substitui process.env.EXPO_PUBLIC_* no build; essa declaração
// só existe pro TypeScript reconhecer o "process" no app.
declare const process: { env: Record<string, string | undefined> };

/**
 * Endereço do backend. Vem de EXPO_PUBLIC_API_URL (arquivo mobile/.env),
 * pra trocar de método de teste sem mexer no código:
 *   - Emulador Android (Android Studio): http://10.0.2.2:3000
 *     ("localhost" dentro do emulador é o próprio emulador, não o PC)
 *   - Celular físico no mesmo Wi-Fi: http://<IP do PC>:3000
 *     (ex: http://SEU_IP_LOCAL:3000)
 *   - Celular via cabo USB (adb reverse tcp:3000 tcp:3000): http://localhost:3000
 * Depois de mudar o .env, reinicie o Expo com --clear.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:3000";

/** Emissão e cancelamento conversam com o governo — podem levar bem mais
 * que uma chamada comum. */
const TIMEOUT_GOVERNO_MS = 90000;

export const TOKEN_STORAGE_KEY = "@appmedicos:token";
export const MEDICO_NOME_STORAGE_KEY = "@appmedicos:medico_nome";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface Plantao {
  id: string;
  data: string;
  horario: string;
  hospital: string;
  tomador_id: string | null;
  valor: string | null;
  descricao_nf: string | null;
  status:
    | "agendado"
    | "nf_emitida"
    | "nf_confirmada"
    | "aguardando_nova_data"
    | "cancelamento_administrativo"
    | "cancelado";
  data_emissao_nf: string | null;
  observacao_cancelamento: string | null;
  /** Chave de acesso da NFS-e emitida de verdade pelo app (se houver). */
  nfse_chave_acesso?: string | null;
  created_at: string;
}

export interface Tomador {
  id: string;
  cnpj: string;
  razao_social: string;
  apelido: string | null;
  endereco: string | null;
  email: string | null;
  telefone: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  codigo_municipio_ibge: string | null;
  municipio?: string | null;
  uf?: string | null;
  /** "manual" (cadastrado no app) ou "importado_nfse" (veio das notas emitidas). */
  origem?: "manual" | "importado_nfse";
  ultima_nota_em?: string | null;
  qtd_notas_importadas?: number;
  qtd_plantoes?: number;
  /** Último plantão com o hospital ou última nota emitida pra ele. */
  ultimo_uso?: string | null;
  created_at: string;
}

export interface HistoricoPlantao {
  id: string;
  campo: "data" | "horario" | "hospital" | "valor" | "descricao_nf" | "status";
  valor_anterior: string | null;
  valor_novo: string | null;
  editado_em: string;
}

/** Nome a exibir na tela: usa o apelido quando existir, senão a razão social. */
export function nomeExibicaoTomador(tomador: Tomador): string {
  return tomador.apelido || tomador.razao_social;
}

export async function login(email: string, senha: string) {
  const { data } = await api.post<{
    token: string;
    medico: { id: string; nome: string };
  }>("/auth/login", { email, senha });

  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, data.token);
  await AsyncStorage.setItem(MEDICO_NOME_STORAGE_KEY, data.medico.nome);
  return data;
}

export async function logout() {
  await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
  await AsyncStorage.removeItem(MEDICO_NOME_STORAGE_KEY);
}

export async function listarPlantoes(): Promise<Plantao[]> {
  const { data } = await api.get<Plantao[]>("/plantoes");
  return data;
}

export async function criarPlantao(input: {
  data: string;
  horario: string;
  tomador_id: string;
  valor?: number;
  descricao_nf?: string;
  data_emissao_nf?: string;
}): Promise<Plantao> {
  const { data } = await api.post<Plantao>("/plantoes", input);
  return data;
}

export async function editarPlantao(
  id: string,
  input: {
    data: string;
    horario: string;
    tomador_id: string;
    valor?: number;
    descricao_nf?: string;
  }
): Promise<Plantao> {
  const { data } = await api.put<Plantao>(`/plantoes/${id}`, input);
  return data;
}

/**
 * Completa o valor de um plantão que ficou sem valor definido. Funciona
 * mesmo em plantões passados (diferente de editarPlantao, que só permite
 * plantões de hoje/futuro).
 */
export async function completarValorPlantao(
  id: string,
  input: { valor: number; descricao_nf?: string }
): Promise<Plantao> {
  const { data } = await api.patch<Plantao>(`/plantoes/${id}/valor`, input);
  return data;
}

export async function excluirPlantao(id: string): Promise<void> {
  await api.delete(`/plantoes/${id}`);
}

/** Emite DE VERDADE a NFS-e do plantão no Sistema Nacional (usa a
 * empresa emissora e o hospital cadastrados). Pode levar alguns segundos. */
export async function emitirNfPlantao(id: string): Promise<Plantao> {
  const { data } = await api.patch<Plantao>(`/plantoes/${id}/emitir-nf`, undefined, {
    timeout: TIMEOUT_GOVERNO_MS,
  });
  return data;
}

/** @deprecated nome antigo — use emitirNfPlantao. */
export const marcarNfEmitida = emitirNfPlantao;

export interface RespostaNaoRealizado {
  acao: "excluido" | "cancelado" | "processo_administrativo";
  mensagemFiscal?: string;
  /** Resultado do cancelamento da NFS-e no governo (quando aplicável). */
  mensagemNf?: string;
  mensagem?: string;
}

/** Marca um plantão passado como "não foi realizado", seguindo o fluxo de
 * cancelamento de NF / retificação do Simples Nacional quando aplicável. */
export async function marcarNaoRealizado(
  id: string,
  respostas: {
    simplesJaEntregue?: boolean;
    dasJaPaga?: boolean;
    observacaoCancelamento?: string;
  } = {}
): Promise<RespostaNaoRealizado> {
  const { data } = await api.post<RespostaNaoRealizado>(
    `/plantoes/${id}/nao-realizado`,
    respostas,
    { timeout: TIMEOUT_GOVERNO_MS }
  );
  return data;
}

export async function listarHistoricoPlantao(
  id: string
): Promise<HistoricoPlantao[]> {
  const { data } = await api.get<HistoricoPlantao[]>(`/plantoes/${id}/historico`);
  return data;
}

export async function listarTomadores(): Promise<Tomador[]> {
  const { data } = await api.get<Tomador[]>("/tomadores");
  return data;
}

export async function criarTomador(input: {
  cnpj: string;
  razao_social: string;
  apelido?: string;
  endereco?: string;
  email?: string;
  telefone?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  codigo_municipio_ibge?: string;
}): Promise<Tomador> {
  const { data } = await api.post<Tomador>("/tomadores", input);
  return data;
}

export async function buscarDadosCnpj(cnpj: string): Promise<{
  razao_social: string;
  endereco: string;
  email: string;
  telefone: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  codigo_municipio_ibge: string | null;
}> {
  const { data } = await api.get(`/tomadores/cnpj/${cnpj}`);
  return data;
}

/** Extrai a mensagem de erro amigável de uma falha de chamada à API. */
export function mensagemDeErro(err: any, padrao: string): string {
  if (err?.code === "ECONNABORTED") {
    return "A resposta demorou demais. Confira a lista antes de tentar de novo — a operação pode ter sido concluída.";
  }
  if (!err?.response) {
    return `Sem conexão com o servidor (${API_BASE_URL}). Confira se o backend está rodando e se o endereço da API está certo.`;
  }
  return err.response.data?.erro ?? padrao;
}

// ---------------------------------------------------------------------
// Empresa emissora (dados fiscais de quem emite a NFS-e)
// ---------------------------------------------------------------------

export interface EmpresaEmissora {
  id: string;
  cnpj: string;
  razao_social: string;
  inscricao_municipal: string | null;
  codigo_municipio_ibge: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  telefone: string | null;
  email: string | null;
  op_simp_nac: number;
  reg_ap_trib_sn: number;
  percentual_aprox_tributos_sn: string;
  codigo_trib_nac: string;
  codigo_nbs: string | null;
  ambiente: "homologacao" | "producao";
  certificado_titular: string | null;
  certificado_validade: string | null;
  certificado_cadastrado: boolean;
}

export type DadosEmpresaEmissora = Omit<
  EmpresaEmissora,
  | "id"
  | "certificado_titular"
  | "certificado_validade"
  | "certificado_cadastrado"
  | "percentual_aprox_tributos_sn"
  | "inscricao_municipal"
  | "complemento"
  | "telefone"
  | "email"
  | "codigo_nbs"
> & {
  inscricao_municipal?: string;
  complemento?: string;
  telefone?: string;
  email?: string;
  codigo_nbs?: string;
};

/** Devolve a empresa emissora do médico logado, ou null se ainda não houver. */
export async function obterMinhaEmpresa(): Promise<EmpresaEmissora | null> {
  try {
    const { data } = await api.get<EmpresaEmissora>("/empresas-emissoras/me");
    return data;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}

export async function salvarMinhaEmpresa(
  input: DadosEmpresaEmissora
): Promise<EmpresaEmissora> {
  const { data } = await api.post<EmpresaEmissora>("/empresas-emissoras/me", input);
  return data;
}

export interface CalculoSimplesNacional {
  rbt12: number;
  folhaPagamento12Meses: number;
  fatorRPercentual: number;
  anexo: "III" | "V";
  aliquotaNominalPercentual: number;
  parcelaDeduzir: number;
  aliquotaEfetivaPercentual: number;
  semHistoricoSuficiente: boolean;
}

export async function obterCalculoSimples(): Promise<CalculoSimplesNacional> {
  const { data } = await api.get<CalculoSimplesNacional>(
    "/empresas-emissoras/me/simples-nacional"
  );
  return data;
}

export interface ConvenioMunicipio {
  codigoMunicipio: string;
  ambiente: string;
  aderente: boolean | null;
  resumo: string;
  consultadoEm: string;
}

export async function consultarConvenioMunicipio(): Promise<ConvenioMunicipio> {
  const { data } = await api.get<ConvenioMunicipio>("/empresas-emissoras/me/convenio", {
    timeout: TIMEOUT_GOVERNO_MS,
  });
  return data;
}

/** Busca os dados de uma empresa pelo CNPJ (BrasilAPI + ViaCEP, via backend)
 * — reaproveita a mesma consulta usada no cadastro de hospital. */
export const buscarDadosEmpresaPorCnpj = buscarDadosCnpj;

// ---------------------------------------------------------------------
// Importação automática de hospitais a partir das notas já emitidas
// ---------------------------------------------------------------------

export interface ImportacaoHospitais {
  id: string;
  status: "executando" | "concluida" | "parcial" | "erro";
  periodo_inicio: string | null;
  documentos_lidos: number;
  notas_emitidas_periodo: number;
  notas_canceladas: number;
  tomadores_novos: number;
  tomadores_atualizados: number;
  ignorados_pessoa_fisica: number;
  mensagem: string | null;
  iniciado_em: string;
  concluido_em: string | null;
}

/** Dispara a importação (roda em segundo plano no servidor). */
export async function importarHospitaisDasNotas(): Promise<ImportacaoHospitais> {
  const { data } = await api.post<ImportacaoHospitais>("/tomadores/importar");
  return data;
}

export async function statusImportacaoHospitais(): Promise<ImportacaoHospitais | null> {
  const { data } = await api.get<ImportacaoHospitais | null>("/tomadores/importar/status");
  return data;
}

/**
 * Consulta o status a cada poucos segundos até a importação terminar (ou
 * até `deveParar()` devolver true — ex: a tela foi fechada).
 */
export async function acompanharImportacaoHospitais(
  aoAtualizar: (i: ImportacaoHospitais) => void,
  deveParar: () => boolean = () => false
): Promise<ImportacaoHospitais | null> {
  const limite = Date.now() + 15 * 60 * 1000;
  while (!deveParar() && Date.now() < limite) {
    const atual = await statusImportacaoHospitais();
    if (atual) aoAtualizar(atual);
    if (!atual || atual.status !== "executando") return atual;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

/** Texto curto de progresso/resultado de uma importação, pra exibir na tela. */
export function descreverImportacao(i: ImportacaoHospitais): string {
  if (i.status === "executando") {
    return i.documentos_lidos > 0
      ? `Lendo suas notas no governo… ${i.documentos_lidos} documento(s) lido(s).`
      : "Lendo suas notas no governo…";
  }
  return i.mensagem ?? (i.status === "erro" ? "A importação falhou." : "Importação concluída.");
}
