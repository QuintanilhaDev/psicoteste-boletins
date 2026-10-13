import { useRef, useState } from 'react';
import { Estado, juntarClientes, pendencias, Pendencia, resolverRepetidos } from '../core/model';
import { parseMoney } from '../core/text';
import { aguardandoConferencia, alterar, podeEmitir, processarArquivos, rodar } from '../automation';
import { salvarSenha } from '../lib/api';
import { atualizarStatus, setUi, Ui } from '../store';
import { CartaoBoletim, Icone } from '../ui';

interface Nav { abrirBoletim: (id: string) => void; abrirCliente: (id: string) => void; ir: (v: string) => void; abrirConferencia: () => void }

export const ACEITOS = '.xlsx,.xls,.xlsm,.csv,.ods,.txt,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

interface Item { chave: string; p: Pendencia; clienteId: string; boletimId: string; boletins: number }
export function listarPendencias(e: Estado): Item[] {
  const m = new Map<string, Item>();
  for (const b of e.boletins) {
    if (b.nota.status === 'emitida' || b.nota.status === 'emitindo') continue;
    for (const p of pendencias(e, b)) {
      const chave = p.tipo === 'preco' || p.tipo === 'clinica' ? p.tipo : p.tipo === 'repetidos' ? `${p.tipo}|${b.id}` : `${p.tipo}|${b.clienteId}`;
      const it = m.get(chave);
      if (it) it.boletins++;
      else m.set(chave, { chave, p, clienteId: b.clienteId, boletimId: b.id, boletins: 1 });
    }
  }
  const ordem = ['identificar', 'parecido', 'repetidos', 'preco', 'clinica', 'cliente'];
  return [...m.values()].sort((a, b) => ordem.indexOf(a.p.tipo) - ordem.indexOf(b.p.tipo));
}

function Identificar({ e, clienteId }: { e: Estado; clienteId: string }) {
  const [escolha, setEscolha] = useState('');
  const [nome, setNome] = useState('');
  const outros = e.clientes.filter((c) => !c.naoIdentificado).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const ok = escolha === '_novo' ? nome.trim().length >= 2 : !!escolha;
  const confirmar = () =>
    alterar((r) => {
      if (escolha === '_novo') {
        const c = r.clientes.find((x) => x.id === clienteId);
        if (c) { c.nome = nome.trim(); c.naoIdentificado = false; }
      } else juntarClientes(r, clienteId, escolha);
    });
  return (
    <div className="acoes" style={{ width: '100%' }}>
      <select className="entrada" style={{ flex: '1 1 200px', width: 'auto' }} value={escolha} onChange={(ev) => setEscolha(ev.target.value)} aria-label="Cliente desta planilha">
        <option value="">Escolha o cliente…</option>
        {outros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        <option value="_novo">É um cliente novo</option>
      </select>
      {escolha === '_novo' && <input className="entrada" style={{ flex: '1 1 200px', width: 'auto' }} placeholder="Nome da empresa" value={nome} onChange={(ev) => setNome(ev.target.value)} aria-label="Nome da empresa" />}
      <button className="btn forte" disabled={!ok} onClick={confirmar}>Confirmar cliente</button>
    </div>
  );
}

function Preco() {
  const [v, setV] = useState('');
  const n = parseMoney(v);
  return (
    <form className="acoes" style={{ width: '100%' }} onSubmit={(ev) => { ev.preventDefault(); if (n > 0) alterar((r) => { r.config.precoPadrao = n; }); }}>
      <input className="entrada" style={{ flex: '1 1 140px', width: 'auto', maxWidth: 220 }} inputMode="decimal" placeholder="Ex.: 80,00" value={v} onChange={(ev) => setV(ev.target.value)} aria-label="Preço de cada psicoteste em reais" />
      <button className="btn forte" disabled={!(n > 0)}>Usar este preço</button>
    </form>
  );
}

function Pendencias({ e, nav }: { e: Estado; nav: Nav }) {
  const itens = listarPendencias(e);
  if (!itens.length) return null;
  return (
    <section className="secao" aria-labelledby="t-pend">
      <h2 id="t-pend">Só falta você me dizer</h2>
      <div className="lista">
        {itens.map((it) => {
          const c = e.clientes.find((x) => x.id === it.clienteId);
          const n = it.boletins > 1 ? ` (${it.boletins} boletins esperando)` : '';
          if (it.p.tipo === 'preco') return <div key={it.chave} className="faixa alerta" style={{ marginTop: 0 }}><p className="cresce"><strong>Quanto custa cada psicoteste?</strong><br /><span className="pequeno">Vale para todos os clientes. Dá para pôr um preço diferente em cada cadastro depois.</span></p><Preco /></div>;
          if (it.p.tipo === 'clinica') return <div key={it.chave} className="faixa alerta" style={{ marginTop: 0 }}><p className="cresce"><strong>Dados da sua clínica para a nota</strong><br /><span className="pequeno">{it.p.texto}</span></p><button className="btn" onClick={() => nav.ir('ajustes')}>Preencher nos ajustes</button></div>;
          if (it.p.tipo === 'identificar') return <div key={it.chave} className="faixa alerta" style={{ marginTop: 0 }}><p className="cresce"><strong>De qual empresa é esta planilha?</strong><br /><span className="pequeno">{c?.nome.replace('Empresa não identificada ', '')} não traz o nome da empresa.</span></p><Identificar e={e} clienteId={it.clienteId} /></div>;
          if (it.p.tipo === 'repetidos') return (
            <div key={it.chave} className="faixa alerta" style={{ marginTop: 0 }}>
              <p className="cresce"><strong>Cobrar de novo de {c?.nome}?</strong><br /><span className="pequeno">{it.p.texto}</span></p>
              <div className="acoes">
                <button className="btn forte" onClick={() => alterar((r) => resolverRepetidos(r, it.boletimId, false))}>Não cobrar os repetidos</button>
                <button className="btn" onClick={() => alterar((r) => resolverRepetidos(r, it.boletimId, true))}>Cobrar todos</button>
              </div>
            </div>
          );
          if (it.p.tipo === 'parecido') return (
            <div key={it.chave} className="faixa alerta" style={{ marginTop: 0 }}>
              <p className="cresce"><strong>{it.p.texto}</strong><br /><span className="pequeno">Os nomes são parecidos. Não emito nota sem ter certeza.</span></p>
              <div className="acoes">
                <button className="btn forte" onClick={() => alterar((r) => juntarClientes(r, it.clienteId, c!.parecidoCom!))}>Sim, é o mesmo</button>
                <button className="btn" onClick={() => alterar((r) => { const x = r.clientes.find((y) => y.id === it.clienteId); if (x) x.parecidoCom = undefined; })}>Não, é outro</button>
              </div>
            </div>
          );
          return <div key={it.chave} className="faixa alerta" style={{ marginTop: 0 }}><p className="cresce"><strong>{it.p.texto}</strong>{n && <><br /><span className="pequeno">{n.trim()}</span></>}</p><button className="btn" onClick={() => nav.abrirCliente(it.clienteId)}>Completar cadastro</button></div>;
        })}
      </div>
    </section>
  );
}

function Senha() {
  const [v, setV] = useState('');
  const [erro, setErro] = useState(false);
  const entrar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    salvarSenha(v);
    const s = await atualizarStatus();
    setErro(!s.autenticado);
    if (s.autenticado) void rodar();
  };
  return (
    <form className="faixa" onSubmit={entrar}>
      <p className="cresce"><strong>Digite a senha do sistema</strong><br /><span className="pequeno">{erro ? 'Senha incorreta. Tente de novo.' : 'Só uma vez neste aparelho. Ela libera a nota fiscal e o e-mail.'}</span></p>
      <input className="entrada" style={{ flex: '1 1 160px', width: 'auto', maxWidth: 240 }} type="password" value={v} onChange={(ev) => setV(ev.target.value)} aria-label="Senha do sistema" autoComplete="current-password" />
      <button className="btn forte" disabled={!v}>Entrar</button>
    </form>
  );
}

export function Inicio({ e, ui, nav }: { e: Estado; ui: Ui; nav: Nav }) {
  const [sobre, setSobre] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const receber = (lista: FileList | null) => {
    const arquivos = lista ? [...lista] : [];
    if (input.current) input.current.value = '';
    void processarArquivos(arquivos);
  };
  const recentes = [...e.boletins].sort((a, b) => b.numero - a.numero).slice(0, 6);
  const naFila = e.boletins.filter((b) => podeEmitir(e, b)).length;
  const conferir = e.boletins.filter(aguardandoConferencia).length;
  const st = ui.status;
  return (
    <>
      <label className={`zona ${sobre ? 'sobre' : ''}`} onDragOver={(ev) => { ev.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)} onDrop={() => setSobre(false)}>
        <h1>Solte as planilhas aqui.</h1>
        <p>Eu leio qualquer formato, monto o boletim de cada empresa, emito a nota fiscal e salvo tudo em Downloads. Antes de mandar ao cliente, você confere cada e-mail.</p>
        <span className="escolher"><Icone.subir /> Escolher planilhas</span>
        <input ref={input} type="file" multiple accept={ACEITOS} onChange={(ev) => receber(ev.target.files)} aria-label="Escolher planilhas de psicotestes" />
        <svg className="folhas" viewBox="0 0 200 180" aria-hidden="true">
          <g transform="rotate(-9 100 90)"><rect x="46" y="26" width="112" height="140" rx="8" fill="#dfe9e5" /><path d="M62 54h80M62 74h80M62 94h80M62 114h80M62 134h52" stroke="#9fb7b0" strokeWidth="6" strokeLinecap="round" /></g>
          <g transform="rotate(7 100 90)"><rect x="40" y="20" width="112" height="140" rx="8" fill="#fff" /><path d="M56 48h80M56 68h80M56 88h80" stroke="#c7d6d1" strokeWidth="6" strokeLinecap="round" /><path d="m64 122 16 16 34-38" fill="none" stroke="#0e6b5e" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" /></g>
        </svg>
      </label>

      <div aria-live="polite">
        {ui.ocupado && <div className="faixa"><span className="girando" /><span className="cresce">{ui.ocupado}</span></div>}
        {ui.leituras.map((l, i) => (
          <div key={i} className={`faixa ${l.ok ? 'ok' : 'alerta'}`}><p className="cresce"><strong style={{ overflowWrap: 'anywhere' }}>{l.arquivo}</strong><br />{l.texto}</p></div>
        ))}
        {ui.contagem != null && (
          <div className="faixa alerta">
            <span className="contador num">{ui.contagem}</span>
            <p className="cresce"><strong>Vou emitir {naFila} nota{naFila === 1 ? '' : 's'} na prefeitura.</strong><br /><span className="pequeno">Depois de emitida, a nota só se cancela no portal.</span></p>
            <button className="btn" onClick={() => setUi({ pausado: true })}>Pausar emissão</button>
          </div>
        )}
        {ui.pausado && (
          <div className="faixa alerta"><p className="cresce"><strong>Emissão de notas pausada.</strong> Os boletins continuam sendo gerados.</p><button className="btn forte" onClick={() => { setUi({ pausado: false }); void rodar(); }}>Retomar emissão</button></div>
        )}
      </div>

      {st.online && st.senhaDefinida && !st.autenticado && <Senha />}
      {conferir > 0 && (
        <div className="faixa conferencia">
          <p className="cresce"><strong>{conferir === 1 ? '1 e-mail pronto para você conferir' : `${conferir} e-mails prontos para você conferir`}</strong><br /><span className="pequeno">Boletim (PDF e Excel) e nota fiscal de cada cliente. Nada sai antes de você confirmar.</span></p>
          <button className="btn" onClick={nav.abrirConferencia}>Conferir e enviar</button>
        </div>
      )}
      <Pendencias e={e} nav={nav} />

      <section className="secao" aria-labelledby="t-rec">
        <div className="linha-titulo">
          <h2 id="t-rec">Últimos boletins</h2>
          {e.boletins.length > recentes.length && <button className="link" onClick={() => nav.ir('historico')}>Ver todos os {e.boletins.length}</button>}
        </div>
        {recentes.length ? <div className="lista">{recentes.map((b) => <CartaoBoletim key={b.id} e={e} ui={ui} b={b} abrir={nav.abrirBoletim} />)}</div> : <div className="vazio">Nenhum boletim ainda. Solte a primeira planilha ali em cima.</div>}
      </section>

      {ui.carregado && (!st.nfse.pronto || !st.email.pronto) && (
        <section className="secao" aria-labelledby="t-lig">
          <h2 id="t-lig">O que já funciona sozinho</h2>
          <div className="cartao">
            <ul className="check">
              <li><span className="ponto ok">✓</span><span>Ler planilhas, montar os boletins e salvar em Downloads</span></li>
              <li><span className={`ponto ${st.nfse.pronto ? 'ok' : 'falta'}`}>{st.nfse.pronto ? '✓' : '!'}</span><span>Emitir a nota fiscal na prefeitura{st.nfse.pronto ? '' : <span className="mudo"> — falta instalar o certificado digital A1. Enquanto isso, emita no portal e toque em “Já emiti no portal” no boletim.</span>}</span></li>
              <li><span className={`ponto ${st.email.pronto ? 'ok' : 'falta'}`}>{st.email.pronto ? '✓' : '!'}</span><span>Enviar boletim e nota por e-mail{st.email.pronto ? '' : <span className="mudo"> — falta configurar a conta de e-mail.</span>}</span></li>
            </ul>
            {(!st.nfse.pronto || !st.email.pronto) && <p className="mudo pequeno" style={{ marginTop: 12 }}>Essa parte é feita uma vez por quem instalou o sistema (passo a passo no README do projeto).</p>}
          </div>
        </section>
      )}
    </>
  );
}
