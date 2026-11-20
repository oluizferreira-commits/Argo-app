# ARGO — Gestão Pecuária

Aplicativo de gestão pecuária (PWA) feito para o iPhone, que **funciona offline** e guarda os dados no próprio aparelho.

## Como acessar e instalar no iPhone

1. Abra no **Safari**: `https://oluizferreira-commits.github.io/Argo-app/`
2. Toque em **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início**.
3. Abra o ARGO pelo ícone. Ele roda em tela cheia e funciona sem internet.

> Use sempre o app pelo **ícone da Tela de Início**. O iPhone separa os dados do Safari e os
> dados do app instalado. Os dados gravados num deles não aparecem no outro.

### Ativação do GitHub Pages (uma única vez)

No Safari do iPhone, abra github.com → repositório **Argo-app** → **Settings** → **Pages** →
em *Build and deployment / Source*, escolha **GitHub Actions**. Depois, em **Actions**, rode
de novo o workflow **"Testar e publicar"** (botão *Re-run all jobs*).

## Como o projeto é desenvolvido (só com o iPhone)

Não há computador. O fluxo é:

1. Você descreve a próxima etapa ao Claude Code (app Claude ou claude.ai/code).
2. O Claude escreve o código num ambiente na nuvem, roda testes automatizados e testes num navegador real,
   e envia (push) para o GitHub.
3. O **GitHub Actions** testa de novo, compila e publica no GitHub Pages.
4. O ARGO instalado mostra **"Nova versão disponível — Atualizar"**. Tocando em Atualizar, a nova versão entra.
   **Os dados do aparelho não são apagados por atualizações.**

O andamento da publicação fica visível no GitHub (aba **Actions**).

## Backup — importante

Os dados ficam **somente neste iPhone** até a sincronização em nuvem ser ativada (etapa futura).
Em **Configurações → Exportar backup**, salve o arquivo em *Arquivos → iCloud Drive*.
Faça backup com frequência. A restauração **mescla** os dados: não apaga nem duplica registros.

## Comandos (para o ambiente de desenvolvimento)

| Comando | Função |
|---|---|
| `npm install` | instala dependências |
| `npm run dev` | servidor de desenvolvimento |
| `npm test` | testes automatizados da camada de dados |
| `npm run build` | build de produção (`BASE_PATH=/Argo-app/` para o GitHub Pages) |
| `npm run lint` | análise estática |

Documentação técnica: [docs/ARQUITETURA.md](docs/ARQUITETURA.md) · Etapas: [docs/ROADMAP.md](docs/ROADMAP.md)
