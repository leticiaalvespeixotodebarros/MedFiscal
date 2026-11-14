// mobile/src/utils/dataHora.ts
//
// Funções para interpretar data/hora digitadas em vários formatos,
// validar se fazem sentido no calendário real, e formatar para
// exibição (padrão brasileiro) e para envio à API (padrão do backend).

const pad = (n: number) => String(n).padStart(2, "0");

export interface DataPartes {
  dia: number;
  mes: number;
  ano: number;
}

export interface HoraPartes {
  hora: number;
  minuto: number;
}

interface ResultadoParse<T> {
  partes: T | null;
  erro: string | null;
}

/**
 * Aceita: "15082026", "150826", "15/08/2026", "15/08/26"
 */
export function parseDataFlexivel(input: string): ResultadoParse<DataPartes> {
  const texto = input.trim();
  if (!texto) {
    return { partes: null, erro: "Preencha a data." };
  }

  let dia: number;
  let mes: number;
  let ano: number;

  if (texto.includes("/")) {
    const segmentos = texto.split("/");
    if (segmentos.length !== 3) {
      return { partes: null, erro: "Use o formato dd/mm/aaaa." };
    }
    dia = parseInt(segmentos[0], 10);
    mes = parseInt(segmentos[1], 10);
    ano = parseInt(segmentos[2], 10);
  } else {
    const digitos = texto.replace(/\D/g, "");
    if (digitos.length === 8) {
      dia = parseInt(digitos.slice(0, 2), 10);
      mes = parseInt(digitos.slice(2, 4), 10);
      ano = parseInt(digitos.slice(4, 8), 10);
    } else if (digitos.length === 6) {
      dia = parseInt(digitos.slice(0, 2), 10);
      mes = parseInt(digitos.slice(2, 4), 10);
      ano = parseInt(digitos.slice(4, 6), 10);
    } else {
      return { partes: null, erro: "Data incompleta. Digite dia, mês e ano." };
    }
  }

  if (Number.isNaN(dia) || Number.isNaN(mes) || Number.isNaN(ano)) {
    return { partes: null, erro: "Data inválida. Use só números." };
  }

  if (ano < 100) {
    ano += 2000;
  }

  if (mes < 1 || mes > 12) {
    return { partes: null, erro: "Esse mês não existe. Use um valor de 01 a 12." };
  }

  const diasNoMes = new Date(ano, mes, 0).getDate();
  if (dia < 1 || dia > diasNoMes) {
    return {
      partes: null,
      erro: `Esse dia não existe nesse mês (o máximo é ${diasNoMes}).`,
    };
  }

  return { partes: { dia, mes, ano }, erro: null };
}

/**
 * Aceita: "1900", "930", "19", "19:00"
 */
export function parseHoraFlexivel(input: string): ResultadoParse<HoraPartes> {
  const texto = input.trim();
  if (!texto) {
    return { partes: null, erro: "Preencha o horário." };
  }

  let hora: number;
  let minuto: number;

  if (texto.includes(":")) {
    const segmentos = texto.split(":");
    if (segmentos.length !== 2) {
      return { partes: null, erro: "Use o formato HH:mm." };
    }
    hora = parseInt(segmentos[0], 10);
    minuto = parseInt(segmentos[1], 10);
  } else {
    const digitos = texto.replace(/\D/g, "");
    if (digitos.length === 4) {
      hora = parseInt(digitos.slice(0, 2), 10);
      minuto = parseInt(digitos.slice(2, 4), 10);
    } else if (digitos.length === 3) {
      hora = parseInt(digitos.slice(0, 1), 10);
      minuto = parseInt(digitos.slice(1, 3), 10);
    } else if (digitos.length <= 2) {
      hora = parseInt(digitos, 10);
      minuto = 0;
    } else {
      return { partes: null, erro: "Horário incompleto." };
    }
  }

  if (Number.isNaN(hora) || Number.isNaN(minuto)) {
    return { partes: null, erro: "Horário inválido. Use só números." };
  }

  if (hora < 0 || hora > 23) {
    return { partes: null, erro: "Essa hora não existe. Use um valor de 00 a 23." };
  }

  if (minuto < 0 || minuto > 59) {
    return { partes: null, erro: "Esses minutos não existem. Use um valor de 00 a 59." };
  }

  return { partes: { hora, minuto }, erro: null };
}

export function formatarDataBR({ dia, mes, ano }: DataPartes): string {
  return `${pad(dia)}/${pad(mes)}/${ano}`;
}

export function formatarHoraBR({ hora, minuto }: HoraPartes): string {
  return `${pad(hora)}:${pad(minuto)}`;
}

/** Formato usado para enviar à API (o backend espera "AAAA-MM-DD"). */
export function dataParaISO({ dia, mes, ano }: DataPartes): string {
  return `${ano}-${pad(mes)}-${pad(dia)}`;
}

/**
 * Formata para exibição uma data vinda do backend, que pode chegar como
 * "2026-08-15" (correto) ou como um timestamp ISO completo
 * "2026-08-15T03:00:00.000Z" (o que causava o bug de exibição anterior).
 */
export function formatarDataVindaDoBackend(valor: string): string {
  const dataPura = valor.slice(0, 10); // sempre pega só "AAAA-MM-DD"
  const [ano, mes, dia] = dataPura.split("-");
  if (!ano || !mes || !dia) return valor;
  return `${dia}/${mes}/${ano}`;
}

/**
 * Formata para exibição um horário vindo do backend, que pode estar como
 * "19:00" (correto) ou como um número solto tipo "1800" ou "2500"
 * (dado sujo salvo antes de existir validação).
 */
export function formatarHoraVindaDoBackend(valor: string): string {
  if (valor.includes(":")) {
    const [h, m] = valor.split(":");
    const horaNum = parseInt(h, 10);
    const minNum = parseInt(m, 10) || 0;
    return `${pad(horaNum)}:${pad(minNum)}`;
  }
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length === 4) {
    return `${digitos.slice(0, 2)}:${digitos.slice(2, 4)}`;
  }
  if (digitos.length <= 2) {
    return `${pad(parseInt(digitos, 10))}:00`;
  }
  return valor;
}

/**
 * Converte uma data vinda do backend ("AAAA-MM-DD" ou timestamp ISO
 * completo) em partes {dia, mes, ano}, para pré-preencher o formulário
 * de edição (que usa o mesmo estado/parsing da tela de criar plantão).
 */
export function isoParaPartes(dataISOOuTimestamp: string): DataPartes {
  const dataPura = dataISOOuTimestamp.slice(0, 10);
  const [ano, mes, dia] = dataPura.split("-").map(Number);
  return { dia, mes, ano };
}

/** Data de hoje no formato "AAAA-MM-DD", no fuso horário do aparelho. */
export function dataHojeISO(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
}

/**
 * Compara uma data vinda do backend (ou já em "AAAA-MM-DD") com a data de
 * hoje. Usado para decidir se um plantão ainda pode ser editado/excluído
 * (regra 1: só plantões de hoje ou no futuro).
 */
export function isDataFuturaOuHoje(dataISOOuTimestamp: string): boolean {
  const dataPura = dataISOOuTimestamp.slice(0, 10);
  return dataPura >= dataHojeISO();
}

/**
 * Dia 20 do mês seguinte ao mês/ano de uma data de referência (usado para
 * saber se a emissão/cancelamento de uma NF acontece antes ou depois do
 * prazo do Simples Nacional). Mesma lógica do backend
 * (backend/src/utils/validacao.ts) — mantida em espelho aqui para permitir
 * o app decidir localmente antes de confirmar com a usuária.
 */
export function dia20DoMesSubsequente(dataISO: string): string {
  const [ano, mes] = dataISO.split("-").map(Number);
  let anoSub = ano;
  let mesSub = mes + 1;
  if (mesSub > 12) {
    mesSub = 1;
    anoSub += 1;
  }
  return `${anoSub}-${String(mesSub).padStart(2, "0")}-20`;
}
