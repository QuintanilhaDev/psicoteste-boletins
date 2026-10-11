# Psicotestes — boletins, notas e caixa

Ferramenta web para a clínica: solta-se a planilha de psicotestes e o sistema

1. lê a planilha (qualquer layout) e separa os vigilantes por empresa e por mês;
2. monta um **boletim em PDF** para cada empresa;
3. emite a **NFS-e na Prefeitura de Salvador** (web service oficial, com certificado A1);
4. envia boletim + nota para o **e-mail cadastrado do cliente**;
5. salva tudo na pasta **Downloads**;
6. mostra o **caixa**: psicotestes por cliente e por mês, nota tirada, recebido (baixa) e em aberto, com exportação para Excel.

Funciona no computador e no celular.

## Como colocar no ar (GitHub + Vercel)

1. Crie um repositório **privado** no GitHub e envie o conteúdo desta pasta.
2. Em vercel.com: **Add New → Project → Import** o repositório. A Vercel reconhece o Vite sozinha; não mude nada e clique em **Deploy**.
3. Em **Settings → Environment Variables**, cadastre as variáveis abaixo e faça **Redeploy**.

Sem nenhuma variável o site já lê planilhas, gera boletins e relatórios. Cada bloco abaixo liga uma parte da automação.

| Variável | Para quê |
|---|---|
| `SENHA_DO_APP` | Senha pedida uma vez por aparelho. **Obrigatória** para nota, e-mail e nuvem. Use uma senha longa. |
| `NFSE_CERT_PFX_BASE64` | O certificado A1 (.pfx) em base64 (ver abaixo). |
| `NFSE_CERT_SENHA` | A senha do certificado. |
| `NFSE_AMBIENTE` | `homologacao` (padrão, notas de teste) ou `producao` (notas valem). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Conta que envia os e-mails. Gmail: `smtp.gmail.com`, `465`, o endereço e uma [senha de app](https://myaccount.google.com/apppasswords). |
| `EMAIL_REMETENTE`, `EMAIL_COPIA` | Opcionais: remetente exibido e cópia oculta de tudo que sai. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Opcionais: mesmos dados em todos os aparelhos. Rode antes `supabase/schema.sql` no SQL Editor do Supabase. |

### Certificado A1 → base64

O certificado **não vai para o GitHub nem para conversa nenhuma**: vai direto na Vercel.

- Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\certificado.pfx")) | Set-Clipboard`
- Mac: `base64 -i certificado.pfx | pbcopy`
- Linux: `base64 -w0 certificado.pfx`

Cole o resultado em `NFSE_CERT_PFX_BASE64`. O sistema confere se o CNPJ do certificado é o mesmo da clínica e avisa a validade na tela **Ajustes → Ligações**.

### Antes da primeira nota de verdade

A integração com a prefeitura foi escrita seguindo o layout ABRASF usado por Salvador e testada contra um simulador; **com a prefeitura real ela só pode ser validada com o certificado**. Por isso o padrão é homologação:

1. Com `NFSE_AMBIENTE=homologacao`, libere o cadastro em https://notahml.salvador.ba.gov.br e emita uma nota de teste pelo sistema.
2. Em **Ajustes → Nota fiscal**, confirme com o contador: item da lista de serviços, CNAE, alíquota, Simples Nacional, regime e os campos da reforma tributária (NBS, classificação IBS/CBS). Preencha o **próximo nº de RPS** continuando a sequência do portal.
3. Deu certo? Troque para `NFSE_AMBIENTE=producao` e faça Redeploy.

A Vercel roda as funções em São Paulo (`gru1`, definido em `vercel.json`).

## Como a automação decide

- **Nada é cobrado duas vezes.** Planilha repetida é reconhecida pelo conteúdo; a mesma pessoa (CPF) no mesmo cliente e mês não entra de novo; o número do RPS é gravado antes de falar com a prefeitura, então queda de internet ou página fechada no meio não gera nota em dobro.
- **Na dúvida, pergunta em vez de adivinhar.** Empresa não identificada, nomes parecidos, cadastro incompleto, preço faltando ou gente repetida de outro mês aparecem em "Só falta você me dizer" e seguram só aquele boletim.
- **Cliente novo** entra sozinho no cadastro. Se a planilha traz o CNPJ, razão social e endereço são buscados na Receita (BrasilAPI). O e-mail é informado uma vez.
- Antes de emitir há uma contagem de 8 segundos com botão **Pausar** — nota emitida só se cancela no portal.
- Sem certificado, use **"Já emiti no portal"** no boletim: informa-se o número da nota e o sistema envia o e-mail e controla o caixa do mesmo jeito.

## Dados

Ficam no navegador (IndexedDB). Em **Ajustes** há cópia de segurança (baixar/restaurar). Com Supabase configurado, o estado é espelhado numa tabela fechada, acessada só pelo servidor. As planilhas contêm CPF: mantenha o repositório privado e a senha forte.

## Desenvolvimento

```bash
npm install
npm run dev        # só a interface (sem /api)
npm test           # leitor de planilhas, regras de negócio e NFS-e (53 testes; 400 planilhas aleatórias)
npm run simular    # fluxo inteiro num navegador, com prefeitura e e-mail simulados (precisa do Playwright)
```

Para testar as funções `/api` localmente use `vercel dev`.

**Biblioteca de planilhas:** o pacote `xlsx` do npm (0.18.5) tem alertas de segurança conhecidos para arquivos maliciosos. A versão corrigida é distribuída só pelo site do SheetJS; recomenda-se trocar com:

```bash
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

## Estrutura

```
api/            funções da Vercel: nfse (emissão/consulta), email, sync (Supabase), status
src/core/       leitor de planilhas e regras de negócio (puro, testado)
src/automation  a esteira: boletim → nota → e-mail → download
src/views/      telas: Início, Caixa, Clientes, Histórico, Ajustes
tests/          testes automáticos e simulação ponta a ponta
```
