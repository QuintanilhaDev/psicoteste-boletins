// Conversa com as funções do servidor (pasta /api). Sem servidor, o app segue funcionando só no navegador.

export interface Status {
  online: boolean;
  senhaDefinida: boolean;
  autenticado: boolean;
  nfse: { pronto: boolean; ambiente: string; titular?: string; cnpj?: string; validade?: string; erro?: string };
  email: { pronto: boolean; remetente: string };
  nuvem: { pronto: boolean };
}
export const statusVazio = (): Status => ({
  online: false, senhaDefinida: false, autenticado: false,
  nfse: { pronto: false, ambiente: 'homologacao' }, email: { pronto: false, remetente: '' }, nuvem: { pronto: false },
});

const CHAVE = 'psico-senha';
export const senhaSalva = () => { try { return localStorage.getItem(CHAVE) ?? ''; } catch { return ''; } };
export const salvarSenha = (s: string) => { try { localStorage.setItem(CHAVE, s); } catch { /* modo privado */ } };

export class ErroApi extends Error {
  constructor(msg: string, public status: number) { super(msg); }
  /** falha passageira (rede, prefeitura fora do ar): vale tentar de novo sozinho */
  get passageiro() { return this.status === 0 || this.status === 502 || this.status === 504 || this.status === 429; }
}

export async function api<T>(caminho: string, corpo?: unknown, method?: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/${caminho}`, {
      method: method ?? (corpo === undefined ? 'GET' : 'POST'),
      headers: { 'x-senha': senhaSalva(), ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi('Sem internet no momento.', 0);
  }
  const txt = await r.text();
  let dados: unknown = null;
  try { dados = JSON.parse(txt); } catch { /* resposta não-JSON (ex.: página do Vite em dev) */ }
  if (dados === null || typeof dados !== 'object') throw new ErroApi(r.status === 413 ? 'Arquivos grandes demais para enviar.' : 'O servidor não respondeu como esperado.', r.status === 200 ? 500 : r.status);
  if (!r.ok) throw new ErroApi(String((dados as { erro?: string }).erro ?? `Erro ${r.status}`), r.status);
  return dados as T;
}

export async function buscarStatus(): Promise<Status> {
  try {
    const s = await api<Partial<Status>>('status');
    return { ...statusVazio(), ...s, online: true };
  } catch {
    return statusVazio();
  }
}

export interface ErroPrefeitura { codigo: string; mensagem: string; correcao: string }
export interface NotaApi { numero: string; codigo: string; emitidaEm: string; xml: string; ambiente: string; valor: number; tomadorDoc: string }
