/** Erro esperado (dados faltando/errados, configuração incompleta) — o
 * chamador decide o status HTTP certo (normalmente 400), em vez de virar
 * um 500 genérico. A mensagem é pensada pra ser mostrada à usuária. */
export class ErroEmissaoNfse extends Error {}
