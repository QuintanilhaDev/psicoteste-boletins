// Modelo de dados e regras de negócio (puro, testável em Node).

import { Leitura } from './reader';
import {
  competenciaLabel, digits, empresaKey, isCNPJ, isCPF, juntarEmails, listaEmails, norm, round2, semelhancaNucleo, similaridade, uid, brl,
} from './text';

export interface Endereco {
  logradouro: string; numero: string; complemento: string; bairro: string;
  cidade: string; codMunicipio: string; uf: string; cep: string;
}
export interface Cliente {
  id: string; nome: string; apelidos: string[]; cnpj: string; email: string; telefone: string;
  endereco: Endereco; preco: number | null;
  /** id de um cliente já cadastrado com nome parecido: espera confirmação antes de faturar */
  parecidoCom?: string;
  /** a planilha não dizia de qual empresa era */
  naoIdentificado?: boolean;
  criadoEm: string;
}
export interface Pessoa { nome: string; cpf: string; cpfValido: boolean; data: string | null }
export interface Nota {
  status: 'pendente' | 'emitindo' | 'emitida' | 'erro';
  origem?: 'automatica' | 'manual';
  rps?: number; serie?: string; protocolo?: string;
  numero?: string; codigo?: string; emitidaEm?: string; xml?: string; ambiente?: string;
  /** valor que a prefeitura registrou na nota (para conferir com o boletim) */
  valor?: number;
  erro?: string; tentativas: number;
  anexo?: { nome: string; base64: string; tipo: string };
}
export interface Envio {
  /** dispensado = você decidiu não mandar por aqui */
  status: 'pendente' | 'enviado' | 'erro' | 'dispensado';
  /** liberado por você na tela de conferência; sem isso nenhum e-mail sai */
  aprovado?: boolean;
  para?: string; em?: string; erro?: string; tentativas: number;
}
export interface Boletim {
  id: string; numero: number; clienteId: string; competencia: string;
  pessoas: Pessoa[]; quantidade: number; precoUnit: number; total: number;
  importacaoId: string; arquivo: string; criadoEm: string;
  nota: Nota; email: Envio;
  recebido: boolean; recebidoEm?: string;
  baixado: { boletim: boolean; nota: boolean };
  observacoes: string[];
  /** vigilantes que parecem já cobrados em outro mês (planilha sem datas): espera decisão */
  duvida?: { cpfs: string[]; texto: string };
}
export interface Importacao {
  id: string; arquivo: string; hash: string; em: string;
  linhas: number; novos: number; repetidos: number; avisos: string[]; boletimIds: string[];
  /** linhas da mesma pessoa repetidas dentro da própria planilha (contadas uma vez só) */
  repetidosNoArquivo?: number;
  repetida?: boolean;
}
export interface Config {
  prestador: { razao: string; cnpj: string; im: string; email: string; telefone: string; cidade: string };
  fiscal: {
    itemLista: string; cnae: string; codTributacao: string; aliquota: number; // % (ex.: 5)
    simples: boolean; regime: string; natureza: string; issRetido: boolean; incentivador: boolean;
    nbs: string; cClassTrib: string; indop: string; serie: string; proximoRps: number; codMunicipio: string;
  };
  precoPadrao: number;
  emitirAutomatico: boolean;
  discriminacao: string;
}
export interface Estado {
  v: 1;
  clientes: Cliente[]; boletins: Boletim[]; importacoes: Importacao[];
  config: Config; seqBoletim: number; atualizadoEm: string;
}

export const enderecoVazio = (): Endereco => ({
  logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', codMunicipio: '', uf: '', cep: '',
});

export const estadoInicial = (): Estado => ({
  v: 1,
  clientes: [], boletins: [], importacoes: [],
  seqBoletim: 1,
  atualizadoEm: new Date(0).toISOString(),
  config: {
    prestador: { razao: '', cnpj: '', im: '', email: '', telefone: '', cidade: 'Salvador' },
    fiscal: {
      itemLista: '0416', cnae: '', codTributacao: '', aliquota: 5,
      simples: false, regime: '', natureza: '1', issRetido: false, incentivador: false,
      nbs: '', cClassTrib: '', indop: '', serie: 'A', proximoRps: 1, codMunicipio: '2927408',
    },
    precoPadrao: 0,
    emitirAutomatico: true,
    discriminacao:
      'Avaliação psicológica (psicoteste) de {qtd} vigilante(s), competência {mes}. Boletim nº {boletim}. Valor unitário {preco}.',
  },
});

/** aceita estados antigos/incompletos sem quebrar */
export function normalizarEstado(raw: unknown): Estado {
  const base = estadoInicial();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Estado>;
  const cfg = (r.config ?? {}) as Partial<Config>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const est: Estado = {
    v: 1,
    clientes: arr<Cliente>(r.clientes).map((c) => ({
      ...c, apelidos: arr<string>(c.apelidos), endereco: { ...enderecoVazio(), ...(c.endereco ?? {}) },
      cnpj: c.cnpj ?? '', email: c.email ?? '', telefone: c.telefone ?? '', preco: c.preco ?? null,
    })),
    boletins: arr<Boletim>(r.boletins).map((b) => ({
      ...b,
      pessoas: arr<Pessoa>(b.pessoas),
      observacoes: arr<string>(b.observacoes),
      nota: { ...{ status: 'pendente' as const, tentativas: 0 }, ...(b.nota ?? {}) },
      email: { ...{ status: 'pendente' as const, tentativas: 0 }, ...(b.email ?? {}) },
      baixado: { boletim: !!b.baixado?.boletim, nota: !!b.baixado?.nota },
    })),
    importacoes: arr<Importacao>(r.importacoes),
    seqBoletim: Number(r.seqBoletim) > 0 ? Number(r.seqBoletim) : 1,
    atualizadoEm: typeof r.atualizadoEm === 'string' ? r.atualizadoEm : base.atualizadoEm,
    config: {
      ...base.config, ...cfg,
      prestador: { ...base.config.prestador, ...(cfg.prestador ?? {}) },
      fiscal: { ...base.config.fiscal, ...(cfg.fiscal ?? {}) },
    },
  };
  // boletins gerados antes da correção de repetidos: limpa os que ainda não viraram nota
  for (const b of est.boletins) {
    if (!b.pessoas.length) continue;
    const unicos = deduplicar(b.pessoas);
    if (unicos.length === b.pessoas.length) continue;
    const tirados = b.pessoas.length - unicos.length;
    if (b.nota.status === 'emitida' || b.nota.status === 'emitindo' || b.nota.protocolo) {
      const aviso = `Atenção: este boletim listava ${tirados} vigilante(s) em dobro e a nota já foi emitida com ${b.quantidade}. O correto seria ${unicos.length}; confira e, se preciso, substitua a nota no portal da prefeitura.`;
      if (!b.observacoes.includes(aviso)) b.observacoes.push(aviso);
      continue;
    }
    b.pessoas = unicos;
    b.quantidade = unicos.length;
    b.baixado = { ...b.baixado, boletim: false }; // baixa de novo o PDF já corrigido
    b.observacoes.push(`${tirados} nome(s) repetido(s) removido(s) na correção automática.`);
  }
  // uma emissão interrompida (aba fechada no meio) volta para a fila; o nº do RPS já reservado evita nota em dobro
  for (const b of est.boletins) if (b.nota.status === 'emitindo') b.nota.status = 'pendente';
  recalcular(est);
  const maior = est.boletins.reduce((m, b) => Math.max(m, b.numero || 0), 0);
  if (est.seqBoletim <= maior) est.seqBoletim = maior + 1;
  return est;
}

export const clienteDe = (e: Estado, b: Boletim) => e.clientes.find((c) => c.id === b.clienteId);
export const precoDe = (e: Estado, c?: Cliente) => (c?.preco != null && c.preco > 0 ? c.preco : e.config.precoPadrao);

function resolverCliente(e: Estado, nome: string, cnpj?: string): Cliente {
  if (cnpj) {
    const porCnpj = e.clientes.find((c) => c.cnpj && digits(c.cnpj) === cnpj);
    if (porCnpj) return porCnpj;
  }
  const key = empresaKey(nome);
  const exato = e.clientes.find((c) => !c.naoIdentificado && [c.nome, ...c.apelidos].some((n) => empresaKey(n) === key));
  // mesmo nome com CNPJ diferente = outra empresa (filiais contam como clientes separados)
  if (exato && !(cnpj && exato.cnpj && digits(exato.cnpj) !== cnpj)) return exato;
  let melhor: Cliente | undefined;
  let nota = 0;
  let parecido: Cliente | undefined;
  let notaNucleo = 0;
  for (const c of e.clientes) {
    if (c.naoIdentificado) continue;
    for (const n of [c.nome, ...c.apelidos]) {
      const s = similaridade(n, nome);
      const sn = semelhancaNucleo(n, nome);
      if (s > nota && sn >= 0.8) { nota = s; melhor = c; }
      if (sn > notaNucleo) { notaNucleo = sn; parecido = c; }
    }
  }
  const conflita = (c?: Cliente) => !!(cnpj && c?.cnpj && digits(c.cnpj) !== cnpj);
  // só junta sozinho quando é praticamente o mesmo texto (erro de digitação); na dúvida, pergunta
  if (melhor && nota >= 0.93 && !conflita(melhor)) {
    if (!melhor.apelidos.includes(nome)) melhor.apelidos.push(nome);
    return melhor;
  }
  const novo: Cliente = {
    id: uid(), nome, apelidos: [], cnpj: '', email: '', telefone: '', endereco: enderecoVazio(), preco: null,
    parecidoCom: parecido && notaNucleo >= 0.6 && !conflita(parecido) && !cnpj ? parecido.id : undefined,
    criadoEm: new Date().toISOString(),
  };
  e.clientes.push(novo);
  return novo;
}

/**
 * Quem é a mesma pessoa, dentro de um cliente e de um mês:
 * - mesmo CPF → mesma pessoa (mesmo com datas diferentes no mês);
 * - sem CPF numa das linhas → mesma pessoa se o nome (sem acento/maiúsculas) for igual;
 * - nomes iguais com CPFs diferentes → pessoas diferentes (homônimos).
 */
export class IndicePessoas {
  private porCpf = new Map<string, Pessoa>();
  private porNome = new Map<string, Pessoa[]>();
  private static nome(p: Pessoa) { const n = norm(p.nome); return n && !n.startsWith('sem nome') ? n : ''; }
  private static temCpf(p: Pessoa) { return digits(p.cpf).length === 11; }
  achar(escopo: string, p: Pessoa): Pessoa | undefined {
    if (IndicePessoas.temCpf(p)) {
      const x = this.porCpf.get(`${escopo}|${p.cpf}`);
      if (x) return x;
    }
    const n = IndicePessoas.nome(p);
    if (!n) return undefined;
    const mesmos = this.porNome.get(`${escopo}|${n}`) ?? [];
    return IndicePessoas.temCpf(p) ? mesmos.find((m) => !IndicePessoas.temCpf(m)) : mesmos[0];
  }
  guardar(escopo: string, p: Pessoa) {
    if (IndicePessoas.temCpf(p)) this.porCpf.set(`${escopo}|${p.cpf}`, p);
    const n = IndicePessoas.nome(p);
    if (n) { const k = `${escopo}|${n}`; this.porNome.set(k, [...(this.porNome.get(k) ?? []), p]); }
  }
  /** a linha nova traz o CPF que faltava na anterior: completa a pessoa já registrada */
  completar(escopo: string, existente: Pessoa, nova: Pessoa) {
    if (!IndicePessoas.temCpf(existente) && IndicePessoas.temCpf(nova)) {
      existente.cpf = nova.cpf;
      existente.cpfValido = nova.cpfValido;
      this.porCpf.set(`${escopo}|${nova.cpf}`, existente);
    }
    if ((!existente.nome || existente.nome.startsWith('(sem nome')) && nova.nome && !nova.nome.startsWith('(sem nome')) existente.nome = nova.nome;
    if (!existente.data && nova.data) existente.data = nova.data;
  }
}
const escopoDe = (clienteId: string, comp: string) => `${clienteId}|${comp}`;

/** remove repetidos de uma lista já montada (usado para corrigir boletins antigos) */
export function deduplicar(pessoas: Pessoa[]): Pessoa[] {
  const ind = new IndicePessoas();
  const out: Pessoa[] = [];
  for (const p0 of pessoas) {
    const p = { ...p0 };
    const ja = ind.achar('x', p);
    if (ja) ind.completar('x', ja, p);
    else { ind.guardar('x', p); out.push(p); }
  }
  return out;
}

function novoBoletim(e: Estado, c: Cliente, comp: string, imp: Importacao, agora: Date): Boletim {
  const b: Boletim = {
    id: uid(), numero: e.seqBoletim++, clienteId: c.id, competencia: comp,
    pessoas: [], quantidade: 0, precoUnit: 0, total: 0,
    importacaoId: imp.id, arquivo: imp.arquivo, criadoEm: agora.toISOString(),
    nota: { status: 'pendente', tentativas: 0 }, email: { status: 'pendente', tentativas: 0 },
    recebido: false, baixado: { boletim: false, nota: false }, observacoes: [],
  };
  e.boletins.push(b);
  imp.boletimIds.push(b.id);
  return b;
}

/** Transforma a leitura de um arquivo em boletins. Muta `e` (use uma cópia). */
export function importarLeitura(e: Estado, arquivo: string, hash: string, leitura: Leitura, agora = new Date()): Importacao {
  const imp: Importacao = {
    id: uid(), arquivo, hash, em: agora.toISOString(),
    linhas: leitura.registros.length + leitura.resumos.length, novos: 0, repetidos: 0,
    avisos: [...leitura.avisos], boletimIds: [],
  };
  const anterior = e.importacoes.find((i) => i.hash === hash && !i.repetida);
  if (anterior) {
    imp.repetida = true;
    imp.avisos.push(`Esta planilha já foi lançada em ${new Date(anterior.em).toLocaleDateString('pt-BR')} (${anterior.arquivo}). Nada foi faturado de novo.`);
    e.importacoes.unshift(imp);
    return imp;
  }
  const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const compPadrao = leitura.competenciaSugerida ?? mesAtual;
  if (!leitura.competenciaSugerida && leitura.registros.some((r) => !r.data) ) {
    imp.avisos.push(`A planilha não informa o mês; usei ${competenciaLabel(mesAtual, true)}.`);
  }

  const jaFaturadas = new IndicePessoas();
  for (const b of e.boletins) for (const p of b.pessoas) jaFaturadas.guardar(escopoDe(b.clienteId, b.competencia), p);
  const desteArquivo = new Set<Pessoa>();

  // quem já foi cobrado, por cliente+CPF, para desconfiar de planilha sem data reenviada em outro mês
  const cobrados = new Map<string, { numero: number; competencia: string; recente: boolean }>();
  for (const b of e.boletins) for (const p of b.pessoas) if (p.cpfValido) cobrados.set(`${b.clienteId}|${p.cpf}`, { numero: b.numero, competencia: b.competencia, recente: agora.getTime() - new Date(b.criadoEm).getTime() < 45 * 86400000 });
  const distMeses = (a: string, b: string) => Math.abs((Number(a.slice(0, 4)) - Number(b.slice(0, 4))) * 12 + Number(a.slice(5)) - Number(b.slice(5)));
  const suspeitos = new Map<string, { cpfs: string[]; ref: { numero: number; competencia: string } }>(); // por boletim novo

  const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dataMin = isoDia(new Date(agora.getFullYear(), agora.getMonth() - 18, 1));
  const dataMax = isoDia(new Date(agora.getFullYear(), agora.getMonth() + 1, agora.getDate()));
  let datasIgnoradas = 0;

  const semEmpresa = new Map<string, Cliente>();
  const grupos = new Map<string, Boletim>();
  const pegarBoletim = (c: Cliente, comp: string) => {
    const k = `${c.id}|${comp}`;
    let b = grupos.get(k);
    if (!b) { b = novoBoletim(e, c, comp, imp, agora); grupos.set(k, b); }
    return b;
  };
  const completar = (c: Cliente, cnpj?: string, email?: string) => {
    if (cnpj && !c.cnpj) c.cnpj = cnpj;
    if (email && !listaEmails(c.email).length) c.email = juntarEmails(listaEmails(email));
  };

  for (const r of leitura.registros) {
    let c: Cliente;
    if (r.empresaIdentificada) c = resolverCliente(e, r.empresa, r.cnpj);
    else {
      const k = r.aba;
      c = semEmpresa.get(k) ?? {
        id: uid(), nome: `Empresa não identificada (${arquivo})`, apelidos: [], cnpj: '', email: '', telefone: '',
        endereco: enderecoVazio(), preco: null, naoIdentificado: true, criadoEm: agora.toISOString(),
      };
      if (!semEmpresa.has(k)) { semEmpresa.set(k, c); e.clientes.push(c); }
    }
    completar(c, r.cnpj, r.email);
    // data fora da janela plausível (ex.: coluna de nascimento ou validade lida como data do exame) é desconsiderada
    const data = r.data && r.data >= dataMin && r.data <= dataMax ? r.data : null;
    if (r.data && !data) datasIgnoradas++;
    const comp = data ? data.slice(0, 7) : compPadrao;
    const pessoa: Pessoa = { nome: r.nome, cpf: r.cpf, cpfValido: r.cpfValido, data };
    const esc = escopoDe(c.id, comp);
    const ja = jaFaturadas.achar(esc, pessoa);
    if (ja) {
      // repetida na própria planilha: só completa os dados; já cobrada antes: não cobra de novo
      if (desteArquivo.has(ja)) { jaFaturadas.completar(esc, ja, pessoa); imp.repetidosNoArquivo = (imp.repetidosNoArquivo ?? 0) + 1; }
      else imp.repetidos++;
      continue;
    }
    jaFaturadas.guardar(esc, pessoa);
    desteArquivo.add(pessoa);
    const bol = pegarBoletim(c, comp);
    bol.pessoas.push(pessoa);
    imp.novos++;
    const antes = pessoa.cpfValido && !pessoa.data ? cobrados.get(`${c.id}|${pessoa.cpf}`) : undefined;
    if (antes && antes.competencia !== comp && (antes.recente || distMeses(antes.competencia, comp) <= 2)) {
      const sus = suspeitos.get(bol.id) ?? { cpfs: [], ref: antes };
      sus.cpfs.push(pessoa.cpf);
      suspeitos.set(bol.id, sus);
    }
  }
  for (const b of grupos.values()) {
    const sus = suspeitos.get(b.id);
    if (!sus) continue;
    const n = sus.cpfs.length;
    b.duvida = {
      cpfs: sus.cpfs,
      texto: `${n} vigilante${n > 1 ? 's' : ''} de ${arquivo} já ${n > 1 ? 'foram cobrados' : 'foi cobrado'} em ${competenciaLabel(sus.ref.competencia, true).toLowerCase()} (boletim ${String(sus.ref.numero).padStart(4, '0')}) e a planilha não traz datas.`,
    };
  }
  for (const r of leitura.resumos) {
    const c = resolverCliente(e, r.empresa, r.cnpj);
    completar(c, r.cnpj, r.email);
    const b = pegarBoletim(c, compPadrao);
    b.quantidade += r.quantidade;
    imp.novos += r.quantidade;
  }
  for (const b of grupos.values()) {
    if (b.pessoas.length) b.quantidade = b.pessoas.length;
    b.pessoas.sort((a, z) => a.nome.localeCompare(z.nome, 'pt-BR'));
    const invalidos = b.pessoas.filter((p) => !p.cpfValido).length;
    if (invalidos) b.observacoes.push(`${invalidos} CPF(s) ausente(s) ou com dígito inválido na planilha — contados normalmente.`);
  }
  if (datasIgnoradas) imp.avisos.push(`${datasIgnoradas} data(s) fora do período esperado foram desconsideradas; usei ${competenciaLabel(compPadrao, true)}.`);
  if (imp.repetidosNoArquivo) imp.avisos.push(`${imp.repetidosNoArquivo} linha(s) repetiam um vigilante já listado na mesma planilha; cada pessoa foi contada uma vez só.`);
  if (imp.repetidos) imp.avisos.push(`${imp.repetidos} vigilante(s) já estavam em boletins anteriores e não foram cobrados de novo.`);
  recalcular(e);
  e.importacoes.unshift(imp);
  return imp;
}

/** aplica o preço atual aos boletins que ainda não viraram nota */
export function recalcular(e: Estado) {
  for (const b of e.boletins) {
    if (b.nota.status === 'emitida' || b.nota.status === 'emitindo' || b.nota.protocolo) continue;
    b.precoUnit = precoDe(e, clienteDe(e, b));
    b.total = round2(b.quantidade * b.precoUnit);
  }
}

export function enderecoCompleto(en: Endereco) {
  return !!(en.logradouro.trim() && en.numero.trim() && en.bairro.trim() && digits(en.cep).length === 8 &&
    en.uf.trim().length === 2 && digits(en.codMunicipio).length === 7);
}

export function faltasDoCliente(c: Cliente): string[] {
  const f: string[] = [];
  if (!isCNPJ(c.cnpj) && !isCPF(c.cnpj)) f.push('CNPJ');
  if (!listaEmails(c.email).length) f.push('e-mail');
  if (!enderecoCompleto(c.endereco)) f.push('endereço');
  return f;
}

export function faltasDoPrestador(cfg: Config): string[] {
  const f: string[] = [];
  if (!cfg.prestador.razao.trim()) f.push('nome da clínica');
  if (!isCNPJ(cfg.prestador.cnpj)) f.push('CNPJ da clínica');
  if (digits(cfg.prestador.im).length < 3) f.push('inscrição municipal');
  if (digits(cfg.fiscal.itemLista).length < 3) f.push('item da lista de serviços');
  if (digits(cfg.fiscal.cnae).length < 7) f.push('CNAE');
  return f;
}

export interface Pendencia { tipo: 'cliente' | 'parecido' | 'identificar' | 'repetidos' | 'preco' | 'clinica'; texto: string }

/** O que impede a emissão automática da nota deste boletim (lista vazia = pode emitir). */
export function pendencias(e: Estado, b: Boletim): Pendencia[] {
  const c = clienteDe(e, b);
  const p: Pendencia[] = [];
  if (!c) return [{ tipo: 'cliente', texto: 'Cliente removido.' }];
  if (c.naoIdentificado) p.push({ tipo: 'identificar', texto: 'A planilha não diz de qual empresa é. Diga qual é o cliente.' });
  else if (c.parecidoCom && e.clientes.some((x) => x.id === c.parecidoCom)) {
    const outro = e.clientes.find((x) => x.id === c.parecidoCom)!;
    p.push({ tipo: 'parecido', texto: `"${c.nome}" é o mesmo cliente que "${outro.nome}"?` });
  } else {
    const f = faltasDoCliente(c);
    if (f.length) p.push({ tipo: 'cliente', texto: `Falta ${f.join(', ')} de ${c.nome}.` });
  }
  if (b.duvida) p.push({ tipo: 'repetidos', texto: b.duvida.texto });
  if (!(b.precoUnit > 0) || !(b.total > 0)) p.push({ tipo: 'preco', texto: 'Falta o preço do psicoteste.' });
  const fp = faltasDoPrestador(e.config);
  if (fp.length) p.push({ tipo: 'clinica', texto: `Falta ${fp.join(', ')} nos ajustes.` });
  return p;
}

export function juntarClientes(e: Estado, origemId: string, destinoId: string) {
  if (origemId === destinoId) return;
  const o = e.clientes.find((c) => c.id === origemId);
  const d = e.clientes.find((c) => c.id === destinoId);
  if (!o || !d) return;
  if (!o.naoIdentificado) for (const n of [o.nome, ...o.apelidos]) if (!d.apelidos.includes(n) && n !== d.nome) d.apelidos.push(n);
  if (!d.cnpj) d.cnpj = o.cnpj;
  d.email = juntarEmails([...listaEmails(d.email), ...listaEmails(o.email)]);
  if (!d.telefone) d.telefone = o.telefone;
  if (!enderecoCompleto(d.endereco) && enderecoCompleto(o.endereco)) d.endereco = o.endereco;
  // quem já está num boletim do cliente de destino não é cobrado de novo
  const ja = new IndicePessoas();
  for (const b of e.boletins) if (b.clienteId === destinoId) for (const p of b.pessoas) ja.guardar(escopoDe(destinoId, b.competencia), p);
  const vazios = new Set<string>();
  for (const b of e.boletins) {
    if (b.clienteId !== origemId) continue;
    b.clienteId = destinoId;
    if (b.nota.status === 'emitida' || b.nota.status === 'emitindo' || b.nota.protocolo || !b.pessoas.length) continue;
    const antes = b.pessoas.length;
    const esc = escopoDe(destinoId, b.competencia);
    b.pessoas = b.pessoas.filter((p) => { if (ja.achar(esc, p)) return false; ja.guardar(esc, p); return true; });
    if (b.pessoas.length !== antes) {
      b.quantidade = b.pessoas.length;
      b.observacoes.push(`${antes - b.pessoas.length} vigilante(s) já constavam em outro boletim deste cliente e foram retirados.`);
      if (!b.pessoas.length) vazios.add(b.id);
    }
  }
  if (vazios.size) {
    e.boletins = e.boletins.filter((b) => !vazios.has(b.id));
    for (const i of e.importacoes) i.boletimIds = i.boletimIds.filter((x) => !vazios.has(x));
  }
  for (const c of e.clientes) if (c.parecidoCom === origemId) c.parecidoCom = undefined;
  e.clientes = e.clientes.filter((c) => c.id !== origemId);
  recalcular(e);
}

export function discriminacao(e: Estado, b: Boletim): string {
  return e.config.discriminacao
    .replace(/\{qtd\}/g, String(b.quantidade))
    .replace(/\{mes\}/g, competenciaLabel(b.competencia, true).toLowerCase())
    .replace(/\{boletim\}/g, String(b.numero).padStart(4, '0'))
    .replace(/\{preco\}/g, brl(b.precoUnit))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1900);
}

export interface Linha { chave: string; rotulo: string; testes: number; faturado: number; comNota: number; recebido: number; aberto: number; semNota: number }

function somar(l: Linha, b: Boletim) {
  l.testes += b.quantidade;
  l.faturado = round2(l.faturado + b.total);
  if (b.recebido) l.recebido = round2(l.recebido + b.total);
  if (b.nota.status === 'emitida') {
    l.comNota = round2(l.comNota + b.total);
    if (!b.recebido) l.aberto = round2(l.aberto + b.total);
  } else if (!b.recebido) l.semNota = round2(l.semNota + b.total);
}
const linha = (chave: string, rotulo: string): Linha => ({ chave, rotulo, testes: 0, faturado: 0, comNota: 0, recebido: 0, aberto: 0, semNota: 0 });

export function porMes(e: Estado, clienteId?: string): Linha[] {
  const m = new Map<string, Linha>();
  for (const b of e.boletins) {
    if (clienteId && b.clienteId !== clienteId) continue;
    if (!m.has(b.competencia)) m.set(b.competencia, linha(b.competencia, competenciaLabel(b.competencia)));
    somar(m.get(b.competencia)!, b);
  }
  return [...m.values()].sort((a, b) => a.chave.localeCompare(b.chave));
}

export function porCliente(e: Estado, competencia?: string): Linha[] {
  const m = new Map<string, Linha>();
  for (const b of e.boletins) {
    if (competencia && b.competencia !== competencia) continue;
    if (!m.has(b.clienteId)) m.set(b.clienteId, linha(b.clienteId, clienteDe(e, b)?.nome ?? 'Cliente removido'));
    somar(m.get(b.clienteId)!, b);
  }
  return [...m.values()].sort((a, b) => b.testes - a.testes || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

export function totais(e: Estado, competencia?: string): Linha {
  const t = linha('total', 'Total');
  for (const b of e.boletins) if (!competencia || b.competencia === competencia) somar(t, b);
  return t;
}

/** resolve a dúvida de repetidos: cobra todos, ou retira os que já estavam em outro boletim */
export function resolverRepetidos(e: Estado, boletimId: string, cobrar: boolean) {
  const b = e.boletins.find((x) => x.id === boletimId);
  if (!b?.duvida) return;
  if (!cobrar) {
    const fora = new Set(b.duvida.cpfs);
    const n = b.pessoas.length;
    b.pessoas = b.pessoas.filter((p) => !fora.has(p.cpf));
    b.quantidade = b.pessoas.length;
    b.observacoes.push(`${n - b.pessoas.length} vigilante(s) repetido(s) retirado(s) a seu pedido.`);
  }
  b.duvida = undefined;
  if (!b.pessoas.length && !cobrar) {
    e.boletins = e.boletins.filter((x) => x.id !== boletimId);
    for (const i of e.importacoes) i.boletimIds = i.boletimIds.filter((x) => x !== boletimId);
  }
  recalcular(e);
}

export interface Verificacao { tipo: 'ok' | 'aviso' | 'erro'; texto: string }

/** Tudo o que é conferido antes de um e-mail sair. Um "erro" impede o envio. */
export function verificacoes(e: Estado, b: Boletim): Verificacao[] {
  const v: Verificacao[] = [];
  const c = clienteDe(e, b);
  if (b.pessoas.length) {
    const unicos = deduplicar(b.pessoas).length;
    if (unicos !== b.pessoas.length) v.push({ tipo: 'erro', texto: `${b.pessoas.length - unicos} nome(s) repetido(s) na lista de vigilantes.` });
    else if (b.quantidade !== b.pessoas.length) v.push({ tipo: 'erro', texto: `Quantidade (${b.quantidade}) diferente da lista (${b.pessoas.length} nomes).` });
    else v.push({ tipo: 'ok', texto: `${b.quantidade} vigilante${b.quantidade === 1 ? '' : 's'}, sem nomes repetidos.` });
  } else v.push({ tipo: 'aviso', texto: `${b.quantidade} psicotestes informados em planilha-resumo, sem lista de nomes.` });
  if (!(b.total > 0)) v.push({ tipo: 'erro', texto: 'Boletim sem valor.' });
  else if (Math.abs(round2(b.quantidade * b.precoUnit) - b.total) > 0.009) v.push({ tipo: 'erro', texto: `A conta não fecha: ${b.quantidade} × ${brl(b.precoUnit)} não dá ${brl(b.total)}.` });
  else v.push({ tipo: 'ok', texto: `${b.quantidade} × ${brl(b.precoUnit)} = ${brl(b.total)}.` });
  if (b.nota.status !== 'emitida' || !b.nota.numero) v.push({ tipo: 'erro', texto: 'Nota fiscal ainda não emitida.' });
  else if (b.nota.origem === 'manual') v.push({ tipo: 'aviso', texto: `Nota nº ${b.nota.numero} informada por você: confira o número${b.nota.anexo ? '' : ' (vai sem o arquivo da nota)'}.` });
  else if (b.nota.valor != null && Math.abs(b.nota.valor - b.total) > 0.009) v.push({ tipo: 'erro', texto: `A nota nº ${b.nota.numero} foi emitida com ${brl(b.nota.valor)}, diferente do boletim (${brl(b.total)}).` });
  else v.push({ tipo: 'ok', texto: `Nota fiscal nº ${b.nota.numero}${b.nota.valor != null ? `, no mesmo valor do boletim` : ''}.` });
  if (b.nota.status === 'emitida' && b.nota.origem === 'automatica' && b.nota.ambiente !== 'producao') v.push({ tipo: 'aviso', texto: 'Nota de teste (homologação), sem valor fiscal.' });
  const invalidos = b.pessoas.filter((p) => !p.cpfValido).length;
  if (invalidos) v.push({ tipo: 'aviso', texto: `${invalidos} CPF(s) ausente(s) ou inválido(s) na lista.` });
  const emails = listaEmails(c?.email);
  if (!emails.length) v.push({ tipo: 'erro', texto: 'Cliente sem e-mail cadastrado.' });
  else v.push({ tipo: 'ok', texto: `Vai para ${emails.join(', ')}.` });
  if (b.email.em && b.email.status !== 'erro') v.push({ tipo: 'aviso', texto: `Já foi enviado em ${new Date(b.email.em).toLocaleDateString('pt-BR')}: este será um reenvio.` });
  for (const o of b.observacoes) if (o.startsWith('Atenção')) v.push({ tipo: 'aviso', texto: o });
  return v;
}
