// Cópia de segurança/sincronização opcional no Supabase (tabela psico_estado). Ver supabase/schema.sql.
import { envolver, exigirSenha, json, lerCorpo, Falha } from './_lib/http.js';

export const nuvemPronta = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

async function supa(caminho, init = {}) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${process.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Falha(`Supabase respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`, 502);
  return r;
}

export default envolver(async (req, res) => {
  if (!exigirSenha(req, res)) return;
  if (!nuvemPronta()) throw new Falha('Supabase não configurado.', 503);
  if (req.method === 'GET') {
    const r = await supa('psico_estado?id=eq.principal&select=dados,atualizado_em');
    const linhas = await r.json();
    return json(res, 200, linhas[0] ? { estado: linhas[0].dados, atualizadoEm: linhas[0].atualizado_em } : { estado: null });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    const b = await lerCorpo(req);
    if (!b.estado || typeof b.estado !== 'object' || !Array.isArray(b.estado.boletins)) throw new Falha('Dados inválidos.');
    await supa('psico_estado?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: 'principal', dados: b.estado, atualizado_em: b.estado.atualizadoEm ?? new Date().toISOString() }),
    });
    return json(res, 200, { ok: true });
  }
  json(res, 405, { erro: 'Método não suportado.' });
});
