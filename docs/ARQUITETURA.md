# ARGO — Arquitetura técnica

## Stack

| Camada | Tecnologia | Motivo |
|---|---|---|
| Interface | React 19 + TypeScript (strict) | componentes, tipagem forte |
| Build | Vite 8 | rápido, padrão de mercado |
| Navegação | React Router 7 (`HashRouter`) | rotas `#/…` funcionam em qualquer hospedagem estática e offline |
| Banco local | IndexedDB via Dexie 4 | persistente, transacional, com versionamento de esquema |
| Offline / instalação | vite-plugin-pwa (Workbox) | service worker com todo o app em cache + manifesto |
| Testes | Vitest + fake-indexeddb | testes da camada de dados sem navegador |
| Hospedagem | GitHub Pages via GitHub Actions | gratuito, HTTPS, atualizável pelo iPhone |
| Nuvem (futuro) | Supabase / PostgreSQL | sincronização multi-aparelho |

Sem bibliotecas de UI. Ícones e estilos são próprios. Nenhuma fonte ou recurso externo é carregado em tempo de execução,
então tudo funciona offline.

## Estrutura de pastas

```
src/
  app/          modules.ts (registro dos 12 módulos), navigation.ts (abas), routes.tsx (rotas + títulos)
  domain/       categories.ts (categorias e sequência), movements.ts (tipos de movimentação, motivos)
  components/   Layout, Icon, StatusItem, UpdatePrompt
  core/         ids (UUID, datas ISO), format (pt-BR)
  db/           database.ts (esquema Dexie), types.ts (modelos), repository.ts (gravação), device.ts
  sync/         types.ts (contrato SyncAdapter), engine.ts (push/pull), localOnlyAdapter.ts
  backup/       backup.ts (exportar, validar, restaurar com mesclagem)
  platform/     storage.ts (armazenamento persistente), files.ts (salvar/compartilhar arquivo no iPhone)
  hooks/        useOnline, useStorageStatus
  modules/      uma pasta por módulo: dashboard, rebanho (herd.ts = regras), pastos (pastures.ts), settings…
  styles/       global.css (tokens da identidade visual)
```

## Regras de dados (obrigatórias para todos os módulos)

1. **Todo registro de negócio estende `BaseRecord`**: `id` (UUID), `createdAt`, `updatedAt`, `deletedAt`, `rev`,
   `deviceId`, `syncStatus`.
2. **Toda gravação passa pelo `Repository`.** Numa única transação ele grava:
   o registro, a entrada no **histórico** (`auditLog`, com estado *antes* e *depois*) e a entrada na **fila de
   sincronização** (`outbox`). Ou grava tudo, ou nada.
3. **Nada é apagado fisicamente.** A exclusão é lógica (`deletedAt`) e pode ser revertida.
4. **Proteção contra duplicação**
   - **Idempotência**: cada formulário gera um `id` ao abrir. Toque duplo ou reenvio grava o mesmo registro.
   - **Índices únicos** (`&campo` no Dexie) para chaves de negócio. Exemplo: brinco do animal.
   - **Backup e sincronização** mesclam por `id`. Vence a maior `rev`; em empate, o `updatedAt` mais recente.
5. **Rebanho por contagem (sem identificação individual).** Os animais não têm brinco; o controle é por
   **pasto × categoria**. O saldo NUNCA é digitado: é a soma das linhas (`entries`) de todas as movimentações
   (`movements`). Tipos: nascimento, compra, transferência, mudança de categoria, morte, venda, contagem e estorno.
   - Regras validadas em `src/modules/rebanho/herd.ts`, numa única transação: nenhum saldo pode ficar negativo;
     nascimento só soma bezerro/bezerra; mudança de categoria só avança no mesmo sexo
     (Bezerro → Desmama macho → Garrote → Boi ou Reprodutor; Bezerra → Desmama fêmea → Novilha → Vaca).
   - **Contagem** compara o contado com o saldo e grava a diferença com um motivo
     (saldo inicial, nascimentos/mortes não registrados, correção, outro).
   - Movimentações não são editadas nem apagadas: corrige-se com **estorno** (lançamento inverso, ligado ao original).
     O estorno é recusado se os animais já foram movimentados depois.
   - Categorias ficam em `src/domain/categories.ts`. Os ids são gravados no banco: nunca renomear um id.
   - **A especificar** (grupo próprio nas telas): Fêmeas, Machos e **Bezerros (sem separar macho e fêmea)**.
     Geram alerta (Painel, Rebanho, Pastos) até a movimentação **Especificar contagem**, que distribui o gado nas
     categorias contadas no curral (bezerros a especificar → bezerro e bezerra). Diferença no total exige motivo.
6. **Valores financeiros** serão gravados em **centavos (inteiros)** para evitar erros de arredondamento.
   Pagamentos parciais serão registros próprios ligados à conta a receber. O saldo é calculado e nunca sobrescrito.

## Fazendas e entrada no app

- Todo dado de negócio pertence a uma fazenda (`farmId`). As telas só mostram a fazenda aberta (`useFarm()`).
- `FarmGate` (src/modules/fazendas) controla a entrada: cadastro da primeira fazenda → "Escolha a fazenda" → PIN.
- PIN opcional de 4 a 6 números, guardado como SHA-256 com sal (nunca o número). É pedido a cada abertura do app.
  Proteção local do aparelho; login entre aparelhos só virá com a sincronização em nuvem.
- Dados lançados antes do cadastro de fazendas são adotados pela primeira fazenda cadastrada.
- O backup inclui todas as fazendas do aparelho.

## Financeiro e dados do responsável

- A aba Financeiro mostra no topo os **dados do responsável** (nome, CPF mascarado e se há chave Pix) e os módulos em grupos: Vendas, Recebimentos e Reserva.
- `farm.responsibleCpf` (opcional, só números, validado pelos dígitos verificadores; campo sem índice, não exigiu nova versão do banco). Editado em Financeiro → Dados do responsável (`updateFarmResponsible`), junto com a chave Pix, que é sugerida com o CPF quando ainda não existe.

## Vendas e Pix

- `src/modules/vendas/sales.ts`: venda e saída do rebanho gravadas na MESMA transação (nada fica pela metade).
  A saída gerada por venda só é desfeita cancelando a venda.
- Arroba: peso vivo → kg ÷ 30 (rendimento de 50% sobre @ de 15 kg); abate → arrobas lançadas direto. Peso por animal.
- Valores em centavos; pesos em décimos de kg; arrobas em centésimos. Arredondamento só no final.
- Parcelas somam exatamente o total (diferença de centavos na 1ª parcela).
- `src/domain/pix.ts`: BR Code estático (padrão EMV do Banco Central), CRC16 conferido com o exemplo oficial (1D3D).
  Chaves e documentos aparecem sempre mascarados na tela e no comprovante.
- `src/modules/vendas/receipt.ts`: comprovante desenhado em imagem PNG (canvas), com QR Code; não é documento fiscal.

## Contas a receber e pagamentos parciais

- `src/modules/receber/receivables.ts`: recebimentos (`payments`) ligados à venda. A situação de cada parcela
  (paga, parcial, em aberto, vencida) é sempre CALCULADA a partir dos recebimentos ativos, abatendo da parcela mais
  antiga para a mais nova. Nada é sobrescrito.
- Não aceita valor acima do saldo, data futura ou anterior à venda. Recebimento errado é estornado (fica no histórico).
- Venda à vista pode ser registrada já recebida (venda, saída do rebanho e recebimento na mesma transação).
- Venda com recebimento ativo não pode ser cancelada (estornar os recebimentos antes).
- O QR Code Pix do comprovante cobra só o que falta da parcela; parcela paga não gera QR.

## Reserva financeira (percentual definido pelo responsável)

- `src/modules/reserva/reserve.ts`: a reserva é um percentual do valor de cada venda (padrão 35%, definido pelo
  responsável de cada fazenda em `farm.reserveRates`, com data de início), separado conforme o dinheiro é recebido.
  Cada recebimento usa o percentual vigente na data dele; mudar o percentual não altera recebimentos anteriores. A conta da reserva é separada: o usuário confirma cada transferência (depósito).
- Saldo = depósitos − retiradas. Falta separar = 35% do recebido − depositado. Meta = 35% das vendas ativas.
- Depósitos ligados a um recebimento abatem o dele; depósitos avulsos abatem os pendentes do mais antigo ao mais novo.
- Retirada exige motivo e não pode passar do saldo. Lançamentos errados são estornados (estorno de depósito não pode
  deixar o saldo negativo).
- Conferência de saldo (`reserveChecks`): saldo visto no banco (ex.: Mercado Pago) × saldo do ARGO na hora.
  Diferença pode ser ajustada (retirada ou depósito com motivo; ajuste não duplica). Lembrete após 30 dias.

## Relatórios

- `src/modules/relatorios/reports.ts`: cálculos puros (mesmos números na tela e no PDF). Período: mês ou ano.
- Vendas, arrobas, recebimentos, inadimplência (posição no fim do período ou hoje; só pagamentos até essa data),
  reserva (saldo inicial/final), nascimentos e mortes (inclui os encontrados na contagem), rebanho por pasto e categoria.
- Lançamentos estornados e o próprio estorno ficam fora (são correções); vendas canceladas não entram nos totais.
- `pdf.ts`: jsPDF + autotable, carregado só ao gerar o PDF; funciona offline. Fontes padrão: `pdfText` troca caracteres
  fora do Latin-1. Partes opcionais do jsPDF (html2canvas, canvg, purify) ficam fora do pacote offline.

## Como chegar à fazenda (mapa e rotas)

- Tela `/acesso` (app) e página pública `acesso.html` (sem login), gerada como segunda entrada do Vite.
- **Serviços externos (precisam de internet):**
  - Satélite: Esri World Imagery + rótulos `World_Boundaries_and_Places` (server.arcgisonline.com), com atribuição.
  - Roteamento rodoviário: OSRM público (router.project-osrm.org), dados do OpenStreetMap. Uso leve, sem garantia de serviço.
  - Busca de cidades: Nominatim (nominatim.openstreetmap.org); reserva: Photon (photon.komoot.io).
- A **coordenada oficial da porteira** é guardada na fazenda (`entrance`) e é sempre o destino. O roteamento nunca a substitui:
  `snapEnd` (distância entre a porteira e o fim da estrada mapeada) valida a chegada (≤ 150 m = validada).
- As cidades são só referência para desenhar a rota; os links de navegação (Google Maps, Waze, Apple Mapas) usam apenas o destino,
  e o app de mapas do visitante calcula a partir da localização real dele.
- Rotas calculadas ficam em `routeCache` (cópia local, fora do backup) para o guia funcionar sem internet.
- Link público compacto (formato v2): texto curto em base64url; porteira exata (6 casas), cidades e pontos como diferença
  em relação à porteira, em base 36. Links do formato antigo (v1, JSON) continuam abrindo.
- **Privacidade:** nenhuma coordenada real fica no código (repositório público). A localização da porteira só sai do aparelho
  dentro do link público gerado pelo usuário (codificado na parte `#` da URL, que não é enviada ao servidor do GitHub Pages).

## Insumos e responsáveis

- **Responsáveis** (`responsibles`): nome e função; nunca são apagados, só desativados (o histórico continua apontando para eles).
- **Insumos** (`supplies`): Sal branco e Sal mineral são criados na primeira abertura do módulo (uma vez por fazenda, chave fixa); outros produtos podem ser cadastrados. Peso do saco em gramas (`gramsPerSack`, opcional) → equivalência em kg.
- **Movimentos** (`supplyMovements`): quantidade em **meios sacos** (inteiro, com sinal: + entrada, − saída). Compra (valor pago em centavos + fornecedor), consumo no cocho (sempre com pasto) e ajuste (entrada/saída com motivo). Só sacos inteiros ou meio saco, inclusive em correções.
- Estoque = soma dos movimentos ativos. Saída que deixaria o estoque negativo é recusada (`NegativeStockError`) até haver autorização explícita: motivo + confirmação + PIN da fazenda (se houver). O lançamento fica marcado `authorizedNegative`.
- Correção = estorno (fica no histórico). Estornar uma entrada não pode deixar o estoque negativo.
- **Mistura de sal**: produto com `recipe` (ingredientes de UMA mistura, em meios sacos) e `yieldHalves` (quanto rende). Criada uma vez por fazenda com 3 sacos de sal branco + 1 de mineral → 6 sacos; a receita é definida pelo responsável e vale para as próximas misturas. "Mistura feita" grava, com o mesmo `batchId`, uma saída de cada ingrediente e a entrada da mistura (tipo `mistura`); o estorno desfaz o grupo todo e é recusado se a mistura já foi para o cocho. Ingrediente de mistura ativa não tem consumo direto no cocho; mistura não tem compra. Campos novos sem índice: não exigiram nova versão do banco.

## Diesel

- **Equipamentos** (`equipments`): nome (único), tipo, identificação, responsável e medidor (horímetro, hodômetro em km ou nenhum). Desativados, nunca apagados.
- **Lançamentos** (`fuelMovements`): litros em **centilitros** com sinal. Compra (+, posto e valor total em centavos; preço por litro calculado), abastecimento (−, equipamento, responsável — sugerido pelo equipamento —, leitura do medidor ×10, que não pode ser menor que a anterior) e ajuste (±, com motivo).
- **Custo médio ponderado** (`fuelLedger`): em ordem de data; cada compra recalcula (valor em estoque + valor pago) ÷ (litros em estoque + litros comprados); cada saída sai pelo custo médio do momento. Com estoque zerado ou negativo, o custo passa a ser o preço da compra.
- Estoque negativo só com autorização (mesmo fluxo dos insumos); correção por estorno.
- **Relatório do diesel** (em Relatórios, id `diesel`; atalho `/relatorios?r=diesel`): resumo (comprado, consumido, custo, custo médio e estoque no fim do período), por semana (período mensal, semanas de segunda a domingo) ou por mês (período anual), por equipamento (litros, custo, horas/km trabalhados e média L/h ou km/L), por responsável, compras e abastecimentos. Média do medidor: litros de cada abastecimento com leitura ÷ horas (ou km) desde o abastecimento anterior do mesmo equipamento.

## Esquema do banco

| Versão | Tabelas adicionadas |
|---|---|
| v1 | meta, auditLog, outbox, diagnostics |
| v2 | pastures (pastos), pastureTasks (serviços dos pastos), movements (movimentações do rebanho) |
| v3 | farms (fazendas) + índice `farmId` em pastures, pastureTasks e movements |
| v4 | clients (clientes), sales (vendas) |
| v5 | landmarks (pontos de referência), routeCache (cópia local das rotas — não entra no backup) |
| v6 | payments (recebimentos das vendas) |
| v7 | reserveEntries (depósitos e retiradas da reserva financeira) |
| v8 | reserveChecks (conferências do saldo da reserva com o banco) |
| v9 | responsibles, supplies, supplyMovements (insumos em meios sacos), equipments, fuelMovements (diesel em centilitros), vaccinations, vaccinationApplications |

## Migrações (preservação de dados)

- Nunca alterar um `db.version(n)` já publicado.
- Mudança de esquema = novo `db.version(n+1).stores({...})`, com `.upgrade()` se for preciso converter dados.
- O backup registra `schemaVersion`. Um backup de versão mais nova é recusado com mensagem clara.

## Como adicionar um módulo (ex.: Rebanho)

1. Em `db/types.ts`, criar `interface Animal extends BaseRecord {...}` e incluir em `EntityMap` e `ENTITY_NAMES`.
2. Em `db/database.ts`, criar `db.version(2).stores({ animals: 'id, &brinco, createdAt, updatedAt, ...' })`.
3. Em `src/modules/rebanho/`, criar as páginas usando `new Repository(db, 'animals')`.
4. Em `app/routes.tsx`, registrar a página em `IMPLEMENTED`. Em `app/modules.ts`, mudar `status` para `'disponivel'`.
5. Escrever os testes. Backup, histórico e sincronização passam a cobrir a nova entidade automaticamente.

## Sincronização (preparada, não ativa)

- `outbox`: uma entrada por registro alterado (chave `entidade:id`), sempre com o estado mais recente.
- `runSync(db, adapter)`: envia as pendências (push) e aplica as alterações remotas (pull). Alterações remotas
  mais antigas nunca sobrescrevem dados locais mais novos. Já está coberto por testes com um servidor simulado.
- Hoje o adaptador é `localOnlyAdapter` (não configurado). Para ativar: criar `SupabaseAdapter` implementando
  `SyncAdapter`, com tabelas PostgreSQL que espelham os campos de `BaseRecord`, autenticação e políticas RLS.

## Limitações do iPhone (e como o ARGO lida com elas)

| Limitação | Mitigação |
|---|---|
| O Safari pode apagar dados de sites não usados por 7 dias | instalar na Tela de Início (apps instalados ficam isentos), pedir `storage.persist()` e manter backups |
| Dados do Safari e do app instalado ficam separados | usar sempre pelo ícone |
| Sem sincronização em segundo plano | a sincronização roda quando o app é aberto |
| Download de arquivos limitado | backup salvo pela folha de compartilhamento (*Salvar em Arquivos*) |
