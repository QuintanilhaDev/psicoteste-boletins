// Gera os documentos: boletim (PDF), espelho da NFS-e (PDF), planilha de relatório (Excel) e faz os downloads.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Boletim, Cliente, Estado, clienteDe, discriminacao, porCliente, porMes, totais } from '../core/model';
import { brl, competenciaLabel, fmtCNPJ, fmtCPF, fmtDate, digits, listaEmails } from '../core/text';

export interface Doc { nome: string; tipo: string; bytes: Uint8Array; /** pasta dentro do .zip (ex.: "EM PLANILHA") */ pasta?: string }

export const PASTA_PLANILHAS = 'EM PLANILHA';

const TINTA: [number, number, number] = [18, 48, 46];
const MARCA: [number, number, number] = [14, 107, 94];
const CINZA: [number, number, number] = [91, 107, 104];

/** as fontes padrão do PDF só têm Latin-1 */
const L = (s: unknown) =>
  String(s ?? '')
    .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/[^\u0000-ÿ]/g, '');

export const nomeArquivo = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'documento';

const docCliente = (c?: Cliente) => (c?.cnpj ? (digits(c.cnpj).length === 11 ? fmtCPF(c.cnpj) : fmtCNPJ(c.cnpj)) : '');
const enderecoTxt = (c?: Cliente) => {
  const e = c?.endereco;
  if (!e?.logradouro) return '';
  return `${e.logradouro}, ${e.numero}${e.complemento ? ' ' + e.complemento : ''} - ${e.bairro}, ${e.cidade}${e.uf ? '/' + e.uf : ''}`;
};

function cabecalho(pdf: jsPDF, e: Estado, titulo: string, sub: string) {
  const p = e.config.prestador;
  pdf.setFillColor(...TINTA);
  pdf.rect(0, 0, 210, 30, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold').setFontSize(15);
  pdf.text(L(titulo), 14, 14);
  pdf.setFont('helvetica', 'normal').setFontSize(10);
  pdf.text(L(sub), 14, 21.5);
  pdf.setFontSize(9);
  const dir = [p.razao, p.cnpj ? `CNPJ ${fmtCNPJ(p.cnpj)}` : '', [p.telefone, listaEmails(p.email)[0]].filter(Boolean).join('  ')].filter(Boolean);
  dir.forEach((t, i) => pdf.text(L(t), 196, 11 + i * 5, { align: 'right' }));
  pdf.setTextColor(...TINTA);
}

function campo(pdf: jsPDF, rotulo: string, valor: string, x: number, y: number, larg = 90) {
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...CINZA);
  pdf.text(L(rotulo), x, y);
  pdf.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...TINTA);
  const linhas = pdf.splitTextToSize(L(valor || '-'), larg) as string[];
  pdf.text(linhas.slice(0, 2), x, y + 5);
  return y + 5 + Math.min(linhas.length, 2) * 4.6;
}

export function pdfBoletim(e: Estado, b: Boletim): Doc {
  const c = clienteDe(e, b);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const num = String(b.numero).padStart(4, '0');
  cabecalho(pdf, e, `Boletim de psicotestes nº ${num}`, `Competência: ${competenciaLabel(b.competencia, true)}`);
  let y = 40;
  const y1 = campo(pdf, 'Cliente', c?.nome ?? '', 14, y, 110);
  const y2 = campo(pdf, 'CNPJ', docCliente(c), 132, y, 64);
  y = Math.max(y1, y2) + 3;
  if (enderecoTxt(c)) y = campo(pdf, 'Endereço', enderecoTxt(c), 14, y, 182) + 3;

  // quadro de totais
  pdf.setFillColor(238, 244, 241);
  pdf.roundedRect(14, y, 182, 20, 2, 2, 'F');
  const col = (rot: string, val: string, x: number) => {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...CINZA).text(L(rot), x, y + 7);
    pdf.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...TINTA).text(L(val), x, y + 14.5);
  };
  col('Vigilantes avaliados', String(b.quantidade), 20);
  col('Valor por psicoteste', brl(b.precoUnit), 80);
  col('Total do boletim', brl(b.total), 140);
  y += 27;

  if (b.pessoas.length) {
    const temData = b.pessoas.some((p) => p.data);
    autoTable(pdf, {
      startY: y,
      margin: { left: 14, right: 14, bottom: 18 },
      head: [['Nº', 'Vigilante', 'CPF', ...(temData ? ['Data'] : [])]],
      body: b.pessoas.map((p, i) => [String(i + 1), L(p.nome), p.cpf ? fmtCPF(p.cpf) : '-', ...(temData ? [fmtDate(p.data)] : [])]),
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 2.2, textColor: TINTA, lineColor: [213, 222, 218], lineWidth: 0.1 },
      headStyles: { fillColor: MARCA, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 249, 247] },
      columnStyles: { 0: { cellWidth: 12, halign: 'right' }, 2: { cellWidth: 36 }, 3: { cellWidth: 26 } },
    });
    y = ((pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? y) + 8;
  } else {
    pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...CINZA);
    pdf.text(L('Quantidade informada em planilha-resumo, sem relação nominal.'), 14, y + 2);
    y += 10;
  }
  if (b.observacoes.length) {
    if (y > 265) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...CINZA);
    pdf.text(pdf.splitTextToSize(L('Obs.: ' + b.observacoes.join(' ')), 182), 14, y);
  }
  const paginas = pdf.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...CINZA);
    pdf.text(L(`Boletim ${num} - emitido em ${fmtDate(b.criadoEm)} - origem: ${b.arquivo}`.slice(0, 110)), 14, 289);
    pdf.text(`${i}/${paginas}`, 196, 289, { align: 'right' });
  }
  return { nome: `Boletim-${num}-${nomeArquivo(c?.nome ?? 'cliente')}-${b.competencia}.pdf`, tipo: 'application/pdf', bytes: new Uint8Array(pdf.output('arraybuffer')) };
}

/** O boletim em planilha Excel: mesmo conteúdo do PDF, pronto para conferir, filtrar e somar. */
export async function xlsxBoletim(e: Estado, b: Boletim): Promise<Doc> {
  const ExcelJS = (await import('exceljs')).default;
  const c = clienteDe(e, b);
  const p = e.config.prestador;
  const num = String(b.numero).padStart(4, '0');
  const wb = new ExcelJS.Workbook();
  wb.creator = p.razao || 'Psicotestes';
  wb.created = new Date();
  const ws = wb.addWorksheet(`Boletim ${num}`, {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: `Boletim ${num} - página &P de &N` },
  });
  ws.columns = [{ width: 13 }, { width: 44 }, { width: 19 }, { width: 16 }];
  const TINTA_X = 'FF12302E';
  const VERDE = 'FF0E6B5E';
  const CLARO = 'FFEEF4F1';
  const fonte = (extra: Partial<{ size: number; bold: boolean; color: string }> = {}) =>
    ({ name: 'Calibri', size: extra.size ?? 11, bold: extra.bold ?? false, color: { argb: extra.color ?? TINTA_X } });
  const faixa = (linha: number, valor: string, opt: { size?: number; bold?: boolean; fundo?: string; cor?: string; altura?: number } = {}) => {
    ws.mergeCells(linha, 1, linha, 4);
    const cel = ws.getCell(linha, 1);
    cel.value = valor;
    cel.font = fonte({ size: opt.size, bold: opt.bold, color: opt.cor });
    if (opt.fundo) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fundo } };
    cel.alignment = { vertical: 'middle', indent: 1, wrapText: true };
    if (opt.altura) ws.getRow(linha).height = opt.altura;
  };
  faixa(1, `Boletim de psicotestes nº ${num}`, { size: 16, bold: true, fundo: TINTA_X, cor: 'FFFFFFFF', altura: 32 });
  faixa(2, `Competência: ${competenciaLabel(b.competencia, true)}`, { size: 11, fundo: TINTA_X, cor: 'FFC9DAD5', altura: 20 });
  faixa(3, [p.razao, p.cnpj ? `CNPJ ${fmtCNPJ(p.cnpj)}` : '', listaEmailsTxt(p.email), p.telefone].filter(Boolean).join('   |   '), { size: 10, cor: 'FF5B6B68', altura: 20 });

  const rotulo = (linha: number, r: string, v: string) => {
    const a = ws.getCell(linha, 1);
    a.value = r;
    a.font = fonte({ size: 10, color: 'FF5B6B68' });
    a.alignment = { vertical: 'middle', indent: 1 };
    ws.mergeCells(linha, 2, linha, 4);
    const x = ws.getCell(linha, 2);
    x.value = v || '-';
    x.font = fonte({ bold: true });
    x.alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(linha).height = 20;
  };
  rotulo(5, 'Cliente', c?.nome ?? '');
  rotulo(6, 'CNPJ', docCliente(c));
  rotulo(7, 'Endereço', enderecoTxt(c));
  rotulo(8, 'Nota fiscal', b.nota.status === 'emitida' && b.nota.numero ? `nº ${b.nota.numero}${b.nota.codigo ? ` (código ${b.nota.codigo})` : ''}` : 'ainda não emitida');

  // quadro de totais com fórmula (quem abrir no Excel pode conferir)
  const t = 10;
  [['Vigilantes avaliados', 1], ['Valor por psicoteste', 2], ['Total do boletim', 3]].forEach(([r, i]) => {
    const cel = ws.getCell(t, Number(i) + 1);
    cel.value = String(r);
    cel.font = fonte({ size: 10, color: 'FF5B6B68' });
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
    cel.alignment = { horizontal: 'center' };
  });
  ws.getCell(t, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
  const q = ws.getCell(t + 1, 2);
  q.value = b.quantidade;
  const pr = ws.getCell(t + 1, 3);
  pr.value = b.precoUnit;
  pr.numFmt = '"R$" #,##0.00';
  const tot = ws.getCell(t + 1, 4);
  tot.value = { formula: 'B11*C11', result: b.total };
  tot.numFmt = '"R$" #,##0.00';
  for (let col = 1; col <= 4; col++) {
    const cel = ws.getCell(t + 1, col);
    cel.font = fonte({ size: 14, bold: true });
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
    cel.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.getRow(t + 1).height = 28;

  let linha = t + 3;
  if (b.pessoas.length) {
    const cab = ws.getRow(linha);
    ['Nº', 'Vigilante', 'CPF', 'Data'].forEach((v, i) => {
      const cel = cab.getCell(i + 1);
      cel.value = v;
      cel.font = fonte({ bold: true, color: 'FFFFFFFF' });
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } };
      cel.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', indent: i === 0 ? 0 : 1 };
    });
    cab.height = 22;
    const ini = linha + 1;
    b.pessoas.forEach((pe, k) => {
      const r = ws.getRow(ini + k);
      const vals = [k + 1, pe.nome, pe.cpf ? fmtCPF(pe.cpf) : '-', pe.data ? fmtDate(pe.data) : ''];
      vals.forEach((v, i) => {
        const cel = r.getCell(i + 1);
        cel.value = v;
        cel.font = fonte();
        cel.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', indent: i === 0 ? 0 : 1 };
        cel.border = { bottom: { style: 'hair', color: { argb: 'FFD5DEDA' } } };
        if (k % 2 === 1) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9F7' } };
      });
      r.height = 19;
    });
    ws.autoFilter = { from: { row: linha, column: 1 }, to: { row: linha + b.pessoas.length, column: 4 } };
    ws.views = [{ state: 'frozen', ySplit: linha, showGridLines: false }];
    linha = ini + b.pessoas.length;
    const fim = ws.getRow(linha);
    fim.getCell(1).value = 'Total';
    fim.getCell(2).value = { formula: `COUNTA(B${ini}:B${linha - 1})&" vigilantes"`, result: `${b.pessoas.length} vigilantes` };
    for (let col = 1; col <= 4; col++) {
      const cel = fim.getCell(col);
      cel.font = fonte({ bold: true });
      cel.border = { top: { style: 'medium', color: { argb: TINTA_X } } };
      cel.alignment = { horizontal: col === 1 ? 'center' : 'left', indent: col === 1 ? 0 : 1 };
    }
    linha += 2;
  } else {
    faixa(linha, 'Quantidade informada em planilha-resumo, sem relação nominal.', { size: 10, cor: 'FF5B6B68' });
    linha += 2;
  }
  for (const o of b.observacoes) { faixa(linha, `Obs.: ${o}`, { size: 10, cor: 'FF5B6B68', altura: 30 }); linha++; }
  faixa(linha, `Emitido em ${fmtDate(b.criadoEm)}. Planilha de origem: ${b.arquivo}`, { size: 9, cor: 'FF8A9895' });

  const buf = await wb.xlsx.writeBuffer();
  return {
    nome: `Boletim-${num}-${nomeArquivo(c?.nome ?? 'cliente')}-${b.competencia}.xlsx`,
    tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: new Uint8Array(buf as ArrayBuffer),
    pasta: PASTA_PLANILHAS,
  };
}
const listaEmailsTxt = (v: string) => listaEmails(v).join(', ');

/** Espelho em PDF de uma NFS-e JÁ autorizada pela prefeitura (os dados vêm do retorno oficial). */
export function pdfNota(e: Estado, b: Boletim): Doc | null {
  const n = b.nota;
  if (n.status !== 'emitida' || n.origem !== 'automatica' || !n.numero) return null;
  const c = clienteDe(e, b);
  const p = e.config.prestador;
  const f = e.config.fiscal;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  cabecalho(pdf, e, `NFS-e nº ${n.numero}`, 'Nota Fiscal de Serviços Eletrônica - Prefeitura Municipal do Salvador');
  let y = 46;
  campo(pdf, 'Código de verificação', n.codigo ?? '', 14, y, 60);
  campo(pdf, 'Emitida em', (n.emitidaEm ?? '').replace('T', ' ').slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'), 80, y, 50);
  y = campo(pdf, 'RPS', `${n.rps ?? ''} série ${n.serie ?? ''}`, 140, y, 50) + 4;
  const bloco = (titulo: string, linhas: [string, string][]) => {
    pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...MARCA).text(L(titulo), 14, y);
    pdf.setDrawColor(213, 222, 218).line(14, y + 1.5, 196, y + 1.5);
    y += 7;
    for (const [r, v] of linhas) if (v) y = campo(pdf, r, v, 14, y, 182) + 2;
    y += 2;
  };
  bloco('Prestador de serviços', [['Razão social', p.razao], ['CNPJ / Inscrição municipal', `${fmtCNPJ(p.cnpj)}  /  ${p.im}`]]);
  bloco('Tomador de serviços', [['Razão social', c?.nome ?? ''], ['CNPJ', docCliente(c)], ['Endereço', enderecoTxt(c)], ['E-mail', listaEmails(c?.email).join(', ')]]);
  bloco('Discriminação dos serviços', [['', discriminacao(e, b)]]);
  const iss = Math.round(b.total * f.aliquota) / 100;
  pdf.setFillColor(238, 244, 241).roundedRect(14, y, 182, 20, 2, 2, 'F');
  const col = (rot: string, val: string, x: number) => {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...CINZA).text(L(rot), x, y + 7);
    pdf.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...TINTA).text(L(val), x, y + 14.5);
  };
  col('Valor dos serviços', brl(b.total), 20);
  col(`ISS (${String(f.aliquota).replace('.', ',')}%)${f.issRetido ? ' retido' : ''}`, brl(iss), 85);
  col('Valor líquido', brl(b.total - (f.issRetido ? iss : 0)), 145);
  y += 30;
  pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...CINZA);
  pdf.text(pdf.splitTextToSize(L('Documento auxiliar gerado a partir da NFS-e autorizada pela Prefeitura do Salvador (XML em anexo). Confira a autenticidade em nfse.salvador.ba.gov.br informando o número da nota e o código de verificação.'), 182), 14, y);
  if (n.ambiente !== 'producao') {
    pdf.setFillColor(168, 39, 31).rect(0, 30, 210, 7, 'F');
    pdf.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(255, 255, 255);
    pdf.text(L('NOTA DE TESTE (HOMOLOGAÇÃO) - SEM VALOR FISCAL'), 105, 34.8, { align: 'center' });
  }
  return { nome: `NFSe-${n.numero}-${nomeArquivo(c?.nome ?? 'cliente')}.pdf`, tipo: 'application/pdf', bytes: new Uint8Array(pdf.output('arraybuffer')) };
}

export function xmlNota(e: Estado, b: Boletim): Doc | null {
  if (!b.nota.xml || !b.nota.numero) return null;
  return { nome: `NFSe-${b.nota.numero}-${nomeArquivo(clienteDe(e, b)?.nome ?? 'cliente')}.xml`, tipo: 'application/xml', bytes: new TextEncoder().encode(b.nota.xml) };
}

/** boletim em PDF + o mesmo em Excel (este vai na pasta EM PLANILHA do .zip) */
export async function documentosDoBoletim(e: Estado, b: Boletim): Promise<Doc[]> {
  return [pdfBoletim(e, b), await xlsxBoletim(e, b)];
}
/** tudo que vai anexado no e-mail ao cliente */
export async function anexosDoEmail(e: Estado, b: Boletim): Promise<Doc[]> {
  const docs = await documentosDoBoletim(e, b);
  const pn = pdfNota(e, b);
  const xn = xmlNota(e, b);
  if (pn) docs.push(pn);
  if (xn) docs.push(xn);
  if (b.nota.anexo) {
    const bin = atob(b.nota.anexo.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    docs.push({ nome: b.nota.anexo.nome, tipo: b.nota.anexo.tipo, bytes });
  }
  return docs.map((d) => ({ ...d, pasta: undefined }));
}

export function paraBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** .zip com os documentos; os que têm `pasta` vão dentro dela (ex.: EM PLANILHA/Boletim-0001.xlsx) */
export async function montarZip(docs: Doc[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const usados = new Set<string>();
  for (const d of docs) {
    const base = d.pasta ? `${d.pasta}/` : '';
    let n = d.nome;
    for (let i = 2; usados.has(base + n); i++) n = d.nome.replace(/(\.[a-z]+)$/i, `-${i}$1`);
    usados.add(base + n);
    zip.file(base + n, d.bytes);
  }
  return zip.generateAsync({ type: 'blob' });
}

/** Salva na pasta Downloads. Um arquivo vai direto; vários vão num único .zip (o navegador bloqueia rajadas de downloads). */
export async function baixar(docs: Doc[], nomeZip = 'psicotestes') {
  if (!docs.length) return;
  let blob: Blob;
  let nome: string;
  if (docs.length === 1 && !docs[0].pasta) {
    blob = new Blob([docs[0].bytes as BlobPart], { type: docs[0].tipo });
    nome = docs[0].nome;
  } else {
    blob = await montarZip(docs);
    nome = `${nomeZip}.zip`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const situacaoNota = (b: Boletim) =>
  b.nota.status === 'emitida' ? `Emitida nº ${b.nota.numero ?? ''}` : b.nota.status === 'erro' ? 'Com erro' : 'Não emitida';

export async function planilhaRelatorio(e: Estado): Promise<Doc> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = e.config.prestador.razao || 'Psicotestes';
  wb.created = new Date();
  const VERDE = 'FF0E6B5E';
  const TINTA_X = 'FF12302E';
  const moeda = '"R$" #,##0.00';

  type Col = { titulo: string; larg: number; fmt?: string; alinh?: 'left' | 'right' | 'center' };
  const montar = (nome: string, titulo: string, cols: Col[], linhas: (string | number | null)[][], somar: number[] = []) => {
    const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws.columns = cols.map((c) => ({ width: c.larg }));
    ws.mergeCells(1, 1, 1, cols.length);
    const t = ws.getCell(1, 1);
    t.value = titulo;
    t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINTA_X } };
    t.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 34;
    ws.mergeCells(2, 1, 2, cols.length);
    const s = ws.getCell(2, 1);
    s.value = `${e.config.prestador.razao || ''}${e.config.prestador.razao ? '  |  ' : ''}Gerado em ${new Date().toLocaleDateString('pt-BR')}`;
    s.font = { name: 'Calibri', size: 10, color: { argb: 'FF5B6B68' } };
    s.alignment = { indent: 1, vertical: 'middle' };
    ws.getRow(2).height = 20;
    const cab = ws.getRow(4);
    cols.forEach((c, i) => {
      const cel = cab.getCell(i + 1);
      cel.value = c.titulo;
      cel.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } };
      cel.alignment = { vertical: 'middle', horizontal: c.alinh ?? (c.fmt ? 'right' : 'left'), wrapText: true };
      cel.border = { bottom: { style: 'medium', color: { argb: TINTA_X } } };
    });
    cab.height = 26;
    linhas.forEach((l, r) => {
      const row = ws.getRow(5 + r);
      l.forEach((v, i) => {
        const cel = row.getCell(i + 1);
        cel.value = v;
        cel.font = { name: 'Calibri', size: 11, color: { argb: TINTA_X } };
        if (cols[i].fmt) cel.numFmt = cols[i].fmt!;
        cel.alignment = { vertical: 'middle', horizontal: cols[i].alinh ?? (cols[i].fmt ? 'right' : 'left') };
        cel.border = { bottom: { style: 'hair', color: { argb: 'FFD5DEDA' } } };
        if (r % 2 === 1) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F7F5' } };
        if (v === 'Em aberto') cel.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF8A5A00' } };
        if (v === 'Recebido') cel.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1D7A4F' } };
      });
      row.height = 20;
    });
    if (linhas.length && somar.length) {
      const row = ws.getRow(5 + linhas.length);
      row.getCell(1).value = 'Total';
      cols.forEach((c, i) => {
        const cel = row.getCell(i + 1);
        if (somar.includes(i)) {
          const letra = ws.getColumn(i + 1).letter;
          cel.value = { formula: `SUM(${letra}5:${letra}${4 + linhas.length})`, result: linhas.reduce((a, l) => a + (Number(l[i]) || 0), 0) };
          if (c.fmt) cel.numFmt = c.fmt;
        }
        cel.font = { name: 'Calibri', size: 11, bold: true, color: { argb: TINTA_X } };
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EDE9' } };
        cel.border = { top: { style: 'medium', color: { argb: TINTA_X } } };
        cel.alignment = { vertical: 'middle', horizontal: c.alinh ?? (c.fmt ? 'right' : 'left') };
      });
      row.height = 24;
    }
    if (linhas.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + linhas.length, column: cols.length } };
    return ws;
  };

  const grana: Col[] = [
    { titulo: 'Psicotestes', larg: 14, fmt: '#,##0' }, { titulo: 'Faturado', larg: 16, fmt: moeda }, { titulo: 'Com nota emitida', larg: 18, fmt: moeda },
    { titulo: 'Recebido', larg: 16, fmt: moeda }, { titulo: 'Em aberto (nota emitida)', larg: 20, fmt: moeda }, { titulo: 'Ainda sem nota', larg: 16, fmt: moeda },
  ];
  const nums = (l: ReturnType<typeof totais>) => [l.testes, l.faturado, l.comNota, l.recebido, l.aberto, l.semNota];
  montar('Por mês', 'Psicotestes e fluxo de caixa por mês', [{ titulo: 'Mês', larg: 18 }, ...grana],
    porMes(e).map((l) => [competenciaLabel(l.chave, true), ...nums(l)]), [1, 2, 3, 4, 5, 6]);
  montar('Por cliente', 'Psicotestes e fluxo de caixa por cliente', [{ titulo: 'Cliente', larg: 40 }, ...grana],
    porCliente(e).map((l) => [l.rotulo, ...nums(l)]), [1, 2, 3, 4, 5, 6]);

  // cliente x mês
  const meses = porMes(e).map((m) => m.chave);
  const mapa = new Map<string, Map<string, number>>();
  for (const b of e.boletins) {
    const nome = clienteDe(e, b)?.nome ?? 'Cliente removido';
    if (!mapa.has(nome)) mapa.set(nome, new Map());
    mapa.get(nome)!.set(b.competencia, (mapa.get(nome)!.get(b.competencia) ?? 0) + b.quantidade);
  }
  montar('Cliente x mês', 'Quantidade de psicotestes por cliente em cada mês',
    [{ titulo: 'Cliente', larg: 40 }, ...meses.map((m) => ({ titulo: competenciaLabel(m), larg: 11, fmt: '#,##0' })), { titulo: 'Total', larg: 12, fmt: '#,##0' }],
    [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([nome, m]) => {
      const vals = meses.map((k) => m.get(k) ?? 0);
      return [nome, ...vals.map((v) => v || null), vals.reduce((a, v) => a + v, 0)];
    }), meses.map((_, i) => i + 1).concat(meses.length + 1));

  const ordenados = [...e.boletins].sort((a, b) => b.numero - a.numero);
  montar('Boletins', 'Boletins, notas fiscais e recebimentos',
    [{ titulo: 'Boletim', larg: 10, alinh: 'center' }, { titulo: 'Cliente', larg: 38 }, { titulo: 'CNPJ', larg: 21 }, { titulo: 'Mês', larg: 12 },
      { titulo: 'Psicotestes', larg: 13, fmt: '#,##0' }, { titulo: 'Valor unitário', larg: 15, fmt: moeda }, { titulo: 'Total', larg: 16, fmt: moeda },
      { titulo: 'Nota fiscal', larg: 22 }, { titulo: 'E-mail', larg: 14 }, { titulo: 'Pagamento', larg: 14 }, { titulo: 'Recebido em', larg: 14 }, { titulo: 'Planilha de origem', larg: 34 }],
    ordenados.map((b) => [String(b.numero).padStart(4, '0'), clienteDe(e, b)?.nome ?? '', docCliente(clienteDe(e, b)), competenciaLabel(b.competencia), b.quantidade, b.precoUnit, b.total,
      situacaoNota(b), b.email.status === 'enviado' ? 'Enviado' : b.email.status === 'dispensado' ? 'Não enviado (decisão)' : 'Não enviado', b.recebido ? 'Recebido' : 'Em aberto', fmtDate(b.recebidoEm), b.arquivo]), [4, 6]);

  montar('Vigilantes', 'Relação de vigilantes avaliados',
    [{ titulo: 'Cliente', larg: 38 }, { titulo: 'Mês', larg: 12 }, { titulo: 'Vigilante', larg: 40 }, { titulo: 'CPF', larg: 18 }, { titulo: 'Data', larg: 13 }, { titulo: 'Boletim', larg: 10, alinh: 'center' }],
    ordenados.flatMap((b) => b.pessoas.map((p) => [clienteDe(e, b)?.nome ?? '', competenciaLabel(b.competencia), p.nome, p.cpf ? fmtCPF(p.cpf) : '', fmtDate(p.data), String(b.numero).padStart(4, '0')])));

  const buf = await wb.xlsx.writeBuffer();
  return { nome: `Psicotestes-relatorio-${new Date().toISOString().slice(0, 10)}.xlsx`, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: new Uint8Array(buf as ArrayBuffer) };
}
