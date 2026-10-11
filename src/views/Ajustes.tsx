import { useState } from 'react';
import { Config, Estado, faltasDoPrestador } from '../core/model';
import { digits, fmtCNPJ, fmtDate, isCNPJ, parseMoney } from '../core/text';
import { alterar, rodar } from '../automation';
import { salvarSenha, senhaSalva } from '../lib/api';
import { baixar } from '../lib/docs';
import { atualizarStatus, avisarUsuario, soMemoria, substituirEstado, Ui } from '../store';
import { Campo } from '../ui';

export function Ajustes({ e, ui }: { e: Estado; ui: Ui }) {
  const cfg = e.config;
  const p = cfg.prestador;
  const f = cfg.fiscal;
  const st = ui.status;
  const [senha, setSenha] = useState(senhaSalva());
  const mud = (fn: (c: Config) => void) => alterar((r) => fn(r.config));
  const faltas = faltasDoPrestador(cfg);

  const entrar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    salvarSenha(senha);
    const s = await atualizarStatus();
    avisarUsuario(s.autenticado ? 'Senha aceita.' : s.online ? 'Senha incorreta.' : 'Servidor fora do ar.', s.autenticado ? 'ok' : 'erro');
    if (s.autenticado) void rodar();
  };
  const exportar = () => baixar([{ nome: `Psicotestes-copia-${new Date().toISOString().slice(0, 10)}.json`, tipo: 'application/json', bytes: new TextEncoder().encode(JSON.stringify(e)) }]);
  const importar = async (arq?: File) => {
    if (!arq) return;
    try {
      const j = JSON.parse(await arq.text());
      if (!j || !Array.isArray(j.boletins) || !Array.isArray(j.clientes)) throw new Error('formato');
      substituirEstado(j);
      avisarUsuario('Cópia restaurada.');
    } catch { avisarUsuario('Este arquivo não é uma cópia de segurança válida.', 'erro'); }
  };
  const Liga = ({ ok, titulo, texto }: { ok: boolean; titulo: string; texto: string }) => (
    <li><span className={`ponto ${ok ? 'ok' : 'falta'}`}>{ok ? '✓' : '!'}</span><span><strong>{titulo}</strong><br /><span className="mudo pequeno">{texto}</span></span></li>
  );

  return (
    <>
      <div className="cab-pagina"><h1>Ajustes</h1></div>
      <p className="mudo" style={{ maxWidth: '60ch' }}>Preencha uma vez. Tudo é salvo sozinho ao sair de cada campo.</p>

      <section className="secao">
        <h2>Sua clínica</h2>
        <div className="cartao grade">
          <Campo classe="c8" rotulo="Razão social" valor={p.razao} aoMudar={(v) => mud((c) => { c.prestador.razao = v.trim(); })} />
          <Campo classe="c4" rotulo="CNPJ" valor={p.cnpj ? fmtCNPJ(p.cnpj) : ''} modo="numeric" aoMudar={(v) => mud((c) => { c.prestador.cnpj = digits(v); })} invalido={!!p.cnpj && !isCNPJ(p.cnpj)} />
          <Campo classe="c4" rotulo="Inscrição municipal" valor={p.im} aoMudar={(v) => mud((c) => { c.prestador.im = v.trim(); })} />
          <Campo classe="c4" rotulo="E-mail" valor={p.email} tipo="email" modo="email" aoMudar={(v) => mud((c) => { c.prestador.email = v.trim(); })} dica="As respostas dos clientes chegam aqui." />
          <Campo classe="c4" rotulo="Telefone" valor={p.telefone} modo="tel" aoMudar={(v) => mud((c) => { c.prestador.telefone = v.trim(); })} />
        </div>
      </section>

      <section className="secao">
        <h2>Preço</h2>
        <div className="cartao grade">
          <Campo classe="c4" rotulo="Preço de cada psicoteste (R$)" valor={cfg.precoPadrao ? String(cfg.precoPadrao).replace('.', ',') : ''} modo="decimal" placeholder="Ex.: 80,00" aoMudar={(v) => mud((c) => { c.precoPadrao = parseMoney(v); })} dica="Cada cliente pode ter um preço próprio no cadastro dele." />
        </div>
      </section>

      <section className="secao">
        <h2>Nota fiscal</h2>
        {faltas.length > 0 && <div className="faixa alerta" style={{ marginTop: 0, marginBottom: 12 }}><p>Para emitir falta: {faltas.join(', ')}.</p></div>}
        <div className="cartao grade">
          <label className="chave c12"><input type="checkbox" checked={cfg.emitirAutomatico} onChange={(ev) => mud((c) => { c.emitirAutomatico = ev.target.checked; })} /><span><strong>Emitir as notas sozinho</strong><br /><span className="mudo pequeno">Desligado, os boletins continuam sendo gerados e você emite no portal.</span></span></label>
          <p className="c12 mudo pequeno">Os códigos abaixo são os mesmos que aparecem numa nota já emitida no portal da prefeitura. Confirme com o contador antes da primeira nota.</p>
          <Campo classe="c4" rotulo="Item da lista de serviços" valor={f.itemLista} modo="numeric" aoMudar={(v) => mud((c) => { c.fiscal.itemLista = digits(v); })} dica="Psicologia é o item 4.16 (digite 0416)." />
          <Campo classe="c4" rotulo="CNAE" valor={f.cnae} modo="numeric" aoMudar={(v) => mud((c) => { c.fiscal.cnae = digits(v); })} dica="7 dígitos. Psicologia: 8650003." />
          <Campo classe="c4" rotulo="Alíquota do ISS (%)" valor={String(f.aliquota).replace('.', ',')} modo="decimal" aoMudar={(v) => mud((c) => { c.fiscal.aliquota = Math.min(parseMoney(v), 10); })} />
          <label className="campo c6"><span>Natureza da operação</span>
            <select value={f.natureza} onChange={(ev) => mud((c) => { c.fiscal.natureza = ev.target.value; })}>
              <option value="1">1 — Tributação no município</option><option value="2">2 — Tributação fora do município</option><option value="3">3 — Isenção</option><option value="4">4 — Imune</option><option value="5">5 — Suspensa por decisão judicial</option><option value="6">6 — Suspensa por procedimento administrativo</option>
            </select>
          </label>
          <label className="campo c6"><span>Regime especial de tributação</span>
            <select value={f.regime} onChange={(ev) => mud((c) => { c.fiscal.regime = ev.target.value; })}>
              <option value="">Nenhum</option><option value="1">1 — Microempresa municipal</option><option value="2">2 — Estimativa</option><option value="3">3 — Sociedade de profissionais</option><option value="4">4 — Cooperativa</option><option value="5">5 — MEI</option><option value="6">6 — ME ou EPP</option>
            </select>
          </label>
          <label className="chave c6"><input type="checkbox" checked={f.simples} onChange={(ev) => mud((c) => { c.fiscal.simples = ev.target.checked; })} /><span>Optante pelo Simples Nacional</span></label>
          <label className="chave c6"><input type="checkbox" checked={f.issRetido} onChange={(ev) => mud((c) => { c.fiscal.issRetido = ev.target.checked; })} /><span>ISS retido pelo cliente</span></label>
          <Campo classe="c3" rotulo="Série do RPS" valor={f.serie} aoMudar={(v) => mud((c) => { c.fiscal.serie = v.trim().slice(0, 5) || 'A'; })} />
          <Campo classe="c3" rotulo="Próximo nº de RPS" valor={String(f.proximoRps)} modo="numeric" aoMudar={(v) => mud((c) => { const n = Number(digits(v)); if (n >= 1) c.fiscal.proximoRps = n; })} dica="Continue de onde parou no portal." />
          <Campo classe="c6" rotulo="Código de tributação do município" valor={f.codTributacao} aoMudar={(v) => mud((c) => { c.fiscal.codTributacao = v.trim(); })} dica="Opcional." />
          <Campo classe="c4" rotulo="NBS" valor={f.nbs} modo="numeric" aoMudar={(v) => mud((c) => { c.fiscal.nbs = digits(v); })} dica="Reforma tributária. Opcional." />
          <Campo classe="c4" rotulo="Classificação IBS/CBS" valor={f.cClassTrib} modo="numeric" aoMudar={(v) => mud((c) => { c.fiscal.cClassTrib = digits(v); })} dica="Opcional." />
          <Campo classe="c4" rotulo="Indicador da operação" valor={f.indop} modo="numeric" aoMudar={(v) => mud((c) => { c.fiscal.indop = digits(v); })} dica="Opcional." />
          <Campo classe="c12" area rotulo="Texto da nota" valor={cfg.discriminacao} aoMudar={(v) => mud((c) => { if (v.trim()) c.discriminacao = v.trim(); })} dica="Eu troco {qtd} pela quantidade, {mes} pelo mês, {boletim} pelo número do boletim e {preco} pelo valor unitário." />
        </div>
      </section>

      <section className="secao">
        <h2>Ligações</h2>
        <div className="cartao">
          {!st.online ? <p>Não encontrei o servidor. Lendo planilhas e gerando boletins normalmente neste aparelho; nota e e-mail automáticos dependem do site publicado na Vercel.</p> : (
            <>
              {(!st.autenticado) && (
                <form className="acoes" onSubmit={entrar} style={{ marginBottom: 16 }}>
                  <input className="entrada" type="password" style={{ flex: '1 1 200px', width: 'auto', maxWidth: 280 }} placeholder={st.senhaDefinida ? 'Senha do sistema' : 'Defina SENHA_DO_APP na Vercel'} value={senha} onChange={(ev) => setSenha(ev.target.value)} aria-label="Senha do sistema" disabled={!st.senhaDefinida} />
                  <button className="btn forte" disabled={!senha || !st.senhaDefinida}>Entrar</button>
                </form>
              )}
              <ul className="check">
                <Liga ok={st.autenticado} titulo="Senha do sistema" texto={st.autenticado ? 'Este aparelho está liberado.' : st.senhaDefinida ? 'Digite a senha acima.' : 'Ainda não definida no servidor (variável SENHA_DO_APP).'} />
                <Liga ok={st.nfse.pronto} titulo="Certificado digital A1" texto={st.nfse.pronto ? `${st.nfse.titular}, válido até ${fmtDate(st.nfse.validade)}. Ambiente: ${st.nfse.ambiente === 'producao' ? 'produção (notas valem)' : 'homologação (notas de teste)'}.` : st.nfse.erro ?? 'Não instalado. Sem ele a prefeitura não aceita emissão automática.'} />
                <Liga ok={st.email.pronto} titulo="Envio de e-mail" texto={st.email.pronto ? `Saindo de ${st.email.remetente}.` : 'Conta de e-mail ainda não configurada.'} />
                <Liga ok={st.nuvem.pronto && ui.nuvem !== 'erro'} titulo="Cópia na nuvem (Supabase)" texto={st.nuvem.pronto ? (ui.nuvem === 'erro' ? 'Configurada, mas a última gravação falhou.' : 'Ligada: os dados aparecem iguais no computador e no celular.') : 'Opcional. Sem ela, os dados ficam só neste navegador.'} />
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="secao">
        <h2>Cópia de segurança</h2>
        <div className="cartao">
          <p className="mudo" style={{ marginBottom: 12 }}>{soMemoria() ? 'Atenção: este navegador está bloqueando a gravação (modo anônimo?). Baixe uma cópia antes de fechar.' : 'Os dados moram neste navegador. Baixe uma cópia de vez em quando ou ao trocar de aparelho.'}</p>
          <div className="acoes">
            <button className="btn" onClick={exportar}>Baixar cópia dos dados</button>
            <label className="btn calmo" style={{ cursor: 'pointer' }}>Restaurar uma cópia<input type="file" accept="application/json,.json" className="sr" onChange={(ev) => { void importar(ev.target.files?.[0]); ev.target.value = ''; }} /></label>
          </div>
        </div>
      </section>
    </>
  );
}
