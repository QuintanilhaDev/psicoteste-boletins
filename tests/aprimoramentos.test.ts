import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { gente, xlsx, ler } from './util';
import { estadoInicial, importarLeitura, faltasDoCliente, verificacoes, Estado } from '../src/core/model';
import { listaEmails, juntarEmails } from '../src/core/text';
import { documentosDoBoletim, anexosDoEmail, montarZip, xlsxBoletim, PASTA_PLANILHAS } from '../src/lib/docs';

const pronto = (): Estado => {
  const e = estadoInicial(); e.config.precoPadrao = 85.5;
  Object.assign(e.config.prestador, { razao: 'Clínica Teste Ltda', cnpj: '11222333000181', im: '123456', email: 'a@clinica.com, b@clinica.com' });
  const g = gente(4);
  const r = ler('x.xlsx', xlsx({ P: [['Vigilante', 'CPF', 'Empresa', 'E-mail'], ...g.map((p) => [p.nome, p.cpf, 'Guardião', 'fin@guardiao.com.br; rh@guardiao.com.br'])] }));
  importarLeitura(e, 'x.xlsx', r.hash, r, new Date(2026, 9, 10));
  return e;
};

describe('vários e-mails', () => {
  it('extrai, valida e junta listas em qualquer formato', () => {
    expect(listaEmails('Fin@A.com.br; rh@a.com.br, fin@a.com.br  <c@b.co>  inválido@ x@y')).toEqual(['fin@a.com.br', 'rh@a.com.br', 'c@b.co']);
    expect(listaEmails('')).toEqual([]);
    expect(juntarEmails(['A@x.com', 'a@x.com', 'b@y.com'])).toBe('a@x.com, b@y.com');
  });
  it('planilha com vários e-mails na célula preenche todos no cliente', () => {
    const e = pronto();
    expect(listaEmails(e.clientes[0].email)).toEqual(['fin@guardiao.com.br', 'rh@guardiao.com.br']);
    expect(faltasDoCliente(e.clientes[0])).not.toContain('e-mail');
  });
});

describe('boletim em Excel e pasta EM PLANILHA', () => {
  it('gera a planilha do boletim com lista, totais e fórmula', async () => {
    const e = pronto();
    const d = await xlsxBoletim(e, e.boletins[0]);
    expect([d.pasta, d.nome]).toEqual([PASTA_PLANILHAS, 'Boletim-0001-Guardiao-2026-10.xlsx']);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(d.bytes.buffer as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Boletim 0001');
    expect(ws.getCell('A1').value).toBe('Boletim de psicotestes nº 0001');
    expect(ws.getCell('B5').value).toBe('Guardião');
    expect([ws.getCell('B11').value, ws.getCell('C11').value]).toEqual([4, 85.5]);
    expect(ws.getCell('D11').value).toMatchObject({ formula: 'B11*C11', result: 342 });
    expect(ws.getCell('B13').value).toBe('Vigilante');
    const nomes = [14, 15, 16, 17].map((r) => ws.getCell(`B${r}`).value);
    expect(nomes).toEqual(e.boletins[0].pessoas.map((p) => p.nome));
    expect(String(ws.getCell('C14').value)).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  });
  it('o .zip tem os PDFs na raiz e as planilhas dentro de EM PLANILHA', async () => {
    const e = pronto();
    const docs = (await Promise.all(e.boletins.map((b) => documentosDoBoletim(e, b)))).flat();
    const zip = await JSZip.loadAsync(await (await montarZip(docs)).arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['Boletim-0001-Guardiao-2026-10.pdf', 'EM PLANILHA/', 'EM PLANILHA/Boletim-0001-Guardiao-2026-10.xlsx']);
  });
  it('e-mail leva boletim em PDF e Excel + a nota (sem pastas)', async () => {
    const e = pronto();
    const b = e.boletins[0];
    b.nota = { status: 'emitida', origem: 'manual', numero: '4521', tentativas: 0, anexo: { nome: 'nota-4521.pdf', tipo: 'application/pdf', base64: btoa('%PDF-1.4 teste') } };
    const a = await anexosDoEmail(e, b);
    expect(a.map((d) => d.nome)).toEqual(['Boletim-0001-Guardiao-2026-10.pdf', 'Boletim-0001-Guardiao-2026-10.xlsx', 'nota-4521.pdf']);
    expect(a.every((d) => !d.pasta)).toBe(true);
    expect(new TextDecoder().decode(a[2].bytes)).toBe('%PDF-1.4 teste');
  });
});

describe('verificações da conferência', () => {
  it('tudo certo: só ok e avisos', () => {
    const e = pronto();
    const b = e.boletins[0];
    b.nota = { status: 'emitida', origem: 'automatica', numero: '2026001', valor: 342, ambiente: 'producao', tentativas: 0 };
    const v = verificacoes(e, b);
    expect(v.filter((x) => x.tipo !== 'ok')).toEqual([]);
    expect(v.map((x) => x.texto).join(' ')).toMatch(/4 vigilantes, sem nomes repetidos.*4 × R\$ 85,50 = R\$ 342,00.*mesmo valor.*fin@guardiao.com.br, rh@guardiao.com.br/);
  });
  it('bloqueia: nomes repetidos, conta errada, nota com outro valor, cliente sem e-mail, nota não emitida', () => {
    const e = pronto();
    const b = e.boletins[0];
    expect(verificacoes(e, b).some((x) => x.tipo === 'erro' && /não emitida/.test(x.texto))).toBe(true);
    b.nota = { status: 'emitida', origem: 'automatica', numero: '1', valor: 300, ambiente: 'producao', tentativas: 0 };
    b.pessoas.push({ ...b.pessoas[0] }); b.quantidade = 5;
    e.clientes[0].email = '';
    const erros = verificacoes(e, b).filter((x) => x.tipo === 'erro').map((x) => x.texto).join(' | ');
    expect(erros).toMatch(/repetido/); expect(erros).toMatch(/não fecha/); expect(erros).toMatch(/emitida com R\$ 300,00/); expect(erros).toMatch(/sem e-mail/);
  });
  it('avisa (sem bloquear): nota informada à mão, homologação, reenvio', () => {
    const e = pronto();
    const b = e.boletins[0];
    b.nota = { status: 'emitida', origem: 'manual', numero: '77', tentativas: 0 };
    b.email = { status: 'pendente', tentativas: 0, em: '2026-10-11T12:00:00Z' };
    const v = verificacoes(e, b);
    expect(v.some((x) => x.tipo === 'erro')).toBe(false);
    expect(v.filter((x) => x.tipo === 'aviso').map((x) => x.texto).join(' ')).toMatch(/informada por você.*reenvio/);
  });
});
