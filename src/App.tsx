import { useEffect, useState } from 'react';
import { processarArquivos } from './automation';
import { BoletimJanela } from './BoletimJanela';
import { useEstado, useUi } from './store';
import { Icone } from './ui';
import { Ajustes } from './views/Ajustes';
import { Caixa } from './views/Caixa';
import { ClienteJanela, Clientes } from './views/Clientes';
import { Historico } from './views/Historico';
import { Inicio, listarPendencias } from './views/Inicio';

const TELAS = [
  { id: 'inicio', nome: 'Início', icone: Icone.inicio },
  { id: 'caixa', nome: 'Caixa', icone: Icone.caixa },
  { id: 'clientes', nome: 'Clientes', icone: Icone.clientes },
  { id: 'historico', nome: 'Histórico', icone: Icone.historico },
  { id: 'ajustes', nome: 'Ajustes', icone: Icone.ajustes },
] as const;
const telaDaUrl = () => {
  const h = window.location.hash.replace(/^#\/?/, '');
  return TELAS.some((t) => t.id === h) ? h : 'inicio';
};

export function App() {
  const e = useEstado();
  const ui = useUi();
  const [tela, setTela] = useState(telaDaUrl);
  const [boletim, setBoletim] = useState<string | null>(null);
  const [cliente, setCliente] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const ir = (t: string) => { window.location.hash = `/${t}`; };
  useEffect(() => {
    const aoHash = () => { setTela(telaDaUrl()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', aoHash);
    return () => window.removeEventListener('hashchange', aoHash);
  }, []);

  // soltar planilhas em qualquer lugar da janela, ou colar (Ctrl+V)
  useEffect(() => {
    let nivel = 0;
    const temArquivo = (ev: DragEvent) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
    const entra = (ev: DragEvent) => { if (temArquivo(ev)) { nivel++; setArrastando(true); } };
    const sai = () => { nivel = Math.max(0, nivel - 1); if (!nivel) setArrastando(false); };
    const sobre = (ev: DragEvent) => { if (temArquivo(ev)) ev.preventDefault(); };
    const solta = (ev: DragEvent) => {
      nivel = 0;
      setArrastando(false);
      if (!temArquivo(ev)) return;
      // a zona de soltar tem um <input type=file> que já trata o próprio drop
      if (ev.target instanceof HTMLInputElement && ev.target.type === 'file') return;
      ev.preventDefault();
      ir('inicio');
      void processarArquivos([...(ev.dataTransfer?.files ?? [])]);
    };
    const cola = (ev: ClipboardEvent) => {
      const arqs = [...(ev.clipboardData?.files ?? [])];
      if (arqs.length) { ev.preventDefault(); ir('inicio'); void processarArquivos(arqs); }
    };
    window.addEventListener('dragenter', entra);
    window.addEventListener('dragleave', sai);
    window.addEventListener('dragover', sobre);
    window.addEventListener('drop', solta);
    window.addEventListener('paste', cola);
    return () => {
      window.removeEventListener('dragenter', entra);
      window.removeEventListener('dragleave', sai);
      window.removeEventListener('dragover', sobre);
      window.removeEventListener('drop', solta);
      window.removeEventListener('paste', cola);
    };
  }, []);

  const pend = listarPendencias(e).length;
  const nav = { abrirBoletim: setBoletim, abrirCliente: setCliente, ir };

  return (
    <div className="app">
      <nav className="lateral" aria-label="Principal">
        <div className="marca"><img src="/icone.svg" alt="" />Psicotestes</div>
        {TELAS.map((t) => (
          <button key={t.id} className="nav-item" aria-current={tela === t.id ? 'page' : undefined} onClick={() => ir(t.id)}>
            <t.icone />
            <span>{t.nome}</span>
            {t.id === 'inicio' && pend > 0 && <span className="bolha" aria-label={`${pend} pendências`}>{pend}</span>}
          </button>
        ))}
        <div className="rodape">{ui.status.nuvem.pronto ? (ui.nuvem === 'erro' ? 'Nuvem: falhou ao gravar' : 'Dados guardados na nuvem') : 'Dados guardados neste navegador'}</div>
      </nav>
      <main className="principal">
        {!ui.carregado ? <div className="faixa"><span className="girando" /><span>Abrindo…</span></div>
          : tela === 'caixa' ? <Caixa e={e} abrirBoletim={setBoletim} />
          : tela === 'clientes' ? <Clientes e={e} abrirCliente={setCliente} />
          : tela === 'historico' ? <Historico e={e} ui={ui} abrirBoletim={setBoletim} />
          : tela === 'ajustes' ? <Ajustes e={e} ui={ui} />
          : <Inicio e={e} ui={ui} nav={nav} />}
      </main>
      {boletim && <BoletimJanela e={e} ui={ui} id={boletim} fechar={() => setBoletim(null)} abrirCliente={setCliente} />}
      {cliente && <ClienteJanela e={e} id={cliente} fechar={() => setCliente(null)} />}
      {arrastando && <div className="cortina">Pode soltar as planilhas</div>}
      {ui.aviso && <div className={`torrada ${ui.aviso.tipo === 'erro' ? 'erro' : ''}`} role="status">{ui.aviso.texto}</div>}
    </div>
  );
}
