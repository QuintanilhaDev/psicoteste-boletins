import { useState } from 'react';
import { clienteDe, Estado } from './core/model';
import { brl, competenciaLabel, fmtCPF, fmtDate } from './core/text';
import { alterar, boletimPronto, informarNotaManual, tentarDeNovo } from './automation';
import { baixar, Doc, paraBase64, pdfBoletim, pdfNota, xmlNota } from './lib/docs';
import { avisarUsuario, Ui } from './store';
import { Icone, Janela, situacaoDe, Trilha } from './ui';

export function BoletimJanela({ e, ui, id, fechar, abrirCliente }: { e: Estado; ui: Ui; id: string; fechar: () => void; abrirCliente: (id: string) => void }) {
  const b = e.boletins.find((x) => x.id === id);
  const [manual, setManual] = useState(false);
  const [numero, setNumero] = useState('');
  const [codigo, setCodigo] = useState('');
  const [anexo, setAnexo] = useState<{ nome: string; base64: string; tipo: string } | undefined>();
  const [confirmar, setConfirmar] = useState(false);
  if (!b) return null;
  const c = clienteDe(e, b);
  const s = situacaoDe(e, ui, b);
  const emitida = b.nota.status === 'emitida';

  const baixarDocs = (docs: (Doc | null)[]) => void baixar(docs.filter(Boolean) as Doc[], `Boletim-${b.numero}`);
  const escolherAnexo = async (f?: File) => {
    if (!f) return setAnexo(undefined);
    if (f.size > 3_000_000) return avisarUsuario('O arquivo da nota passa de 3 MB. Envie um menor.', 'erro');
    setAnexo({ nome: f.name, tipo: f.type || 'application/pdf', base64: paraBase64(new Uint8Array(await f.arrayBuffer())) });
  };
  const excluir = () => {
    alterar((r) => {
      r.boletins = r.boletins.filter((x) => x.id !== id);
      const imp = r.importacoes.find((i) => i.id === b.importacaoId);
      if (imp) {
        imp.boletimIds = imp.boletimIds.filter((x) => x !== id);
        if (!imp.boletimIds.length) imp.hash = ''; // permite lançar a mesma planilha de novo
      }
    });
    fechar();
  };

  return (
    <Janela titulo={c?.nome ?? 'Boletim'} sub={`Boletim ${String(b.numero).padStart(4, '0')}, ${competenciaLabel(b.competencia, true).toLowerCase()}`} aoFechar={fechar}>
      <div className="cartao" style={{ display: 'grid', gap: 12 }}>
        <div className="item-linha">
          <div><span className="mudo pequeno">Psicotestes</span><br /><strong className="num">{b.quantidade} × {brl(b.precoUnit)}</strong></div>
          <div style={{ textAlign: 'right' }}><span className="mudo pequeno">Total</span><br /><strong className="num" style={{ fontSize: '1.3rem' }}>{brl(b.total)}</strong></div>
        </div>
        <Trilha s={s} />
        <p className={s.tom === 'ruim' ? '' : 'mudo'} style={s.tom === 'ruim' ? { color: 'var(--ruim)' } : undefined}>{s.texto}</p>
        {emitida && (
          <p className="pequeno">
            Nota nº <strong>{b.nota.numero}</strong>{b.nota.codigo ? `, código ${b.nota.codigo}` : ''}{b.nota.origem === 'manual' ? ' (emitida por você no portal)' : ''}
            {b.nota.ambiente && b.nota.ambiente !== 'producao' ? ' — ambiente de teste, sem valor fiscal' : ''}
            {b.email.status === 'enviado' ? `. E-mail enviado para ${b.email.para} em ${fmtDate(b.email.em)}.` : '.'}
          </p>
        )}
      </div>

      <div className="acoes" style={{ marginTop: 14 }}>
        {emitida && (
          <button className={`btn ${b.recebido ? 'calmo' : 'forte'}`} onClick={() => alterar((r) => { const x = r.boletins.find((y) => y.id === id)!; x.recebido = !x.recebido; x.recebidoEm = x.recebido ? new Date().toISOString() : undefined; })}>
            {b.recebido ? 'Desfazer baixa' : <><Icone.certo /> Dar baixa: recebi</>}
          </button>
        )}
        {boletimPronto(e, b) && <button className="btn" onClick={() => baixarDocs([pdfBoletim(e, b)])}><Icone.baixar /> Boletim</button>}
        {emitida && b.nota.origem === 'automatica' && <button className="btn" onClick={() => baixarDocs([pdfNota(e, b), xmlNota(e, b)])}><Icone.baixar /> Nota fiscal</button>}
        {b.nota.status === 'erro' && <button className="btn forte" onClick={() => tentarDeNovo(id, 'nota')}>Tentar a nota de novo</button>}
        {emitida && b.email.status !== 'pendente' && <button className="btn calmo" onClick={() => tentarDeNovo(id, 'email')}>{b.email.status === 'erro' ? 'Tentar o e-mail de novo' : 'Reenviar e-mail'}</button>}
        {c && <button className="btn calmo" onClick={() => { fechar(); abrirCliente(c.id); }}>Cadastro do cliente</button>}
      </div>

      {!emitida && b.nota.status !== 'emitindo' && (
        <div className="cartao" style={{ marginTop: 14 }}>
          {!manual ? (
            <div className="item-linha">
              <p className="cresce pequeno">Emitiu esta nota direto no portal da prefeitura? Informe o número e eu envio o boletim e a nota ao cliente.</p>
              <button className="btn mini" onClick={() => setManual(true)}>Já emiti no portal</button>
            </div>
          ) : (
            <div className="grade">
              <label className="campo c6"><span>Número da nota</span><input inputMode="numeric" value={numero} onChange={(ev) => setNumero(ev.target.value)} /></label>
              <label className="campo c6"><span>Código de verificação</span><input value={codigo} onChange={(ev) => setCodigo(ev.target.value)} /><small>Opcional</small></label>
              <label className="campo c12"><span>Arquivo da nota (PDF)</span><input type="file" accept="application/pdf,.pdf,.xml,image/*" onChange={(ev) => void escolherAnexo(ev.target.files?.[0])} /><small>Opcional. Vai anexado no e-mail ao cliente.</small></label>
              <div className="acoes c12">
                <button className="btn forte" disabled={!numero.trim() || !(b.total > 0)} onClick={() => { informarNotaManual(id, numero, codigo, anexo); setManual(false); }}>Registrar nota</button>
                <button className="btn calmo" onClick={() => setManual(false)}>Cancelar</button>
              </div>
              {!(b.total > 0) && <small className="c12" style={{ color: 'var(--ruim)' }}>Informe antes o preço do psicoteste.</small>}
            </div>
          )}
        </div>
      )}

      {b.pessoas.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 8 }}>Vigilantes ({b.pessoas.length})</h3>
          <div className="pessoas">
            {b.pessoas.map((p, i) => (
              <div key={i}><span>{p.nome}</span><span className="num mudo">{p.cpf ? fmtCPF(p.cpf) : 'sem CPF'}{!p.cpfValido && p.cpf ? ' ⚠' : ''}</span></div>
            ))}
          </div>
        </div>
      )}
      {b.observacoes.map((o, i) => <p key={i} className="mudo pequeno" style={{ marginTop: 8 }}>{o}</p>)}
      <p className="mudo pequeno" style={{ marginTop: 8 }}>Planilha: {b.arquivo}, lida em {fmtDate(b.criadoEm)}.</p>

      {!emitida && b.nota.status !== 'emitindo' && !b.nota.protocolo && (
        <div style={{ marginTop: 18 }}>
          {!confirmar ? <button className="link" style={{ color: 'var(--ruim)' }} onClick={() => setConfirmar(true)}>Excluir este boletim</button> : (
            <div className="faixa erro">
              <span className="cresce">Excluir o boletim {String(b.numero).padStart(4, '0')}? Ele ainda não tem nota.</span>
              <button className="btn perigo mini" onClick={excluir}>Excluir boletim</button>
              <button className="btn calmo mini" onClick={() => setConfirmar(false)}>Manter</button>
            </div>
          )}
        </div>
      )}
    </Janela>
  );
}
