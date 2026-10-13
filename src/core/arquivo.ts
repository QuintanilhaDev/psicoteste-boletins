// Converte os bytes de um arquivo (xlsx, xls, ods, csv, txt) em células cruas para o leitor.

import * as XLSX from 'xlsx';
import { Arquivo, Aba } from './reader';
import { Cell, hashString, parseDate } from './text';

const pad = (n: number) => String(n).padStart(2, '0');

/** o formato numérico da célula é de data? (ex.: dd/mm/yyyy, m/d/yy, d-mmm-yy) */
export function formatoDeData(fmt: string): boolean {
  const f = fmt.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
  if (/general/i.test(f)) return false;
  return /[dy]/i.test(f) || /m.*[/\-.].*m|mmm/i.test(f) || (/m/i.test(f) && /[dy]/i.test(f));
}

function decodificarTexto(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes); // CSV salvo pelo Excel brasileiro
  }
}

function ehBinarioDePlanilha(b: Uint8Array) {
  const zip = b[0] === 0x50 && b[1] === 0x4b; // xlsx / ods
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; // xls
  return zip || ole;
}

/** CSV próprio: respeita aspas, detecta ; , tab ou | e nunca converte CPF/data em número */
export function parseCSV(text: string): Cell[][] {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const amostra = t.split('\n').slice(0, 30).join('\n');
  const cont = (ch: string) => amostra.split(ch).length - 1;
  const seps = [';', '\t', '|', ','];
  let sep = seps[0];
  for (const s of seps) if (cont(s) > cont(sep)) sep = s;
  // vírgula só vence se não houver ; (evita quebrar "Silva, João" e "1.234,56")
  if (sep === ',' && cont(';') > 0 && cont(';') >= cont(',') / 3) sep = ';';
  const linhas: Cell[][] = [];
  let linha: Cell[] = [];
  let cel = '';
  let aspas = false;
  let teveAspas = false;
  const fecharCelula = () => {
    const v = teveAspas ? cel : cel.trim();
    linha.push(v === '' ? null : v.replace(/^="?(.*?)"?$/, '$1'));
    cel = '';
    teveAspas = false;
  };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') { cel += '"'; i++; } else aspas = false;
      } else cel += ch;
    } else if (ch === '"' && cel.trim() === '') {
      aspas = true;
      teveAspas = true;
      cel = '';
    } else if (ch === sep) fecharCelula();
    else if (ch === '\n') { fecharCelula(); linhas.push(linha); linha = []; }
    else cel += ch;
  }
  if (cel !== '' || linha.length) { fecharCelula(); linhas.push(linha); }
  return linhas;
}

function abaDoWorksheet(nome: string, ws: XLSX.WorkSheet): Aba {
  const ref = ws['!ref'];
  if (!ref) return { nome, linhas: [] };
  const r = XLSX.utils.decode_range(ref);
  // protege contra planilhas com formatação até a linha 1.048.576
  const maxR = Math.min(r.e.r, r.s.r + 20000);
  const maxC = Math.min(r.e.c, r.s.c + 80);
  const linhas: Cell[][] = [];
  for (let R = r.s.r; R <= maxR; R++) {
    const l: Cell[] = [];
    for (let C = r.s.c; C <= maxC; C++) {
      const c = ws[XLSX.utils.encode_cell({ r: R, c: C })] as XLSX.CellObject | undefined;
      let v: Cell = null;
      if (c && c.v != null) {
        if (c.t === 'n') {
          const n = c.v as number;
          const fmt = typeof c.z === 'string' ? c.z : '';
          if (fmt && formatoDeData(fmt) && n > 0) {
            v = parseDate(n) ?? n;
          } else v = n;
        } else if (c.t === 'd') {
          const d = c.v as Date;
          v = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        } else if (c.t === 'b') v = c.v ? 'sim' : 'não';
        else if (c.t === 'e') v = null;
        else v = String(c.v);
      }
      l.push(v);
    }
    linhas.push(l);
  }
  // células mescladas: repete o valor na vertical (ex.: empresa mesclada sobre várias pessoas)
  const preenchidas = new Set<string>();
  for (const m of ws['!merges'] ?? []) {
    const r0 = m.s.r - r.s.r;
    const c0 = m.s.c - r.s.c;
    const v = linhas[r0]?.[c0];
    if (v == null) continue;
    for (let R = r0 + 1; R <= m.e.r - r.s.r && R < linhas.length; R++) {
      if (linhas[R] && c0 < linhas[R].length) { linhas[R][c0] = v; preenchidas.add(`${R}|${c0}`); }
    }
  }
  // linha que só existe por causa da mesclagem (a "segunda linha" de uma pessoa) não é outra pessoa
  if (preenchidas.size) {
    linhas.forEach((l, R) => {
      const cheias = l.map((c, C) => ({ c, C })).filter((x) => x.c != null && x.c !== '');
      if (cheias.length && cheias.every((x) => preenchidas.has(`${R}|${x.C}`))) linhas[R] = l.map(() => null);
    });
  }
  // remove linhas ocultas por filtro? Não: uma linha oculta ainda é um atendimento realizado.
  return { nome, linhas };
}

export interface ArquivoLido { arquivo: Arquivo; hash: string }

export function abrirArquivo(nome: string, bytes: Uint8Array): ArquivoLido {
  if (!bytes.length) throw new Error(`${nome} está vazio.`);
  const ext = (nome.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    throw new Error(`${nome} é um PDF. Envie a planilha (Excel ou CSV).`);
  }
  if (['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif', 'doc', 'docx', 'zip', 'rar'].includes(ext)) {
    throw new Error(`${nome} não é uma planilha. Envie o arquivo do Excel ou CSV.`);
  }
  let abas: Aba[];
  if (ehBinarioDePlanilha(bytes)) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true, cellText: false });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      throw new Error(/password|encrypt/i.test(msg) ? `${nome} está protegido por senha.` : `Não consegui abrir ${nome}. O arquivo pode estar corrompido.`);
    }
    abas = wb.SheetNames.filter((n) => wb.Sheets[n]).map((n) => abaDoWorksheet(n, wb.Sheets[n]));
  } else {
    const txt = decodificarTexto(bytes);
    if (/^\s*<(\?xml|html|table|!doctype)/i.test(txt)) {
      // "xls" exportado por sistemas costuma ser HTML disfarçado
      const wb = XLSX.read(txt, { type: 'string', raw: true });
      abas = wb.SheetNames.map((n) => abaDoWorksheet(n, wb.Sheets[n]));
    } else {
      if (/[\u0000-\u0008]/.test(txt.slice(0, 2000))) throw new Error(`${nome} não é uma planilha que eu consiga ler.`);
      abas = [{ nome: 'CSV', linhas: parseCSV(txt) }];
    }
  }
  const arquivo: Arquivo = { nome, abas };
  // o hash é do conteúdo, não do arquivo: a mesma planilha salva de novo é reconhecida
  const hash = hashString(
    JSON.stringify(abas.map((a) => a.linhas.filter((l) => l.some((c) => c != null && c !== '')).map((l) => l.map((c) => (c == null ? '' : String(c).trim())).join('\u0001').replace(/\u0001+$/, '')))),
  );
  return { arquivo, hash };
}
