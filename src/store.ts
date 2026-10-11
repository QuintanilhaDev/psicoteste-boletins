// Estado do app: guardado no navegador (IndexedDB) e, se configurado, espelhado no Supabase.
import { useSyncExternalStore } from 'react';
import { get, set } from 'idb-keyval';
import { Estado, estadoInicial, normalizarEstado } from './core/model';
import { api, buscarStatus, Status, statusVazio } from './lib/api';

const CHAVE = 'psico-estado';
let estado: Estado = estadoInicial();
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export interface Ui {
  carregado: boolean;
  status: Status;
  ocupado: string | null;
  contagem: number | null; // segundos até emitir
  pausado: boolean;
  aviso: { texto: string; tipo: 'ok' | 'erro' | 'info' } | null;
  nuvem: 'off' | 'ok' | 'enviando' | 'erro';
  leituras: { arquivo: string; ok: boolean; texto: string }[];
}
let ui: Ui = { carregado: false, status: statusVazio(), ocupado: null, contagem: null, pausado: false, aviso: null, nuvem: 'off', leituras: [] };

export const getEstado = () => estado;
export const getUi = () => ui;
export const useEstado = () => useSyncExternalStore(sub, getEstado);
export const useUi = () => useSyncExternalStore(sub, getUi);
function sub(f: () => void) { ouvintes.add(f); return () => ouvintes.delete(f); }

export function setUi(p: Partial<Ui>) { ui = { ...ui, ...p }; avisar(); }
let timerAviso: ReturnType<typeof setTimeout> | undefined;
export function avisarUsuario(texto: string, tipo: 'ok' | 'erro' | 'info' = 'ok') {
  setUi({ aviso: { texto, tipo } });
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => setUi({ aviso: null }), tipo === 'erro' ? 9000 : 5000);
}

const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('psico') : null;
let gravando: Promise<void> = Promise.resolve();
let memoriaApenas = false;

async function gravarLocal(e: Estado) {
  try {
    await set(CHAVE, e);
  } catch {
    try { localStorage.setItem(CHAVE, JSON.stringify(e)); } catch { memoriaApenas = true; }
  }
  canal?.postMessage({ t: 'mudou', em: e.atualizadoEm });
}

/** Altera o estado. Sempre por aqui: garante cópia, data de alteração e gravação. */
export function mudar(fn: (rascunho: Estado) => void): Estado {
  const r = structuredClone(estado);
  fn(r);
  r.atualizadoEm = new Date().toISOString();
  estado = r;
  avisar();
  gravando = gravando.then(() => gravarLocal(r));
  agendarNuvem();
  return r;
}
/** espera a gravação em disco terminar (usado antes de falar com a prefeitura) */
export const gravado = () => gravando;
export const soMemoria = () => memoriaApenas;

async function lerLocal(): Promise<Estado | null> {
  try {
    const v = await get(CHAVE);
    if (v) return normalizarEstado(v);
  } catch { /* IndexedDB indisponível */ }
  try {
    const t = localStorage.getItem(CHAVE);
    if (t) return normalizarEstado(JSON.parse(t));
  } catch { /* nada salvo */ }
  return null;
}

let timerNuvem: ReturnType<typeof setTimeout> | undefined;
function agendarNuvem() {
  if (!ui.status.nuvem.pronto) return;
  clearTimeout(timerNuvem);
  timerNuvem = setTimeout(enviarNuvem, 2500);
}
async function enviarNuvem() {
  if (!ui.status.nuvem.pronto) return;
  setUi({ nuvem: 'enviando' });
  try {
    await api('sync', { estado }, 'PUT');
    setUi({ nuvem: 'ok' });
  } catch {
    setUi({ nuvem: 'erro' });
  }
}
async function sincronizarNuvem() {
  if (!ui.status.nuvem.pronto) return;
  try {
    const r = await api<{ estado: unknown }>('sync');
    if (r.estado) {
      const remoto = normalizarEstado(r.estado);
      if (remoto.atualizadoEm > estado.atualizadoEm) {
        estado = remoto;
        avisar();
        await gravarLocal(remoto);
      } else if (remoto.atualizadoEm < estado.atualizadoEm) await enviarNuvem();
    } else if (estado.boletins.length || estado.clientes.length) await enviarNuvem();
    setUi({ nuvem: ui.nuvem === 'erro' ? 'erro' : 'ok' });
  } catch {
    setUi({ nuvem: 'erro' });
  }
}

export async function atualizarStatus() {
  const status = await buscarStatus();
  setUi({ status });
  return status;
}

export async function iniciar() {
  const local = await lerLocal();
  if (local) estado = local;
  setUi({ carregado: true });
  canal?.addEventListener('message', async (ev) => {
    if (ev.data?.t !== 'mudou' || ev.data.em <= estado.atualizadoEm) return;
    const novo = await lerLocal();
    if (novo && novo.atualizadoEm > estado.atualizadoEm) { estado = novo; avisar(); }
  });
  await atualizarStatus();
  await sincronizarNuvem();
}

export function substituirEstado(bruto: unknown) {
  const novo = normalizarEstado(bruto);
  mudar((r) => { Object.assign(r, novo); });
}

/** outra aba pode ter alterado os dados: pega a versão mais nova antes de agir */
export async function recarregarSeMaisNovo() {
  await gravando;
  const novo = await lerLocal();
  if (novo && novo.atualizadoEm > estado.atualizadoEm) { estado = novo; avisar(); }
}
