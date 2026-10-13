import nodemailer from 'nodemailer';
import { envolver, exigirSenha, json, lerCorpo, Falha } from './_lib/http.js';

export const emailPronto = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;

export default envolver(async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Use POST.' });
  if (!exigirSenha(req, res)) return;
  if (!emailPronto()) throw new Falha('Envio de e-mail ainda não configurado.', 503);
  const b = await lerCorpo(req);
  const para = String(b.para ?? '').split(/[;,\s]+/).filter(Boolean);
  if (!para.length || !para.every((e) => RE.test(e))) throw new Falha('E-mail do cliente inválido.');
  if (para.length > 20) throw new Falha('No máximo 20 destinatários por envio.');
  const anexos = Array.isArray(b.anexos) ? b.anexos.slice(0, 6) : [];
  const porta = Number(process.env.SMTP_PORT) || 587;
  const transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: porta, secure: porta === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000, socketTimeout: 20000,
  });
  const remetente = process.env.EMAIL_REMETENTE || process.env.SMTP_USER;
  const nomeRemetente = String(b.remetenteNome ?? '').replace(/["<>\r\n]/g, '').trim();
  try {
    const info = await transporte.sendMail({
      from: nomeRemetente ? `"${nomeRemetente}" <${remetente}>` : remetente,
      to: para.join(', '),
      bcc: process.env.EMAIL_COPIA || undefined,
      replyTo: String(b.responderPara ?? '').split(/[;,\s]+/).filter((x) => RE.test(x)).join(', ') || undefined,
      subject: String(b.assunto ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200),
      text: String(b.texto ?? ''),
      html: typeof b.html === 'string' ? b.html : undefined,
      attachments: anexos.map((a) => ({
        filename: String(a.nome ?? 'anexo').replace(/[\\/\r\n]/g, '_'),
        content: Buffer.from(String(a.base64 ?? ''), 'base64'),
        contentType: String(a.tipo ?? 'application/octet-stream'),
      })),
    });
    json(res, 200, { ok: true, id: info.messageId });
  } catch (e) {
    // senha errada ou destinatário recusado não se resolvem tentando de novo; queda de conexão, sim
    if (e.code === 'EAUTH') throw new Falha('O servidor de e-mail não aceitou o usuário/senha (SMTP_USER e SMTP_PASS).', 400);
    if (e.code === 'EENVELOPE' || (e.responseCode >= 500 && e.responseCode < 600)) throw new Falha(`O servidor de e-mail recusou a mensagem: ${e.response ?? e.message}`, 400);
    throw new Falha(`Não consegui falar com o servidor de e-mail: ${e.message}`, 502);
  }
});
