// Tela de conferência: nada vai para o cliente sem passar por aqui.
import { useEffect, useMemo, useState } from 'react';
import { Boletim, clienteDe, Estado, verificacoes } from './core/model';
import { brl, competenciaLabel } from './core/text';
import { aguardandoConferencia, alterar, aprovarEnvios, corpoEmail, dispensarEnvio } from './automation';
import { anexosDoEmail, baixar, Doc } from './lib/docs';
import { Ui } from './store';
import { CampoEmails, Icone, Janela } from './ui';

function abrirDoc(d: Doc) {
  if (d.tipo === 'application/pdf') {
    const url = URL.createObjectURL(new Blob([d.bytes as BlobPart], { type: d.tipo }));
    const w = window.open(url, '_blank', 'noopener');
    if (!w) void baixar([{ ...d, pasta: undefined }]);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } else void baixar([{ ...d, pasta: undefined }]);
}
const tamanho = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Item({ e, b, marcado, alternar }: { e: Estado; b: Boletim; marcado: boolean; alternar: () => void }) {
  const c = clienteDe(e, b);
  const v = verificacoes(e, b);
  const bloqueado = v.some((x) => x.tipo === 'erro');
  const [anexos, setAnexos] = useState<Doc[] | null>(null);
  const chave = `${b.id}|${b.nota.numero}|${b.quantidade}|${b.total}|${c?.nome}|${c?.email}`;
  useEffect(() => {
    let vivo = true;
    setAnexos(null);
    anexosDoEmail(e, b).then((d) => { if (vivo) setAnexos(d); }).catch(() => { if (vivo) setAnexos([]); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  const corpo = corpoEmail(e, b);
  return (
    <article className={`conferir ${bloqueado ? 'bloqueado' : marcado ? 'marcado' : ''}`} aria-label={`E-mail para ${c?.nome}`}>
      <label className="conferir-topo">
        <input type="checkbox" checked={marcado && !bloqueado} disabled={bloqueado} onChange={alternar} aria-label={`Enviar para ${c?.nome}`} />
        <span className="cresce">
          <strong className="nome">{c?.nome}</strong>
          <span className="mudo pequeno">Boletim {String(b.numero).padStart(4, '0')}, {competenciaLabel(b.competencia, true).toLowerCase()}, nota nº {b.nota.numero}</span>
        </span>
        <strong className="num valor">{brl(b.total)}</strong>
      </label>

      <ul className="verificacoes">
        {v.map((x, i) => (
          <li key={i} className={x.tipo}><span aria-hidden="true">{x.tipo === 'ok' ? '✓' : x.tipo === 'aviso' ? '!' : '×'}</span>{x.texto}</li>
        ))}
      </ul>

      {c && (
        <CampoEmails rotulo="Para" valor={c.email} aoMudar={(val) => alterar((r) => { const x = r.clientes.find((y) => y.id === c.id); if (x) x.email = val; })} dica="Mudar aqui também atualiza o cadastro do cliente." />
      )}

      <div>
        <p className="pequeno" style={{ fontWeight: 700, margin: '12px 0 6px' }}>Anexos</p>
        {anexos === null ? <p className="mudo pequeno"><span className="girando" style={{ display: 'inline-block', width: 14, height: 14, verticalAlign: 'middle', marginRight: 6 }} />Preparando os anexos…</p> : (
          <div className="anexos">
            {anexos.map((d) => (
              <button key={d.nome} type="button" className="anexo" onClick={() => abrirDoc(d)} title={d.tipo === 'application/pdf' ? 'Abrir para conferir' : 'Baixar para conferir'}>
                <span className="tipo">{d.nome.split('.').pop()?.toUpperCase()}</span>
                <span className="cresce">{d.nome}</span>
                <span className="mudo pequeno num">{tamanho(d.bytes.length)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <details className="texto-email">
        <summary>Ver o texto do e-mail</summary>
        <p className="pequeno"><strong>Assunto:</strong> {corpo.assunto}</p>
        <p className="pequeno" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{corpo.texto}</p>
      </details>
      <button type="button" className="link pequeno" style={{ marginTop: 10, color: 'var(--mudo)' }} onClick={() => dispensarEnvio(b.id)}>Não enviar este por aqui</button>
    </article>
  );
}

export function Conferencia({ e, ui, fechar }: { e: Estado; ui: Ui; fechar: () => void }) {
  const fila = useMemo(() => e.boletins.filter(aguardandoConferencia).sort((a, z) => a.numero - z.numero), [e]);
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const enviaveis = fila.filter((b) => !verificacoes(e, b).some((v) => v.tipo === 'erro'));
  const escolhidos = enviaveis.filter((b) => !desmarcados.has(b.id));
  const bloqueados = fila.length - enviaveis.length;
  const ligado = ui.status.email.pronto;
  const alternar = (id: string) => setDesmarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const enviar = () => { aprovarEnvios(escolhidos.map((b) => b.id)); fechar(); };

  return (
    <Janela largo titulo="Conferir antes de enviar" sub="Confira cada e-mail. Só sai o que você marcar e mandar enviar." aoFechar={fechar}>
      {!fila.length ? <div className="vazio">Nenhum e-mail esperando conferência.</div> : (
        <>
          <div className="lista">
            {fila.map((b) => <Item key={b.id} e={e} b={b} marcado={!desmarcados.has(b.id)} alternar={() => alternar(b.id)} />)}
          </div>
          <div className="rodape-fixo">
            <p className="cresce pequeno">
              {!ligado ? 'O envio de e-mail ainda não foi configurado no servidor.' :
                `${escolhidos.length} de ${fila.length} marcado${fila.length === 1 ? '' : 's'}${bloqueados ? `; ${bloqueados} com problema não pode${bloqueados === 1 ? '' : 'm'} sair` : ''}.`}
            </p>
            <button className="btn calmo" onClick={fechar}>Agora não</button>
            <button className="btn forte" disabled={!ligado || !escolhidos.length} onClick={enviar}>
              <Icone.certo /> Enviar {escolhidos.length} e-mail{escolhidos.length === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </Janela>
  );
}
