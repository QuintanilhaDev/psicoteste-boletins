import * as XLSX from 'xlsx';
import { abrirArquivo } from '../src/core/arquivo';
import { lerPlanilha, OpcoesLeitura } from '../src/core/reader';
import { Cell } from '../src/core/text';

let semente = 7;
const rnd = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff), semente / 0x7fffffff);
export function cpf(prefixo?: string): string {
  let d = prefixo ?? '';
  while (d.length < 9) d += Math.floor(rnd() * 10);
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    d += ((s * 10) % 11) % 10;
  }
  return d;
}
export const mask = (c: string) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
const NOMES = ['João', 'Maria', 'José', 'Ana', 'Carlos', 'Paulo', 'Luiz', 'Marcos', 'Rita', 'Jorge', 'Edson', 'Cláudia'];
const SOBR = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Conceição', 'de Jesus', 'Nascimento', 'Bispo', 'dos Anjos', 'Pereira'];
export const pessoa = () => `${NOMES[Math.floor(rnd() * NOMES.length)]} ${SOBR[Math.floor(rnd() * SOBR.length)]} ${SOBR[Math.floor(rnd() * SOBR.length)]}`;
export const gente = (n: number) => Array.from({ length: n }, () => ({ nome: pessoa(), cpf: cpf() }));

export type Planilha = Record<string, Cell[][]>;
export function xlsx(abas: Planilha, opt: { merges?: Record<string, XLSX.Range[]>; bookType?: XLSX.BookType; datas?: boolean } = {}): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [nome, linhas] of Object.entries(abas)) {
    const ws = XLSX.utils.aoa_to_sheet(linhas as unknown[][], { cellDates: false });
    if (opt.merges?.[nome]) ws['!merges'] = opt.merges[nome];
    XLSX.utils.book_append_sheet(wb, ws, nome);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: opt.bookType ?? 'xlsx' }));
}
export function ler(nome: string, bytes: Uint8Array | string, op?: OpcoesLeitura) {
  const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const { arquivo, hash } = abrirArquivo(nome, b);
  return { ...lerPlanilha(arquivo, op), hash };
}
export function contar(regs: { empresa: string }[]) {
  const m: Record<string, number> = {};
  for (const r of regs) m[r.empresa] = (m[r.empresa] ?? 0) + 1;
  return m;
}
