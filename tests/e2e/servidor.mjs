// Ambiente completo de simulação: site + funções /api + prefeitura falsa (TLS mútuo) + servidor de e-mail falso.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '../..');
const fx = (f) => path.join(raiz, 'tests/fixtures', f);
const escutar = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

export async function subir({ configurado = true } = {}) {
  const pref = { modo: 'ok', emitidos: new Map(), envios: 0, consultas: 0, derrubarProximos: 0, situacoesAteProcessar: 1, contadorSituacao: 0 };
  const emails = [];
  const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const env = (op, interno) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${op}Response xmlns="http://tempuri.org/"><${op}Result>${escapar(interno)}</${op}Result></${op}Response></s:Body></s:Envelope>`;
  const erro = (cod, msg) => `<R><ListaMensagemRetorno><MensagemRetorno><Codigo>${cod}</Codigo><Mensagem>${msg}</Mensagem><Correcao>Verifique.</Correcao></MensagemRetorno></ListaMensagemRetorno></R>`;

  const prefeitura = https.createServer({ key: fs.readFileSync(fx('srv.key')), cert: fs.readFileSync(fx('srv.pem')), ca: fs.readFileSync(fx('ca.pem')), requestCert: true, rejectUnauthorized: true }, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET') { res.statusCode = 404; return res.end(''); }
      const cdata = (body.match(/<!\[CDATA\[([\s\S]*)\]\]>/) ?? [])[1] ?? '';
      const pega = (t, src = cdata) => (src.match(new RegExp(`<${t}>([^<]*)</${t}>`)) ?? [])[1] ?? '';
      const rps = pega('Numero');
      res.setHeader('Content-Type', 'text/xml');
      if (req.url.includes('ENVIOLOTERPS')) {
        pref.envios++;
        if (pref.derrubarProximos > 0) { pref.derrubarProximos--; if (pref.modo === 'processaMasCai') registrar(); return req.socket.destroy(); }
        if (!cdata.includes('<Signature')) return res.end(env('EnviarLoteRPS', erro('E172', 'Lote sem assinatura')));
        if (pref.emitidos.has(rps) || pref.modo === 'rpsOcupado') return res.end(env('EnviarLoteRPS', erro('E10', 'RPS já informado.')));
        if (pref.modo === 'recusa') return res.end(env('EnviarLoteRPS', erro('E160', 'Código CNAE inválido')));
        if (pref.modo !== 'erroLote') registrar();
        pref.contadorSituacao = 0;
        return res.end(env('EnviarLoteRPS', `<R><NumeroLote>${rps}</NumeroLote><Protocolo>P${rps}</Protocolo></R>`));
      }
      function registrar() {
        const tom = (cdata.match(/<Tomador>[\s\S]*?<\/Tomador>/) ?? [''])[0];
        pref.emitidos.set(rps, { numero: String(2026000 + pref.emitidos.size + 1), valor: pega('ValorServicos'), doc: pega('Cnpj', tom) || pega('Cpf', tom), xmlLote: cdata });
      }
      if (req.url.includes('CONSULTASITUACAOLOTERPS')) {
        pref.contadorSituacao++;
        const sit = pref.modo === 'erroLote' ? 3 : pref.contadorSituacao >= pref.situacoesAteProcessar ? 4 : 2;
        return res.end(env('ConsultarSituacaoLoteRPS', `<R><NumeroLote>1</NumeroLote><Situacao>${sit}</Situacao></R>`));
      }
      if (req.url.includes('CONSULTALOTERPS')) return res.end(env('ConsultarLoteRPS', erro('E160', 'Código CNAE inválido')));
      if (req.url.includes('CONSULTANFSERPS')) {
        pref.consultas++;
        if (pref.modo === 'rpsOcupado') return res.end(env('ConsultarNfseRPS', `<R><CompNfse><Nfse><InfNfse><Numero>777</Numero><CodigoVerificacao>ZZZZ</CodigoVerificacao><DataEmissao>2025-01-01T00:00:00</DataEmissao><Servico><Valores><ValorServicos>1.00</ValorServicos></Valores></Servico><TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>99999999000191</Cnpj></CpfCnpj></IdentificacaoTomador></TomadorServico></InfNfse></Nfse></CompNfse></R>`));
        const n = pref.emitidos.get(rps);
        if (!n) return res.end(env('ConsultarNfseRPS', erro('E4', 'RPS não encontrado')));
        return res.end(env('ConsultarNfseRPS', `<ConsultarNfseRpsResposta><CompNfse><Nfse><InfNfse><Numero>${n.numero}</Numero><CodigoVerificacao>VER-${n.numero}</CodigoVerificacao><DataEmissao>2026-10-10T10:00:01</DataEmissao><Servico><Valores><ValorServicos>${n.valor}</ValorServicos></Valores></Servico><PrestadorServico><IdentificacaoPrestador><Cnpj>11222333000181</Cnpj></IdentificacaoPrestador></PrestadorServico><TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>${n.doc}</Cnpj></CpfCnpj></IdentificacaoTomador></TomadorServico></InfNfse></Nfse></CompNfse></ConsultarNfseRpsResposta>`));
      }
      res.statusCode = 404; res.end('x');
    });
  });
  const portaPref = await escutar(prefeitura);

  const smtp = new SMTPServer({
    disabledCommands: ['STARTTLS'], allowInsecureAuth: true, authOptional: false,
    onAuth: (auth, _s, cb) => (auth.password === 'senha-smtp' ? cb(null, { user: auth.username }) : cb(new Error('Senha inválida'))),
    onData: (stream, _s, cb) => { simpleParser(stream).then((m) => { emails.push(m); cb(); }, cb); },
  });
  const portaSmtp = await escutar(smtp.server);

  for (const k of ['SENHA_DO_APP', 'NFSE_CERT_PFX_BASE64', 'NFSE_CERT_SENHA', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
  process.env.NFSE_URL_BASE = `https://localhost:${portaPref}`;
  process.env.NFSE_CA_PEM_BASE64 = fs.readFileSync(fx('ca.pem')).toString('base64');
  if (configurado) {
    Object.assign(process.env, {
      SENHA_DO_APP: 'segredo', NFSE_CERT_PFX_BASE64: fs.readFileSync(fx('legado.pfx')).toString('base64'), NFSE_CERT_SENHA: 'senha123',
      SMTP_HOST: '127.0.0.1', SMTP_PORT: String(portaSmtp), SMTP_USER: 'clinica@teste.com', SMTP_PASS: 'senha-smtp',
    });
  }
  // Supabase falso (PostgREST mínimo)
  let linhaNuvem = null;
  const supa = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (req.headers.apikey !== 'chave-servico') { res.statusCode = 401; return res.end('{}'); }
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') return res.end(JSON.stringify(linhaNuvem ? [linhaNuvem] : []));
      linhaNuvem = JSON.parse(b); res.statusCode = 201; res.end('');
    });
  });
  const portaSupa = await escutar(supa);

  const rotas = {};
  for (const n of ['status', 'nfse', 'email', 'sync']) rotas[n] = (await import(path.join(raiz, 'api', `${n}.js`))).default;
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  let apiFora = false;
  const site = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      if (apiFora) return req.socket.destroy();
      const h = rotas[u.pathname.slice(5)];
      if (!h) { res.statusCode = 404; return res.end('{}'); }
      return h(req, res);
    }
    let arq = path.join(raiz, 'dist', u.pathname === '/' ? 'index.html' : u.pathname);
    if (!arq.startsWith(path.join(raiz, 'dist')) || !fs.existsSync(arq)) arq = path.join(raiz, 'dist/index.html');
    res.setHeader('Content-Type', tipos[path.extname(arq)] ?? 'application/octet-stream');
    fs.createReadStream(arq).pipe(res);
  });
  const portaSite = await escutar(site);
  return {
    url: `http://127.0.0.1:${portaSite}`, pref, emails,
    apiFora: (v) => { apiFora = v; },
    ligarNuvem: () => { process.env.SUPABASE_URL = `http://127.0.0.1:${portaSupa}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-servico'; },
    nuvem: () => linhaNuvem,
    fechar: () => { site.close(); prefeitura.close(); smtp.close(); supa.close(); },
  };
}
