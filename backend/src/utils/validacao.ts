// backend/src/utils/validacao.ts
//
// Validação de data e horário no backend. Mesmo que o app mobile já
// valide antes de enviar, o backend precisa validar de novo — nunca
// confiar só no frontend, e principalmente: nunca deixar um dado ruim
// chegar cru no Postgres (foi isso que derrubou o processo antes).

/**
 * Espera exatamente o formato "AAAA-MM-DD" (o que o app mobile já envia).
 * Retorna uma mensagem de erro em português, ou null se estiver válido.
 */
export function validarData(data: unknown): string | null {
  if (typeof data !== "string") {
    return "Campo 'data' deve ser um texto no formato AAAA-MM-DD.";
  }

  const match = data.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "Campo 'data' deve estar no formato AAAA-MM-DD.";
  }

  const ano = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  const dia = parseInt(match[3], 10);

  if (mes < 1 || mes > 12) {
    return "Esse mês não existe (use 01 a 12).";
  }

  const diasNoMes = new Date(ano, mes, 0).getDate();
  if (dia < 1 || dia > diasNoMes) {
    return `Esse dia não existe nesse mês (o máximo é ${diasNoMes}).`;
  }

  return null;
}

/**
 * Espera exatamente o formato "HH:MM" (o que o app mobile já envia).
 * Retorna uma mensagem de erro em português, ou null se estiver válido.
 */
export function validarHorario(horario: unknown): string | null {
  if (typeof horario !== "string") {
    return "Campo 'horario' deve ser um texto no formato HH:MM.";
  }

  const match = horario.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return "Campo 'horario' deve estar no formato HH:MM.";
  }

  const hora = parseInt(match[1], 10);
  const minuto = parseInt(match[2], 10);

  if (hora < 0 || hora > 23) {
    return "Essa hora não existe (use 00 a 23).";
  }

  if (minuto < 0 || minuto > 59) {
    return "Esses minutos não existem (use 00 a 59).";
  }

  return null;
}

/** Data de hoje no formato "AAAA-MM-DD", no fuso horário do servidor. */
export function dataHojeISO(): string {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/**
 * Compara uma data "AAAA-MM-DD" com a data de hoje. Funciona por
 * comparação de texto (válido porque o formato AAAA-MM-DD ordena
 * igual cronologicamente).
 */
export function isDataFuturaOuHoje(data: string): boolean {
  return data >= dataHojeISO();
}

/** Número de dias corridos entre duas datas "AAAA-MM-DD" (fim - início). */
export function diasEntreDatas(dataInicioISO: string, dataFimISO: string): number {
  const inicio = new Date(dataInicioISO + "T00:00:00Z");
  const fim = new Date(dataFimISO + "T00:00:00Z");
  const diffMs = fim.getTime() - inicio.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Dia 20 do mês seguinte ao mês/ano de uma data de referência (usado para
 * saber se o cancelamento de uma NF acontece antes ou depois do prazo do
 * Simples Nacional).
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
