import { describe, it, expect } from 'vitest';
import { cpf, mask, pessoa, xlsx, ler } from './util';
import { Cell } from '../src/core/text';

// Gera centenas de planilhas com combinações aleatórias de layout e confere a leitura linha a linha.
let s = 2026;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
const um = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const EMPRESAS = ['Alfa Segurança Ltda', 'Sentinela Vigilância Patrimonial', 'GRUPO ESCUDO SEGURANÇA S/A', 'Forte Proteção Eireli', 'Águia Dourada Segurança', 'Vigilância Bahia Norte Ltda - ME', 'Brinks Segurança e Transporte de Valores Ltda'];
const CAB = {
  nome: ['Nome', 'NOME COMPLETO', 'Vigilante', 'Nome do Candidato', 'FUNCIONÁRIO', 'Colaborador(a)', 'Avaliado'],
  cpf: ['CPF', 'C.P.F.', 'Cpf do vigilante', 'CPF Nº', 'Documento'],
  empresa: ['Empresa', 'EMPRESA CONTRATANTE', 'Razão Social', 'Cliente', 'Tomador'],
  data: ['Data', 'Data do exame', 'DT. ATENDIMENTO', 'Realizado em'],
};
const EXTRAS: [string, () => Cell][] = [
  ['Nº', () => Math.ceil(rnd() * 90)], ['Telefone', () => `(71) 9${Math.floor(rnd() * 9e7 + 1e7)}`], ['RG', () => Math.floor(rnd() * 9e8 + 1e8)],
  ['Data de Nascimento', () => `1${Math.floor(rnd() * 9)}/0${Math.ceil(rnd() * 9)}/19${70 + Math.floor(rnd() * 29)}`], ['Resultado', () => um(['APTO', 'INAPTO', 'Apto'])],
  ['Função', () => 'Vigilante'], ['Obs', () => (rnd() < 0.3 ? 'retorno' : null)],
];

function gerar(k: number) {
  const nEmp = 1 + Math.floor(rnd() * 3);
  const empresas = [...EMPRESAS].sort(() => rnd() - 0.5).slice(0, nEmp);
  const onde = nEmp > 1 ? um(['coluna', 'coluna', 'secao', 'abas']) : um(['coluna', 'rotulo', 'aba', 'arquivo', 'secao']);
  const comCab = rnd() < 0.85;
  const fmtCpf = um(['mascara', 'numero', 'texto']);
  const tipo = onde === 'abas' || onde === 'aba' ? um(['xlsx', 'biff8']) : um(['xlsx', 'biff8', 'csv', 'xlsx']);
  const comData = rnd() < 0.5;
  const extras = EXTRAS.filter(() => rnd() < 0.3);
  const cols: { k: string; cab: string; v?: () => Cell }[] = [{ k: 'nome', cab: um(CAB.nome) }, { k: 'cpf', cab: um(CAB.cpf) }];
  if (onde === 'coluna') cols.push({ k: 'empresa', cab: um(CAB.empresa) });
  if (comData) cols.push({ k: 'data', cab: um(CAB.data) });
  for (const [cab, v] of extras) cols.push({ k: 'x', cab, v });
  cols.sort(() => rnd() - 0.5);
  const desloc = Math.floor(rnd() * 3);
  const esperado: Record<string, string[]> = {};
  const linhaDe = (emp: string): Cell[] => {
    const c = cpf();
    (esperado[emp] ??= []).push(c);
    const nome = rnd() < 0.5 ? pessoa().toUpperCase() : pessoa();
    return [...Array(desloc).fill(null), ...cols.map((col) => col.k === 'nome' ? nome : col.k === 'cpf' ? (fmtCpf === 'mascara' ? mask(c) : fmtCpf === 'numero' && tipo !== 'csv' ? Number(c) : c) : col.k === 'empresa' ? (rnd() < 0.3 ? emp.toUpperCase() : emp) : col.k === 'data' ? `1${Math.floor(rnd() * 9)}/03/2026` : col.v!())];
  };
  const cab = (): Cell[] => [...Array(desloc).fill(null), ...cols.map((c) => c.cab)];
  const titulo: Cell[][] = rnd() < 0.5 ? [[...Array(desloc).fill(null), 'RELAÇÃO DE PSICOTESTES REALIZADOS'], []] : [];
  const fim: Cell[][] = rnd() < 0.4 ? [[], [...Array(desloc).fill(null), 'TOTAL', 99]] : [];
  const abas: Record<string, Cell[][]> = {};
  let arquivo = `lote ${k}`;
  const q = () => 1 + Math.floor(rnd() * 12);
  if (onde === 'abas' || onde === 'aba') {
    for (const e of empresas) abas[e.replace(/[\/\\?*[\]:]/g, ' ').slice(0, 31)] = [...titulo, ...(comCab ? [cab()] : []), ...Array.from({ length: q() }, () => linhaDe(e.replace(/[\/\\?*[\]:]/g, ' ').slice(0, 31))), ...fim];
    if (onde === 'aba') abas['Plan2'] = [];
  } else if (onde === 'secao') {
    const l: Cell[][] = [...titulo, ...(comCab ? [cab()] : [])];
    for (const e of empresas) { l.push([...Array(desloc).fill(null), rnd() < 0.5 ? `Empresa: ${e}` : e]); for (let i = q(); i > 0; i--) l.push(linhaDe(e)); if (rnd() < 0.5) l.push([]); }
    abas['Plan1'] = [...l, ...fim];
  } else {
    const e0 = empresas[0];
    const topo: Cell[][] = onde === 'rotulo' ? [[...Array(desloc).fill(null), um([`Empresa: ${e0}`, `CLIENTE: ${e0}`, `Contratante - ${e0}`])], []] : [];
    if (onde === 'arquivo') arquivo = `Psicotestes ${e0.replace(/[\/]/g, '')} 03-2026`;
    const l: Cell[][] = [];
    for (const e of empresas) for (let i = q(); i > 0; i--) l.push(linhaDe(onde === 'arquivo' ? e0.replace(/[\/]/g, '') : e));
    if (onde === 'coluna') l.sort(() => rnd() - 0.5);
    abas['Planilha1'] = [...titulo, ...topo, ...(comCab ? [cab()] : []), ...l, ...fim];
  }
  return { abas, arquivo, tipo, esperado, desc: JSON.stringify({ k, onde, comCab, fmtCpf, tipo, comData, cols: cols.map((c) => c.cab), desloc }) };
}

describe('leitor — 400 planilhas aleatórias', () => {
  it('lê 100% das linhas com a empresa e o CPF certos', () => {
    const falhas: string[] = [];
    let linhas = 0;
    for (let k = 0; k < 400; k++) {
      if (k % 50 === 0) s = 1000 + k * 7919; // novas sementes para variar mais as combinações
      const g = gerar(k);
      let r;
      if (g.tipo === 'csv') {
        const sep = um([';', ',', '\t']);
        const txt = Object.values(g.abas)[0].map((l) => l.map((c) => (c == null ? '' : /[;,"\t]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(sep)).join('\r\n');
        r = ler(`${g.arquivo}.csv`, txt);
      } else r = ler(`${g.arquivo}.${g.tipo === 'biff8' ? 'xls' : 'xlsx'}`, xlsx(g.abas, { bookType: g.tipo as 'xlsx' | 'biff8' }));
      const lido: Record<string, string[]> = {};
      for (const x of r.registros) (lido[x.empresa.toUpperCase()] ??= []).push(x.cpf);
      const esp: Record<string, string[]> = {};
      for (const [e, c] of Object.entries(g.esperado)) (esp[e.toUpperCase()] ??= []).push(...c);
      for (const v of Object.values(esp)) linhas += v.length;
      const norm = (o: Record<string, string[]>) => JSON.stringify(Object.keys(o).sort().map((e) => [e, [...o[e]].sort()]));
      if (norm(lido) !== norm(esp) || r.registros.some((x) => !x.cpfValido || !x.nome || /\d/.test(x.nome))) {
        falhas.push(`${g.desc}\n   esperado ${JSON.stringify(Object.fromEntries(Object.entries(esp).map(([e, c]) => [e, c.length])))}\n   lido     ${JSON.stringify(Object.fromEntries(Object.entries(lido).map(([e, c]) => [e, c.length])))} avisos=${r.avisos.join('|')}`);
      }
    }
    if (falhas.length) throw new Error(`${falhas.length} de 400 planilhas lidas errado (${linhas} linhas):\n` + falhas.slice(0, 8).join('\n'));
    expect(linhas).toBeGreaterThan(3000);
  }, 60000);
});
