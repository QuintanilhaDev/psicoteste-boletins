import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Boletim, Estado, clienteDe, pendencias } from './core/model';
import { brl, competenciaLabel, fmtDate, isEmail, juntarEmails, listaEmails } from './core/text';
import { Ui } from './store';
import { boletimPronto } from './automation';

const P = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
export const Icone = {
  inicio: () => <P d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10" />,
  caixa: () => <P d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  clientes: () => <P d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M2 21h20M8 8h3M8 12h3M8 16h3" />,
  historico: () => <P d="M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4v4h4" />,
  ajustes: () => <P d="M4 6h10m4 0h2M4 12h3m4 0h9M4 18h11m4 0h1M14 4v4M7 10v4M15 16v4" />,
  fechar: () => <P d="M6 6l12 12M18 6 6 18" />,
  baixar: () => <P d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />,
  subir: () => <P d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14" />,
  certo: () => <P d="m5 12.5 4.5 4.5L19 7.5" />,
};

/** Campo que grava sozinho ao sair dele (sem botão "salvar"). */
export function Campo(p: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; dica?: string; tipo?: string; modo?: 'numeric' | 'decimal' | 'email' | 'tel' | 'text';
  classe?: string; invalido?: boolean; placeholder?: string; area?: boolean; aoDigitar?: (v: string) => void; auto?: string;
}) {
  const [v, setV] = useState(p.valor);
  const ultimo = useRef(p.valor);
  useEffect(() => { if (p.valor !== ultimo.current) { ultimo.current = p.valor; setV(p.valor); } }, [p.valor]);
  const id = useId();
  const gravar = () => { if (v !== ultimo.current) { ultimo.current = v; p.aoMudar(v); } };
  const comum = {
    id, value: v, placeholder: p.placeholder, onBlur: gravar, autoComplete: p.auto ?? 'off',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setV(e.target.value); p.aoDigitar?.(e.target.value); },
  };
  return (
    <label className={`campo ${p.classe ?? ''} ${p.invalido ? 'invalido' : ''}`} htmlFor={id}>
      <span>{p.rotulo}</span>
      {p.area ? <textarea {...comum} /> : <input {...comum} type={p.tipo ?? 'text'} inputMode={p.modo} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
      {p.dica && <small>{p.dica}</small>}
    </label>
  );
}

/**
 * Vários e-mails num campo só: cada endereço vira uma etiqueta removível.
 * Digite e aperte Enter, vírgula ou espaço — ou cole uma lista inteira.
 */
export function CampoEmails(p: { rotulo: string; valor: string; aoMudar: (v: string) => void; dica?: string; classe?: string }) {
  const id = useId();
  const lista = listaEmails(p.valor);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const confirmar = (bruto: string) => {
    const partes = bruto.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!partes.length) { setTexto(''); setErro(''); return; }
    const bons = partes.filter((x) => isEmail(x)).map((x) => x.toLowerCase());
    const ruins = partes.filter((x) => !isEmail(x));
    if (bons.length) p.aoMudar(juntarEmails([...lista, ...bons]));
    setTexto(ruins.join(' '));
    setErro(ruins.length ? `"${ruins[0]}" não parece um e-mail. Confira e aperte Enter.` : '');
  };
  const remover = (x: string) => p.aoMudar(juntarEmails(lista.filter((y) => y !== x)));
  return (
    <div className={`campo ${p.classe ?? ''} ${erro ? 'invalido' : ''}`}>
      <label htmlFor={id}><span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{p.rotulo}</span></label>
      <div className="emails">
        {lista.map((x) => (
          <span key={x} className="etiqueta">
            {x}
            <button type="button" onClick={() => remover(x)} aria-label={`Remover ${x}`}><Icone.fechar /></button>
          </span>
        ))}
        <input
          id={id} type="email" inputMode="email" autoComplete="off" multiple value={texto}
          placeholder={lista.length ? 'Adicionar outro e-mail' : 'nome@empresa.com.br'}
          onChange={(ev) => {
            const v = ev.target.value;
            if (/[,;\s]$/.test(v) && v.trim()) confirmar(v);
            else { setTexto(v); if (erro) setErro(''); }
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); confirmar(texto); }
            else if (ev.key === 'Backspace' && !texto && lista.length) remover(lista[lista.length - 1]);
          }}
          onPaste={(ev) => { const t = ev.clipboardData.getData('text'); if (/[,;\s]/.test(t.trim())) { ev.preventDefault(); confirmar(texto + ' ' + t); } }}
          onBlur={() => confirmar(texto)}
        />
      </div>
      {erro ? <small style={{ color: 'var(--ruim)' }} role="alert">{erro}</small> : p.dica && <small>{p.dica}</small>}
    </div>
  );
}

export function Janela(p: { titulo: string; sub?: string; aoFechar: () => void; children: ReactNode; largo?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') p.aoFechar(); };
    document.addEventListener('keydown', tecla);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = ''; anterior?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) p.aoFechar(); }}>
      <div className={`janela ${p.largo ? 'larga' : ''}`} role="dialog" aria-modal="true" aria-label={p.titulo} tabIndex={-1} ref={ref}>
        <header>
          <div>
            <h2>{p.titulo}</h2>
            {p.sub && <p className="mudo">{p.sub}</p>}
          </div>
          <button className="fechar" onClick={p.aoFechar} aria-label="Fechar"><Icone.fechar /></button>
        </header>
        {p.children}
      </div>
    </div>
  );
}

export interface Situacao { texto: string; tom: 'ok' | 'ambar' | 'ruim' | 'neutro'; passos: ('feito' | 'agora' | 'erro' | '')[] }

/** Em uma frase: em que pé está este boletim e o que falta. */
export function situacaoDe(e: Estado, ui: Ui, b: Boletim): Situacao {
  const pend = pendencias(e, b);
  const pronto = boletimPronto(e, b);
  const passos: Situacao['passos'] = [pronto ? 'feito' : 'agora', '', '', ''];
  const s = (texto: string, tom: Situacao['tom']): Situacao => ({ texto, tom, passos });
  if (b.nota.status === 'emitida') {
    passos[0] = 'feito';
    passos[1] = 'feito';
    passos[3] = b.recebido ? 'feito' : '';
    if (b.email.status === 'enviado' || b.email.status === 'dispensado') {
      passos[2] = 'feito';
      if (b.email.status === 'dispensado' && !b.recebido) { passos[3] = 'agora'; return s('E-mail não enviado por aqui (decisão sua). Aguardando pagamento.', 'neutro'); }
      if (b.recebido) return s(`Recebido em ${fmtDate(b.recebidoEm)}`, 'ok');
      passos[3] = 'agora';
      return s('Nota e boletim enviados. Aguardando pagamento.', 'neutro');
    }
    if (b.email.status === 'erro') { passos[2] = 'erro'; return s(`E-mail não enviado: ${b.email.erro ?? 'erro'}`, 'ruim'); }
    passos[2] = 'agora';
    if (b.email.status === 'pendente' && !b.email.aprovado) return s('Nota emitida. Esperando você conferir e liberar o e-mail.', 'ambar');
    if (!listaEmails(clienteDe(e, b)?.email).length) return s('Falta o e-mail do cliente para enviar.', 'ambar');
    if (!ui.status.email.pronto) return s('Nota emitida. O envio por e-mail ainda não foi ligado.', 'ambar');
    return s('Nota emitida. Enviando por e-mail…', 'neutro');
  }
  if (b.nota.status === 'erro') { passos[1] = 'erro'; return s(`Nota não emitida: ${b.nota.erro ?? 'erro'}`, 'ruim'); }
  if (b.nota.status === 'emitindo') { passos[1] = 'agora'; return s('Emitindo a nota na prefeitura…', 'neutro'); }
  if (pend.length) { if (pronto) passos[1] = 'agora'; return s(pend[0].texto, 'ambar'); }
  passos[1] = 'agora';
  if (!ui.status.nfse.pronto) return s('Boletim pronto. Nota aguardando o certificado digital.', 'ambar');
  if (!e.config.emitirAutomatico || ui.pausado) return s('Boletim pronto. Emissão automática pausada.', 'ambar');
  if (b.nota.erro) return s(`Vou tentar a nota de novo: ${b.nota.erro}`, 'ambar');
  return s('Boletim pronto. Na fila para emitir a nota.', 'neutro');
}

export function Trilha({ s }: { s: Situacao }) {
  const nomes = ['Boletim', 'Nota fiscal', 'E-mail', 'Pagamento'];
  return (
    <ol className="trilha" aria-label="Andamento">
      {nomes.map((n, i) => (
        <li key={n} className={s.passos[i]}>
          {n}
          <span className="sr">{s.passos[i] === 'feito' ? ' concluído' : s.passos[i] === 'erro' ? ' com problema' : s.passos[i] === 'agora' ? ' em andamento' : ' pendente'}</span>
        </li>
      ))}
    </ol>
  );
}

export function CartaoBoletim({ e, ui, b, abrir }: { e: Estado; ui: Ui; b: Boletim; abrir: (id: string) => void }) {
  const s = situacaoDe(e, ui, b);
  return (
    <button className="boletim" onClick={() => abrir(b.id)}>
      <div className="topo">
        <span className="nome">{clienteDe(e, b)?.nome ?? 'Cliente removido'}</span>
        <span className="valor num">{b.total > 0 ? brl(b.total) : 'sem preço'}</span>
      </div>
      <div className="mudo pequeno">
        Boletim {String(b.numero).padStart(4, '0')}, {competenciaLabel(b.competencia, true).toLowerCase()}, {b.quantidade} psicoteste{b.quantidade === 1 ? '' : 's'}
      </div>
      <Trilha s={s} />
      <div className="situacao">
        <span className={`selo ${s.tom === 'neutro' ? '' : s.tom}`}>{s.tom === 'ok' ? 'Concluído' : s.tom === 'ruim' ? 'Problema' : s.tom === 'ambar' ? 'Esperando' : 'Andando'}</span>
        <span>{s.texto.length > 150 ? s.texto.slice(0, 150) + '…' : s.texto}</span>
      </div>
    </button>
  );
}
