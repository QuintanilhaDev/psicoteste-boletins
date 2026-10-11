import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { cpf, mask, pessoa, gente, xlsx, ler, contar } from './util';
import { isCPF, isCNPJ, parseDate, findCompetencia, similaridade, empresaKey } from '../src/core/text';
import { parseCSV } from '../src/core/arquivo';

describe('texto', () => {
  it('valida CPF/CNPJ', () => {
    expect(isCPF('529.982.247-25')).toBe(true);
    expect(isCPF('529.982.247-26')).toBe(false);
    expect(isCPF('111.111.111-11')).toBe(false);
    expect(isCNPJ('11.222.333/0001-81')).toBe(true);
    expect(isCNPJ('11.222.333/0001-82')).toBe(false);
  });
  it('datas brasileiras', () => {
    expect(parseDate('05/03/2026')).toBe('2026-03-05');
    expect(parseDate('5/3/26')).toBe('2026-03-05');
    expect(parseDate('2026-03-05')).toBe('2026-03-05');
    expect(parseDate('05.03.2026 14:30')).toBe('2026-03-05');
    expect(parseDate(46086)).toBe('2026-03-05');
    expect(parseDate('31/02/2026')).toBe(null);
    expect(parseDate('5 de março de 2026')).toBe('2026-03-05');
    expect(parseDate(12345678901)).toBe(null);
  });
  it('competência em texto', () => {
    expect(findCompetencia('Psicotestes Março 2026')).toBe('2026-03');
    expect(findCompetencia('ALFA_03-2026.xlsx')).toBe('2026-03');
    expect(findCompetencia('relacao mar-26')).toBe('2026-03');
    expect(findCompetencia('2026-03 alfa')).toBe('2026-03');
    expect(findCompetencia('Período: 01/03/2026 a 31/03/2026')).toBe('2026-03');
    expect(findCompetencia('lista geral')).toBe(null);
  });
  it('nomes de empresa', () => {
    expect(empresaKey('ALFA SEGURANÇA LTDA.')).toBe(empresaKey('Alfa Seguranca Ltda - ME'));
    expect(empresaKey('Brinks S/A')).toBe(empresaKey('BRINKS SA'));
    expect(similaridade('Alfa Segurança', 'Beta Vigilância')).toBeLessThan(0.72);
    expect(similaridade('Proteje Segurança', 'Protege Segurança')).toBeGreaterThan(0.72);
  });
});

describe('leitor — layouts', () => {
  it('1. tabela simples com cabeçalho', () => {
    const g = gente(5);
    const r = ler('lista.xlsx', xlsx({ Plan1: [['Nome', 'CPF', 'Empresa'], ...g.map((p, i) => [p.nome, mask(p.cpf), i < 3 ? 'Alfa Segurança Ltda' : 'Beta Vigilância']) ] }));
    expect(contar(r.registros)).toEqual({ 'Alfa Segurança Ltda': 3, 'Beta Vigilância': 2 });
    expect(r.registros.every((x) => x.cpfValido)).toBe(true);
  });
  it('2. colunas em outra ordem, cabeçalhos diferentes, título e linhas vazias antes', () => {
    const g = gente(4);
    const r = ler('x.xlsx', xlsx({ Dados: [
      [null, 'CLÍNICA PSICOVIDA'], [], ['', 'Relação de psicotestes — Março/2026'], [],
      ['Nº', 'CONTRATANTE', 'C.P.F.', 'VIGILANTE', 'RESULTADO'],
      ...g.map((p, i) => [i + 1, 'GUARDIÃO SEGURANÇA', p.cpf, p.nome.toUpperCase(), 'APTO']),
      [], ['TOTAL', null, null, 4],
    ] }));
    expect(contar(r.registros)).toEqual({ 'GUARDIÃO SEGURANÇA': 4 });
    expect(r.competenciaSugerida).toBe('2026-03');
  });
  it('3. CPF como número (zeros à esquerda perdidos)', () => {
    const c = cpf('007');
    const c2 = cpf('000');
    const r = ler('x.xlsx', xlsx({ Plan1: [['Nome', 'CPF', 'Empresa'], [pessoa(), Number(c), 'Alfa'], [pessoa(), Number(c2), 'Alfa']] }));
    expect(r.registros.map((x) => x.cpf)).toEqual([c, c2]);
    expect(r.registros.every((x) => x.cpfValido)).toBe(true);
  });
  it('4. sem cabeçalho nenhum', () => {
    const g = gente(6);
    const r = ler('x.xlsx', xlsx({ Plan1: g.map((p) => [p.nome, mask(p.cpf), 'Forte Vigilância Ltda']) }));
    expect(contar(r.registros)).toEqual({ 'Forte Vigilância Ltda': 6 });
  });
  it('5. uma aba por empresa', () => {
    const r = ler('psicotestes.xlsx', xlsx({
      'Alfa Segurança': [['Nome', 'CPF'], ...gente(3).map((p) => [p.nome, p.cpf])],
      'Beta': [['Nome', 'CPF'], ...gente(2).map((p) => [p.nome, p.cpf])],
      'Plan3': [],
    }));
    expect(contar(r.registros)).toEqual({ 'Alfa Segurança': 3, Beta: 2 });
  });
  it('6. empresa no título acima da tabela ("Empresa: X")', () => {
    const r = ler('x.xlsx', xlsx({ Plan1: [['Empresa: Sentinela Segurança Patrimonial Ltda'], ['Mês: 02/2026'], [], ['Nome completo', 'CPF', 'Data'], ...gente(3).map((p) => [p.nome, mask(p.cpf), '10/02/2026'])] }));
    expect(contar(r.registros)).toEqual({ 'Sentinela Segurança Patrimonial Ltda': 3 });
    expect(r.registros[0].data).toBe('2026-02-10');
  });
  it('7. rótulo e valor em células separadas', () => {
    const r = ler('x.xlsx', xlsx({ Plan1: [['Cliente:', 'Escudo Vigilância'], ['Nome', 'CPF'], ...gente(2).map((p) => [p.nome, p.cpf])] }));
    expect(contar(r.registros)).toEqual({ 'Escudo Vigilância': 2 });
  });
  it('8. blocos por empresa com linha de seção', () => {
    const r = ler('x.xlsx', xlsx({ Plan1: [
      ['Nome', 'CPF'],
      ['ALFA SEGURANÇA LTDA'], ...gente(3).map((p) => [p.nome, p.cpf]),
      [], ['PROTEGE'], ...gente(2).map((p) => [p.nome, p.cpf]),
      ['Total geral', 5],
    ] }));
    expect(contar(r.registros)).toEqual({ 'ALFA SEGURANÇA LTDA': 3, PROTEGE: 2 });
  });
  it('9. empresa só na primeira linha do grupo e células mescladas', () => {
    const g = gente(5);
    const linhas = [['Empresa', 'Nome', 'CPF'], ['Alfa', g[0].nome, g[0].cpf], [null, g[1].nome, g[1].cpf], [null, g[2].nome, g[2].cpf], ['Beta Ltda', g[3].nome, g[3].cpf], [null, g[4].nome, g[4].cpf]];
    const r = ler('x.xlsx', xlsx({ Plan1: linhas }, { merges: { Plan1: [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }] } }));
    expect(contar(r.registros)).toEqual({ Alfa: 3, 'Beta Ltda': 2 });
  });
  it('10. empresa só no nome do arquivo', () => {
    const r = ler('Psicotestes ALFA SEGURANÇA março 2026 (1).xlsx', xlsx({ Planilha1: [['Nome', 'CPF'], ...gente(4).map((p) => [p.nome, p.cpf])] }));
    expect(contar(r.registros)).toEqual({ 'ALFA SEGURANÇA': 4 });
    expect(r.competenciaSugerida).toBe('2026-03');
  });
  it('11. empresa impossível de identificar', () => {
    const r = ler('planilha.xlsx', xlsx({ Planilha1: [['Nome', 'CPF'], ...gente(2).map((p) => [p.nome, p.cpf])] }));
    expect(r.registros.length).toBe(2);
    expect(r.registros.every((x) => !x.empresaIdentificada)).toBe(true);
  });
  it('12. CSV com ponto e vírgula, latin1 e CPF com máscara', () => {
    const g = gente(3);
    const txt = 'Nome;CPF;Empresa;Data\r\n' + g.map((p) => `${p.nome};${mask(p.cpf)};Segurança São João Ltda;03/03/2026`).join('\r\n');
    const bytes = Uint8Array.from([...txt].map((ch) => ch.charCodeAt(0))); // latin1
    const r = ler('lista.csv', bytes);
    expect(contar(r.registros)).toEqual({ 'Segurança São João Ltda': 3 });
    expect(r.registros[0].data).toBe('2026-03-03');
  });
  it('13. CSV com vírgula, aspas e CPF sem máscara com zero à esquerda', () => {
    const c = cpf('012');
    const r = ler('a.csv', `"nome","cpf","empresa"\n"Silva, João da","${c}","Alfa, Segurança Ltda"\n`);
    expect(r.registros[0].cpf).toBe(c);
    expect(r.registros[0].empresa).toBe('Alfa, Segurança Ltda');
  });
  it('14. datas do Excel definem a competência por linha', () => {
    const g = gente(2);
    const ws = XLSX.utils.aoa_to_sheet([['Nome', 'CPF', 'Empresa', 'Data do exame'], [g[0].nome, g[0].cpf, 'Alfa', null], [g[1].nome, g[1].cpf, 'Alfa', null]]);
    ws.D2 = { t: 'n', v: 46050, z: 'dd/mm/yyyy' }; ws.D3 = { t: 'n', v: 46055.75, z: 'dd/mm/yy hh:mm' };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'P');
    const r = ler('x.xlsx', new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
    expect(r.registros.map((x) => x.data)).toEqual(['2026-01-28', '2026-02-02']);
  });
  it('15. planilha-resumo (empresa + quantidade)', () => {
    const r = ler('resumo.xlsx', xlsx({ Plan1: [['Empresa', 'Qtd. de vigilantes'], ['Alfa Segurança', 12], ['Beta Vigilância', 7], ['TOTAL', 19]] }));
    expect(r.resumos.map((x) => [x.empresa, x.quantidade])).toEqual([['Alfa Segurança', 12], ['Beta Vigilância', 7]]);
    expect(r.registros.length).toBe(0);
  });
  it('16. resumo + abas nominais não contam em dobro', () => {
    const r = ler('x.xlsx', xlsx({ Resumo: [['Empresa', 'Quantidade'], ['Alfa', 2]], Alfa: [['Nome', 'CPF'], ...gente(2).map((p) => [p.nome, p.cpf])] }));
    expect(r.registros.length).toBe(2);
    expect(r.resumos.length).toBe(0);
  });
  it('17. nome e CPF na mesma célula', () => {
    const g = gente(3);
    const r = ler('Beta Vigilância.xlsx', xlsx({ Plan1: g.map((p, i) => [`${i + 1}) ${p.nome} - CPF: ${mask(p.cpf)}`]) }));
    expect(r.registros.map((x) => x.cpf)).toEqual(g.map((p) => p.cpf));
    expect(r.registros[0].nome).toBe(g[0].nome);
    expect(r.registros[0].empresa).toBe('Beta Vigilância');
  });
  it('18. ignora telefone, RG, data de nascimento e cabeçalho repetido', () => {
    const g = gente(4);
    const lin = (p: { nome: string; cpf: string }) => [p.nome, '71' + '9' + p.cpf.slice(0, 8), p.cpf.slice(0, 9), '12/05/1988', mask(p.cpf), 'Alfa Segurança'];
    const cab = ['Nome', 'Telefone', 'RG', 'Data de Nascimento', 'CPF', 'Empresa'];
    const r = ler('x.xlsx', xlsx({ Plan1: [cab, lin(g[0]), lin(g[1]), cab, lin(g[2]), lin(g[3])] }));
    expect(r.registros.map((x) => x.cpf)).toEqual(g.map((p) => p.cpf));
    expect(r.registros.every((x) => x.data === null)).toBe(true);
  });
  it('19. CPF inválido ou ausente ainda conta, marcado', () => {
    const g = gente(1);
    const r = ler('x.xlsx', xlsx({ Plan1: [['Nome', 'CPF', 'Empresa'], [g[0].nome, g[0].cpf, 'Alfa'], ['Pedro Santos Lima', '123.456.789-00', 'Alfa'], ['Rui Costa Bispo', null, 'Alfa']] }));
    expect(r.registros.length).toBe(3);
    expect(r.registros.map((x) => x.cpfValido)).toEqual([true, false, false]);
  });
  it('20. timbre da clínica não vira cliente', () => {
    const r = ler('lista.xlsx', xlsx({ Plan1: [['PSICOVIDA SERVIÇOS DE PSICOLOGIA LTDA'], ['Vigilantes avaliados - Forte Segurança Ltda'], ['Nome', 'CPF'], ...gente(2).map((p) => [p.nome, p.cpf])] }), { ignorarNomes: ['Psicovida Serviços de Psicologia Ltda'] });
    expect(contar(r.registros)).toEqual({ 'Forte Segurança Ltda': 2 });
  });
  it('21. .xls antigo e .ods', () => {
    for (const bt of ['biff8', 'ods'] as const) {
      const r = ler(bt === 'ods' ? 'x.ods' : 'x.xls', xlsx({ Plan1: [['Nome', 'CPF', 'Empresa'], ...gente(3).map((p) => [p.nome, mask(p.cpf), 'Alfa'])] }, { bookType: bt }));
      expect(contar(r.registros)).toEqual({ Alfa: 3 });
    }
  });
  it('22. CNPJ e e-mail do cliente vindos da planilha', () => {
    const r = ler('x.xlsx', xlsx({ Plan1: [['Vigilante', 'CPF', 'Razão Social', 'CNPJ', 'E-mail'], [pessoa(), cpf(), 'Alfa Ltda', '11.222.333/0001-81', 'Fin@Alfa.com.br']] }));
    expect(r.registros[0]).toMatchObject({ empresa: 'Alfa Ltda', cnpj: '11222333000181', email: 'fin@alfa.com.br' });
  });
  it('23. arquivos que não são planilha dão erro claro', () => {
    expect(() => ler('nota.pdf', '%PDF-1.4 ...')).toThrow(/PDF/);
    expect(() => ler('foto.jpg', 'xxxx')).toThrow(/não é uma planilha/);
    expect(() => ler('v.xlsx', new Uint8Array(0))).toThrow(/vazio/);
  });
  it('24. planilha sem pessoas avisa em vez de inventar', () => {
    const r = ler('x.xlsx', xlsx({ Plan1: [['Produto', 'Valor'], ['Caneta', 3], ['Papel', 10]] }));
    expect(r.registros.length + r.resumos.length).toBe(0);
    expect(r.avisos.length).toBeGreaterThan(0);
  });
  it('25. mesma planilha salva de novo tem o mesmo hash', () => {
    const g = gente(2);
    const linhas = [['Nome', 'CPF', 'Empresa'], ...g.map((p) => [p.nome, p.cpf, 'Alfa'])];
    expect(ler('a.xlsx', xlsx({ P: linhas })).hash).toBe(ler('b.xls', xlsx({ P: [...linhas, [null, null, null]] }, { bookType: 'biff8' })).hash);
  });
  it('26. só nome e empresa, sem CPF', () => {
    const r = ler('x.xlsx', xlsx({ Plan1: [['Funcionário', 'Empresa'], ...gente(3).map((p) => [p.nome, 'Alfa Segurança'])] }));
    expect(contar(r.registros)).toEqual({ 'Alfa Segurança': 3 });
  });
  it('27. tabela deslocada (começa na coluna D, linha 8) com rodapé', () => {
    const g = gente(3);
    const v = [null, null, null];
    const r = ler('x.xlsx', xlsx({ Plan1: [[], [], [...v, 'RELAÇÃO DE CANDIDATOS'], [...v, 'Empresa:', 'Águia Segurança'], [], [...v, 'ORD', 'CANDIDATO', 'DOCUMENTO'], ...g.map((p, i) => [...v, i + 1, p.nome, mask(p.cpf)]), [], [...v, 'Salvador, 10 de março de 2026'], [...v, 'Psicóloga responsável'], [...v, 'Dra. Ana Lima Souza']] }));
    expect(contar(r.registros)).toEqual({ 'Águia Segurança': 3 });
  });
  it('28. CSV: parser', () => {
    expect(parseCSV('a;b\n"x;y";"z ""q"""\n')).toEqual([['a', 'b'], ['x;y', 'z "q"']]);
    expect(parseCSV('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

import { formatoDeData } from '../src/core/arquivo';
import { empresaDoNomeDoArquivo } from '../src/core/reader';
describe('nome do arquivo', () => {
  it('não inventa empresa a partir de nomes gerados por sistema', () => {
    for (const n of ['DOC-20260310-WA0012.xlsx', 'Pasta1.xlsx', 'planilha (3).xls', 'download.csv', 'relatorio_2026_03.xlsx', 'Book1.xlsx']) expect(empresaDoNomeDoArquivo(n), n).toBe(null);
    expect(empresaDoNomeDoArquivo('Relação vigilantes - Sentinela Segurança - mar 2026.xlsx')).toBe('Sentinela Segurança');
  });
});
describe('formatos de célula', () => {
  it('reconhece formatos de data sem depender da biblioteca', () => {
    for (const f of ['dd/mm/yyyy', 'm/d/yy', 'd-mmm-yy', 'dd/mm/yy hh:mm', 'yyyy-mm-dd', '[$-416]d "de" mmmm "de" yyyy', 'mmm-yy']) expect(formatoDeData(f), f).toBe(true);
    for (const f of ['General', '0', '0.00', '#,##0.00', '"R$" #,##0.00', '000"."000"."000"-"00', '@', '0%', '[h]:mm:ss', 'hh:mm']) expect(formatoDeData(f), f).toBe(false);
  });
});
