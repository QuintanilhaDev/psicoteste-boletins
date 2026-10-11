import { envolver, exigirSenha, json, lerCorpo, Falha } from './_lib/http.js';
import {
  ambiente, assinar, certificado, chamar, extrairNota, montarLote, achar,
  xmlConsultaLote, xmlConsultaNfseRps, xmlConsultaSituacao,
} from './_lib/nfse.js';

const so = (v) => String(v ?? '').replace(/\D/g, '');

export default envolver(async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Use POST.' });
  if (!exigirSenha(req, res)) return;
  const b = await lerCorpo(req);
  const cert = certificado();
  if (!cert) throw new Falha('Certificado digital A1 ainda não configurado.', 503);
  if (cert.vencido) throw new Falha('O certificado digital está vencido.', 503);
  const p = b.prestador ?? b.dados?.prestador;
  if (!p || so(p.cnpj).length !== 14) throw new Falha('Informe o CNPJ da clínica nos ajustes.');
  if (cert.cnpj && cert.cnpj !== so(p.cnpj)) {
    throw new Falha(`O certificado é do CNPJ ${cert.cnpj}, diferente do CNPJ da clínica nos ajustes.`);
  }

  if (b.acao === 'emitir') {
    const xml = assinar(montarLote(b.dados), cert);
    const r = await chamar('enviar', xml, cert);
    if (r.erros.length) return json(res, 200, { erros: r.erros });
    const protocolo = achar(r.obj, 'Protocolo');
    if (!protocolo) throw new Falha('A prefeitura não devolveu o protocolo do lote.', 502);
    return json(res, 200, { protocolo: String(protocolo), ambiente: ambiente() });
  }
  if (b.acao === 'situacao') {
    const r = await chamar('situacao', xmlConsultaSituacao(p, b.protocolo), cert);
    if (r.erros.length) return json(res, 200, { erros: r.erros });
    const situacao = Number(achar(r.obj, 'Situacao'));
    if (situacao === 3) {
      const l = await chamar('lote', xmlConsultaLote(p, b.protocolo), cert);
      return json(res, 200, { situacao, erros: l.erros });
    }
    return json(res, 200, { situacao });
  }
  if (b.acao === 'consultar') {
    const r = await chamar('nfseRps', xmlConsultaNfseRps(p, b.rps, b.serie), cert);
    const nota = extrairNota(r);
    if (nota) return json(res, 200, { nota: { ...nota, ambiente: ambiente() } });
    return json(res, 200, { erros: r.erros });
  }
  throw new Falha('Ação desconhecida.');
});
