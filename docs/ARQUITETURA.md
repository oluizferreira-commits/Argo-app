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

## Painel (tela inicial)

Ordem: boas-vindas compacto → Indicadores da fazenda → Central de Pendências → Novo lançamento → Agenda Operacional → Atividades recentes. Cálculos em `src/modules/dashboard/dashboard.ts` (funções puras, testadas); dados numa única consulta reativa (`useDashboardData`), que se atualiza a cada lançamento.

- **Indicadores** (só dados reais): animais; pastos ocupados/cadastrados; a receber (parcelas em aberto, descontados os recebimentos parciais) e vencido; receitas do mês = dinheiro efetivamente recebido no mês; despesas do mês = compras de diesel e de insumos lançadas no mês; reserva (saldo da conta separada, sem somar o que está a receber). **Não há "saldo disponível"**: o ARGO ainda não tem caixa/conta bancária nem despesas gerais.
- **Central de Pendências**: conta vencida (uma por venda), estoque negativo (insumo ou diesel), contagem a especificar (uma por pasto: fêmeas/machos sem categoria, bezerros sem sexo) e reserva a separar. Chave estável por situação (sem duplicar), prioridade Alta/Média/Baixa; some sozinha quando resolvida.
- **Novo lançamento**: atalhos para os formulários existentes (`/diesel?novo=compra|consumo` abre o formulário direto). Despesa, vacinação, pesagem e manutenção aparecem "Em breve" (não há formulário falso).
- **Agenda Operacional**: parcelas atrasadas, de hoje e dos próximos 15 dias (com valor em aberto) e serviços dos pastos (sem data; concluir/desfazer direto no Painel). Nada é criado automaticamente.
- **Atividades recentes**: últimas criações do histórico (`auditLog`, só as 80 mais recentes, filtradas pela fazenda); a mistura aparece uma vez só.
- Situação do sistema, backup e sincronização ficam em **Configurações → Sistema, segurança e backup**.

## Vacinação

- **Campanha** (`vaccinations`): pasto + lote (texto livre; vazio = todo o pasto), vacina, produto, quantidade prevista (sugerida pelo saldo do pasto, editável), responsável, próxima vacinação (opcional) e observações.
- **Aplicações** (`vaccinationApplications`): data, quantidade, responsável, observação. Várias por campanha; nunca apagadas (correção por estorno, os animais voltam a pendentes).
- **Cobertura** (`coverage`): vacinados = soma das aplicações ativas; pendentes = previstos − vacinados (nunca contam como vacinados); percentual arredondado para baixo (100% só sem pendentes). Uma aplicação não pode passar dos pendentes; a quantidade prevista não pode ficar abaixo da vacinada.
- Sem duplicidade: não abre outra campanha do mesmo pasto + lote + vacina enquanto a anterior tiver pendentes; envio repetido não duplica (chave do formulário).
- **Próxima vacinação**: aparece na Agenda do Painel (com responsável) até ser registrada; "Registrar a próxima vacinação" cria a nova campanha já preenchida e marca a anterior (`followUpId`, campo sem índice — o banco continua na v9). Lote com pendentes aparece na Central de Pendências.

## Máquinas e horímetro digital

- **Cadastro único**: o mesmo `equipments` do Diesel ganhou marca, modelo, ano, nº de série (identification), aquisição, observações, situação (`status`: ativo, parado, em manutenção, inativo) e horímetro inicial (`meterInitial`, centésimos de hora). `/diesel/equipamentos` abre a tela Máquinas.
- **Sessões** (`machineSessions`): INICIAR SERVIÇO cria uma sessão por máquina (mesmo `serviceId`), com horário real de início; pausar/retomar guardam os intervalos; ENCERRAR grava o fim e as horas. Tempo = (fim − início) − pausas, calculado pelos horários gravados: funciona com o app fechado, em segundo plano e sem internet (o relógio da tela só mostra). Uma máquina não fica em dois serviços ao mesmo tempo; máquina inativa ou em manutenção não inicia serviço.
- **Horímetro acumulado** (`meterAt`): última leitura absoluta (inicial, ajuste autorizado, leitura digitada no diesel ou na operação) + horas das sessões encerradas depois dela. Leitura gravada pelo horímetro digital no diesel é marcada (`meterFromSession`) e não conta de novo.
- **Operação de campo**: "Concluir a operação" abre o formulário já preenchido (tipo, pasto ou local, máquinas, responsáveis, horas). Cada sessão entra em **uma** operação (`operationId`); cancelar a operação libera a sessão (as horas continuam no horímetro: a máquina trabalhou). Novos tipos: roçada, limpeza, adubação, preparo de solo, transporte, outra (nome livre). Transporte, preparo e outra podem ser fora de pasto (`pastureId` = '' e `location`), sem custo de pasto.
- **Ajustes autorizados** (motivo + PIN): tempo de uma sessão encerrada (ex.: esqueceu de encerrar) e horímetro absoluto (`meterAdjustments`). Tudo no histórico.
- Sincronização: os registros ficam no aparelho e entram na fila (`outbox`) para a sincronização futura; não há nuvem configurada.
- **Manutenção programada** (`maintenancePlans`): intervalo por horas, por dias ou os dois (vale o que vencer primeiro), aviso antecipado configurável (horas/dias) e última vez feita antes do ARGO. `planStatus`: próxima = última manutenção concluída (ou a base) + intervalo; estados em dia / próxima / vencida.
- **Manutenções** (`maintenanceRecords`): solicitada (ex.: problema no checklist) ou concluída. Peças do estoque dão baixa (custo médio; `maintenanceId`, só corrigida pela manutenção) e **não** viram despesa de novo; peças compradas direto + mão de obra = `directCents`, que entra em Despesas do mês. Cancelar devolve as peças ao estoque.
- **Checklist diário** (`machineChecklists`): itens configuráveis por fazenda (`farm.checklistItems`), cada um em ordem / atenção / problema / não se aplica; só grava com todos marcados; fotos reduzidas (JPEG ~1024 px) guardadas no aparelho; problema → solicitação de manutenção ligada.
- **Central de Pendências**: manutenção próxima/vencida (horímetro atual, previsto, data, responsável), solicitação aberta e inspeção diária não feita em máquina que trabalhou hoje; uma pendência por plano/solicitação/máquina-dia. Agenda: manutenções por data.

## Diaristas

- **Cadastro** (`workers`): nome, diária, meia diária (metade automática; valor diferente só com motivo e PIN), início do trabalho, situação, observações.
- **Calendário** (`workDays`): um registro por trabalhador e dia (`id = workerId:data`), então não existe diária duplicada. Ao tocar no dia, a sugestão é: seg–sex diária integral, sábado meia diária, domingo (sem expediente) só se trabalhou. Opções: integral, meia, não trabalhou, falta justificada, folga, desmarcar. O valor é guardado na marcação (mudar a diária não altera dias já marcados). Alterações ficam no histórico (auditLog) e aparecem no dia.
- **Situação do dia** (`dayState`): marcado → a marcação; antes do início → neutro; hoje e futuro → neutro (não é falta); domingo sem marcação → sem expediente; dia útil passado sem marcação → não trabalhou.
- **Fechamento** (`monthSummary`): dias trabalhados, integrais, meias, faltas (marcadas + dias úteis passados sem marca), justificadas, folgas, devido, pago (pagamentos do mês de referência) e saldo; saldo geral = todo o devido − todo o pago.
- **Pagamentos** (`workerPayments`): data, valor (parcial ou de vários dias), forma, mês de referência; estorno com motivo. **Só o pagamento é saída de caixa** (Despesas do mês).
- **Operação de campo**: diarista na operação vincula a diária do calendário daquele dia (ou marca, se ainda não existir); uma diária = uma operação (`workDays.operationId`). O custo entra na operação como mão de obra (gerencial) e no custo do pasto; não gera despesa (a despesa é o pagamento). Cancelar a operação desvincula a diária (o dia continua trabalhado).
- **Relatórios** (Relatórios): "Máquinas: horas e manutenção" (horas por equipamento, dia/mês, responsável, tipo de serviço; diesel; manutenções e custos; próximas e atrasadas) e "Diaristas" (por trabalhador: dias, integrais, meias, faltas, devido, pago, saldo; pagamentos).

## Manejo e formação de pastagens

Objetivo: saber quanto custa formar, recuperar e manter cada pasto, **sem estoques ou lançamentos paralelos**.

- **Estoque único**: herbicidas e sementes são produtos do estoque de Insumos (`supplies`) com `category` ('herbicida' | 'semente'; ausente = 'geral') e `unit` ('L' | 'kg'; ausente = 'saco'). Em L/kg a quantidade fica em `qty` (mL/g, inteiro com sinal) e `halfSacks` = 0; `movQty()` lê qualquer um. Compras com fornecedor, NF, lote e valor (total ou unitário). Estoque mínimo opcional (`minQty`) → "Estoque baixo" na Central de Pendências.
- **Custo médio ponderado** (`supplyLedger`), como no diesel: compras somam valor; cada saída sai pelo custo médio da data e o custo é **gravado no lançamento** (`costCents` da saída).
- **Operações de campo** (`fieldOperations`, v10): herbicida, plantio, replantio, recuperação, outra. Pasto, área do pasto (snapshot) e área trabalhada (parcial permitida, nunca maior que o pasto), responsável, vários produtos (com lote), vários equipamentos (responsável, horímetro inicial/final, horas, diesel), outros custos e observações.
  - Ao concluir, numa única transação: cada produto vira um **consumo no estoque de Insumos** e o diesel de cada equipamento vira **um único consumo no Diesel** (com equipamento, responsável, pasto e `operationId`). Não há segunda baixa: esses lançamentos só são estornados pela operação (bloqueado no Diesel/Insumos).
  - Custos guardados na operação (produtos, sementes, diesel, outros, total) — preservam o histórico mesmo com compras lançadas depois. Custo/ha = total ÷ área trabalhada.
  - **Cancelar** (motivo + PIN) estorna os consumos e mantém a operação no histórico. **Corrigir** = cancelar + nova operação na mesma transação, ligadas por `replacesId`/`replacedById` (o horímetro da correção não é comparado com leituras lançadas depois).
- **Financeiro sem duplicidade**: só as **compras** (insumos, herbicidas, sementes, diesel) são despesa (Painel → Despesas do mês). Consumo não gera despesa: vira custo atribuído ao pasto. Separação: valor comprado (compras), valor em estoque (`supplyLedger`/`fuelLedger`), valor consumido (operações) e custo do pasto (soma das operações). O app não tem contas a pagar: compra lançada = paga.
- **Pasto**: seção "Manejo, Formação e Custos" (capim plantado = sementes do último plantio/replantio, custo acumulado, formação × manutenção, custo/ha do pasto, produtos, diesel, equipamentos, responsáveis, histórico com filtros de período e tipo).
- **Painel de manejo** (`/manejo`, `manejoStats.ts`) com filtros (período, pasto, tipo, equipamento, produto, espécie) e PDF; relatório "Manejo de pastagens" também em Relatórios.

## Aba Pastos (listagem)

Resumo (pastos, hectares informados, ocupados, vazios), pesquisa pelo nome (sem acento), filtros Todos / Com animais / Vazios / Com pendências e lista em grade fixa (ícone | nome e área | cabeças | seta). Pendências reais abaixo do nome, cada uma com link próprio: "Especificar" (gado sem categoria / bezerros sem sexo) abre a especificação do pasto; "serviço pendente" abre o pasto. Cálculos em `src/modules/pastos/pastureList.ts` (só leem os saldos; regras de contagem inalteradas).

## Financeiro e dados do responsável

- A aba Financeiro mostra no topo os **dados do responsável** (nome, CPF mascarado e se há chave Pix) e os módulos em grupos: Vendas, Recebimentos e Reserva.
- `farm.responsibleCpf` (opcional, só números, validado pelos dígitos verificadores; campo sem índice, não exigiu nova versão do banco). Editado em Financeiro → Dados do responsável (`updateFarmResponsible`), junto com a chave Pix, que é sugerida com o CPF quando ainda não existe.

## Vendas e Pix

- Nome e cidade do recebedor: o usuário digita completos (`pixFullName`, `pixFullCity`, usados na tela e no comprovante). O QR Code usa `pixName`/`pixCity` dentro dos limites do Pix (25 e 15 caracteres): `pixFitName` abrevia os nomes do meio ("LUIZ EDUARDO N G FERREIRA") e `pixFitCity` tira "do/da" antes de cortar. A tela mostra como vai ficar antes de salvar.

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

- PDF sempre em A4 **paisagem** (todas as páginas). Relatório de vendas: lista, por cliente e, no ano, mês a mês; atalhos em Vendas e no Financeiro (`/relatorios?r=vendas`).

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

## Venda por kg

- `Sale.mode = 'kg'` (tipo ampliado; nenhum índice novo), `pricePerKgCents`, `weighing = 'vivo'`.
  Cada item de `animals` é UMA pesagem: `amount` = kg × 10 do total da balança e `heads` = 1 a 3 cabeças.
  Valor = Σ kg × preço do kg. As pesagens têm de bater com os animais escolhidos (pasto × categoria).
  `arrobasHundredths` (kg ÷ 30) fica só para informação.

## Dois preços pelo corte de peso

- `Sale.kgPriceCut` (`cutTenths`, `aboveCents`, `belowCents`; sem índice). Pesagem com média por cabeça
  ≥ corte usa o preço de cima; abaixo, o de baixo (`kgCutTotals`). Cada pesagem entra inteira num grupo.

## Pesagem de lote (v15)

- Tabela nova `weighingLots` (versão 15 do banco; nada existente muda): data, nome, pesagens (pasto,
  categoria, 1–4 cabeças, kg × 10), status aberta/vendida/cancelada e `saleId`. Cada lançamento grava na hora.
- Na balança os animais sobem misturados: cada pesagem guarda só cabeças (1–4, `MAX_HEADS_PER_WEIGHING`) e kg; a composição do lote
  (`composition`: cabeças por pasto × categoria) é informada uma vez. Na venda, `Sale.weighings` guarda as
  pesagens e `items` os animais; a validação exige Σ cabeças pesadas = Σ cabeças vendidas. Vendas/lotes da
  0.26–0.27 (pesagem com pasto/categoria em `animals`/`weighings`) são lidos por `kgWeighingsOf`/`compositionOf`.
- Não mexe no rebanho. A venda por kg com `weighingLotId` exige exatamente as mesmas pesagens
  (`sameWeighings`) e, na MESMA transação, marca o lote como vendido.

## Destino da venda e valor das diárias

- `Sale.purpose` (`fazenda` | `pessoal`, sem índice; ausente = fazenda). Recebimentos de venda pessoal ficam
  fora de "Receitas" e do saldo da fazenda no Painel (aparecem à parte); o relatório de vendas mostra o destino
  e os totais. A reserva continua valendo para todas as vendas.
- Diárias: o valor de cada dia é guardado na marcação. `outdatedDays` lista dias com valor diferente da diária
  atual e `applyCurrentRate` corrige (com histórico) quando a pessoa pede — nunca automaticamente.

## Lembrete de backup (12 horas)

- `src/backup/exportNow.ts`: `backupDue` (há lançamentos e o último backup tem ≥ 12 h ou nunca foi feito) e
  `exportBackupNow` (gera, abre a folha do iPhone, marca `lastBackupAt` só se não cancelar).
- `BackupReminder`: no Painel logo abaixo do cabeçalho e no topo das demais telas; confere a cada minuto com o
  app aberto; "Depois" adia na sessão (sessionStorage) por até 1 hora. Um app web no iPhone não consegue
  salvar arquivo sem um toque — backup 100% automático só com a nuvem.

## Novidades (notas de atualização)

- `src/app/changelog.ts`: lista de versões (mais nova primeiro). **A cada versão publicada, acrescente uma
  entrada no topo** — o teste `changelog.test.ts` falha se a versão do `package.json` não tiver nota.
- Tela `/novidades` (Mais › Fazenda e sistema, e Configurações). Depois de uma atualização, o Painel mostra
  uma vez "ARGO atualizado para a versão X" (versão vista guardada no aparelho; instalação nova não avisa).

## Identidade visual "Terra & Tecnologia" (design system)

- Tudo em `src/styles/global.css`, por tokens no `:root`: fundo verde-floresta em camadas
  (`--bg`, `--layer-1..3`, `--field` para campos), dourado envelhecido (`--gold`) para valores e ação,
  areia/creme para texto (`--ink`, `--ink-2`, `--ink-3`), estados (`--ok`, `--warn`, `--danger`, `--info`).
  Os nomes antigos (`--surface`, `--green-*`, `--gold-*`) continuam como apelidos, então os módulos
  herdam o tema sem mudar código.
- Fontes: Fraunces (títulos e números, empacotada com o app via `@fontsource-variable/fraunces`,
  funciona offline) e a fonte do sistema no texto.
- Ilustrações vetoriais em `src/components/Art.tsx` (boi nelore, paisagem, curvas de nível):
  sem imagens para baixar e sem representar dados da fazenda.
- Animações curtas (entrada de tela, indicadores, folhas) usam `animation-fill-mode: backwards`
  (não deixam `transform` ativo, o que quebraria elementos `position: fixed`) e respeitam
  "Reduzir movimento" do iPhone.
- Painel: o cabeçalho é parte da tela (sem faixa); sino rola até a Central de Pendências;
  engrenagem abre Configurações. "Despesa" nas ações rápidas abre só os lançamentos que já existem
  (diesel, insumo, manutenção, diarista); despesa avulsa continua "Em breve".

## ARGO Maps (Fase 1 — cartografia)

- Tabelas novas na versão 14 do banco (nenhum dado existente muda): `mapShapes` (perímetro, pastos e
  áreas não produtivas; GeoJSON `Polygon` em [longitude, latitude] WGS 84, `areaCentiHa`, `perimeterM`,
  `geometryVersion`), `farmMaps` (situação rascunho/confirmado, número da versão, enquadramento) e
  `mapVersions` (cópia imutável de cada confirmação, com os alertas da época). Entram no backup e na fila
  de sincronização como as demais entidades.
- `src/modules/maps/geo.ts`: área geodésica (esfera, raio médio 6.371.008,8 m), perímetro (haversine),
  cruzamento do contorno, sobreposição (dividir cerca é permitido; tolerância de 30 cm para diferenças de
  encaixe), "dentro do perímetro", ponto interno para o nome. Tudo é estimativa cartográfica, não
  georreferenciamento legal.
- `mapping.ts`: gravação só pelo Repository; recusa contorno em "8", dois perímetros, pasto desenhado duas
  vezes e sobreposição. Edição usa `expectedRev` (conflito → mensagem para reabrir). Qualquer alteração
  volta o mapeamento para "rascunho"; "Confirmar" (com PIN, se a fazenda tiver) grava nova versão.
  A área do cadastro do pasto só muda quando a pessoa toca em "Usar área do mapa".
- Cabeças por pasto vêm sempre do Rebanho (`computeBalances`); o mapa não guarda contagem.
- Telas: `/maps` (satélite Esri com internet; "Desenho" offline; busca; painel do pasto) e
  `/maps/editar?etapa=local|perimetro|pastos|estruturas|revisao`. Encaixe automático em cantos e cercas já
  desenhadas (18 px / 12 px). Estruturas: fase seguinte.
- **Mapa ilustrado** (`illustrated.ts`, padrão da tela): SVG gerado a partir dos contornos a cada movimento/zoom
  (sem imagem fixa): capim com textura (tom mais seco no pasto vazio), cercas com arame e mourões, perímetro
  marcado, fora da fazenda escurecido, luz e sombra. Áreas não produtivas pelo tipo escolhido pelo
  proprietário (`areaType`: mata, água, sede, outra — campo sem índice, banco não muda). Placas com nome
  (área e cabeças quando cabe), sem sobrepor uma à outra. Gado ilustrativo, visto de cima: só em pastos com
  cabeças no Rebanho, no máximo 6 por pasto e 40 no total, posição fixa por pasto (não é rastreamento),
  animação discreta desligada em "Reduzir movimento" e em aparelhos fracos. Funciona offline.

## Clima e tarefa por voz (Painel)

- **Clima** (`src/modules/clima/`): Open-Meteo (gratuito, sem chave). Região da fazenda = entrada de
  "Como chegar" ou, sem ela, a cidade da fazenda (localizada uma vez e guardada). "Onde estou" usa o GPS
  só depois que a pessoa toca no botão; nas próximas aberturas só atualiza sozinho se a permissão já
  estiver dada. A coordenada enviada é arredondada (~1 km). Última leitura guardada no aparelho
  (`localStorage`) e mostrada offline com a hora; atualiza quando passar de 30 min. Nome da cidade:
  Photon/Nominatim (OpenStreetMap). Nada disso vai para o banco.
- **Tarefa por voz** — no iPhone (e onde não houver reconhecimento) o caminho principal é o **ditado do
  teclado da Apple**: o toque no botão foca um campo auxiliar (o iOS só abre o teclado num gesto) e o foco passa
  ao campo da tarefa; a tela mostra "Entendi: …" antes de anotar. Motivo: com o app instalado na tela de início,
  a Web Speech API do iOS existe mas não recebe áudio. Nos demais aparelhos, se nada for captado em 8 s, a
  escuta é cancelada e cai no ditado do teclado. Detalhes técnicos: (`src/modules/tarefas/voice.ts`, `speech.ts`, `VoiceTask.tsx`): reconhecimento de
  fala do próprio navegador (pt-BR), iniciado dentro do toque (exigência do iPhone). O texto é interpretado
  (`parseSpokenTask`: prazo, pasto pelo nome, responsável com "pro/para o", "urgente" → alta) e a tarefa
  é criada na hora pela mesma `createTask` (com "Desfazer" = exclusão lógica). Se a voz do app não
  existir ou falhar (ex.: sem internet), a folha abre o campo para ditar pelo microfone do teclado do
  iPhone, que funciona offline nos modelos com ditado no aparelho — o texto passa pela mesma interpretação.
- **Paisagem animada**: gado nelore e vaqueiro a cavalo andando de lá para cá só com CSS `transform`
  (`.walk-*`), desligado em "Reduzir movimento".

## Tarefas (aba própria)

- Usa a mesma tabela `pastureTasks` dos serviços de pasto (sem nova versão do banco: os campos novos não são indexados).
  Tarefa geral tem `pastureId: ''`; os serviços anotados num pasto aparecem também na aba Tarefas e vice-versa.
- Campos opcionais: `dueDate` (prazo), `responsibleId`, `priority` (`normal` | `alta`) e `notes` (detalhes, várias linhas).
- Lógica em `src/modules/tarefas/tasks.ts`: criação/edição via `Repository`, exclusão lógica, agrupamento
  (atrasadas, hoje, próximos 7 dias, mais adiante, sem prazo) e ordenação (prioridade alta primeiro).
- Painel: tarefa atrasada vira pendência na Central (`tarefa:<id>`); tarefa com prazo entra na Agenda com o responsável.

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
| v10 | fieldOperations (operações de campo). Campos novos sem índice em supplies (categoria, unidade L/kg, fabricante, princípio ativo, espécie, cultivar, VC%, mínimo), supplyMovements (qty em mL/g, NF, lote, operationId) e fuelMovements (operationId, pastureId) |
| v11 | machineSessions (horímetro digital), meterAdjustments (ajustes autorizados do horímetro). Equipamento ganha marca, modelo, ano, aquisição, situação e horímetro inicial (sem índice) |
| v12 | maintenancePlans, maintenanceRecords (manutenções e solicitações), machineChecklists. supplyMovements ganha maintenanceId; farm ganha checklistItems (sem índice) |
| v13 | workers, workDays (id = trabalhador:data — uma diária por dia), workerPayments. fieldOperations ganha workers/laborCents (sem índice) |

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
