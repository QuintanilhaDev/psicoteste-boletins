import { useState } from 'react';
import { clienteDe, Estado } from '../core/model';
import { competenciaLabel, digits } from '../core/text';
import { Ui } from '../store';
import { CartaoBoletim, situacaoDe } from '../ui';

export function Historico({ e, ui, abrirBoletim }: { e: Estado; ui: Ui; abrirBoletim: (id: string) => void }) {
  const [aba, setAba] = useState<'boletins' | 'planilhas'>('boletins');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('');
  const [limite, setLimite] = useState(30);
  const q = busca.trim().toLowerCase();
  const boletins = [...e.boletins]
    .sort((a, b) => b.numero - a.numero)
    .filter((b) => {
      if (filtro) {
        const t = situacaoDe(e, ui, b).tom;
        if (filtro === 'aberto' ? !(b.nota.status === 'emitida' && !b.recebido) : filtro === 'semnota' ? b.nota.status === 'emitida' : filtro === 'recebido' ? !b.recebido : t !== 'ruim') return false;
      }
      if (!q) return true;
      const nome = (clienteDe(e, b)?.nome ?? '').toLowerCase();
      return nome.includes(q) || String(b.numero).padStart(4, '0').includes(q) || (b.nota.numero ?? '').includes(q) ||
        competenciaLabel(b.competencia, true).toLowerCase().includes(q) ||
        b.pessoas.some((p) => p.nome.toLowerCase().includes(q) || (digits(q).length >= 4 && p.cpf.includes(digits(q))));
    });
  return (
    <>
      <div className="cab-pagina">
        <h1>Histórico</h1>
        <div className="abas" role="tablist">
          <button role="tab" aria-selected={aba === 'boletins'} onClick={() => setAba('boletins')}>Boletins</button>
          <button role="tab" aria-selected={aba === 'planilhas'} onClick={() => setAba('planilhas')}>Planilhas lidas</button>
        </div>
      </div>
      {aba === 'boletins' ? (
        <>
          <div className="filtros" style={{ marginBottom: 12 }}>
            <input type="search" placeholder="Cliente, vigilante, CPF, nº da nota…" value={busca} onChange={(ev) => { setBusca(ev.target.value); setLimite(30); }} aria-label="Buscar no histórico" style={{ flex: '1 1 240px' }} />
            <select value={filtro} onChange={(ev) => { setFiltro(ev.target.value); setLimite(30); }} aria-label="Situação">
              <option value="">Todas as situações</option>
              <option value="semnota">Ainda sem nota</option>
              <option value="aberto">Nota emitida, em aberto</option>
              <option value="recebido">Recebidos</option>
              <option value="problema">Com problema</option>
            </select>
          </div>
          {boletins.length ? (
            <div className="lista">
              {boletins.slice(0, limite).map((b) => <CartaoBoletim key={b.id} e={e} ui={ui} b={b} abrir={abrirBoletim} />)}
              {boletins.length > limite && <button className="btn calmo" onClick={() => setLimite(limite + 30)}>Mostrar mais {Math.min(30, boletins.length - limite)}</button>}
            </div>
          ) : <div className="vazio">{e.boletins.length ? 'Nada encontrado com esse filtro.' : 'Os boletins gerados ficam guardados aqui.'}</div>}
        </>
      ) : e.importacoes.length ? (
        <div className="lista">
          {e.importacoes.slice(0, 100).map((i) => (
            <div key={i.id} className="cartao">
              <div className="item-linha">
                <strong className="cresce" style={{ overflowWrap: 'anywhere' }}>{i.arquivo}</strong>
                <span className="mudo pequeno">{new Date(i.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <p className="pequeno" style={{ marginTop: 4 }}>
                {i.repetida ? 'Planilha repetida: nada foi lançado.' : `${i.novos} psicoteste${i.novos === 1 ? '' : 's'} em ${i.boletimIds.length} ${i.boletimIds.length === 1 ? 'boletim' : 'boletins'}.`}
              </p>
              {i.avisos.map((a, k) => <p key={k} className="mudo pequeno" style={{ marginTop: 4 }}>{a}</p>)}
            </div>
          ))}
        </div>
      ) : <div className="vazio">Nenhuma planilha lida ainda.</div>}
    </>
  );
}
