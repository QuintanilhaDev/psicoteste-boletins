// Consultas públicas que poupam digitação: Receita Federal (via BrasilAPI) e CEP (via ViaCEP).
// Se falharem, o app segue normalmente e o campo fica para preencher à mão.
import { Cliente } from '../core/model';
import { digits, juntarEmails, listaEmails } from '../core/text';

const tx = (v: unknown) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

async function pegar(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, unknown>;
    return j && typeof j === 'object' && !j.erro ? j : null;
  } catch {
    return null;
  }
}
export const buscarCnpj = (cnpj: string) => pegar(`https://brasilapi.com.br/api/cnpj/v1/${digits(cnpj)}`);
export const buscarCep = (cep: string) => pegar(`https://viacep.com.br/ws/${digits(cep)}/json/`);

/** preenche só o que está vazio; o nome oficial passa a valer e o da planilha vira apelido */
export function aplicarCnpj(x: Cliente, d: Record<string, unknown>) {
  const en = x.endereco;
  if (!en.logradouro) en.logradouro = [tx(d.descricao_tipo_de_logradouro), tx(d.logradouro)].filter(Boolean).join(' ');
  if (!en.numero) en.numero = tx(d.numero) || 'S/N';
  if (!en.complemento) en.complemento = tx(d.complemento);
  if (!en.bairro) en.bairro = tx(d.bairro);
  if (!en.cidade) en.cidade = tx(d.municipio);
  if (!en.uf) en.uf = tx(d.uf).toUpperCase().slice(0, 2);
  if (!en.cep) en.cep = digits(d.cep);
  if (!en.codMunicipio) en.codMunicipio = digits(d.codigo_municipio_ibge);
  if (!listaEmails(x.email).length && listaEmails(d.email).length) x.email = juntarEmails(listaEmails(d.email));
  if (!x.telefone) x.telefone = digits(d.ddd_telefone_1).slice(0, 11);
  const razao = tx(d.razao_social);
  if (razao && razao.toLowerCase() !== x.nome.toLowerCase()) {
    if (!x.naoIdentificado && x.nome && !x.apelidos.includes(x.nome)) x.apelidos.push(x.nome);
    x.nome = razao;
    x.naoIdentificado = false;
  }
}
export function aplicarCep(x: Cliente, d: Record<string, unknown>) {
  const en = x.endereco;
  en.logradouro = en.logradouro || tx(d.logradouro);
  en.bairro = en.bairro || tx(d.bairro);
  en.cidade = tx(d.localidade) || en.cidade;
  en.uf = tx(d.uf) || en.uf;
  en.codMunicipio = digits(d.ibge) || en.codMunicipio;
}
