// NFS-e de Salvador/BA — web service próprio no padrão ABRASF 1.0 (lote de RPS, assinado com certificado A1).
import https from 'node:https';
import tls from 'node:tls';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { XMLParser } from 'fast-xml-parser';
import { Falha } from './http.js';

const NS = 'http://www.abrasf.org.br/ABRASF/arquivos/nfse.xsd';
const BASES = {
  producao: 'https://nfse.salvador.ba.gov.br',
  homologacao: 'https://notahml.salvador.ba.gov.br',
};
const SERVICOS = {
  enviar: { caminho: '/rps/ENVIOLOTERPS/EnvioLoteRPS.svc', op: 'EnviarLoteRPS', param: 'loteXML', contrato: 'IEnvioLoteRPS' },
  situacao: { caminho: '/rps/CONSULTASITUACAOLOTERPS/ConsultaSituacaoLoteRPS.svc', op: 'ConsultarSituacaoLoteRPS', param: 'loteXML', contrato: 'IConsultaSituacaoLoteRPS' },
  lote: { caminho: '/rps/CONSULTALOTERPS/ConsultaLoteRPS.svc', op: 'ConsultarLoteRPS', param: 'loteXML', contrato: 'IConsultaLoteRPS' },
  nfseRps: { caminho: '/rps/CONSULTANFSERPS/ConsultaNfseRPS.svc', op: 'ConsultarNfseRPS', param: 'consultaxml', contrato: 'IConsultaNfseRPS' },
};

export const ambiente = () => (String(process.env.NFSE_AMBIENTE ?? '').toLowerCase() === 'producao' ? 'producao' : 'homologacao');

const so = (v) => String(v ?? '').replace(/\D/g, '');
const esc = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (nome, v) => (v === undefined || v === null || v === '' ? '' : `<${nome}>${esc(v)}</${nome}>`);
const dinheiro = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);

let cacheCert;
export function certificado() {
  const b64 = process.env.NFSE_CERT_PFX_BASE64;
  if (!b64) return null;
  if (cacheCert && cacheCert.origem === b64) return cacheCert;
  let p12;
  try {
    const der = forge.util.decode64(b64.replace(/\s+/g, ''));
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), process.env.NFSE_CERT_SENHA ?? '');
  } catch (e) {
    throw new Falha(/mac|password|senha/i.test(String(e?.message)) ? 'Senha do certificado incorreta (NFSE_CERT_SENHA).' : 'Certificado inválido: confira NFSE_CERT_PFX_BASE64.', 500);
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  if (!chaves.length || !certs.length) throw new Falha('O arquivo .pfx não contém chave privada e certificado.', 500);
  const chave = chaves[0];
  // o certificado do titular é o que corresponde à chave privada
  const alvo =
    certs.find((c) => chave.attributes?.localKeyId && c.attributes?.localKeyId && String(c.attributes.localKeyId[0]) === String(chave.attributes.localKeyId[0])) ??
    certs.find((c) => c.cert && !c.cert.getExtension('basicConstraints')?.cA) ??
    certs[0];
  const cert = alvo.cert;
  const cn = cert.subject.getField('CN')?.value ?? '';
  const cnpj = (cn.match(/:(\d{14})\b/) ?? [])[1] ?? '';
  cacheCert = {
    origem: b64,
    keyPem: forge.pki.privateKeyToPem(chave.key),
    certPem: forge.pki.certificateToPem(cert),
    cadeiaPem: certs.map((c) => forge.pki.certificateToPem(c.cert)).join('\n'),
    titular: cn.replace(/:\d+$/, ''),
    cnpj,
    validade: cert.validity.notAfter.toISOString(),
    vencido: cert.validity.notAfter.getTime() < Date.now(),
  };
  return cacheCert;
}

export function montarLote(d) {
  const p = d.prestador;
  const t = d.tomador;
  const f = d.fiscal;
  const valor = Number(d.valor);
  if (!(valor > 0)) throw new Falha('Valor da nota inválido.');
  const rps = Number(d.rps);
  if (!Number.isInteger(rps) || rps < 1) throw new Falha('Número de RPS inválido.');
  const aliq = Number(f.aliquota) || 0; // em %
  const iss = Math.round((valor * aliq) / 100 * 100 + 1e-9) / 100;
  const retido = !!f.issRetido;
  const doc = so(t.cnpj);
  if (doc.length !== 14 && doc.length !== 11) throw new Falha('CNPJ/CPF do cliente inválido.');
  if (so(p.cnpj).length !== 14) throw new Falha('CNPJ da clínica inválido.');

  const valores =
    tag('ValorServicos', dinheiro(valor)) + tag('ValorDeducoes', '0.00') + tag('ValorPis', '0.00') +
    tag('ValorCofins', '0.00') + tag('ValorInss', '0.00') + tag('ValorIr', '0.00') + tag('ValorCsll', '0.00') +
    tag('IssRetido', retido ? 1 : 2) + tag('ValorIss', dinheiro(iss)) + tag('ValorIssRetido', dinheiro(retido ? iss : 0)) +
    tag('OutrasRetencoes', '0.00') + tag('BaseCalculo', dinheiro(valor)) + tag('Aliquota', (aliq / 100).toFixed(4)) +
    tag('ValorLiquidoNfse', dinheiro(valor - (retido ? iss : 0))) + tag('DescontoIncondicionado', '0.00') + tag('DescontoCondicionado', '0.00');

  const servico =
    `<Valores>${valores}</Valores>` + tag('ItemListaServico', so(f.itemLista)) + tag('CodigoCnae', so(f.cnae)) +
    tag('CodigoTributacaoMunicipio', f.codTributacao) + tag('Discriminacao', String(d.discriminacao).slice(0, 2000)) +
    tag('CodigoMunicipio', so(f.codMunicipio) || '2927408') + tag('NBS', so(f.nbs)) + tag('cClassTrib', so(f.cClassTrib)) + tag('INDOP', so(f.indop));

  const e = t.endereco ?? {};
  const tomador =
    `<IdentificacaoTomador><CpfCnpj>${doc.length === 14 ? tag('Cnpj', doc) : tag('Cpf', doc)}</CpfCnpj></IdentificacaoTomador>` +
    tag('RazaoSocial', String(t.nome).slice(0, 115)) +
    `<Endereco>${tag('Endereco', String(e.logradouro ?? '').slice(0, 125))}${tag('Numero', String(e.numero ?? '').slice(0, 10))}${tag('Complemento', String(e.complemento ?? '').slice(0, 60))}${tag('Bairro', String(e.bairro ?? '').slice(0, 60))}${tag('CodigoMunicipio', so(e.codMunicipio))}${tag('Uf', String(e.uf ?? '').toUpperCase())}${tag('Cep', so(e.cep))}</Endereco>` +
    (so(t.telefone) || t.email ? `<Contato>${tag('Telefone', so(t.telefone).slice(0, 11))}${tag('Email', t.email)}</Contato>` : '');

  const inf =
    `<IdentificacaoRps>${tag('Numero', rps)}${tag('Serie', d.serie || 'A')}${tag('Tipo', 1)}</IdentificacaoRps>` +
    tag('DataEmissao', d.dataEmissao) + tag('NaturezaOperacao', f.natureza || 1) + tag('RegimeEspecialTributacao', f.regime) +
    tag('OptanteSimplesNacional', f.simples ? 1 : 2) + tag('IncentivadorCultural', f.incentivador ? 1 : 2) + tag('Status', 1) +
    `<Servico>${servico}</Servico>` +
    `<Prestador>${tag('Cnpj', so(p.cnpj))}${tag('InscricaoMunicipal', so(p.im))}</Prestador>` +
    `<Tomador>${tomador}</Tomador>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?><EnviarLoteRpsEnvio xmlns="${NS}"><LoteRps id="lote${rps}">` +
    tag('NumeroLote', rps) + tag('Cnpj', so(p.cnpj)) + tag('InscricaoMunicipal', so(p.im)) + tag('QuantidadeRps', 1) +
    `<ListaRps><Rps><InfRps id="rps${rps}">${inf}</InfRps></Rps></ListaRps></LoteRps></EnviarLoteRpsEnvio>`
  );
}

/** Assinatura XMLDSig (RSA-SHA1, C14N) do documento inteiro, anexada no lote e em cada RPS — igual ao que o município aceita. */
export function assinar(xml, cert) {
  const sig = new SignedXml({
    privateKey: cert.keyPem,
    publicCert: cert.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: '/*',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    isEmptyUri: true,
  });
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
  const assinado = sig.getSignedXml();
  const bloco = sig.getSignatureXml();
  return assinado.replace('</InfRps></Rps>', `</InfRps>${bloco}</Rps>`);
}

const acoes = new Map();
function requisitar(url, { method = 'GET', headers = {}, body, cert }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const extraCa = process.env.NFSE_CA_PEM_BASE64 ? Buffer.from(process.env.NFSE_CA_PEM_BASE64, 'base64').toString('utf8') : undefined;
    const req = https.request(
      {
        hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers,
        key: cert?.keyPem, cert: cert?.certPem, ca: extraCa ? [...tls.rootCertificates, extraCa] : undefined, timeout: 25000,
      },
      (res) => {
        const partes = [];
        res.on('data', (c) => partes.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString('utf8') }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('A prefeitura demorou demais para responder.')));
    req.on('error', (e) => reject(new Falha(`Sem conexão com a prefeitura: ${e.message}`, 502)));
    if (body) req.write(body);
    req.end();
  });
}

async function soapAction(base, s, cert) {
  const k = base + s.caminho;
  if (acoes.has(k)) return acoes.get(k);
  let acao = `http://tempuri.org/${s.contrato}/${s.op}`;
  for (const q of ['?singleWsdl', '?wsdl']) {
    try {
      const r = await requisitar(base + s.caminho + q, { cert });
      const m = r.status === 200 && r.texto.match(new RegExp(`soapAction="([^"]*/${s.op})"`, 'i'));
      if (m) { acao = m[1]; break; }
    } catch { /* usa a convenção */ }
  }
  acoes.set(k, acao);
  return acao;
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });

function achar(obj, chave) {
  if (obj == null || typeof obj !== 'object') return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === chave.toLowerCase()) return v;
    const r = achar(v, chave);
    if (r !== undefined) return r;
  }
  return undefined;
}
const lista = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function interpretar(interno) {
  const obj = parser.parse(interno);
  const msgs = lista(achar(obj, 'MensagemRetorno')).map((m) => ({
    codigo: String(m.Codigo ?? ''), mensagem: String(m.Mensagem ?? '').trim(), correcao: String(m.Correcao ?? '').trim(),
  }));
  return { obj, erros: msgs };
}

export async function chamar(qual, xml, cert) {
  const s = SERVICOS[qual];
  const base = process.env.NFSE_URL_BASE || BASES[ambiente()];
  const acao = await soapAction(base, s, cert);
  const corpo =
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<${s.op} xmlns="http://tempuri.org/"><${s.param}><![CDATA[${xml.replace(/]]>/g, ']]]]><![CDATA[>')}]]></${s.param}></${s.op}></soap:Body></soap:Envelope>`;
  const r = await requisitar(base + s.caminho, {
    method: 'POST', cert, body: corpo,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${acao}"`, 'Content-Length': Buffer.byteLength(corpo) },
  });
  const env = (() => { try { return parser.parse(r.texto); } catch { return null; } })();
  const resultado = env ? achar(env, `${s.op}Result`) : undefined;
  if (typeof resultado !== 'string' || !resultado.trim()) {
    const falha = env ? achar(env, 'faultstring') ?? achar(env, 'Text') : undefined;
    throw new Falha(`A prefeitura respondeu algo inesperado (HTTP ${r.status})${falha ? `: ${typeof falha === 'string' ? falha : JSON.stringify(falha)}` : ''}.`, 502);
  }
  return { interno: resultado, ...interpretar(resultado) };
}

export const xmlConsultaSituacao = (p, protocolo) =>
  `<?xml version="1.0" encoding="utf-8"?><ConsultarSituacaoLoteRpsEnvio xmlns="${NS}"><Prestador>${tag('Cnpj', so(p.cnpj))}${tag('InscricaoMunicipal', so(p.im))}</Prestador>${tag('Protocolo', protocolo)}</ConsultarSituacaoLoteRpsEnvio>`;
export const xmlConsultaLote = (p, protocolo) =>
  `<?xml version="1.0" encoding="utf-8"?><ConsultarLoteRpsEnvio xmlns="${NS}"><Prestador>${tag('Cnpj', so(p.cnpj))}${tag('InscricaoMunicipal', so(p.im))}</Prestador>${tag('Protocolo', protocolo)}</ConsultarLoteRpsEnvio>`;
export const xmlConsultaNfseRps = (p, rps, serie) =>
  `<?xml version="1.0" encoding="utf-8"?><ConsultarNfseRpsEnvio xmlns="${NS}"><IdentificacaoRps>${tag('Numero', rps)}${tag('Serie', serie || 'A')}${tag('Tipo', 1)}</IdentificacaoRps><Prestador>${tag('Cnpj', so(p.cnpj))}${tag('InscricaoMunicipal', so(p.im))}</Prestador></ConsultarNfseRpsEnvio>`;

export function extrairNota(r) {
  const inf = achar(r.obj, 'InfNfse');
  if (!inf || !inf.Numero) return null;
  const tom = achar(inf, 'TomadorServico') ?? achar(inf, 'Tomador') ?? {};
  return {
    valor: Number(achar(inf, 'ValorServicos') ?? NaN),
    tomadorDoc: String(achar(tom, 'Cnpj') ?? achar(tom, 'Cpf') ?? '').replace(/\D/g, ''),
    numero: String(inf.Numero),
    codigo: String(inf.CodigoVerificacao ?? ''),
    emitidaEm: String(inf.DataEmissao ?? ''),
    xml: r.interno,
  };
}
export { achar };
