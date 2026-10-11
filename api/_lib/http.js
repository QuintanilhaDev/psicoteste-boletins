import crypto from 'node:crypto';

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function lerCorpo(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    return req.body;
  }
  const partes = [];
  for await (const p of req) partes.push(p);
  const txt = Buffer.concat(partes).toString('utf8');
  return txt ? JSON.parse(txt) : {};
}

export const senhaDefinida = () => !!(process.env.SENHA_DO_APP && process.env.SENHA_DO_APP.length >= 4);

export function autenticado(req) {
  if (!senhaDefinida()) return false;
  const dada = String(req.headers['x-senha'] ?? '');
  const a = crypto.createHash('sha256').update(dada).digest();
  const b = crypto.createHash('sha256').update(process.env.SENHA_DO_APP).digest();
  return crypto.timingSafeEqual(a, b);
}

/** devolve true se a requisição pode seguir; senão já respondeu */
export function exigirSenha(req, res) {
  if (!senhaDefinida()) {
    json(res, 503, { erro: 'Defina a variável SENHA_DO_APP na Vercel para liberar esta função.' });
    return false;
  }
  if (!autenticado(req)) {
    json(res, 401, { erro: 'Senha incorreta.' });
    return false;
  }
  return true;
}

export function envolver(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      const msg = e instanceof SyntaxError ? 'Requisição inválida.' : String(e?.message ?? e);
      if (!res.writableEnded) json(res, e?.status ?? (e instanceof SyntaxError ? 400 : 500), { erro: msg });
    }
  };
}

export class Falha extends Error {
  constructor(msg, status = 400) {
    super(msg);
    this.status = status;
  }
}
