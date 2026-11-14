/**
 * backend/src/nfse/dps.ts
 *
 * Monta o XML da DPS (Declaração de Prestação de Serviço) no layout do
 * padrão nacional da NFS-e.
 *
 * Estrutura calibrada e validada contra uma NFS-e REAL, emitida em
 * 08/09/2026 pelo Emissor Nacional de verdade (não é mais
 * baseada só no exemplo de referência de 2022 do governo — esse exemplo
 * real mostrou que alguns campos mudaram desde então, ex: a estrutura de
 * "totTrib" ficou mais simples).
 *
 * ⚠️ Ainda faltam 2 coisas antes de emitir de verdade (ver lista no
 * final do arquivo): controle de numeração sequencial da DPS, e a
 * assinatura digital do XML (XMLDSig).
 */

export interface DadosPrestador {
  /** CNPJ sem pontuação (14 dígitos). */
  cnpj: string;
  /** Opcional — alguns municípios (em alguns municípios, no cadastro atual da
   * empresa) rejeitam a DPS se a IM for enviada, porque o CNC não tem
   * informações complementares registradas pra esse
   * prestador+município (erro E0120). Nesse caso, omitir o campo. */
  inscricaoMunicipal?: string;
  telefone?: string;
  email?: string;
  /**
   * 1 = Não optante, 2 = MEI, 3 = ME/EPP do Simples Nacional.
   * Para uma empresa real (ME optante pelo Simples), o valor confirmado é 3.
   */
  opSimpNac: 1 | 2 | 3;
  /** Regime de apuração do Simples Nacional. 1 = confirmado em nota
   * real de uma empresa real (regime normal). */
  regApTribSN: number;
}

export interface DadosTomador {
  /** Informe cnpj OU cpf (nunca os dois) — depende se o tomador é
   * pessoa jurídica ou física. */
  cnpj?: string;
  cpf?: string;
  /** Inscrição Municipal do tomador, se ele tiver (opcional — só
   * aparece quando o tomador tem cadastro na mesma prefeitura). */
  inscricaoMunicipal?: string;
  razaoSocial: string;
  /** Código IBGE do município (7 dígitos) do endereço do tomador.
   * TODO: hoje o cadastro de tomador do app só guarda um endereço em
   * texto livre (vindo da BrasilAPI) — precisa passar a guardar também
   * o código IBGE do município separadamente pra isso funcionar. */
  codigoMunicipioIbge: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  telefone?: string;
  email?: string;
}

export interface DadosServico {
  descricao: string;
  valor: number;
  /** Código de tributação nacional (6 dígitos). Confirmado para
   * "Contabilidade" = "171901". Para "Medicina e biomedicina" (uso
   * futuro com o certificado do um certificado real) ainda precisa ser confirmado. */
  codigoTribNac: string;
  /** Código NBS (Nomenclatura Brasileira de Serviços) — opcional, mas
   * presente nas notas reais de uma empresa real (ex: "113022100" para contabilidade). */
  codigoNbs?: string;
  /** Informação complementar livre (ex: referência/vencimento). */
  informacaoComplementar?: string;
}

export interface DadosDps {
  ambiente: "homologacao" | "producao";
  /** Data/hora de emissão, formato ISO com timezone (ex:
   * "2026-09-08T00:00:00-03:00"). */
  dataHoraEmissao: string;
  serie: string;
  /** Número sequencial da DPS — precisa ser único e crescente por
   * série, controlado pelo próprio sistema (ver pendências no final). */
  numeroDps: string;
  /** Data de competência do serviço, formato "AAAA-MM-DD". */
  dataCompetencia: string;
  /** Código IBGE do município (7 dígitos) de onde o serviço foi
   * emitido. Código IBGE do município de emissão. */
  codigoMunicipioEmissao: string;
  /**
   * Percentual aproximado de tributos, específico do Simples Nacional
   * (campo `pTotTribSN`) — obrigatório pra ME/EPP (o indicador genérico
   * `indTotTrib` é proibido nesse caso, confirmado em teste real contra
   * o governo, erro E0712). Valor de teste usado por enquanto: 6.00
   * (6%) — PRECISA ser substituído pela alíquota efetiva real calculada
   * conforme a faixa de faturamento (RBT12) e o anexo do Simples
   * Nacional da empresa antes de qualquer emissão de verdade.
   */
  percentualAproxTributosSN: number;
  prestador: DadosPrestador;
  tomador: DadosTomador;
  servico: DadosServico;
}

/**
 * Monta o identificador (Id) da DPS — 45 caracteres, formados por:
 * "DPS" + cLocEmi(7) + tipoInscricao(1) + inscricaoFederal(14) +
 * serie(5) + numeroDps(15). Validado contra o Id real de uma DPS de uma empresa real:
 * "DPS<IBGE><tipoInsc><CNPJ><serie><nDPS>".
 */
function montarIdDps(dados: DadosDps): string {
  const cLocEmi = dados.codigoMunicipioEmissao.padStart(7, "0");
  const tipoInscricao = "2"; // 2 = CNPJ
  const inscricaoFederal = dados.prestador.cnpj.padStart(14, "0");
  const serie = dados.serie.padStart(5, "0");
  const numeroDps = dados.numeroDps.padStart(15, "0");

  return `DPS${cLocEmi}${tipoInscricao}${inscricaoFederal}${serie}${numeroDps}`;
}

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Só inclui a tag se o valor existir — evita gerar tags vazias. */
function tagOpcional(nomeTag: string, valor: string | undefined): string {
  if (!valor) return "";
  return `<${nomeTag}>${escaparXml(valor)}</${nomeTag}>`;
}

/**
 * Devolve a data/hora atual no formato exigido pelo governo pro campo
 * `dhEmi` (ex: "2026-09-13T17:13:03-03:00") — sem milissegundos e com uma
 * margem de segurança de 5 minutos no passado para evitar rejeição
 * por diferença de relógio com o servidor do governo (Erro E0008).
 */
export function dataHoraAtualBrasilia(): string {
  const agoraUtc = new Date();
  // Subtrai 3h do fuso + 5 minutos de margem de segurança
  const comMargem = new Date(agoraUtc.getTime() - (3 * 60 * 60 * 1000) - (5 * 60 * 1000));
  return comMargem.toISOString().split(".")[0] + "-03:00";
}

/**
 * Monta o XML completo da DPS (ainda sem assinatura digital — isso é a
 * próxima etapa).
 */
export function montarDpsXml(dados: DadosDps): string {
  const id = montarIdDps(dados);
  const tpAmb = dados.ambiente === "producao" ? "1" : "2";
  const serieFormatada = dados.serie.padStart(5, "0");

  const enderecoTomador = `
      <end>
        <endNac>
          <cMun>${dados.tomador.codigoMunicipioIbge}</cMun>
          <CEP>${dados.tomador.cep}</CEP>
        </endNac>
        <xLgr>${escaparXml(dados.tomador.logradouro)}</xLgr>
        <nro>${escaparXml(dados.tomador.numero)}</nro>
        ${tagOpcional("xCpl", dados.tomador.complemento)}
        <xBairro>${escaparXml(dados.tomador.bairro)}</xBairro>
      </end>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<DPS versao="1.00" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infDPS Id="${id}">
    <tpAmb>${tpAmb}</tpAmb>
    <dhEmi>${dados.dataHoraEmissao}</dhEmi>
    <verAplic>MedFiscal_0.1.0</verAplic>
    <serie>${serieFormatada}</serie>
    <nDPS>${dados.numeroDps}</nDPS>
    <dCompet>${dados.dataCompetencia}</dCompet>
    <tpEmit>1</tpEmit>
    ${
      /* Homologação (produção restrita) usa desde 20/10/2026 o leiaute da
       * NT 009, que exige finNFSe (0 = NFS-e regular) entre tpEmit e
       * cLocEmi — sem ele, erro E1235. A produção segue no leiaute de
       * 09/02/2026, que não tem esse campo; quando a NT 009 chegar lá,
       * tirar esta condição. */
      dados.ambiente === "producao" ? "" : "<finNFSe>0</finNFSe>"
    }
    <cLocEmi>${dados.codigoMunicipioEmissao}</cLocEmi>
    <prest>
      <CNPJ>${dados.prestador.cnpj}</CNPJ>
      ${
        /* A IM do prestador só é enviada em Produção. Em Homologação,
         * confirmamos empiricamente (com 2 municípios diferentes —
         * dois municípios diferentes) que o CNC de teste do governo
         * não tem a informação complementar registrada, e a DPS é
         * rejeitada com o erro E0120 se a IM for enviada. Pode não ser
         * uma regra universal pra todo município, mas foi o padrão
         * observado até agora — revisar se aparecer um caso diferente. */
        dados.ambiente === "producao"
          ? tagOpcional("IM", dados.prestador.inscricaoMunicipal)
          : ""
      }
      ${tagOpcional("fone", dados.prestador.telefone)}
      ${tagOpcional("email", dados.prestador.email)}
      <regTrib>
        <opSimpNac>${dados.prestador.opSimpNac}</opSimpNac>
        ${
          /* regApTribSN só existe pra ME/EPP optante do Simples (opSimpNac 3). */
          Number(dados.prestador.opSimpNac) === 3
            ? `<regApTribSN>${dados.prestador.regApTribSN}</regApTribSN>`
            : ""
        }
        <regEspTrib>0</regEspTrib>
      </regTrib>
    </prest>
    <toma>
      ${
        dados.tomador.cpf
          ? `<CPF>${dados.tomador.cpf}</CPF>`
          : `<CNPJ>${dados.tomador.cnpj}</CNPJ>`
      }
      ${tagOpcional("IM", dados.tomador.inscricaoMunicipal)}
      <xNome>${escaparXml(dados.tomador.razaoSocial)}</xNome>${enderecoTomador}
      ${tagOpcional("fone", dados.tomador.telefone)}
      ${tagOpcional("email", dados.tomador.email)}
    </toma>
    <serv>
      <locPrest>
        <cLocPrestacao>${dados.codigoMunicipioEmissao}</cLocPrestacao>
      </locPrest>
      <cServ>
        <cTribNac>${dados.servico.codigoTribNac}</cTribNac>
        ${
          /* NT 009 (só homologação por enquanto, ver finNFSe acima):
           * cNBS vem ANTES de xDescServ. Na produção, depois. */
          dados.ambiente === "producao"
            ? `<xDescServ>${escaparXml(dados.servico.descricao)}</xDescServ>
        ${tagOpcional("cNBS", dados.servico.codigoNbs)}`
            : `${tagOpcional("cNBS", dados.servico.codigoNbs)}
        <xDescServ>${escaparXml(dados.servico.descricao)}</xDescServ>`
        }
      </cServ>
      ${
        dados.servico.informacaoComplementar
          ? `<infoCompl><xInfComp>${escaparXml(
              dados.servico.informacaoComplementar
            )}</xInfComp></infoCompl>`
          : ""
      }
    </serv>
    <valores>
      <vServPrest>
        <vServ>${dados.servico.valor.toFixed(2)}</vServ>
      </vServPrest>
      <trib>
        <tribMun>
          <tribISSQN>1</tribISSQN>
          <tpRetISSQN>1</tpRetISSQN>
        </tribMun>
        ${
          /* ME/EPP do Simples: percentual aproximado do Simples (pTotTribSN)
           * — o indicador genérico é proibido pra ME/EPP (erro E0712).
           * Demais (MEI / não optante): indicador "não informar" (0). */
          Number(dados.prestador.opSimpNac) === 3
            ? `<totTrib><pTotTribSN>${dados.percentualAproxTributosSN.toFixed(2)}</pTotTribSN></totTrib>`
            : `<totTrib><indTotTrib>0</indTotTrib></totTrib>`
        }
      </trib>
    </valores>
  </infDPS>
</DPS>`;
}

/**
 * PENDÊNCIAS antes de testar a emissão de verdade:
 *
 * ✅ RESOLVIDO (2026-09-13): toda a estrutura do XML foi recalibrada e
 * validada contra uma NFS-e REAL emitida peluma empresa real em 08/09/2026 pelo
 * Emissor Nacional (não mais baseada só no exemplo de 2022). Isso
 * confirmou/corrigiu vários campos:
 * - IM de uma empresa real = "4798317", código do município = "5208707".
 * - cTribNac de contabilidade = "171901" (confirmado igual na nota real).
 * - A estrutura de "totTrib" mudou desde 2022: hoje é só
 *   `<indTotTrib>0</indTotTrib>`, não mais o detalhamento percentual
 *   fed/est/mun que o exemplo antigo mostrava.
 * - Campos novos incorporados: telefone/email do prestador e do
 *   tomador, regApTribSN, cNBS do serviço, informação complementar.
 *
 * O que ainda falta:
 * 1. Código IBGE do município de cada tomador (hospital) cadastrado no
 *    app — hoje o cadastro só guarda endereço em texto livre.
 * 2. Controle do número sequencial da DPS (nDPS) por série — precisa de
 *    um contador incremental salvo no banco, único por prestador (na
 *    nota real analisada, o nDPS estava em 180 — ou seja, a numeração
 *    já está avançada na conta real de uma empresa real; ao testar em Homologação,
 *    pode começar do 1, já que homologação e produção não compartilham
 *    numeração).
 * 3. Assinatura digital do XML (XMLDSig) — ainda não implementada, é a
 *    próxima fase.
 * 4. Código de tributação nacional (cTribNac) para "Medicina e
 *    biomedicina" — ainda não confirmado, necessário só quando for
 *    testar com o certificado do um certificado real / serviço médico de verdade.
 *
 * Valores de configuração de teste:
 * - (CNPJ e IM de uma empresa real removidos desta cópia pública)
 * - prestador.opSimpNac = 3
 * - prestador.regApTribSN = 1
 * - codigoMunicipioEmissao = "5208707"
 * - servico.codigoTribNac = "171901"
 * - servico.codigoNbs = "113022100"
 */
