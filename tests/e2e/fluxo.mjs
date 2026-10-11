// Simulação do fluxo inteiro num navegador de verdade. Rodar: npm run build && node tests/e2e/fluxo.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { subir } from './servidor.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psico-'));
const fotos = process.env.FOTOS || path.join(tmp, 'fotos');
fs.mkdirSync(fotos, { recursive: true });
let falhas = 0;
let total = 0;
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.log(`   ✗ ${msg}`); } else if (process.env.VERBOSO) console.log(`   ✓ ${msg}`); };
const igual = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

let semente = 99;
const rnd = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff), semente / 0x7fffffff);
function cpf() {
  let d = '';
  while (d.length < 9) d += Math.floor(rnd() * 10);
  for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); d += ((s * 10) % 11) % 10; }
  return d;
}
const mask = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
const N = ['João', 'Maria', 'José', 'Ana', 'Carlos', 'Paulo', 'Rita', 'Jorge', 'Edson', 'Cláudia'];
const S = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Conceição', 'de Jesus', 'Nascimento', 'Bispo', 'Pereira'];
const pessoa = () => `${N[Math.floor(rnd() * N.length)]} ${S[Math.floor(rnd() * S.length)]} ${S[Math.floor(rnd() * S.length)]}`;
const gente = (n) => Array.from({ length: n }, () => [pessoa(), cpf()]);
function planilha(nome, abas) {
  const wb = XLSX.utils.book_new();
  for (const [n, l] of Object.entries(abas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(l), n);
  const p = path.join(tmp, nome);
  fs.writeFileSync(p, XLSX.write(wb, { type: 'buffer', bookType: nome.endsWith('.xls') ? 'biff8' : 'xlsx' }));
  return p;
}

const navegador = await chromium.launch();
async function abrir(amb, { celular = false, senha = true, ritmo = 0.02, armazenamento } = {}) {
  const ctx = await navegador.newContext({ acceptDownloads: true, viewport: celular ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: celular, hasTouch: celular, deviceScaleFactor: celular ? 2 : 1, locale: 'pt-BR', timezoneId: 'America/Bahia', storageState: armazenamento });
  await ctx.addInitScript(([r, s]) => { window.__PSICO_RITMO__ = r; if (s) try { localStorage.setItem('psico-senha', 'segredo'); } catch {} }, [ritmo, senha]);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/brasilapi\.com\.br/, (r) => {
    const cnpj = r.request().url().split('/').pop();
    if (cnpj === '11444777000161') return r.fulfill({ json: { razao_social: 'ALFA SEGURANCA PATRIMONIAL LTDA', descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'TANCREDO NEVES', numero: '620', complemento: 'SALA 301', bairro: 'CAMINHO DAS ARVORES', municipio: 'SALVADOR', uf: 'BA', cep: '41820020', codigo_municipio_ibge: 2927408, email: null, ddd_telefone_1: '7133334444' } });
    return r.fulfill({ status: 404, json: { message: 'não encontrado' } });
  });
  await ctx.route(/viacep\.com\.br/, (r) => r.fulfill({ json: { logradouro: 'Rua Chile', bairro: 'Centro', localidade: 'Salvador', uf: 'BA', ibge: '2927408' } }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) erros.push(m.text()); });
  const baixados = [];
  page.on('download', async (d) => { const p = path.join(tmp, `${Date.now()}-${d.suggestedFilename()}`); await d.saveAs(p); baixados.push({ nome: d.suggestedFilename(), caminho: p }); });
  await page.goto(amb.url);
  await page.waitForSelector('.zona');
  const estado = () => page.evaluate(() => new Promise((res, rej) => { const o = indexedDB.open('keyval-store'); o.onerror = () => rej(o.error); o.onsuccess = () => { const q = o.result.transaction('keyval').objectStore('keyval').get('psico-estado'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }; }));
  const ate = async (fn, msg, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const e = await estado().catch(() => null);
      try { if (e && (await fn(e))) return e; } catch { /* ainda não */ }
      if (Date.now() - t0 > ms) { ok(false, `tempo esgotado: ${msg} | tela: ${(await page.locator('.faixa').allInnerTexts()).join(' / ').replace(/\n/g, ' ').slice(0, 600)}`); return e; }
      await page.waitForTimeout(60);
    }
  };
  // como buffer: o Chromium de teste não aceita caminho com acento, e assim o nome com acento chega intacto ao app
  const soltar = (arqs) => page.setInputFiles('.zona input', arqs.map((a) => ({ name: path.basename(a), mimeType: 'application/octet-stream', buffer: fs.readFileSync(a) })));
  const ir = async (t) => { await page.evaluate((x) => { location.hash = `/${x}`; }, t); await page.waitForTimeout(80); };
  const semRolagemLateral = async (onde) => ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1), `sem rolagem lateral em ${onde}`);
  return { ctx, page, erros, baixados, estado, ate, soltar, ir, semRolagemLateral };
}
async function preencher(page, rotulo, valor, escopo = page) {
  const c = escopo.getByLabel(rotulo, { exact: false }).first();
  await c.fill(valor);
  await c.blur();
}
const arquivosDoZip = async (p) => Object.keys((await JSZip.loadAsync(fs.readFileSync(p))).files).sort();
async function configurarClinica(t) {
  await t.ir('ajustes');
  await preencher(t.page, 'Razão social', 'Clínica Teste Ltda');
  await preencher(t.page, 'CNPJ', '11.222.333/0001-81');
  await preencher(t.page, 'Inscrição municipal', '123.456/001-99');
  await preencher(t.page, 'E-mail', 'contato@clinicateste.com.br');
  await preencher(t.page, 'Preço de cada psicoteste', '85,50');
  await preencher(t.page, 'CNAE', '8650003');
  await t.ir('inicio');
}
const cenarios = [];
const cenario = (nome, fn) => cenarios.push({ nome, fn });

// ---------------------------------------------------------------------------------------------
cenario('1. Primeiro uso, sem certificado nem e-mail: boletins, nota manual, caixa, planilha', async () => {
  const amb = await subir({ configurado: false });
  const t = await abrir(amb, { senha: false });
  const g1 = gente(7); const g2 = gente(4);
  const arq = planilha('Psicotestes março 2026.xlsx', { Plan1: [['CLÍNICA TESTE LTDA'], ['Relação de psicotestes'], [], ['Nº', 'VIGILANTE', 'C.P.F.', 'CONTRATANTE'], ...g1.map((p, i) => [i + 1, p[0].toUpperCase(), mask(p[1]), 'Alfa Segurança Ltda']), ...g2.map((p, i) => [i + 8, p[0], Number(p[1]), 'Beta Vigilância']), ['TOTAL', null, null, 11]] });
  await t.soltar([arq]);
  let e = await t.ate((x) => x.boletins.length === 2, 'dois boletins criados');
  igual(e.boletins.map((b) => [b.quantidade, b.competencia]).sort(), [[4, '2026-03'], [7, '2026-03']], 'quantidades e mês lidos');
  ok(await t.page.getByText('Quanto custa cada psicoteste?').isVisible(), 'pede o preço');
  igual(t.baixados.length, 0, 'não baixa boletim sem preço');
  await t.page.getByLabel('Preço de cada psicoteste em reais').fill('85,5');
  await t.page.getByRole('button', { name: 'Usar este preço' }).click();
  e = await t.ate((x) => x.boletins.every((b) => b.baixado.boletim), 'boletins baixados');
  igual(e.boletins.map((b) => b.total).sort((a, b) => a - b), [342, 598.5], 'totais calculados');
  await t.page.waitForTimeout(400);
  igual(t.baixados.length, 1, 'um único download (zip)');
  igual((await arquivosDoZip(t.baixados[0].caminho)).length, 2, 'zip com os 2 boletins em PDF');
  const pdf = await (await JSZip.loadAsync(fs.readFileSync(t.baixados[0].caminho))).file(/Alfa/)[0].async('nodebuffer');
  ok(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 3000, 'PDF do boletim é válido');
  ok(await t.page.getByText(/Falta CNPJ, e-mail, endereço de Alfa/).first().isVisible(), 'diz o que falta no cadastro do cliente');
  await t.page.screenshot({ path: path.join(fotos, '1-inicio-desktop.png'), fullPage: true });

  // mesma planilha de novo: nada duplica
  await t.soltar([arq]);
  await t.page.getByText('Já tinha sido lançada antes').waitFor();
  igual((await t.estado()).boletins.length, 2, 'planilha repetida não gera boletim');
  // mesma lista salva com outro nome e em .xls, com 1 pessoa nova
  const novo = gente(1)[0];
  const arq2 = planilha('alfa de novo.xls', { Dados: [['Nome', 'CPF', 'Empresa'], ...g1.map((p) => [p[0].toUpperCase(), p[1], 'ALFA SEGURANCA LTDA.']), [novo[0], novo[1], 'ALFA SEGURANCA LTDA.']] });
  await t.soltar([arq2]);
  e = await t.ate((x) => x.boletins.length === 3, 'boletim complementar');
  igual(e.boletins.find((b) => b.numero === 3).duvida?.cpfs.length, 7, 'planilha sem data com gente já cobrada em março: pergunta antes de cobrar');
  igual(e.boletins.find((b) => b.numero === 3).baixado.boletim, false, 'boletim em dúvida não é baixado nem faturado');
  await t.page.getByRole('button', { name: 'Não cobrar os repetidos' }).click();
  e = await t.ate((x) => !x.boletins.find((b) => b.numero === 3).duvida, 'dúvida resolvida');
  igual(e.boletins.find((b) => b.numero === 3).quantidade, 1, 'só a pessoa nova é cobrada (mesmo CPF não cobra 2x)');
  igual(e.clientes.length, 2, 'ALFA SEGURANCA LTDA. = Alfa Segurança Ltda (mesmo cliente)');

  // nota emitida no portal
  await t.page.locator('button.boletim', { hasText: 'Beta Vigilância' }).first().click();
  await t.page.getByRole('button', { name: 'Já emiti no portal' }).click();
  await t.page.getByLabel('Número da nota').fill('4521');
  await t.page.getByRole('button', { name: 'Registrar nota' }).click();
  e = await t.ate((x) => x.boletins.find((b) => b.quantidade === 4).nota.status === 'emitida', 'nota manual registrada');
  await t.page.getByRole('button', { name: /Dar baixa: recebi/ }).click();
  await t.ate((x) => x.boletins.find((b) => b.quantidade === 4).recebido, 'baixa registrada');
  await t.page.getByRole('button', { name: 'Fechar' }).click();
  await t.ir('caixa');
  const razao = await t.page.locator('.razao').innerText();
  ok(/12/.test(razao) && razao.includes('342,00'), `caixa mostra psicotestes e recebido (${razao.replace(/\n/g, ' ')})`);
  await t.page.screenshot({ path: path.join(fotos, '1-caixa-desktop.png'), fullPage: true });
  const antes = t.baixados.length;
  await t.page.getByRole('button', { name: /Baixar planilha completa/ }).click();
  await t.page.getByText('Planilha salva em Downloads').waitFor();
  await t.page.waitForTimeout(300);
  const x = t.baixados[antes];
  ok(x && x.nome.endsWith('.xlsx'), 'relatório em Excel baixado');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(x.caminho);
  igual(wb.worksheets.map((w) => w.name), ['Por mês', 'Por cliente', 'Cliente x mês', 'Boletins', 'Vigilantes'], 'abas do relatório');
  igual([wb.getWorksheet('Por mês').getCell('B5').value, wb.getWorksheet('Por mês').getCell('B6').value, wb.getWorksheet('Por mês').getCell('B7').value.result], [11, 1, 12], 'relatório: 11 em março, 1 no mês atual, total 12');
  igual(wb.getWorksheet('Vigilantes').rowCount, 4 + 12, 'relatório: 12 vigilantes listados');
  ok(wb.getWorksheet('Boletins').getCell('A4').fill.fgColor.argb === 'FF0E6B5E', 'relatório estilizado');
  // persistência
  await t.ir('inicio');
  await t.page.reload(); await t.page.waitForSelector('.zona');
  igual((await t.estado()).boletins.length, 3, 'dados continuam após recarregar');
  for (const tela of ['clientes', 'historico', 'ajustes']) { await t.ir(tela); await t.page.screenshot({ path: path.join(fotos, `1-${tela}-desktop.png`), fullPage: true }); }
  igual(t.erros, [], 'sem erros no console');
  await t.ctx.close(); amb.fechar();
});

// ---------------------------------------------------------------------------------------------
cenario('2. Tudo configurado: planilha → boletim → nota → e-mail → download, sem cliques', async () => {
  const amb = await subir();
  const t = await abrir(amb);
  await configurarClinica(t);
  const g = gente(5);
  const arq = planilha('abril.xlsx', { Plan1: [['Vigilante', 'CPF', 'Razão Social', 'CNPJ', 'E-mail', 'Data'], ...g.map((p) => [p[0], p[1], 'Alfa Segurança', '11.444.777/0001-61', 'financeiro@alfa.com.br', '14/04/2026'])] });
  await t.soltar([arq]);
  await t.page.locator('.contador').waitFor({ timeout: 8000 });
  let e = await t.ate((x) => x.boletins[0]?.email.status === 'enviado' && x.boletins[0].baixado.nota, 'nota emitida, e-mail enviado e baixado', 20000);
  const b = e.boletins[0];
  igual([b.nota.status, b.nota.origem, b.nota.rps, b.nota.numero, b.total, b.competencia], ['emitida', 'automatica', 1, '2026001', 427.5, '2026-04'], 'nota registrada');
  igual(e.clientes[0].nome, 'ALFA SEGURANCA PATRIMONIAL LTDA', 'razão social oficial veio do CNPJ');
  ok(e.clientes[0].apelidos.includes('Alfa Segurança'), 'nome da planilha virou apelido');
  igual(e.config.fiscal.proximoRps, 2, 'RPS avançou');
  const lote = amb.pref.emitidos.get('1').xmlLote;
  ok(lote.includes('<ValorServicos>427.50</ValorServicos>') && lote.includes('<Cnpj>11444777000161</Cnpj>') && lote.includes('<Cep>41820020</Cep>') && lote.includes('<CodigoCnae>8650003</CodigoCnae>'), 'lote enviado à prefeitura está correto');
  ok(/5 vigilante\(s\), competência abril de 2026/.test(lote), 'discriminação da nota');
  igual(amb.emails.length, 1, 'um e-mail enviado');
  const m = amb.emails[0];
  igual([m.to.text, m.attachments.length, m.replyTo.text], ['financeiro@alfa.com.br', 3, 'contato@clinicateste.com.br'], 'e-mail para o cliente com 3 anexos');
  igual(m.attachments.map((a) => a.filename.split('-')[0]).sort(), ['Boletim', 'NFSe', 'NFSe'], 'anexos: boletim, nota PDF e XML');
  ok(m.attachments.every((a) => a.size > 500), 'anexos têm conteúdo');
  ok(m.subject.includes('abril de 2026') && m.text.includes('R$ 427,50') && m.text.includes('VER-2026001'), 'texto do e-mail');
  await t.page.waitForTimeout(400);
  const nomes = (await Promise.all(t.baixados.map((d) => (d.nome.endsWith('.zip') ? arquivosDoZip(d.caminho) : [d.nome])))).flat();
  igual(nomes.map((n) => n.split('-')[0]).sort(), ['Boletim', 'NFSe', 'NFSe'], 'Downloads: boletim + nota (PDF e XML)');
  await t.page.screenshot({ path: path.join(fotos, '2-emitida-desktop.png'), fullPage: true });

  // segunda planilha do mesmo cliente, só com o nome da planilha: ZERO interação
  const cliques = amb.pref.envios;
  const arq2 = planilha('maio.xlsx', { 'Alfa Segurança': [['Nome', 'CPF', 'Data'], ...gente(3).map((p) => [p[0], p[1], '05/05/2026'])], 'Beta Nova': [] });
  await t.soltar([arq2]);
  e = await t.ate((x) => x.boletins.length === 2 && x.boletins[1].email.status === 'enviado' && x.boletins[1].baixado.nota, 'segunda nota 100% automática', 20000);
  igual([e.boletins[1].nota.rps, e.boletins[1].total, e.clientes.length], [2, 256.5, 1], 'segunda nota: RPS 2, mesmo cliente');
  igual([amb.pref.envios - cliques, amb.emails.length], [1, 2], 'um envio e um e-mail a mais');

  // recarregar não reemite nada
  await t.page.reload(); await t.page.waitForSelector('.zona'); await t.page.waitForTimeout(1200);
  igual([amb.pref.envios, amb.emails.length, amb.pref.emitidos.size], [2, 2, 2], 'recarregar a página não reemite nem reenvia');
  // dar baixa pela tela Caixa
  await t.ir('caixa');
  await t.page.getByRole('button', { name: 'Dar baixa' }).first().click();
  e = await t.ate((x) => x.boletins.filter((y) => y.recebido).length === 1, 'baixa pelo caixa');
  const r = (await t.page.locator('.razao').innerText()).replace(/\s+/g, ' ');
  ok(r.includes('684,00') && r.includes('427,50') && r.includes('256,50'), `caixa: nota tirada 684, recebido 427,50, aberto 256,50 (${r})`);
  igual(t.erros, [], 'sem erros no console');
  await t.ctx.close(); amb.fechar();
});

// ---------------------------------------------------------------------------------------------
cenario('3. Falhas: recusa, queda de conexão, lote com erro, RPS ocupado, pausa, recarga no meio, e-mail', async () => {
  const amb = await subir();
  const t = await abrir(amb);
  await configurarClinica(t);
  let n = 0;
  const lancar = async (qtd = 2) => {
    n++;
    await t.soltar([planilha(`f${n}.xlsx`, { P: [['Nome', 'CPF', 'Empresa', 'CNPJ', 'E-mail', 'Data'], ...gente(qtd).map((p) => [p[0], p[1], 'Alfa Segurança', '11444777000161', 'fin@alfa.com.br', `0${n}/0${n}/2026`])] })]);
    return n - 1;
  };
  const nota = (e, i) => e.boletins[i]?.nota;

  // a) prefeitura recusa
  amb.pref.modo = 'recusa';
  let i = await lancar();
  let e = await t.ate((x) => nota(x, i)?.status === 'erro', 'recusa vira erro');
  ok(/E160/.test(nota(e, i).erro), 'mostra o motivo da prefeitura');
  ok(await t.page.getByText(/Nota não emitida: E160/).first().isVisible(), 'erro aparece na tela');
  igual(amb.emails.length, 0, 'não envia e-mail sem nota');
  amb.pref.modo = 'ok';
  await t.page.locator('button.boletim').first().click();
  await t.page.getByRole('button', { name: 'Tentar a nota de novo' }).click();
  e = await t.ate((x) => nota(x, i)?.status === 'emitida' && x.boletins[i].email.status === 'enviado', 'nova tentativa emite');
  igual(nota(e, i).rps, 1, 'reaproveita o mesmo RPS');
  await t.page.getByRole('button', { name: 'Fechar' }).click();

  // b) a prefeitura processa mas a conexão cai antes da resposta → não pode emitir em dobro
  amb.pref.modo = 'processaMasCai'; amb.pref.derrubarProximos = 1;
  const enviosAntes = amb.pref.envios;
  i = await lancar();
  e = await t.ate((x) => nota(x, i)?.status === 'pendente' && nota(x, i).tentativas === 1 && nota(x, i).erro, 'queda de conexão fica para nova tentativa');
  amb.pref.modo = 'ok';
  await t.page.reload(); await t.page.waitForSelector('.zona');
  e = await t.ate((x) => nota(x, i)?.status === 'emitida', 'nota recuperada por consulta');
  igual([amb.pref.envios - enviosAntes, amb.pref.emitidos.size], [1, 2], 'apenas UM envio: sem nota em dobro');

  // c) lote processado com erro, depois corrigido
  amb.pref.modo = 'erroLote';
  i = await lancar();
  e = await t.ate((x) => nota(x, i)?.status === 'erro', 'lote com erro');
  ok(/CNAE/.test(nota(e, i).erro) && !nota(e, i).protocolo, 'guarda o motivo e libera o protocolo');
  amb.pref.modo = 'ok';
  await t.page.locator('button.boletim').first().click();
  await t.page.getByRole('button', { name: 'Tentar a nota de novo' }).click();
  e = await t.ate((x) => nota(x, i)?.status === 'emitida', 'emite após correção');
  await t.page.getByRole('button', { name: 'Fechar' }).click();

  // d) número de RPS já usado por outra nota
  amb.pref.modo = 'rpsOcupado';
  i = await lancar();
  e = await t.ate((x) => nota(x, i)?.status === 'erro', 'RPS ocupado vira erro');
  ok(/pertence a outra nota/.test(nota(e, i).erro) && nota(e, i).rps == null && !nota(e, i).numero, 'não adota nota alheia e libera o RPS');
  amb.pref.modo = 'ok';
  await t.page.locator('button.boletim').first().click();
  await t.page.getByRole('button', { name: 'Tentar a nota de novo' }).click();
  e = await t.ate((x) => nota(x, i)?.status === 'emitida', 'emite com novo RPS');
  await t.page.getByRole('button', { name: 'Fechar' }).click();

  // e) pausar na contagem regressiva
  await t.page.evaluate(() => { window.__PSICO_RITMO__ = 0.4; });
  const antesPausa = amb.pref.envios;
  i = await lancar();
  await t.page.getByRole('button', { name: 'Pausar emissão' }).click();
  await t.page.waitForTimeout(4500);
  igual(amb.pref.envios, antesPausa, 'pausado: nenhuma nota enviada');
  igual(nota(await t.estado(), i).status, 'pendente', 'boletim segue pendente');
  await t.page.evaluate(() => { window.__PSICO_RITMO__ = 0.02; });
  await t.page.getByRole('button', { name: 'Retomar emissão' }).click();
  e = await t.ate((x) => nota(x, i)?.status === 'emitida', 'retomar emite');

  // f) página recarregada no meio da emissão (prefeitura lenta)
  amb.pref.situacoesAteProcessar = 9999;
  await t.page.evaluate(() => { window.__PSICO_RITMO__ = 0.3; });
  const antesRecarga = amb.pref.envios;
  i = await lancar();
  await t.ate((x) => nota(x, i)?.protocolo, 'protocolo gravado');
  await t.page.reload(); await t.page.waitForSelector('.zona');
  amb.pref.situacoesAteProcessar = 1;
  e = await t.ate((x) => nota(x, i)?.status === 'emitida' && x.boletins[i].email.status === 'enviado', 'retoma após recarregar', 20000);
  igual(amb.pref.envios - antesRecarga, 1, 'recarga no meio não reenvia o lote');

  // g) servidor de e-mail recusa, depois volta
  const senhaBoa = process.env.SMTP_PASS; process.env.SMTP_PASS = 'errada';
  const emailsAntes = amb.emails.length;
  i = await lancar();
  e = await t.ate((x) => x.boletins[i]?.email.status === 'erro', 'falha de e-mail registrada');
  igual(nota(e, i).status, 'emitida', 'a nota não é afetada pela falha do e-mail');
  process.env.SMTP_PASS = senhaBoa;
  await t.page.locator('button.boletim').first().click();
  await t.page.getByRole('button', { name: 'Tentar o e-mail de novo' }).click();
  await t.ate((x) => x.boletins[i]?.email.status === 'enviado', 'e-mail reenviado');
  igual(amb.emails.length - emailsAntes, 1, `exatamente um e-mail (${amb.emails.slice(emailsAntes).map((m) => m.subject + ' ' + m.date.toISOString()).join(' | ')})`);
  await t.page.getByRole('button', { name: 'Fechar' }).click();

  // h) internet/servidor fora do ar durante a emissão
  amb.apiFora(true);
  i = await lancar();
  e = await t.ate((x) => nota(x, i)?.erro && nota(x, i).status === 'pendente', 'sem internet: fica na fila');
  amb.apiFora(false);
  await t.page.reload(); await t.page.waitForSelector('.zona');
  e = await t.ate((x) => nota(x, i)?.status === 'emitida' && x.boletins[i].email.status === 'enviado', 'volta a internet e conclui');

  e = await t.estado();
  igual(e.boletins.length, 8, 'oito boletins');
  igual(new Set(e.boletins.map((b) => b.nota.numero)).size, 8, 'oito notas distintas');
  igual(amb.pref.emitidos.size, 8, 'a prefeitura tem exatamente 8 notas');
  igual(amb.emails.length, 8, 'oito e-mails');
  igual(t.erros, [], 'sem erros no console');
  await t.ctx.close(); amb.fechar();
});

// ---------------------------------------------------------------------------------------------
cenario('4. Celular: fluxo com pendências, cadastro do cliente pelo CEP e layout', async () => {
  const amb = await subir();
  const t = await abrir(amb, { celular: true, senha: false });
  await t.semRolagemLateral('início vazio');
  await t.page.screenshot({ path: path.join(fotos, '4-inicio-vazio-celular.png') });
  ok(await t.page.getByText('Digite a senha do sistema').isVisible(), 'pede a senha uma vez');
  await t.page.getByLabel('Senha do sistema').fill('errada'); await t.page.getByRole('button', { name: 'Entrar' }).click();
  await t.page.getByText('Senha incorreta').waitFor();
  await t.page.getByLabel('Senha do sistema').fill('segredo'); await t.page.getByRole('button', { name: 'Entrar' }).click();
  await t.page.getByText('Digite a senha do sistema').waitFor({ state: 'detached' });
  await configurarClinica(t);
  const csv = path.join(tmp, 'lista.csv');
  fs.writeFileSync(csv, Buffer.from('Nome;CPF;Empresa\r\n' + gente(3).map((p) => `${p[0]};${mask(p[1])};Guardião Segurança Ltda`).join('\r\n') + '\r\n' + gente(2).map((p) => `${p[0]};${mask(p[1])};Guardiao Seguranca Patrimonial`).join('\r\n'), 'latin1'));
  const semEmpresa = planilha('planilha.xlsx', { Planilha1: [['Nome', 'CPF'], ...gente(2)] });
  await t.soltar([csv, semEmpresa]);
  let e = await t.ate((x) => x.boletins.length === 3, 'três boletins');
  await t.page.getByText('De qual empresa é esta planilha?').waitFor();
  ok(await t.page.getByText(/é o mesmo cliente que/).first().isVisible(), 'pergunta sobre nomes parecidos em vez de adivinhar');
  await t.semRolagemLateral('início com pendências');
  await t.page.screenshot({ path: path.join(fotos, '4-pendencias-celular.png'), fullPage: true });
  igual(amb.pref.envios, 0, 'nada é emitido com dúvida pendente');
  await t.page.getByRole('button', { name: 'Sim, é o mesmo' }).click();
  await t.page.getByLabel('Cliente desta planilha').selectOption({ label: 'Guardião Segurança Ltda' });
  await t.page.getByRole('button', { name: 'Confirmar cliente' }).click();
  e = await t.ate((x) => x.clientes.length === 1, 'clientes unificados');
  igual(e.boletins.map((b) => b.clienteId).filter((v, k, a) => a.indexOf(v) === k).length, 1, 'todos os boletins no mesmo cliente');
  await t.page.getByRole('button', { name: 'Completar cadastro' }).click();
  const j = t.page.getByRole('dialog');
  await preencher(t.page, 'CNPJ', '11.444.777/0001-61', j);
  await t.ate((x) => x.clientes[0].endereco.codMunicipio === '2927408', 'endereço preenchido pelo CNPJ');
  await t.page.screenshot({ path: path.join(fotos, '4-cliente-celular.png') });
  await preencher(t.page, 'E-mail para receber', 'fin@guardiao.com.br', j);
  await j.getByRole('button', { name: 'Pronto' }).click();
  e = await t.ate((x) => x.boletins.every((b) => b.email.status === 'enviado'), 'três notas emitidas e enviadas', 25000);
  igual([amb.pref.emitidos.size, amb.emails.length], [3, 3], 'três notas e três e-mails');
  await t.page.waitForTimeout(500);
  for (const tela of ['inicio', 'caixa', 'clientes', 'historico', 'ajustes']) {
    await t.ir(tela);
    await t.semRolagemLateral(tela);
    await t.page.screenshot({ path: path.join(fotos, `4-${tela}-celular.png`), fullPage: tela !== 'inicio' });
  }
  await t.ir('inicio');
  await t.page.locator('button.boletim').first().click();
  await t.semRolagemLateral('janela do boletim');
  await t.page.screenshot({ path: path.join(fotos, '4-boletim-celular.png') });
  const alvos = await t.page.evaluate(() => [...document.querySelectorAll('.janela button, .lateral button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.height < 36); }).map((b) => b.textContent));
  igual(alvos, [], 'botões com altura de toque suficiente');
  igual(t.erros, [], 'sem erros no console');
  await t.ctx.close(); amb.fechar();
});

// ---------------------------------------------------------------------------------------------
cenario('5. Supabase: dados aparecem em outro aparelho', async () => {
  const amb = await subir();
  amb.ligarNuvem();
  const a = await abrir(amb);
  await configurarClinica(a);
  await a.soltar([planilha('n.xlsx', { 'Órion Vigilância': [['Nome', 'CPF'], ...gente(4)] })]);
  await a.ate((x) => x.boletins.length === 1, 'boletim no aparelho A');
  const t0 = Date.now();
  while (!(amb.nuvem()?.dados?.boletins?.length === 1) && Date.now() - t0 < 8000) await a.page.waitForTimeout(100);
  igual(amb.nuvem()?.dados?.boletins?.length, 1, 'estado gravado no Supabase');
  const b = await abrir(amb, { celular: true });
  const e = await b.ate((x) => x.boletins.length === 1 && x.config.prestador.razao === 'Clínica Teste Ltda', 'aparelho B recebeu os dados');
  igual(e?.clientes[0]?.nome, 'Órion Vigilância', 'cliente sincronizado');
  igual([a.erros, b.erros], [[], []], 'sem erros no console');
  await a.ctx.close(); await b.ctx.close(); amb.fechar();
});

// ---------------------------------------------------------------------------------------------
cenario('6. Carga: 12 arquivos de formatos variados de uma vez, 1.500 vigilantes', async () => {
  const amb = await subir({ configurado: false });
  const t = await abrir(amb, { senha: false });
  await t.ir('ajustes'); await preencher(t.page, 'Preço de cada psicoteste', '90'); await t.ir('inicio');
  const arqs = []; let esperado = 0;
  for (let k = 0; k < 12; k++) {
    const q = 125; esperado += q; const emp = `${['Alfa', 'Brasília', 'Cometa', 'Dínamo', 'Escudo', 'Falcão', 'Guardiã', 'Horizonte', 'Ipê', 'Jaguar', 'Kairós', 'Leão'][k]} Segurança Ltda`; const g = gente(q);
    const forma = k % 4;
    if (forma === 0) arqs.push(planilha(`c${k}.xlsx`, { P: [['Nome', 'CPF', 'Empresa'], ...g.map((p) => [p[0], mask(p[1]), emp])] }));
    else if (forma === 1) arqs.push(planilha(`c${k}.xls`, { [emp.slice(0, 28)]: [['RELAÇÃO'], [], ['CPF', 'Candidato'], ...g.map((p) => [Number(p[1]), p[0]])] }));
    else if (forma === 2) arqs.push(planilha(`c${k}.xlsx`, { P: [[`Empresa: ${emp}`], ...g.map((p) => [p[0], p[1]])] }));
    else { const p = path.join(tmp, `${emp}.csv`); fs.writeFileSync(p, 'nome,cpf\n' + g.map((x) => `"${x[0]}",${x[1]}`).join('\n')); arqs.push(p); }
  }
  const t0 = Date.now();
  await t.soltar(arqs);
  const e = await t.ate((x) => x.boletins.length === 12 && x.boletins.every((b) => b.baixado.boletim), '12 boletins baixados', 40000);
  const ms = Date.now() - t0;
  igual(e.boletins.reduce((a, b) => a + b.quantidade, 0), esperado, 'todos os 1.500 vigilantes contados');
  igual(e.clientes.length, 12, '12 clientes');
  igual(e.boletins.reduce((a, b) => a + b.pessoas.filter((p) => !p.cpfValido).length, 0), 0, 'todos os CPFs reconhecidos');
  ok(ms < 20000, `tempo razoável (${ms} ms)`);
  await t.page.waitForTimeout(500);
  igual((await arquivosDoZip(t.baixados.at(-1).caminho)).length, 12, 'zip com 12 boletins');
  igual(t.erros, [], 'sem erros no console');
  await t.ctx.close(); amb.fechar();
});

const filtro = process.argv[2];
for (const c of cenarios) {
  if (filtro && !c.nome.startsWith(filtro)) continue;
  const antes = falhas;
  console.log(`\n▶ ${c.nome}`);
  try { await c.fn(); } catch (err) { falhas++; total++; console.log(`   ✗ EXCEÇÃO: ${err.stack?.split('\n').slice(0, 6).join('\n      ')}`); }
  console.log(falhas === antes ? '   passou' : `   ${falhas - antes} falha(s)`);
}
await navegador.close();
console.log(`\n${total - falhas}/${total} verificações passaram. Capturas em ${fotos}`);
process.exit(falhas ? 1 : 0);
