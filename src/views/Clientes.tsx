import { useState } from 'react';
import { Cliente, enderecoVazio, Estado, faltasDoCliente, juntarClientes } from '../core/model';
import { digits, fmtCNPJ, fmtCPF, isCNPJ, isCPF, isEmail, parseMoney, uid } from '../core/text';
import { alterar } from '../automation';
import { aplicarCep, aplicarCnpj, buscarCep, buscarCnpj } from '../lib/externo';
import { Campo, Janela } from '../ui';

const fmtDoc = (v: string) => (digits(v).length === 14 ? fmtCNPJ(v) : digits(v).length === 11 ? fmtCPF(v) : v);

export function ClienteJanela({ e, id, fechar }: { e: Estado; id: string; fechar: () => void }) {
  const c = e.clientes.find((x) => x.id === id);
  const [buscando, setBuscando] = useState('');
  const [juntar, setJuntar] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  if (!c) return null;
  const mud = (fn: (x: Cliente) => void) => alterar((r) => { const x = r.clientes.find((y) => y.id === id); if (x) fn(x); });
  const usado = e.boletins.some((b) => b.clienteId === id);
  const outros = e.clientes.filter((x) => x.id !== id && !x.naoIdentificado).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const aoCnpj = async (v: string) => {
    mud((x) => { x.cnpj = digits(v); });
    if (!isCNPJ(v)) return;
    setBuscando('Buscando os dados deste CNPJ…');
    const d = await buscarCnpj(v);
    setBuscando('');
    if (!d) return;
    mud((x) => aplicarCnpj(x, d));
  };
  const aoCep = async (v: string) => {
    mud((x) => { x.endereco.cep = digits(v); });
    if (digits(v).length !== 8) return;
    setBuscando('Buscando o endereço deste CEP…');
    const d = await buscarCep(v);
    setBuscando('');
    if (!d) return;
    mud((x) => aplicarCep(x, d));
  };
  const en = c.endereco;
  const faltas = faltasDoCliente(c);
  return (
    <Janela titulo={c.naoIdentificado ? 'Cliente não identificado' : c.nome || 'Novo cliente'} sub={faltas.length ? `Para emitir a nota falta: ${faltas.join(', ')}.` : 'Cadastro completo. Tudo é salvo sozinho.'} aoFechar={fechar}>
      <div className="grade">
        <Campo classe="c12" rotulo="Nome ou razão social" valor={c.nome} aoMudar={(v) => mud((x) => { if (v.trim()) { x.nome = v.trim(); x.naoIdentificado = false; } })} />
        <Campo classe="c6" rotulo="CNPJ" valor={fmtDoc(c.cnpj)} modo="numeric" aoMudar={aoCnpj} invalido={!!c.cnpj && !isCNPJ(c.cnpj) && !isCPF(c.cnpj)} dica="Ao digitar, eu busco o endereço sozinho." />
        <Campo classe="c6" rotulo="E-mail para receber boletim e nota" valor={c.email} tipo="email" modo="email" aoMudar={(v) => mud((x) => { x.email = v.trim().toLowerCase(); })} invalido={!!c.email && !isEmail(c.email)} />
        <Campo classe="c4" rotulo="CEP" valor={en.cep} modo="numeric" aoMudar={aoCep} />
        <Campo classe="c8" rotulo="Rua / avenida" valor={en.logradouro} aoMudar={(v) => mud((x) => { x.endereco.logradouro = v.trim(); })} />
        <Campo classe="c3" rotulo="Número" valor={en.numero} aoMudar={(v) => mud((x) => { x.endereco.numero = v.trim(); })} />
        <Campo classe="c3" rotulo="Complemento" valor={en.complemento} aoMudar={(v) => mud((x) => { x.endereco.complemento = v.trim(); })} />
        <Campo classe="c6" rotulo="Bairro" valor={en.bairro} aoMudar={(v) => mud((x) => { x.endereco.bairro = v.trim(); })} />
        <Campo classe="c6" rotulo="Cidade" valor={en.cidade} aoMudar={(v) => mud((x) => { x.endereco.cidade = v.trim(); })} />
        <Campo classe="c3" rotulo="UF" valor={en.uf} aoMudar={(v) => mud((x) => { x.endereco.uf = v.trim().toUpperCase().slice(0, 2); })} />
        <Campo classe="c3" rotulo="Código IBGE" valor={en.codMunicipio} modo="numeric" aoMudar={(v) => mud((x) => { x.endereco.codMunicipio = digits(v); })} dica="Vem do CEP." invalido={!!en.codMunicipio && en.codMunicipio.length !== 7} />
        <Campo classe="c6" rotulo="Telefone" valor={c.telefone} modo="tel" aoMudar={(v) => mud((x) => { x.telefone = digits(v); })} />
        <Campo classe="c6" rotulo="Preço do psicoteste para este cliente" valor={c.preco ? String(c.preco).replace('.', ',') : ''} modo="decimal" placeholder={`Padrão: ${String(e.config.precoPadrao).replace('.', ',')}`} aoMudar={(v) => mud((x) => { const n = parseMoney(v); x.preco = n > 0 ? n : null; })} dica="Deixe vazio para usar o preço padrão." />
      </div>
      <p className="mudo pequeno" style={{ minHeight: 22, marginTop: 8 }} aria-live="polite">{buscando}</p>
      {c.apelidos.length > 0 && <p className="mudo pequeno">Também aparece nas planilhas como: {c.apelidos.join('; ')}.</p>}

      {outros.length > 0 && (
        <div className="cartao" style={{ marginTop: 14 }}>
          <label className="campo"><span>Este cliente é o mesmo que outro já cadastrado?</span>
            <select value={juntar} onChange={(ev) => setJuntar(ev.target.value)}>
              <option value="">Não, é um cliente diferente</option>
              {outros.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </label>
          {juntar && <button className="btn" style={{ marginTop: 10 }} onClick={() => { alterar((r) => juntarClientes(r, id, juntar)); fechar(); }}>Juntar os dois cadastros</button>}
        </div>
      )}
      <div className="acoes" style={{ marginTop: 18, justifyContent: 'space-between' }}>
        <button className="btn forte" onClick={fechar}>Pronto</button>
        {!usado && (confirmar
          ? <button className="btn perigo" onClick={() => { alterar((r) => { r.clientes = r.clientes.filter((x) => x.id !== id); }); fechar(); }}>Confirmar exclusão</button>
          : <button className="link" style={{ color: 'var(--ruim)' }} onClick={() => setConfirmar(true)}>Excluir cliente</button>)}
      </div>
    </Janela>
  );
}

export function Clientes({ e, abrirCliente }: { e: Estado; abrirCliente: (id: string) => void }) {
  const [busca, setBusca] = useState('');
  const q = busca.trim().toLowerCase();
  const lista = e.clientes
    .filter((c) => !q || c.nome.toLowerCase().includes(q) || digits(c.cnpj).includes(digits(q) || '§'))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const novo = () => {
    const id = uid();
    alterar((r) => { r.clientes.push({ id, nome: 'Novo cliente', apelidos: [], cnpj: '', email: '', telefone: '', endereco: enderecoVazio(), preco: null, criadoEm: new Date().toISOString() }); });
    abrirCliente(id);
  };
  return (
    <>
      <div className="cab-pagina"><h1>Clientes</h1><button className="btn forte" onClick={novo}>Cadastrar cliente</button></div>
      <p className="mudo" style={{ marginBottom: 14, maxWidth: '62ch' }}>Cliente novo que aparece numa planilha entra aqui sozinho. Complete CNPJ, e-mail e endereço uma única vez e as próximas notas saem sem você tocar em nada.</p>
      {e.clientes.length > 6 && <div className="filtros" style={{ marginBottom: 12 }}><input type="search" placeholder="Buscar por nome ou CNPJ" value={busca} onChange={(ev) => setBusca(ev.target.value)} aria-label="Buscar cliente" style={{ width: 'min(360px, 100%)' }} /></div>}
      {lista.length ? (
        <div className="lista">
          {lista.map((c) => {
            const f = faltasDoCliente(c);
            const n = e.boletins.filter((b) => b.clienteId === c.id).reduce((a, b) => a + b.quantidade, 0);
            return (
              <button key={c.id} className="boletim" onClick={() => abrirCliente(c.id)}>
                <div className="topo"><span className="nome">{c.nome}</span>{f.length ? <span className="selo ambar">Falta {f.join(', ')}</span> : <span className="selo ok">Cadastro completo</span>}</div>
                <div className="mudo pequeno">{[c.cnpj ? fmtDoc(c.cnpj) : '', c.email, `${n} psicoteste${n === 1 ? '' : 's'}`].filter(Boolean).join(', ')}</div>
              </button>
            );
          })}
        </div>
      ) : <div className="vazio">{q ? 'Nenhum cliente com esse nome.' : 'Nenhum cliente ainda. Eles aparecem sozinhos quando você lança uma planilha.'}</div>}
    </>
  );
}
