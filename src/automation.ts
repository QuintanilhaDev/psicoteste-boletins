// A esteira automática: planilha → boletim → nota fiscal → e-mail → download. Sem cliques.
import { abrirArquivo } from './core/arquivo';
import { lerPlanilha } from './core/reader';
import {
  Boletim, Estado, clienteDe, discriminacao, enderecoCompleto, importarLeitura, pendencias, recalcular,
} from './core/model';
import { brl, competenciaLabel, digits, isCNPJ, isEmail } from './core/text';
import { aplicarCnpj, buscarCnpj } from './lib/externo';
import { api, ErroApi, ErroPrefeitura, NotaApi } from './lib/api';
import { baixar, Doc, paraBase64, pdfBoletim, pdfNota, xmlNota } from './lib/docs';
import {
  atualizarStatus, avisarUsuario, getEstado, getUi, gravado, mudar, recarregarSeMaisNovo, setUi,
} from './store';

class ErroNegocio extends Error {
  constructor(msg: string, public limpar: 'nada' | 'protocolo' | 'rps' = 'nada') { super(msg); }
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** nos testes automatizados os intervalos são encurtados */
const ritmo = () => (globalThis as { __PSICO_RITMO__?: number }).__PSICO_RITMO__ ?? 1;
const achar = (e: Estado, id: string) => e.boletins.find((b) => b.id === id);
const textoErros = (er: ErroPrefeitura[]) =>
  er.map((x) => [x.codigo, x.mensagem, x.correcao].filter(Boolean).join(' — ')).join(' | ') || 'A prefeitura recusou a nota sem dizer o motivo.';

export function boletimPronto(e: Estado, b: Boletim) {
  const c = clienteDe(e, b);
  return !!c && !c.naoIdentificado && !(c.parecidoCom && e.clientes.some((x) => x.id === c.parecidoCom)) && !b.duvida && b.total > 0;
}
export const podeEmitir = (e: Estado, b: Boletim) =>
  b.nota.status === 'pendente' && b.nota.tentativas < 3 && pendencias(e, b).length === 0;

export async function processarArquivos(files: File[]) {
  if (!files.length) return;
  setUi({ ocupado: 'Lendo planilhas…', leituras: [] });
  const leituras: { arquivo: string; ok: boolean; texto: string }[] = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { arquivo, hash } = abrirArquivo(f.name, bytes);
      const leitura = lerPlanilha(arquivo, { ignorarNomes: [getEstado().config.prestador.razao] });
      let resumo = '';
      let ok = true;
      mudar((r) => {
        const imp = importarLeitura(r, f.name, hash, leitura);
        if (imp.repetida) { ok = false; resumo = 'Já tinha sido lançada antes. Nada foi cobrado em dobro.'; }
        else if (!imp.novos) { ok = false; resumo = imp.avisos[0] ?? 'Não encontrei vigilantes nesta planilha.'; }
        else {
          const n = imp.boletimIds.length;
          resumo = `${imp.novos} psicoteste${imp.novos > 1 ? 's' : ''} em ${n} ${n > 1 ? 'boletins' : 'boletim'}.` +
            (imp.repetidos ? ` ${imp.repetidos} repetido${imp.repetidos > 1 ? 's' : ''} ignorado${imp.repetidos > 1 ? 's' : ''}.` : '');
        }
      });
      leituras.push({ arquivo: f.name, ok, texto: resumo });
    } catch (err) {
      leituras.push({ arquivo: f.name, ok: false, texto: String((err as Error).message ?? err) });
    }
  }
  setUi({ leituras, ocupado: null });
  await rodar();
}

let rodando = false;
let denovo = false;
export async function rodar() {
  if (rodando) { denovo = true; return; }
  rodando = true;
  try {
    do {
      denovo = false;
      const ciclo = async () => { await recarregarSeMaisNovo(); await umCiclo(); };
      // só uma aba do navegador trabalha por vez
      if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('psico-esteira', ciclo);
      else await ciclo();
    } while (denovo);
  } catch (err) {
    avisarUsuario(`Algo deu errado: ${String((err as Error).message ?? err)}`, 'erro');
  } finally {
    rodando = false;
    setUi({ ocupado: null, contagem: null });
  }
}

async function umCiclo() {
  await completarClientes();
  await baixarPendentes();
  await emitirFila();
  await enviarFila();
  await baixarPendentes();
}

const cnpjsConsultados = new Set<string>();
/** cliente que veio da planilha com CNPJ: busca razão social e endereço na Receita, sem ninguém digitar */
async function completarClientes() {
  for (const c of getEstado().clientes) {
    if (!isCNPJ(c.cnpj) || enderecoCompleto(c.endereco) || cnpjsConsultados.has(c.cnpj)) continue;
    cnpjsConsultados.add(c.cnpj);
    setUi({ ocupado: `Buscando o cadastro de ${c.nome}…` });
    const d = await buscarCnpj(c.cnpj);
    if (!d) continue;
    mudar((r) => { const x = r.clientes.find((y) => y.id === c.id); if (x) aplicarCnpj(x, d); });
  }
  setUi({ ocupado: null });
}

async function baixarPendentes() {
  const e = getEstado();
  const docs: Doc[] = [];
  const marcar: { id: string; boletim?: boolean; nota?: boolean }[] = [];
  for (const b of e.boletins) {
    const m: { id: string; boletim?: boolean; nota?: boolean } = { id: b.id };
    if (!b.baixado.boletim && boletimPronto(e, b)) { docs.push(pdfBoletim(e, b)); m.boletim = true; }
    if (!b.baixado.nota && b.nota.status === 'emitida' && b.nota.origem === 'automatica') {
      const pdf = pdfNota(e, b);
      const xml = xmlNota(e, b);
      if (pdf) docs.push(pdf);
      if (xml) docs.push(xml);
      m.nota = true;
    }
    if (m.boletim || m.nota) marcar.push(m);
  }
  if (!marcar.length) return;
  const d = new Date();
  await baixar(docs, `Psicotestes-${d.toISOString().slice(0, 10)}-${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`);
  mudar((r) => {
    for (const m of marcar) {
      const b = achar(r, m.id);
      if (!b) continue;
      if (m.boletim) b.baixado.boletim = true;
      if (m.nota) b.baixado.nota = true;
    }
  });
  if (docs.length) avisarUsuario(docs.length === 1 ? `${docs[0].nome} salvo em Downloads.` : `${docs.length} documentos salvos em Downloads (arquivo .zip).`);
}

async function emitirFila() {
  const ui = getUi();
  const e0 = getEstado();
  if (!ui.status.nfse.pronto || !e0.config.emitirAutomatico || ui.pausado) return;
  let fila = e0.boletins.filter((b) => podeEmitir(e0, b)).map((b) => b.id);
  if (!fila.length) return;
  // janela curta para desistir: nota emitida só se cancela no portal da prefeitura
  if (e0.boletins.some((b) => fila.includes(b.id) && b.nota.rps == null)) {
    for (let s = 8; s > 0; s--) {
      setUi({ contagem: s, ocupado: null });
      await dormir(1000 * ritmo());
      if (getUi().pausado) { setUi({ contagem: null }); return; }
    }
    setUi({ contagem: null });
  }
  const e1 = getEstado();
  fila = fila.filter((id) => { const b = achar(e1, id); return !!b && podeEmitir(e1, b); });
  let feitas = 0;
  for (const id of fila) {
    if (getUi().pausado) break;
    const b = achar(getEstado(), id);
    if (!b) continue;
    setUi({ ocupado: `Emitindo nota de ${clienteDe(getEstado(), b)?.nome ?? ''}…` });
    const r = await emitirUm(id);
    if (r === 'ok') feitas++;
    if (r === 'parar') break;
  }
  setUi({ ocupado: null });
  if (feitas) avisarUsuario(feitas === 1 ? 'Nota fiscal emitida.' : `${feitas} notas fiscais emitidas.`);
}

async function emitirUm(id: string): Promise<'ok' | 'falhou' | 'parar'> {
  const antes = achar(getEstado(), id);
  if (!antes) return 'falhou';
  const tentativasAntes = antes.nota.tentativas;
  mudar((r) => {
    const b = achar(r, id)!;
    if (b.nota.rps == null) {
      b.nota.rps = r.config.fiscal.proximoRps++;
      b.nota.serie = r.config.fiscal.serie || 'A';
    }
    b.nota.status = 'emitindo';
  });
  await gravado(); // o nº do RPS fica gravado antes de qualquer envio: é ele que impede nota em dobro
  const e = getEstado();
  const b = achar(e, id)!;
  const c = clienteDe(e, b)!;
  const prestador = { cnpj: e.config.prestador.cnpj, im: e.config.prestador.im };
  const rps = b.nota.rps!;
  const serie = b.nota.serie!;

  const consultar = async (vezes: number): Promise<NotaApi | null> => {
    for (let i = 0; i < vezes; i++) {
      const r = await api<{ nota?: NotaApi }>('nfse', { acao: 'consultar', prestador, rps, serie });
      if (r.nota) return r.nota;
      if (i < vezes - 1) await dormir(3000 * ritmo());
    }
    return null;
  };

  try {
    let nota: NotaApi | null = null;
    let protocolo = b.nota.protocolo;
    if (tentativasAntes > 0 || protocolo) nota = await consultar(1);
    if (!nota && !protocolo) {
      mudar((r) => { achar(r, id)!.nota.tentativas++; });
      await gravado();
      const agora = new Date();
      const iso = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
      const r = await api<{ protocolo?: string; erros?: ErroPrefeitura[] }>('nfse', {
        acao: 'emitir',
        dados: {
          rps, serie, dataEmissao: iso, valor: b.total, discriminacao: discriminacao(e, b), prestador, fiscal: e.config.fiscal,
          tomador: { nome: c.nome, cnpj: c.cnpj, email: c.email, telefone: c.telefone, endereco: c.endereco },
        },
      });
      if (r.erros?.length) {
        if (r.erros.some((x) => x.codigo === 'E10' || /j[aá] informado/i.test(x.mensagem))) {
          nota = await consultar(4);
          if (!nota) throw new ErroNegocio(`A prefeitura diz que o RPS ${rps} já foi usado, mas não achei a nota. Confira no portal da prefeitura antes de tentar de novo.`);
        } else throw new ErroNegocio(textoErros(r.erros));
      } else if (r.protocolo) {
        protocolo = r.protocolo;
        mudar((x) => { achar(x, id)!.nota.protocolo = protocolo; });
        await gravado();
      } else throw new ErroApi('A prefeitura não devolveu o protocolo.', 502);
    }
    if (!nota && protocolo) {
      let processado = false;
      for (let i = 0; i < 25 && !processado; i++) {
        const s = await api<{ situacao?: number; erros?: ErroPrefeitura[] }>('nfse', { acao: 'situacao', prestador, protocolo });
        if (s.situacao === 3) throw new ErroNegocio(textoErros(s.erros ?? []), 'protocolo');
        if (s.situacao === 4) processado = true;
        else if (s.erros?.length && !s.situacao) throw new ErroNegocio(textoErros(s.erros), 'protocolo');
        else await dormir(2000 * ritmo());
      }
      nota = await consultar(processado ? 4 : 1);
      if (!nota) throw new ErroApi('A prefeitura ainda está processando a nota. Vou conferir de novo em instantes.', 504);
    }
    if (!nota) throw new ErroApi('Não foi possível confirmar a nota.', 502);
    const docDiferente = !!nota.tomadorDoc && nota.tomadorDoc !== digits(c.cnpj);
    const valorDiferente = Number.isFinite(nota.valor) && Math.abs(nota.valor - b.total) > 0.009;
    if (docDiferente || valorDiferente) {
      throw new ErroNegocio(`O RPS ${rps} já pertence a outra nota (nº ${nota.numero}). Aumente o "próximo número de RPS" nos ajustes e tente de novo.`, 'rps');
    }
    const final = nota;
    mudar((r) => {
      const x = achar(r, id)!;
      x.nota = { ...x.nota, status: 'emitida', origem: 'automatica', numero: final.numero, codigo: final.codigo, emitidaEm: final.emitidaEm || new Date().toISOString(), xml: final.xml, ambiente: final.ambiente, erro: undefined };
    });
    await gravado();
    return 'ok';
  } catch (err) {
    const config = err instanceof ErroApi && (err.status === 401 || err.status === 503);
    const passageiro = err instanceof ErroApi && err.passageiro;
    mudar((r) => {
      const x = achar(r, id)!;
      x.nota.erro = String((err as Error).message ?? err);
      if (config) { x.nota.status = 'pendente'; x.nota.tentativas = tentativasAntes; }
      else if (passageiro) x.nota.status = x.nota.tentativas >= 3 ? 'erro' : 'pendente';
      else x.nota.status = 'erro';
      if (err instanceof ErroNegocio && err.limpar !== 'nada') x.nota.protocolo = undefined;
      if (err instanceof ErroNegocio && err.limpar === 'rps') { x.nota.rps = undefined; x.nota.tentativas = 0; }
    });
    await gravado();
    if (config) { await atualizarStatus(); return 'parar'; }
    return 'falhou';
  }
}

function corpoEmail(e: Estado, b: Boletim) {
  const c = clienteDe(e, b)!;
  const p = e.config.prestador;
  const mes = competenciaLabel(b.competencia, true).toLowerCase();
  const nota = b.nota.numero ? `nota fiscal nº ${b.nota.numero}` : 'nota fiscal';
  const linhas = [
    'Olá,',
    `Segue o boletim de psicotestes de ${mes} e a ${nota}.`,
    `Vigilantes avaliados: ${b.quantidade}\nValor por psicoteste: ${brl(b.precoUnit)}\nTotal: ${brl(b.total)}`,
    b.nota.codigo ? `Código de verificação da nota: ${b.nota.codigo} (confira em nfse.salvador.ba.gov.br)` : '',
    'Qualquer dúvida, é só responder este e-mail.',
    [p.razao, p.telefone].filter(Boolean).join('\n'),
  ].filter(Boolean);
  const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return {
    assunto: `Boletim de psicotestes e nota fiscal — ${mes} — ${c.nome}`,
    texto: linhas.join('\n\n'),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#12302e;line-height:1.5">${linhas.map((l) => `<p>${h(l)}</p>`).join('')}</div>`,
  };
}

export const podeEnviar = (e: Estado, b: Boletim) =>
  b.nota.status === 'emitida' && b.email.status === 'pendente' && b.email.tentativas < 3 && isEmail(clienteDe(e, b)?.email);

async function enviarFila() {
  if (!getUi().status.email.pronto) return;
  const e0 = getEstado();
  const fila = e0.boletins.filter((b) => podeEnviar(e0, b)).map((b) => b.id);
  let enviados = 0;
  for (const id of fila) {
    const e = getEstado();
    const b = achar(e, id);
    if (!b || !podeEnviar(e, b)) continue;
    const c = clienteDe(e, b)!;
    setUi({ ocupado: `Enviando e-mail para ${c.nome}…` });
    const docs: Doc[] = [pdfBoletim(e, b)];
    const pn = pdfNota(e, b);
    const xn = xmlNota(e, b);
    if (pn) docs.push(pn);
    if (xn) docs.push(xn);
    const anexos = docs.map((d) => ({ nome: d.nome, tipo: d.tipo, base64: paraBase64(d.bytes) }));
    if (b.nota.anexo) anexos.push(b.nota.anexo);
    const para = c.email.trim();
    try {
      await api('email', { para, remetenteNome: e.config.prestador.razao, responderPara: e.config.prestador.email, ...corpoEmail(e, b), anexos });
      mudar((r) => {
        const x = achar(r, id)!;
        x.email = { status: 'enviado', para, em: new Date().toISOString(), tentativas: x.email.tentativas + 1 };
        if (x.nota.anexo) x.nota.anexo = undefined; // já foi entregue; não ocupa mais espaço
      });
      enviados++;
    } catch (err) {
      const config = err instanceof ErroApi && (err.status === 401 || err.status === 503);
      const passageiro = err instanceof ErroApi && err.passageiro;
      mudar((r) => {
        const x = achar(r, id)!;
        x.email.erro = String((err as Error).message ?? err);
        if (!config) x.email.tentativas++;
        x.email.status = config || (passageiro && x.email.tentativas < 3) ? 'pendente' : 'erro';
      });
      if (config) { await atualizarStatus(); break; }
    }
  }
  setUi({ ocupado: null });
  if (enviados) avisarUsuario(enviados === 1 ? 'E-mail enviado ao cliente.' : `${enviados} e-mails enviados aos clientes.`);
}

// ---- ações disparadas pela tela (todas terminam chamando a esteira) ----

export function tentarDeNovo(id: string, o: 'nota' | 'email') {
  mudar((r) => {
    const b = achar(r, id);
    if (!b) return;
    if (o === 'nota' && b.nota.status !== 'emitida') { b.nota.status = 'pendente'; b.nota.tentativas = b.nota.rps != null ? 1 : 0; b.nota.erro = undefined; }
    if (o === 'email') b.email = { status: 'pendente', tentativas: 0 };
    recalcular(r);
  });
  setUi({ pausado: false });
  void rodar();
}

export function informarNotaManual(id: string, numero: string, codigo: string, anexo?: { nome: string; base64: string; tipo: string }) {
  mudar((r) => {
    const b = achar(r, id);
    if (!b || b.nota.status === 'emitida') return;
    b.nota = { status: 'emitida', origem: 'manual', numero: numero.trim(), codigo: codigo.trim() || undefined, emitidaEm: new Date().toISOString(), tentativas: b.nota.tentativas, anexo };
  });
  void rodar();
}

export function alterar(fn: (r: Estado) => void) {
  mudar((r) => { fn(r); recalcular(r); });
  void rodar();
}
