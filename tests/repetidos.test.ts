import { describe, it, expect } from 'vitest';
import { gente, xlsx, ler, cpf } from './util';
import { estadoInicial, importarLeitura, normalizarEstado, Estado } from '../src/core/model';

// Correção do relato "boletim com nomes duplicados": cada vigilante conta uma vez por cliente e por mês.
const importar = (nome: string, bytes: Uint8Array, e: Estado = estadoInicial()) => {
  const r = ler(nome, bytes);
  importarLeitura(e, nome, r.hash, r, new Date(2026, 9, 10));
  return e;
};
const pessoas = (e: Estado) => e.boletins.flatMap((b) => b.pessoas.map((p) => p.cpf));

describe('nomes repetidos no boletim', () => {
  const g = gente(3);
  const cpfs = g.map((p) => p.cpf).sort();

  it('pessoa ocupando 2 linhas (células mescladas) com CPF só na primeira', () => {
    const l: unknown[][] = [['Empresa: Guardião Segurança'], ['Vigilante', 'CPF', 'Exame']];
    const m: object[] = [];
    g.forEach((p, i) => { l.push([p.nome, p.cpf, 'Psicológico'], [null, null, 'Atenção']); m.push({ s: { r: 2 + i * 2, c: 0 }, e: { r: 3 + i * 2, c: 0 } }); });
    const e = importar('a.xlsx', xlsx({ P: l as never }, { merges: { P: m as never } }));
    expect(pessoas(e).sort()).toEqual(cpfs);
  });
  it('mesmo CPF duas vezes no mês (datas diferentes) conta uma vez', () => {
    const e = importar('c.xlsx', xlsx({ P: [['Vigilante', 'CPF', 'Empresa', 'Data'], ...g.flatMap((p) => [[p.nome, p.cpf, 'Guardião', '05/10/2026'], [p.nome, p.cpf, 'Guardião', '06/10/2026']])] }));
    expect(e.boletins.map((b) => b.quantidade)).toEqual([3]);
    expect(e.importacoes[0].avisos.join(' ')).toMatch(/contada uma vez/);
  });
  it('mesmo nome com e sem CPF, com e sem acento/maiúsculas', () => {
    const e = importar('f.xlsx', xlsx({ P: [['Vigilante', 'CPF', 'Empresa'], ...g.flatMap((p) => [[p.nome.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), '', 'Guardião'], [p.nome, p.cpf, 'Guardião']])] }));
    expect(pessoas(e).sort()).toEqual(cpfs); // a linha sem CPF foi completada pela que tinha
  });
  it('segunda aba com os mesmos nomes não vira outra empresa nem outro boletim', () => {
    const e = importar('Guardião.xlsx', xlsx({ Lista: [['Vigilante', 'CPF'], ...g.map((p) => [p.nome, p.cpf])], Nomes: [['Vigilante'], ...g.map((p) => [p.nome])] }));
    expect([e.clientes.length, e.boletins.length, e.boletins[0].quantidade]).toEqual([1, 1, 3]);
  });
  it('layout empilhado: nome numa linha e "CPF: ..." na de baixo', () => {
    const e = importar('Guardião Segurança.xlsx', xlsx({ P: [['Vigilante'], ...g.flatMap((p) => [[p.nome], [`CPF: ${p.cpf}`]])] }));
    expect(pessoas(e).sort()).toEqual(cpfs);
  });
  it('homônimos com CPFs diferentes continuam sendo duas pessoas', () => {
    const e = importar('h.xlsx', xlsx({ P: [['Vigilante', 'CPF', 'Empresa'], ['José da Silva', cpf(), 'Guardião'], ['José da Silva', cpf(), 'Guardião']] }));
    expect(e.boletins[0].quantidade).toBe(2);
  });
  it('mesma pessoa em meses diferentes (com data) é cobrada em cada mês', () => {
    const e = importar('m.xlsx', xlsx({ P: [['Vigilante', 'CPF', 'Empresa', 'Data'], [g[0].nome, g[0].cpf, 'Guardião', '10/09/2026'], [g[0].nome, g[0].cpf, 'Guardião', '10/10/2026']] }));
    expect(e.boletins.map((b) => [b.competencia, b.quantidade])).toEqual([['2026-09', 1], ['2026-10', 1]]);
  });
  it('boletins salvos antes da correção: sem nota são corrigidos e baixados de novo; com nota recebem aviso', () => {
    const e = estadoInicial(); e.config.precoPadrao = 50;
    importar('x.xlsx', xlsx({ P: [['Vigilante', 'CPF', 'Empresa'], ...g.map((p) => [p.nome, p.cpf, 'Guardião']), [pessoa2(), cpf(), 'Beta']] }), e);
    // simula dados antigos com cada nome em dobro
    for (const b of e.boletins) { b.pessoas = b.pessoas.flatMap((p) => [p, { ...p }]); b.quantidade = b.pessoas.length; b.total = b.quantidade * 50; b.baixado.boletim = true; }
    e.boletins[1].nota = { status: 'emitida', origem: 'manual', numero: '99', tentativas: 0 };
    const n = normalizarEstado(JSON.parse(JSON.stringify(e)));
    expect([n.boletins[0].quantidade, n.boletins[0].total, n.boletins[0].baixado.boletim]).toEqual([3, 150, false]);
    expect(n.boletins[1].quantidade).toBe(2); // nota emitida não muda sozinha...
    expect(n.boletins[1].observacoes.join(' ')).toMatch(/nota já foi emitida com 2. O correto seria 1/); // ...mas avisa
    expect(normalizarEstado(JSON.parse(JSON.stringify(n))).boletins[1].observacoes.length).toBe(n.boletins[1].observacoes.length); // aviso não se repete
  });
});
function pessoa2() { return 'Rita Bispo Conceição'; }
