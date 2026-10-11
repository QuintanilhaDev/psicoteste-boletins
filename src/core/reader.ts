// Leitor inteligente de planilhas.
// Recebe as células cruas (qualquer layout) e devolve as pessoas agrupáveis por empresa.
// Não depende de posição, cabeçalho, ordem de colunas nem de formatação.

import {
  Cell, digits, norm, isCPF, isCNPJ, isEmail, parseDate, findCompetencia,
  nomeBonito, similaridade,
} from './text';

export interface Aba { nome: string; linhas: Cell[][] }
export interface Arquivo { nome: string; abas: Aba[] }

export interface Registro {
  empresa: string;
  empresaIdentificada: boolean;
  cnpj?: string;
  email?: string;
  nome: string;
  cpf: string;
  cpfValido: boolean;
  data: string | null;
  aba: string;
  linha: number;
}
export interface Resumo {
  empresa: string;
  cnpj?: string;
  email?: string;
  quantidade: number;
  aba: string;
  linha: number;
}
export interface Leitura {
  registros: Registro[];
  resumos: Resumo[];
  avisos: string[];
  competenciaSugerida: string | null;
}

type Papel = 'cpf' | 'cnpj' | 'nome' | 'empresa' | 'data' | 'email' | 'qtd' | 'ignorar';

const RE_EMPRESA = /\b(empresa|cliente|razao social|contratante|tomador|firma|solicitante|convenio|empregador|nome fantasia|encaminhad\w+|origem)\b/;
const RE_NOME = /\b(nome|vigilantes?|candidatos?|funcionarios?|colaborador\w*|avaliad\w+|examinad\w+|pacientes?|profissiona\w+|alunos?|periciad\w+)\b/;
const RE_QTD = /^(qtd|qtde|quant\w*|total|n de \w+|no de \w+|numero de \w+|testes|psicotestes|avaliacoes|exames)\b/;
const RE_IGNORAR = /\b(nasc\w*|admissao|validade|vencimento|rg|identidade|telefone|celular|fone|resultado|situacao|status|apto|cargo|funcao|valor|preco|obs\w*|idade|sexo|endereco|cidade|matricula)\b/;
const RE_COMPANHIA = /\b(ltda|eireli|sa|s a|seguranca|vigilancia|servicos|patrimonial|transportes?|empresa|grupo|comercio|industria|epp|associacao|condominio|cia|escolta|protecao|monitoramento|terceirizacao|empreendimentos|participacoes|solucoes|limitada)\b/;
const RE_RODAPE = /^(obs|observ|total|subtotal|soma|assinatura|responsavel|psicolog|crp|pagina|relacao|lista|data|quantidade|qtd|salvador|emitido|gerado|atenciosamente|legenda|fonte)/;
const RE_TITULO_GENERICO = /\b(relacao|lista|listagem|psicotest\w*|psicotecnic\w*|avaliac\w+|boletim|planilha|relatorio|controle|clinica|exames?|laudos?|encaminhamento)\b/;
const RE_ABA_GENERICA = /^(planilha|sheet|plan|folha|pagina|aba|tabela|dados|geral|lista|relacao|psicotestes?|vigilantes|resumo|total|base|controle|relatorio|export\w*|worksheet|report|cadastro|principal|aptos|inaptos|pendentes|realizados|agendados|faltosos|faltas)\s*\d*$/;
const STOP_ARQUIVO = new Set([
  'psicoteste', 'psicotestes', 'psicotecnico', 'psicotecnicos', 'planilha', 'planilhas', 'relacao', 'lista',
  'listagem', 'vigilantes', 'vigilante', 'de', 'do', 'da', 'dos', 'das', 'exames', 'exame', 'avaliacao',
  'avaliacoes', 'boletim', 'copia', 'final', 'novo', 'nova', 'atualizado', 'atualizada', 'whatsapp', 'image',
  'documento', 'doc', 'arquivo', 'xlsx', 'xls', 'csv', 'ods', 'mes', 'ref', 'referente', 'competencia', 'v', 'e',
  'controle', 'relatorio', 'envio', 'enviar', 'testes', 'teste', 'dados', 'export', 'sem', 'titulo', 'pasta',
  'download', 'book', 'untitled', 'microsoft', 'excel', 'wa', 'img', 'file', 'sheet', 'geral', 'total', 'aptos', 'inaptos',
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
  'novembro', 'dezembro',
]);

const texto = (c: Cell): string => (c == null ? '' : String(c).replace(/\s+/g, ' ').trim());
const vazio = (c: Cell) => texto(c) === '';

function papel(c: Cell): Papel | null {
  if (typeof c !== 'string') return null;
  const n = norm(c);
  if (!n || n.length > 45 || /\d{3,}/.test(n)) return null;
  if (/\bcnpj\b/.test(n) && !/\bcpf\b/.test(n)) return 'cnpj';
  if (/\bcpf\b|^c p f\b|^documento$|^doc$/.test(n)) return 'cpf';
  if (/\be ?mail\b/.test(n)) return 'email';
  if (RE_IGNORAR.test(n) && !RE_EMPRESA.test(n)) return 'ignorar';
  if (RE_EMPRESA.test(n)) return 'empresa';
  if (RE_QTD.test(n)) return 'qtd';
  if (RE_NOME.test(n)) return 'nome';
  if (/\b(data|dt|dia|realizacao|realizado|atendimento)\b/.test(n)) return 'data';
  return null;
}

const RE_CPF_MASCARA = /(?<!\d)\d{3}\.\d{3}\.\d{3}\s?-\s?\d{2}(?!\d)/;

/** devolve os 11 dígitos se a célula tem "cara" de CPF */
function cpfDe(c: Cell): { cpf: string; valido: boolean } | null {
  if (c == null) return null;
  const s = texto(c);
  if (!s) return null;
  const m = s.match(RE_CPF_MASCARA);
  if (m) {
    const d = digits(m[0]);
    return { cpf: d, valido: isCPF(d) };
  }
  if (/^[\d.\-\s/]+$/.test(s)) {
    const d = digits(s);
    if (d.length === 11) return { cpf: d, valido: isCPF(d) };
    // zeros à esquerda perdidos quando o Excel trata o CPF como número
    if (d.length >= 8 && d.length <= 10) {
      const p = d.padStart(11, '0');
      if (isCPF(p)) return { cpf: p, valido: true };
    }
  }
  return null;
}

function cnpjDe(c: Cell): string | null {
  const s = texto(c);
  if (!s) return null;
  const m = s.match(/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/);
  if (m && isCNPJ(m[0])) return digits(m[0]);
  if (/^\d{12,13}$/.test(s) && isCNPJ(s.padStart(14, '0'))) return s.padStart(14, '0');
  return null;
}

function pareceEmpresa(s: string): boolean {
  return RE_COMPANHIA.test(norm(s.replace(/s\s*[/.]\s*a\b/gi, ' sa ')));
}

function pareceNomePessoa(c: Cell): boolean {
  if (typeof c !== 'string') return false;
  const n = norm(c);
  if (n.length < 5 || n.length > 70 || /\d/.test(n)) return false;
  if (n.split(' ').length < 2) return false;
  return !pareceEmpresa(c) && papel(c) == null;
}

function limparNome(s: string): string {
  return nomeBonito(
    s.replace(RE_CPF_MASCARA, ' ').replace(/\bcpf\b\s*[:.]?/gi, ' ').replace(/^[\s\-–—:;,.\d)]+|[\s\-–—:;,.(]+$/g, ''),
  );
}

function limparEmpresa(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '').trim();
}

const RE_ROTULO_EMPRESA = /^\s*(empresa|cliente|contratante|tomador|raz[aã]o social|firma|solicitante)\s*[:\-–—]\s*(.+)$/i;
const RE_ROTULO_SO = /^\s*(empresa|cliente|contratante|tomador|raz[aã]o social|firma|solicitante)\s*:?\s*$/i;

/** "Empresa: ALFA" numa célula, ou "Empresa:" numa célula e o nome na seguinte */
function rotuloEmpresa(linha: Cell[]): string | null {
  for (let i = 0; i < linha.length; i++) {
    const s = texto(linha[i]);
    if (!s) continue;
    const m = s.match(RE_ROTULO_EMPRESA);
    if (m && m[2].trim().length >= 2 && !cnpjDe(m[2])) return limparEmpresa(m[2].split(/\s+[-–—|]\s+cnpj/i)[0]);
    if (RE_ROTULO_SO.test(s)) {
      for (let j = i + 1; j < linha.length; j++) {
        const v = texto(linha[j]);
        if (v) return typeof linha[j] === 'string' && v.length >= 2 ? limparEmpresa(v) : null;
      }
    }
  }
  return null;
}

function empresaDoTitulo(linha: Cell[], ignorar: string[]): string | null {
  for (const c of linha) {
    if (typeof c !== 'string') continue;
    const s = texto(c);
    if (s.length < 3 || s.length > 120) continue;
    for (const parte of s.split(/\s+[-–—|:]\s+|\s{3,}/)) {
      const p = limparEmpresa(parte);
      const n = norm(p);
      if (!p || !pareceEmpresa(p) || RE_TITULO_GENERICO.test(n) || /\d{4,}/.test(n)) continue;
      if (ignorar.some((x) => similaridade(x, p) >= 0.8)) continue;
      return p;
    }
  }
  return null;
}

function empresaDoNomeDaAba(nome: string): string | null {
  const n = norm(nome);
  if (!n || /^\d+$/.test(n) || RE_ABA_GENERICA.test(n)) return null;
  if (findCompetencia(nome) && n.split(' ').every((t) => STOP_ARQUIVO.has(t) || /^\d+$/.test(t))) return null;
  if (n.split(' ').every((t) => STOP_ARQUIVO.has(t) || /^\d+$/.test(t))) return null;
  return limparEmpresa(nome);
}

const CONECTORES = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
export function empresaDoNomeDoArquivo(nome: string): string | null {
  const base = nome.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\(\d+\)/g, ' ').replace(/(?<=\S)-(?=\S)/g, ' ');
  const toks = base.split(/[\s_.,()[\]]+/).filter(Boolean);
  // primeiro trecho contínuo de palavras "de empresa"; conectores (de, e, -) só valem no meio
  const significativo = (t: string) => { const n = norm(t); return !!n && !/\d/.test(n) && !STOP_ARQUIVO.has(n); };
  const conector = (t: string) => CONECTORES.has(norm(t)) || /^[-–—&]+$/.test(t);
  let melhor: string[] = [];
  let atual: string[] = [];
  const fechar = () => {
    while (atual.length && conector(atual[atual.length - 1])) atual.pop();
    if (atual.filter(significativo).length > melhor.filter(significativo).length) melhor = atual;
    atual = [];
  };
  for (const t of toks) {
    if (significativo(t) && !CONECTORES.has(norm(t))) atual.push(t);
    else if (conector(t) && atual.length) atual.push(t);
    else fechar();
  }
  fechar();
  const r = melhor.join(' ').trim();
  return r.length >= 2 ? r : null;
}

interface Colunas {
  cab: number; // índice da linha de cabeçalho, -1 se não há
  cpf: number; nome: number; empresa: number; data: number; cnpj: number; email: number; qtd: number;
}

function acharCabecalho(linhas: Cell[][]): { idx: number; papeis: Map<number, Papel> } {
  let melhor = { idx: -1, papeis: new Map<number, Papel>(), nota: 0 };
  const lim = Math.min(linhas.length, 60);
  for (let i = 0; i < lim; i++) {
    const papeis = new Map<number, Papel>();
    const distintos = new Set<Papel>();
    let cheias = 0;
    let numericas = 0;
    linhas[i].forEach((c, j) => {
      if (vazio(c)) return;
      cheias++;
      if (typeof c === 'number' || cpfDe(c) || parseDate(c) || /^[\d.,\-/\s%R$]+$/.test(String(c))) numericas++;
      const p = papel(c);
      if (p) {
        papeis.set(j, p);
        if (p !== 'ignorar') distintos.add(p);
      }
    });
    if (!distintos.size || numericas > 0) continue;
    // cabeçalho sem nenhuma linha depois não é cabeçalho (é rodapé, ex.: "TOTAL")
    if (!linhas.slice(i + 1).some((l) => l.some((c) => !vazio(c)))) continue;
    // linha de título ("Relação de vigilantes") tem 1 célula; cabeçalho de verdade tem várias
    const nota = distintos.size * 10 + Math.min(cheias, 9) - (cheias === 1 ? 8 : 0);
    if (distintos.size >= 2 ? nota > melhor.nota : cheias >= 2 && nota > melhor.nota) {
      melhor = { idx: i, papeis, nota };
    }
  }
  return melhor;
}

function mapearColunas(linhas: Cell[][]): Colunas {
  const { idx: cab, papeis } = acharCabecalho(linhas);
  // títulos, rótulos e linhas de seção (uma célula só) não entram na estatística das colunas
  const corpo = linhas.slice(cab + 1);
  const comVarias = corpo.filter((l) => {
    const ch = l.filter((c) => !vazio(c));
    const t = ch.find((c) => typeof c === 'string');
    return ch.length >= 2 && !(ch.length <= 3 && t && RE_RODAPE.test(norm(t)) && !ch.some((c) => cpfDe(c)));
  });
  const dados = comVarias.length ? comVarias : corpo;
  const largura = linhas.reduce((m, l) => Math.max(m, l.length), 0);

  const est = Array.from({ length: largura }, () => ({
    n: 0, cpf: 0, cpfValido: 0, cnpj: 0, data: 0, email: 0, pessoa: 0, empresa: 0, inteiro: 0, texto: 0,
    distintos: new Set<string>(),
  }));
  for (const l of dados) {
    for (let j = 0; j < largura; j++) {
      const c = l[j] ?? null;
      if (vazio(c)) continue;
      const e = est[j];
      e.n++;
      e.distintos.add(norm(c));
      const cp = cpfDe(c);
      if (cp) { e.cpf++; if (cp.valido) e.cpfValido++; }
      if (cnpjDe(c)) e.cnpj++;
      if (parseDate(c) && !cp) e.data++;
      if (isEmail(c)) e.email++;
      if (pareceNomePessoa(c)) e.pessoa++;
      if (typeof c === 'string') {
        if (/[a-zA-ZÀ-ú]/.test(c)) e.texto++;
        if (pareceEmpresa(c)) e.empresa++;
      }
      const num = typeof c === 'number' ? c : /^\d{1,5}$/.test(texto(c)) ? Number(texto(c)) : NaN;
      if (Number.isInteger(num) && num >= 0 && num < 100000) e.inteiro++;
    }
  }
  const fr = (j: number, k: 'cpf' | 'cpfValido' | 'cnpj' | 'data' | 'email' | 'pessoa' | 'empresa' | 'inteiro' | 'texto') =>
    est[j].n ? est[j][k] / est[j].n : 0;
  const porPapel = (p: Papel) => [...papeis.entries()].filter(([, v]) => v === p).map(([j]) => j);
  const melhorDe = (cands: number[], nota: (j: number) => number, minimo = 0) => {
    let best = -1;
    let bn = minimo;
    for (const j of cands) {
      const v = nota(j);
      if (v > bn) { bn = v; best = j; }
    }
    return best;
  };
  const todas = Array.from({ length: largura }, (_, j) => j);
  const usadas = new Set<number>();
  const livres = () => todas.filter((j) => !usadas.has(j) && papeis.get(j) !== 'ignorar');
  const usar = (j: number) => { if (j >= 0) usadas.add(j); return j; };

  // CPF: cabeçalho manda; senão a coluna com mais CPFs de dígito verificador correto
  let cpf = melhorDe(porPapel('cpf'), (j) => fr(j, 'cpf') + 0.01, 0);
  if (cpf < 0) cpf = melhorDe(todas, (j) => (est[j].n >= 1 ? fr(j, 'cpfValido') : 0), 0.5);
  usar(cpf);

  const cnpj = usar(melhorDe(porPapel('cnpj').concat(livres()), (j) => fr(j, 'cnpj'), 0.5));
  const email = usar(melhorDe(porPapel('email').concat(livres()), (j) => fr(j, 'email'), 0.5));

  // colunas rotuladas como "nome"/"vigilantes" mas cheias de números são quantidades
  const nomeCab = porPapel('nome').filter((j) => !usadas.has(j));
  const qtdCands = porPapel('qtd').concat(nomeCab.filter((j) => fr(j, 'inteiro') > 0.8));
  let nome = melhorDe(nomeCab.filter((j) => fr(j, 'inteiro') <= 0.8), (j) => fr(j, 'texto') + 0.01, 0);
  let empresa = melhorDe(porPapel('empresa').filter((j) => !usadas.has(j)), (j) => fr(j, 'texto') + 0.01, 0);

  // cabeçalho "Nome" em planilha-resumo costuma ser o nome da empresa
  if (nome >= 0 && empresa < 0 && cpf < 0 && fr(nome, 'empresa') >= 0.5) { empresa = nome; nome = -1; }
  usar(nome); usar(empresa);

  if (nome < 0) {
    nome = usar(melhorDe(livres(), (j) => (est[j].n >= 1 ? fr(j, 'pessoa') + est[j].distintos.size / 1e4 : 0), 0.5));
  }
  if (empresa < 0) {
    empresa = usar(melhorDe(livres(), (j) => (est[j].n >= 1 ? fr(j, 'empresa') : 0), 0.5));
  }
  const data = usar(melhorDe(porPapel('data').filter((j) => !usadas.has(j)), (j) => fr(j, 'data') + 0.01, 0));
  const dataInf = data >= 0 ? data : usar(melhorDe(livres(), (j) => fr(j, 'data'), 0.7));
  const qtd = melhorDe(qtdCands.filter((j) => !usadas.has(j)), (j) => fr(j, 'inteiro'), 0.6);

  return { cab, cpf, nome, empresa, data: dataInf, cnpj, email, qtd };
}

export interface OpcoesLeitura {
  /** nomes que NÃO são clientes (ex.: a própria clínica, que aparece no timbre da planilha) */
  ignorarNomes?: string[];
}

function lerAba(aba: Aba, arquivo: string, multiplasAbas: boolean, op: OpcoesLeitura, out: Leitura) {
  const linhas = aba.linhas.map((l) => l.map((c) => (typeof c === 'string' ? (c.trim() === '' ? null : c) : c)));
  if (!linhas.some((l) => l.some((c) => !vazio(c)))) return;
  const ignorar = op.ignorarNomes?.filter(Boolean) ?? [];
  const col = mapearColunas(linhas);

  // contexto: empresa e competência escritos acima da tabela
  let empresaCtx: string | null = null;
  let compCtx: string | null = null;
  for (let i = 0; i < Math.max(col.cab, 0); i++) {
    empresaCtx = empresaCtx ?? rotuloEmpresa(linhas[i]);
    compCtx = compCtx ?? findCompetencia(linhas[i].map(texto).join(' '));
  }
  if (!empresaCtx) {
    for (let i = 0; i < Math.max(col.cab, 0) && !empresaCtx; i++) empresaCtx = empresaDoTitulo(linhas[i], ignorar);
  }
  const daAba = empresaDoNomeDaAba(aba.nome);
  const doArquivo = empresaDoNomeDoArquivo(arquivo);
  const naoEhIgnorado = (s: string | null) => (s && !ignorar.some((x) => similaridade(x, s) >= 0.8) ? s : null);
  const fallback =
    naoEhIgnorado(empresaCtx) ??
    (multiplasAbas || (daAba && pareceEmpresa(daAba)) ? naoEhIgnorado(daAba) : null) ??
    naoEhIgnorado(doArquivo) ??
    naoEhIgnorado(daAba);
  compCtx = compCtx ?? findCompetencia(aba.nome) ?? findCompetencia(arquivo);
  out.competenciaSugerida = out.competenciaSugerida ?? compCtx;

  const modoResumo = col.cpf < 0 && col.nome < 0 && col.qtd >= 0 && col.empresa >= 0;
  const temPessoas = col.cpf >= 0 || col.nome >= 0;
  if (!modoResumo && !temPessoas) {
    out.avisos.push(`A aba "${aba.nome}" de ${arquivo} não tem lista de vigilantes reconhecível e foi ignorada.`);
    return;
  }

  let primeiraComCpf = Infinity;
  let ultimaComCpf = -1;
  if (col.cpf >= 0) {
    for (let i = col.cab + 1; i < linhas.length; i++) {
      if (cpfDe(linhas[i][col.cpf] ?? null)) { if (primeiraComCpf === Infinity) primeiraComCpf = i; ultimaComCpf = i; }
    }
  }
  let secao: string | null = null;
  let ultimaEmpresa: string | null = null;
  let ultimoCnpj: string | undefined;
  let ultimoEmail: string | undefined;
  let achados = 0;

  for (let i = col.cab + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const cheias = l.map((c, j) => ({ c, j })).filter((x) => !vazio(x.c));
    if (!cheias.length) continue;
    const primeiroTexto = cheias.find((x) => typeof x.c === 'string');
    const n1 = primeiroTexto ? norm(primeiroTexto.c) : '';

    // CPF: da coluna, ou de qualquer célula que traga CPF com máscara
    let cp = col.cpf >= 0 ? cpfDe(l[col.cpf] ?? null) : null;
    if (!cp && col.cpf < 0) {
      for (const x of cheias) {
        const m = typeof x.c === 'string' ? x.c.match(RE_CPF_MASCARA) : null;
        if (m) { cp = cpfDe(m[0]); break; }
      }
    }
    const cpfBruto = col.cpf >= 0 ? texto(l[col.cpf] ?? null) : '';

    // cabeçalho repetido no meio da planilha
    const papeisNaLinha = cheias.filter((x) => papel(x.c) && papel(x.c) !== 'ignorar').length;
    if (!cp && papeisNaLinha >= 2 && cheias.every((x) => typeof x.c === 'string')) continue;

    // linha de seção: "Empresa: X" ou uma única célula de texto entre os blocos
    if (!cp) {
      const rot = rotuloEmpresa(l);
      if (rot) { secao = naoEhIgnorado(rot) ?? secao; continue; }
      if (
        col.empresa < 0 && cheias.length === 1 && primeiroTexto && !/\d{3,}/.test(n1) &&
        !RE_RODAPE.test(n1) && n1.length >= 2 && n1.length <= 80 && !findCompetenciaExata(n1) &&
        (pareceEmpresa(primeiroTexto.c as string) || (col.cpf >= 0 && col.nome !== primeiroTexto.j) ||
          (col.cpf >= 0 && !pareceNomePessoa(primeiroTexto.c)))
      ) {
        secao = naoEhIgnorado(limparEmpresa(primeiroTexto.c as string)) ?? secao;
        continue;
      }
    }
    // totais e rodapés
    if (!cp && n1 && RE_RODAPE.test(n1) && (cheias.length <= 2 || !(col.nome >= 0 && pareceNomePessoa(l[col.nome] ?? null)))) continue;
    // numa planilha com coluna de CPF, texto solto antes da primeira ou depois da última pessoa é título ou assinatura
    if (!cp && col.cpf >= 0 && cheias.length === 1 && (i < primeiraComCpf || i > ultimaComCpf)) continue;

    // empresa da linha (com "preencher para baixo" quando só a 1ª linha do grupo traz o nome)
    let empresaLinha: string | null = null;
    if (col.empresa >= 0) {
      const v = l[col.empresa] ?? null;
      if (typeof v === 'string' && texto(v) && papel(v) !== 'empresa') {
        empresaLinha = limparEmpresa(v);
        if (empresaLinha !== ultimaEmpresa) { ultimoCnpj = undefined; ultimoEmail = undefined; }
        ultimaEmpresa = empresaLinha;
      } else if (typeof v === 'number') {
        empresaLinha = null;
      } else empresaLinha = ultimaEmpresa;
    }
    const cnpjLinha = col.cnpj >= 0 ? cnpjDe(l[col.cnpj] ?? null) ?? undefined : undefined;
    const emailLinha = col.email >= 0 && isEmail(l[col.email]) ? texto(l[col.email]).toLowerCase() : undefined;
    if (cnpjLinha) ultimoCnpj = cnpjLinha;
    if (emailLinha) ultimoEmail = emailLinha;
    const empresa = empresaLinha ?? secao ?? fallback;

    if (modoResumo) {
      const q = l[col.qtd];
      const qn = typeof q === 'number' ? q : /^\d{1,5}$/.test(texto(q ?? null)) ? Number(texto(q ?? null)) : NaN;
      if (!empresaLinha || !Number.isInteger(qn) || qn <= 0 || RE_RODAPE.test(norm(empresaLinha))) continue;
      out.resumos.push({ empresa: empresaLinha, cnpj: cnpjLinha, email: emailLinha, quantidade: qn, aba: aba.nome, linha: i + 1 });
      achados++;
      continue;
    }

    // nome da pessoa
    let nome = '';
    if (col.nome >= 0) {
      const v = l[col.nome] ?? null;
      if (typeof v === 'string' && /[a-zA-ZÀ-ú]{2}/.test(v) && papel(v) !== 'nome') nome = limparNome(v);
    }
    if (!nome && col.nome < 0 && cp) {
      // sem coluna de nome: usa o texto que acompanha o CPF
      const cand = cheias.find((x) => typeof x.c === 'string' && x.j !== col.empresa && /[a-zA-ZÀ-ú]{3}/.test(limparNome(x.c as string)));
      if (cand) nome = limparNome(cand.c as string);
    }
    const temCpfInvalidoNaColuna = !cp && col.cpf >= 0 && digits(cpfBruto).length >= 5;
    if (!cp && !nome) continue;
    if (!cp && !temCpfInvalidoNaColuna && col.cpf >= 0 && !pareceNomePessoa(l[col.nome] ?? null) && nome.split(' ').length < 2) {
      continue; // texto solto sem CPF numa planilha que tem coluna de CPF: não é uma pessoa
    }

    const data = col.data >= 0 ? parseDate(l[col.data] ?? null) : null;
    out.registros.push({
      empresa: empresa ?? '',
      empresaIdentificada: !!empresa,
      cnpj: cnpjLinha ?? (empresaLinha ? ultimoCnpj : undefined),
      email: emailLinha ?? (empresaLinha ? ultimoEmail : undefined),
      nome: nome || '(sem nome na planilha)',
      cpf: cp ? cp.cpf : digits(cpfBruto),
      cpfValido: !!cp?.valido,
      data,
      aba: aba.nome,
      linha: i + 1,
    });
    achados++;
  }
  if (!achados) out.avisos.push(`Nenhum vigilante encontrado na aba "${aba.nome}" de ${arquivo}.`);
}

function findCompetenciaExata(n: string): boolean {
  return /^([a-z]{3,9})( de)? \d{2,4}$/.test(n) && !!findCompetencia(n);
}

export function lerPlanilha(arquivo: Arquivo, op: OpcoesLeitura = {}): Leitura {
  const out: Leitura = { registros: [], resumos: [], avisos: [], competenciaSugerida: null };
  const abas = arquivo.abas.filter((a) => a.linhas.some((l) => l.some((c) => !vazio(c))));
  for (const aba of abas) lerAba(aba, arquivo.nome, abas.length > 1, op, out);
  if (out.registros.length && out.resumos.length) {
    out.resumos = [];
    out.avisos.push(`${arquivo.nome} tem lista nominal e também uma aba de resumo; usei a lista nominal para não contar em dobro.`);
  }
  if (!out.registros.length && !out.resumos.length && !out.avisos.length) {
    out.avisos.push(`${arquivo.nome} está vazio ou não tem dados de vigilantes.`);
  }
  return out;
}
