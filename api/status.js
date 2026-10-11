import { autenticado, envolver, json, senhaDefinida } from './_lib/http.js';
import { ambiente, certificado } from './_lib/nfse.js';
import { emailPronto } from './email.js';
import { nuvemPronta } from './sync.js';

export default envolver(async (req, res) => {
  const ok = autenticado(req);
  const base = { senhaDefinida: senhaDefinida(), autenticado: ok };
  if (!ok) return json(res, 200, base);
  let nfse = { pronto: false, ambiente: ambiente() };
  try {
    const c = certificado();
    if (c) nfse = { pronto: !c.vencido, ambiente: ambiente(), titular: c.titular, cnpj: c.cnpj, validade: c.validade, erro: c.vencido ? 'Certificado vencido.' : undefined };
  } catch (e) {
    nfse.erro = e.message;
  }
  json(res, 200, {
    ...base, nfse,
    email: { pronto: emailPronto(), remetente: process.env.EMAIL_REMETENTE || process.env.SMTP_USER || '' },
    nuvem: { pronto: nuvemPronta() },
  });
});
