/**
 * npm run cadastrar-empresa -- <email do médico> <cnpj> [--im 123456] [--trib 040101] [--producao]
 *
 * Cadastra (ou atualiza) a empresa emissora do médico a partir do CNPJ:
 * razão social, endereço completo e opção pelo Simples vêm da BrasilAPI;
 * o código IBGE do município vem do ViaCEP. Mesma coisa do botão
 * "Buscar" da tela Minha Empresa, só que pelo terminal.
 *
 *   --im 1234567     Inscrição Municipal (só vai na nota em produção)
 *   --trib 040101   Código de tributação nacional (padrão: Medicina)
 *   --producao      Ambiente de produção (padrão: homologação)
 *
 * Não mexe no certificado já cadastrado nem na IM, se já existirem.
 */
import axios from "axios";
import { pool } from "../src/db";
import { descreverErro, soDigitos } from "./util-terminal";

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const email = args[0];
  const cnpj = soDigitos(args[1] ?? "");
  const im = opcao(args, "--im");
  const trib = opcao(args, "--trib") ?? "040101";
  const ambiente = args.includes("--producao") ? "producao" : "homologacao";

  if (!email || cnpj.length !== 14) {
    console.error("Uso: npm run cadastrar-empresa -- <email do médico> <cnpj> [--im 123] [--trib 040101] [--producao]");
    process.exit(1);
  }

  const u = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);
  if (u.rows.length === 0) {
    console.error(`Médico não encontrado: ${email}. Crie antes com: npm run criar-medico`);
    process.exit(1);
  }

  console.log(`Consultando o CNPJ ${cnpj}...`);
  const r = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { timeout: 15000 });
  const d = r.data;

  const cep = soDigitos(String(d.cep ?? ""));
  let ibge: string | null = null;
  if (cep.length === 8) {
    try {
      const v = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 8000 });
      if (!v.data?.erro && v.data?.ibge) ibge = String(v.data.ibge);
    } catch {
      /* cai no campo da BrasilAPI abaixo */
    }
  }
  if (!ibge && d.codigo_municipio_ibge) ibge = String(d.codigo_municipio_ibge);
  if (!ibge || !/^\d{7}$/.test(ibge)) {
    console.error("Não consegui descobrir o código IBGE do município. Cadastre pela tela Minha Empresa.");
    process.exit(1);
  }

  // 1 = não optante · 2 = MEI · 3 = ME/EPP do Simples
  const opSimpNac = d.opcao_pelo_mei ? 2 : d.opcao_pelo_simples ? 3 : 1;
  const telefone = soDigitos(String(d.ddd_telefone_1 ?? "")) || null;
  const dataAbertura = typeof d.data_inicio_atividade === "string" ? d.data_inicio_atividade.slice(0, 10) : null;

  const res = await pool.query(
    `INSERT INTO empresas_emissoras (
       medico_id, cnpj, razao_social, inscricao_municipal, codigo_municipio_ibge,
       cep, logradouro, numero, complemento, bairro, telefone, email,
       op_simp_nac, reg_ap_trib_sn, codigo_trib_nac, codigo_nbs, ambiente, data_abertura
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,'123012200',$15,$16)
     ON CONFLICT (medico_id) DO UPDATE SET
       cnpj = EXCLUDED.cnpj,
       razao_social = EXCLUDED.razao_social,
       inscricao_municipal = COALESCE(EXCLUDED.inscricao_municipal, empresas_emissoras.inscricao_municipal),
       codigo_municipio_ibge = EXCLUDED.codigo_municipio_ibge,
       cep = EXCLUDED.cep, logradouro = EXCLUDED.logradouro, numero = EXCLUDED.numero,
       complemento = EXCLUDED.complemento, bairro = EXCLUDED.bairro,
       telefone = EXCLUDED.telefone, email = EXCLUDED.email,
       op_simp_nac = EXCLUDED.op_simp_nac, codigo_trib_nac = EXCLUDED.codigo_trib_nac,
       ambiente = EXCLUDED.ambiente, data_abertura = EXCLUDED.data_abertura,
       updated_at = now()
     RETURNING razao_social, codigo_municipio_ibge`,
    [
      u.rows[0].id,
      cnpj,
      String(d.razao_social).slice(0, 200),
      im ?? null,
      ibge,
      cep,
      String(d.logradouro ?? "").slice(0, 200),
      String(d.numero ?? "S/N").slice(0, 20),
      d.complemento ? String(d.complemento).slice(0, 100) : null,
      String(d.bairro ?? "").slice(0, 100),
      telefone?.slice(0, 20) ?? null,
      d.email ? String(d.email).toLowerCase().slice(0, 150) : null,
      opSimpNac,
      trib,
      ambiente,
      dataAbertura,
    ]
  );

  const e = res.rows[0];
  console.log(`✔ Empresa cadastrada: ${e.razao_social} — ${d.municipio}/${d.uf} (IBGE ${e.codigo_municipio_ibge}) — ${ambiente}`);
  console.log(`  Simples: ${["", "não optante", "MEI", "ME/EPP (Simples Nacional)"][opSimpNac]} · tributação ${trib}`);
  if (!im) console.log("  Sem Inscrição Municipal ainda (só é necessária em produção; informe com --im quando tiver).");
  console.log("  Confira o CNAE: o padrão é 040101 (Medicina); use --trib se o serviço for outro.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(`✘ Erro: ${descreverErro(err)}`);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
