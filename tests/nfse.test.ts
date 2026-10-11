import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
// @ts-expect-error módulo JS do servidor
import * as nfse from '../api/_lib/nfse.js';
// @ts-expect-error módulo JS do servidor
import handler from '../api/nfse.js';
// @ts-expect-error módulo JS do servidor
import status from '../api/status.js';

const fx = (f: string) => path.join(__dirname, 'fixtures', f);
const dados = (rps = 7) => ({
  rps, serie: 'A', dataEmissao: '2026-10-10T10:00:00', valor: 1234.5,
  discriminacao: 'Avaliação psicológica de 15 vigilantes <março> & cia',
  prestador: { cnpj: '11.222.333/0001-81', im: '123.456/001-99' },
  fiscal: { itemLista: '0416', cnae: '8650003', codTributacao: '', aliquota: 5, simples: true, regime: '6', natureza: '1', issRetido: false, incentivador: false, nbs: '', cClassTrib: '', indop: '', codMunicipio: '2927408' },
  tomador: { nome: 'Alfa Segurança Ltda', cnpj: '11.444.777/0001-61', email: 'fin@alfa.com.br', telefone: '(71) 3333-4444', endereco: { logradouro: 'Av. Tancredo Neves', numero: '100', complemento: '', bairro: 'Caminho das Árvores', codMunicipio: '2927408', uf: 'ba', cep: '41820-020' } },
});

function chamarApi(h: any, body: unknown, senha = 'segredo', method = 'POST') {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const res: any = { statusCode: 200, headers: {}, setHeader(k: string, v: string) { this.headers[k] = v; }, writableEnded: false,
      end(t: string) { this.writableEnded = true; resolve({ status: this.statusCode, body: JSON.parse(t) }); } };
    h({ method, headers: { 'x-senha': senha }, body }, res);
  });
}

describe('NFS-e Salvador', () => {
  let servidor: https.Server;
  const recebidos: { url: string; action: string; body: string; cn: string }[] = [];
  let modo: 'ok' | 'duplicado' | 'erroLote' = 'ok';
  const emitidos = new Set<string>();

  beforeAll(async () => {
    process.env.SENHA_DO_APP = 'segredo';
    process.env.NFSE_CERT_PFX_BASE64 = fs.readFileSync(fx('legado.pfx')).toString('base64');
    process.env.NFSE_CERT_SENHA = 'senha123';
    process.env.NFSE_CA_PEM_BASE64 = fs.readFileSync(fx('ca.pem')).toString('base64');
    const env = (op: string, interno: string) =>
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${op}Response xmlns="http://tempuri.org/"><${op}Result>${interno.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</${op}Result></${op}Response></s:Body></s:Envelope>`;
    servidor = https.createServer({ key: fs.readFileSync(fx('srv.key')), cert: fs.readFileSync(fx('srv.pem')), ca: fs.readFileSync(fx('ca.pem')), requestCert: true, rejectUnauthorized: true }, (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const cn = (req.socket as any).getPeerCertificate()?.subject?.CN ?? '';
        if (req.method === 'GET') { res.end(`<wsdl><operation><soap:operation soapAction="http://tempuri.org/IServico/${req.url!.includes('ENVIO') ? 'EnviarLoteRPS' : 'X'}"/></operation></wsdl>`); return; }
        recebidos.push({ url: req.url!, action: String(req.headers.soapaction), body, cn });
        const rps = (body.match(/&lt;Numero&gt;(\d+)|<Numero>(\d+)/) ?? []).slice(1).find(Boolean) ?? '';
        res.setHeader('Content-Type', 'text/xml');
        if (req.url!.includes('ENVIOLOTERPS')) {
          if (modo === 'duplicado' || emitidos.has(rps)) return res.end(env('EnviarLoteRPS', '<EnviarLoteRpsResposta><ListaMensagemRetorno><MensagemRetorno><Codigo>E10</Codigo><Mensagem>RPS já informado.</Mensagem><Correcao>Já existe.</Correcao></MensagemRetorno></ListaMensagemRetorno></EnviarLoteRpsResposta>'));
          if (modo === 'ok') emitidos.add(rps);
          return res.end(env('EnviarLoteRPS', `<EnviarLoteRpsResposta xmlns="x"><NumeroLote>${rps}</NumeroLote><DataRecebimento>2026-10-10</DataRecebimento><Protocolo>P${rps}</Protocolo></EnviarLoteRpsResposta>`));
        }
        if (req.url!.includes('CONSULTASITUACAOLOTERPS')) return res.end(env('ConsultarSituacaoLoteRPS', `<R><NumeroLote>1</NumeroLote><Situacao>${modo === 'erroLote' ? 3 : 4}</Situacao></R>`));
        if (req.url!.includes('CONSULTALOTERPS')) return res.end(env('ConsultarLoteRPS', '<R><ListaMensagemRetorno><MensagemRetorno><Codigo>E160</Codigo><Mensagem>CNAE inválido</Mensagem><Correcao>Corrija</Correcao></MensagemRetorno></ListaMensagemRetorno></R>'));
        if (req.url!.includes('CONSULTANFSERPS')) {
          if (!emitidos.has(rps)) return res.end(env('ConsultarNfseRPS', '<R><ListaMensagemRetorno><MensagemRetorno><Codigo>E4</Codigo><Mensagem>RPS não encontrado</Mensagem><Correcao/></MensagemRetorno></ListaMensagemRetorno></R>'));
          return res.end(env('ConsultarNfseRPS', `<ConsultarNfseRpsResposta><CompNfse><Nfse><InfNfse><Numero>2026000${rps}</Numero><CodigoVerificacao>ABCD-1234</CodigoVerificacao><DataEmissao>2026-10-10T10:00:01</DataEmissao></InfNfse></Nfse></CompNfse></ConsultarNfseRpsResposta>`));
        }
        res.statusCode = 404; res.end('x');
      });
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    process.env.NFSE_URL_BASE = `https://localhost:${(servidor.address() as any).port}`;
  });
  afterAll(() => servidor?.close());

  it('lê certificado A1 moderno e legado (RC2) e extrai o CNPJ', () => {
    const c = nfse.certificado();
    expect(c).toMatchObject({ titular: 'CLINICA TESTE LTDA', cnpj: '11222333000181', vencido: false });
    process.env.NFSE_CERT_PFX_BASE64 = fs.readFileSync(fx('moderno.pfx')).toString('base64');
    expect(nfse.certificado().cnpj).toBe('11222333000181');
    process.env.NFSE_CERT_SENHA = 'errada';
    process.env.NFSE_CERT_PFX_BASE64 += '\n';
    expect(() => nfse.certificado()).toThrow(/Senha do certificado/);
    process.env.NFSE_CERT_SENHA = 'senha123';
  });

  it('monta o lote na ordem do schema, escapa texto e calcula o ISS', () => {
    const xml = nfse.montarLote(dados());
    expect(xml).toContain('<Discriminacao>Avaliação psicológica de 15 vigilantes &lt;março&gt; &amp; cia</Discriminacao>');
    expect(xml).toContain('<ValorServicos>1234.50</ValorServicos>');
    expect(xml).toContain('<ValorIss>61.73</ValorIss>');
    expect(xml).toContain('<Aliquota>0.0500</Aliquota>');
    expect(xml).toContain('<Prestador><Cnpj>11222333000181</Cnpj><InscricaoMunicipal>12345600199</InscricaoMunicipal></Prestador>');
    expect(xml).toContain('<Cep>41820020</Cep>');
    expect(xml).toContain('<Uf>BA</Uf>');
    const ordem = ['IdentificacaoRps', 'DataEmissao', 'NaturezaOperacao', 'RegimeEspecialTributacao', 'OptanteSimplesNacional', 'IncentivadorCultural', 'Status', 'Servico', 'Prestador', 'Tomador'].map((t) => xml.indexOf(`<${t}>`));
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect(new DOMParser().parseFromString(xml, 'text/xml').documentElement!.nodeName).toBe('EnviarLoteRpsEnvio');
    expect(() => nfse.montarLote({ ...dados(), valor: 0 })).toThrow(/Valor/);
    expect(() => nfse.montarLote({ ...dados(), rps: 1.5 })).toThrow(/RPS/);
  });

  it('assina e a assinatura confere', () => {
    const cert = nfse.certificado();
    const assinado = nfse.assinar(nfse.montarLote(dados()), cert);
    expect(assinado.match(/<Signature /g)?.length).toBe(2);
    expect(assinado).toMatch(/<\/InfRps><Signature [\s\S]*<\/Signature><\/Rps>/);
    // confere a assinatura do lote (a cópia dentro do RPS é removida para validar a raiz, como faz o validador do município)
    const doc = new DOMParser().parseFromString(assinado, 'text/xml');
    const sigs = Array.from(doc.getElementsByTagName('Signature'));
    const raiz = sigs.find((s) => s.parentNode === doc.documentElement)!;
    const noRps = sigs.find((s) => s !== raiz)!;
    noRps.parentNode!.removeChild(noRps);
    const v = new SignedXml({ publicCert: cert.certPem });
    v.loadSignature(raiz as never);
    expect(v.checkSignature(doc.toString())).toBe(true);
    expect(assinado).toContain('<X509Certificate>');
  });

  it('fluxo completo pela API: emitir → situação → consultar', async () => {
    modo = 'ok';
    const e = await chamarApi(handler, { acao: 'emitir', dados: dados(7) });
    expect(e.body).toEqual({ protocolo: 'P7', ambiente: 'homologacao' });
    const env = recebidos.at(-1)!;
    expect(env.cn).toBe('CLINICA TESTE LTDA:11222333000181'); // TLS mútuo com o certificado do cliente
    expect(env.action).toBe('"http://tempuri.org/IServico/EnviarLoteRPS"'); // descoberto no WSDL
    expect(env.body).toContain('<loteXML><![CDATA[<?xml');
    const s = await chamarApi(handler, { acao: 'situacao', prestador: dados().prestador, protocolo: 'P7' });
    expect(s.body).toEqual({ situacao: 4 });
    expect(recebidos.at(-1)!.action).toBe('"http://tempuri.org/IConsultaSituacaoLoteRPS/ConsultarSituacaoLoteRPS"'); // convenção
    const c = await chamarApi(handler, { acao: 'consultar', prestador: dados().prestador, rps: 7, serie: 'A' });
    expect(c.body.nota).toMatchObject({ numero: '20260007', codigo: 'ABCD-1234' });
    expect(c.body.nota.xml).toContain('<InfNfse>');
  });

  it('RPS repetido é recusado pela prefeitura (não emite em dobro)', async () => {
    const e = await chamarApi(handler, { acao: 'emitir', dados: dados(7) });
    expect(e.body.erros[0].codigo).toBe('E10');
    const c = await chamarApi(handler, { acao: 'consultar', prestador: dados().prestador, rps: 99, serie: 'A' });
    expect(c.body.erros[0].codigo).toBe('E4');
  });

  it('lote processado com erro devolve os motivos', async () => {
    modo = 'erroLote';
    const s = await chamarApi(handler, { acao: 'situacao', prestador: dados().prestador, protocolo: 'P8' });
    expect(s.body).toMatchObject({ situacao: 3, erros: [{ codigo: 'E160' }] });
    modo = 'ok';
  });

  it('proteções: senha, CNPJ diferente do certificado, sem certificado', async () => {
    expect((await chamarApi(handler, { acao: 'emitir', dados: dados() }, 'errada')).status).toBe(401);
    const outro = dados(); outro.prestador.cnpj = '11.444.777/0001-61';
    expect((await chamarApi(handler, { acao: 'emitir', dados: outro })).body.erro).toMatch(/certificado é do CNPJ/);
    expect((await chamarApi(handler, 'isto não é json{', 'segredo')).status).toBe(400);
    const st = await chamarApi(status, undefined, 'segredo', 'GET');
    expect(st.body).toMatchObject({ autenticado: true, nfse: { pronto: true, titular: 'CLINICA TESTE LTDA' }, email: { pronto: false }, nuvem: { pronto: false } });
    expect((await chamarApi(status, undefined, 'x', 'GET')).body).toEqual({ senhaDefinida: true, autenticado: false });
    const pfx = process.env.NFSE_CERT_PFX_BASE64; delete process.env.NFSE_CERT_PFX_BASE64;
    expect((await chamarApi(handler, { acao: 'emitir', dados: dados() })).status).toBe(503);
    process.env.NFSE_CERT_PFX_BASE64 = pfx;
    delete process.env.SENHA_DO_APP;
    expect((await chamarApi(handler, { acao: 'emitir', dados: dados() }, '')).status).toBe(503);
    process.env.SENHA_DO_APP = 'segredo';
  });
});
