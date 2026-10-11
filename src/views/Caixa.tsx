import { useState } from 'react';
import { clienteDe, Estado, porCliente, porMes, totais } from '../core/model';
import { brl, competenciaLabel } from '../core/text';
import { alterar } from '../automation';
import { baixar, planilhaRelatorio } from '../lib/docs';
import { avisarUsuario } from '../store';
import { Icone } from '../ui';

export function Caixa({ e, abrirBoletim }: { e: Estado; abrirBoletim: (id: string) => void }) {
  const [mes, setMes] = useState('');
  const [cliente, setCliente] = useState('');
  const [gerando, setGerando] = useState(false);
  const meses = porMes(e, cliente || undefined);
  const mesValido = meses.some((m) => m.chave === mes) ? mes : '';
  const filtrado: Estado = cliente ? { ...e, boletins: e.boletins.filter((b) => b.clienteId === cliente) } : e;
  const t = totais(filtrado, mesValido || undefined);
  const linhas = cliente ? meses.filter((m) => !mesValido || m.chave === mesValido) : porCliente(e, mesValido || undefined);
  const max = Math.max(1, ...meses.map((m) => m.testes));
  const abertos = filtrado.boletins.filter((b) => b.nota.status === 'emitida' && !b.recebido && (!mesValido || b.competencia === mesValido)).sort((a, b) => a.numero - b.numero);
  const clientes = e.clientes.filter((c) => e.boletins.some((b) => b.clienteId === c.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const exportar = async () => {
    setGerando(true);
    try {
      await baixar([await planilhaRelatorio(e)]);
      avisarUsuario('Planilha salva em Downloads.');
    } catch (err) {
      avisarUsuario(`Não consegui gerar a planilha: ${(err as Error).message}`, 'erro');
    } finally { setGerando(false); }
  };

  if (!e.boletins.length) {
    return <><div className="cab-pagina"><h1>Caixa</h1></div><div className="vazio">Quando você lançar a primeira planilha, aqui aparecem os psicotestes por cliente e por mês, o que já tem nota, o que foi recebido e o que está em aberto.</div></>;
  }
  return (
    <>
      <div className="cab-pagina">
        <h1>Caixa</h1>
        <button className="btn forte" onClick={exportar} disabled={gerando}><Icone.baixar /> {gerando ? 'Gerando…' : 'Baixar planilha completa'}</button>
      </div>
      <div className="filtros">
        <select value={mesValido} onChange={(ev) => setMes(ev.target.value)} aria-label="Mês">
          <option value="">Todos os meses</option>
          {[...meses].reverse().map((m) => <option key={m.chave} value={m.chave}>{competenciaLabel(m.chave, true)}</option>)}
        </select>
        <select value={cliente} onChange={(ev) => setCliente(ev.target.value)} aria-label="Cliente">
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      <dl className="razao" style={{ marginTop: 14 }}>
        <div><dt>Psicotestes</dt><dd className="num">{t.testes}</dd></div>
        <div><dt>Nota tirada</dt><dd className="num">{brl(t.comNota)}</dd></div>
        <div className="recebido"><dt>Recebido</dt><dd className="num">{brl(t.recebido)}</dd></div>
        <div className="aberto"><dt>Em aberto</dt><dd className="num">{brl(t.aberto)}</dd></div>
      </dl>
      {t.semNota > 0 && <p className="mudo pequeno" style={{ marginTop: 8 }}>Além disso, {brl(t.semNota)} em boletins que ainda não têm nota.</p>}

      <section className="secao">
        <h2>Psicotestes por mês</h2>
        <div className="cartao" style={{ padding: 0 }}>
          <div className="barras" role="img" aria-label={`Psicotestes por mês: ${meses.map((m) => `${m.rotulo} ${m.testes}`).join(', ')}`}>
            {meses.slice(-14).map((m) => (
              <div key={m.chave} className={`barra ${m.chave === mesValido ? 'sel' : ''}`}>
                <b className="num">{m.testes}</b>
                <i style={{ height: `${Math.round((m.testes / max) * 100)}%` }} />
                <span>{m.rotulo}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="secao">
        <h2>{cliente ? 'Mês a mês' : mesValido ? `Por cliente em ${competenciaLabel(mesValido, true).toLowerCase()}` : 'Por cliente'}</h2>
        <div className="rolagem">
          <table>
            <thead><tr><th>{cliente ? 'Mês' : 'Cliente'}</th><th>Psicotestes</th><th>Faturado</th><th>Nota tirada</th><th>Recebido</th><th>Em aberto</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave}><td>{cliente ? competenciaLabel(l.chave, true) : l.rotulo}</td><td className="num">{l.testes}</td><td className="num">{brl(l.faturado)}</td><td className="num">{brl(l.comNota)}</td><td className="num">{brl(l.recebido)}</td><td className="num">{brl(l.aberto)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{t.testes}</td><td className="num">{brl(t.faturado)}</td><td className="num">{brl(t.comNota)}</td><td className="num">{brl(t.recebido)}</td><td className="num">{brl(t.aberto)}</td></tr></tfoot>
          </table>
        </div>
      </section>

      <section className="secao">
        <h2>Em aberto</h2>
        {abertos.length ? (
          <div className="lista">
            {abertos.map((b) => (
              <div key={b.id} className="cartao item-linha">
                <button className="link cresce" style={{ textAlign: 'left', color: 'var(--tinta)' }} onClick={() => abrirBoletim(b.id)}>
                  {clienteDe(e, b)?.nome}<br /><span className="mudo pequeno" style={{ fontWeight: 400 }}>Nota {b.nota.numero}, {competenciaLabel(b.competencia, true).toLowerCase()}</span>
                </button>
                <strong className="num">{brl(b.total)}</strong>
                <button className="btn forte mini" onClick={() => alterar((r) => { const x = r.boletins.find((y) => y.id === b.id)!; x.recebido = true; x.recebidoEm = new Date().toISOString(); })}><Icone.certo /> Dar baixa</button>
              </div>
            ))}
          </div>
        ) : <div className="vazio">Nenhuma nota esperando pagamento.</div>}
      </section>
    </>
  );
}
