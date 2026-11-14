// mobile/src/utils/moeda.ts
//
// Máscara de dinheiro estilo "caixa eletrônico": a pessoa digita só
// números, e o valor vai sendo preenchido da direita pra esquerda,
// sempre com duas casas decimais depois da vírgula.
// Ex: digitar 1, 5, 0, 0, 0 vira 0,01 -> 0,15 -> 1,50 -> 15,00 -> 150,00

/**
 * Recebe o texto atual do campo (pode já conter vírgula/pontos da
 * formatação anterior) e devolve o texto já formatado no padrão
 * brasileiro (ex: "1.200,00"). Se não houver nenhum dígito, devolve
 * string vazia (campo "não preenchido").
 */
export function aplicarMascaraMoeda(textoDigitado: string): string {
  const digitos = textoDigitado.replace(/\D/g, "");
  if (!digitos) {
    return "";
  }
  const numeroCentavos = parseInt(digitos, 10);
  const valorEmReais = numeroCentavos / 100;
  return valorEmReais.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte um texto já formatado (ex: "1.200,00") de volta para um
 * número puro (ex: 1200.00), para enviar à API.
 */
export function moedaParaNumero(textoFormatado: string): number {
  const limpo = textoFormatado.replace(/\./g, "").replace(",", ".");
  const numero = Number(limpo);
  return Number.isNaN(numero) ? 0 : numero;
}
