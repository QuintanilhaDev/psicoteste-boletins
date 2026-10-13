import { describe, it, expect } from 'vitest';
import { gente, xlsx, ler, cpf, pessoa } from './util';
import { estadoInicial, importarLeitura, juntarClientes, normalizarEstado, pendencias, porCliente, porMes, recalcular, resolverRepetidos, totais, Estado } from '../src/core/model';
import { semelhancaNucleo } from '../src/core/text';

const importar = (e: Estado, nome: string, linhas: (string | number | null)[][], agora = new Date(2026, 2, 20)) => {
  const r = ler(nome, xlsx({ Plan1: linhas }));
  return importarLeitura(e, nome, r.hash, r, agora);
};
const cab = ['Nome', 'CPF', 'Empresa'];

describe('regras de negócio', () => {
  it('um boletim por empresa e por mês; numeração sequencial; preço padrão e por cliente', () => {
    const e = estadoInicial(); e.config.precoPadrao = 80;
    const g = gente(6);
    importar(e, 'a.xlsx', [[...cab, 'Data'], [g[0].nome, g[0].cpf, 'Alfa', '10/01/2026'], [g[1].nome, g[1].cpf, 'Alfa', '11/02/2026'], [g[2].nome, g[2].cpf, 'Alfa', '12/02/2026'], [g[3].nome, g[3].cpf, 'Beta', '12/02/2026']]);
    expect(e.boletins.map((b) => [b.numero, b.competencia, b.quantidade, b.total])).toEqual([[1, '2026-01', 1, 80], [2, '2026-02', 2, 160], [3, '2026-02', 1, 80]]);
    e.clientes.find((c) => c.nome === 'Beta')!.preco = 99.9;
    recalcular(e);
    expect(e.boletins[2].total).toBe(99.9);
    expect(totais(e).faturado).toBe(339.9);
    expect(porMes(e).map((l) => [l.chave, l.testes])).toEqual([['2026-01', 1], ['2026-02', 3]]);
    expect(porCliente(e, '2026-02').map((l) => [l.rotulo, l.testes])).toEqual([['Alfa', 2], ['Beta', 1]]);
  });
  it('não cobra duas vezes: mesmo arquivo, mesma pessoa em arquivo diferente, CPF repetido na própria planilha', () => {
    const e = estadoInicial(); e.config.precoPadrao = 50;
    const g = gente(3);
    const linhas = [cab, ...g.map((p) => [p.nome, p.cpf, 'Alfa Segurança Ltda']), [g[0].nome, g[0].cpf, 'Alfa Segurança Ltda']];
    const i1 = importar(e, 'a.xlsx', linhas);
    expect([i1.novos, i1.repetidos, i1.repetidosNoArquivo, e.boletins[0].quantidade]).toEqual([3, 0, 1, 3]);
    const i2 = importar(e, 'copia de a.xlsx', linhas);
    expect(i2.repetida).toBe(true);
    const novo = { nome: pessoa(), cpf: cpf() };
    const i3 = importar(e, 'b.xlsx', [['CPF', 'Vigilante', 'Contratante'], ...g.map((p) => [p.cpf, p.nome, 'ALFA SEGURANCA LTDA']), [novo.cpf, novo.nome, 'ALFA SEGURANCA LTDA']]);
    expect([i3.novos, i3.repetidos]).toEqual([1, 3]);
    expect(e.boletins.map((b) => b.quantidade)).toEqual([3, 1]);
    expect(e.clientes.length).toBe(1);
  });
  it('mesma pessoa com data em outro mês é novo psicoteste (cobra)', () => {
    const e = estadoInicial(); e.config.precoPadrao = 50;
    const g = gente(1);
    importar(e, 'a.xlsx', [[...cab, 'Data'], [g[0].nome, g[0].cpf, 'Alfa', '10/01/2026']]);
    importar(e, 'b.xlsx', [[...cab, 'Data'], [g[0].nome, g[0].cpf, 'Alfa', '10/03/2026']]);
    expect(e.boletins.length).toBe(2);
    expect(e.boletins[1].duvida).toBeUndefined();
  });
  it('planilha sem data reenviada no mês seguinte: pergunta antes de cobrar', () => {
    const e = estadoInicial(); e.config.precoPadrao = 50;
    const g = gente(3);
    importar(e, 'a.xlsx', [cab, ...g.map((p) => [p.nome, p.cpf, 'Alfa'])], new Date(2026, 2, 28));
    importar(e, 'a com mais um.xlsx', [cab, ...g.map((p) => [p.nome, p.cpf, 'Alfa']), [pessoa(), cpf(), 'Alfa']], new Date(2026, 3, 2));
    const b = e.boletins[1];
    expect(b.duvida?.cpfs.length).toBe(3);
    expect(pendencias(e, b).some((p) => p.tipo === 'repetidos')).toBe(true);
    resolverRepetidos(e, b.id, false);
    expect([e.boletins[1].quantidade, e.boletins[1].total, e.boletins[1].duvida]).toEqual([1, 50, undefined]);
  });
  it('nomes de empresas: junta erro de digitação óbvio, pergunta quando parecido, separa quando diferente', () => {
    expect(semelhancaNucleo('Falcão Segurança Ltda', 'Alfa Segurança Ltda')).toBeLessThan(0.6);
    expect(semelhancaNucleo('Proteje Segurança', 'Protege Segurança')).toBeGreaterThanOrEqual(0.6);
    const e = estadoInicial();
    const g = gente(7);
    importar(e, 'a.xlsx', [cab, [g[0].nome, g[0].cpf, 'Alfa Segurança Ltda'], [g[1].nome, g[1].cpf, 'ALFA SEGURANÇA LTDA - ME'], [g[2].nome, g[2].cpf, 'Alfa Vigilância Ltda'], [g[3].nome, g[3].cpf, 'Falcão Segurança Ltda'], [g[4].nome, g[4].cpf, 'Beta Segurança'], [g[5].nome, g[5].cpf, 'Alfa Seguranca Patrimonial'], [g[6].nome, g[6].cpf, 'Alfa Segurançaa Ltda']]);
    const nomes = e.clientes.map((c) => [c.nome, !!c.parecidoCom]);
    expect(nomes).toEqual([['Alfa Segurança Ltda', false], ['Alfa Vigilância Ltda', true], ['Falcão Segurança Ltda', false], ['Beta Segurança', false], ['Alfa Seguranca Patrimonial', true]]);
    expect(e.boletins.find((b) => b.clienteId === e.clientes[0].id)!.quantidade).toBe(3);
    // juntar move os boletins e ensina o apelido
    juntarClientes(e, e.clientes[4].id, e.clientes[0].id);
    expect(e.clientes[0].apelidos).toContain('Alfa Seguranca Patrimonial');
    expect(e.boletins.filter((b) => b.clienteId === e.clientes[0].id).reduce((a, b) => a + b.quantidade, 0)).toBe(4);
    const i = importar(e, 'b.xlsx', [cab, [pessoa(), cpf(), 'ALFA SEGURANCA PATRIMONIAL']]);
    expect(e.boletins.find((b) => b.id === i.boletimIds[0])!.clienteId).toBe(e.clientes[0].id);
  });
  it('mesmo nome com CNPJ diferente são clientes diferentes; CNPJ igual com nome diferente é o mesmo', () => {
    const e = estadoInicial();
    const c = ['Nome', 'CPF', 'Empresa', 'CNPJ'];
    importar(e, 'a.xlsx', [c, [pessoa(), cpf(), 'Alfa', '11.222.333/0001-81'], [pessoa(), cpf(), 'Alfa', '11.444.777/0001-61'], [pessoa(), cpf(), 'Alfa Matriz', '11.222.333/0001-81']]);
    expect(e.clientes.map((x) => x.cnpj)).toEqual(['11222333000181', '11444777000161']);
    expect(e.boletins.map((b) => b.quantidade)).toEqual([2, 1]);
  });
  it('pendências bloqueiam a nota até o cadastro estar completo', () => {
    const e = estadoInicial();
    importar(e, 'a.xlsx', [cab, [pessoa(), cpf(), 'Alfa']]);
    const tipos = () => pendencias(e, e.boletins[0]).map((p) => p.tipo);
    expect(tipos()).toEqual(['cliente', 'preco', 'clinica']);
    e.config.precoPadrao = 80; recalcular(e);
    Object.assign(e.config.prestador, { razao: 'Clínica', cnpj: '11222333000181', im: '123456' }); e.config.fiscal.cnae = '8650003';
    Object.assign(e.clientes[0], { cnpj: '11444777000161', email: 'a@b.com.br' });
    expect(tipos()).toEqual(['cliente']);
    Object.assign(e.clientes[0].endereco, { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '40000000', uf: 'BA', codMunicipio: '2927408' });
    expect(tipos()).toEqual([]);
  });
  it('planilha sem empresa fica aguardando identificação; resumo vira boletim sem nomes', () => {
    const e = estadoInicial();
    importar(e, 'planilha.xlsx', [['Nome', 'CPF'], [pessoa(), cpf()]]);
    expect(e.clientes[0].naoIdentificado).toBe(true);
    expect(pendencias(e, e.boletins[0])[0].tipo).toBe('identificar');
    importar(e, 'resumo fev 2026.xlsx', [['Empresa', 'Qtd'], ['Alfa', 12], ['Beta', 3]]);
    expect(e.boletins.slice(1).map((b) => [b.quantidade, b.pessoas.length, b.competencia])).toEqual([[12, 0, '2026-02'], [3, 0, '2026-02']]);
  });
  it('estado salvo antigo/corrompido não quebra; emissão interrompida volta para a fila', () => {
    expect(normalizarEstado(null).boletins).toEqual([]);
    expect(normalizarEstado({ boletins: 'x', config: { fiscal: null } }).config.fiscal.serie).toBe('A');
    const e = estadoInicial();
    importar(e, 'a.xlsx', [cab, [pessoa(), cpf(), 'Alfa']]);
    e.boletins[0].nota.status = 'emitindo'; e.boletins[0].nota.rps = 5; e.seqBoletim = 1;
    const n = normalizarEstado(JSON.parse(JSON.stringify(e)));
    expect([n.boletins[0].nota.status, n.boletins[0].nota.rps, n.seqBoletim]).toEqual(['pendente', 5, 2]);
  });
  it('data absurda (nascimento lido como data do exame) não define o mês', () => {
    const e = estadoInicial();
    const i = importar(e, 'a.xlsx', [['Nome', 'CPF', 'Empresa', 'Data'], [pessoa(), cpf(), 'Alfa', '12/05/2003'], [pessoa(), cpf(), 'Alfa', '18/03/2026']]);
    expect(e.boletins.map((b) => [b.competencia, b.quantidade])).toEqual([['2026-03', 2]]);
    expect(i.avisos.join(' ')).toMatch(/fora do período/);
  });
  it('caixa: nota tirada, recebido, em aberto', () => {
    const e = estadoInicial(); e.config.precoPadrao = 100;
    importar(e, 'a.xlsx', [cab, [pessoa(), cpf(), 'Alfa'], [pessoa(), cpf(), 'Beta'], [pessoa(), cpf(), 'Beta'], [pessoa(), cpf(), 'Gama']]);
    e.boletins[0].nota.status = 'emitida'; e.boletins[0].recebido = true;
    e.boletins[1].nota.status = 'emitida';
    expect(totais(e)).toMatchObject({ testes: 4, faturado: 400, comNota: 300, recebido: 100, aberto: 200, semNota: 100 });
    recalcular(e); e.config.precoPadrao = 999; recalcular(e);
    expect(e.boletins.map((b) => b.total)).toEqual([100, 200, 999]); // nota emitida não muda de valor
  });
});
