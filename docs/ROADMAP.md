# ARGO — Etapas

| Etapa | Conteúdo | Situação |
|---|---|---|
| 1 | Fundação: PWA, identidade visual, navegação, banco local, histórico, backup, estrutura de sincronização | **concluída** (v0.1.0) |
| 2 | Rebanho por contagem + pastos: cadastro de pastos (nome, hectares, observações, serviços), contagem inicial e conferência, nascimento, compra, transferência, mudança de categoria, morte, venda (quantidade), estorno, histórico | **concluída** (v0.2.0) |
| 2.1 | Várias fazendas: tela de entrada com escolha da fazenda e PIN opcional; categoria Reprodutor | **concluída** (v0.3.0) |
| 3 | Vendas por arroba (peso vivo kg ÷ 30 ou abate em @, peso por animal) e por cabeça; clientes; pagamento à vista, a prazo ou parcelado; comprovante com QR Code Pix; cancelamento com devolução ao rebanho | **concluída** (v0.4.0) |
| 3.1 | Como chegar à fazenda: mapa de satélite, rotas por estrada validadas até a porteira, pontos de referência e bifurcações, página pública, navegação e guia em imagem | **concluída** (v0.5.0) |
| 3.2 | Contagem sem categoria (fêmeas/machos a especificar) com alerta e especificação no curral | **concluída** (v0.5.1) |
| 4.1 | Bezerros a especificar e grupo "A especificar" nas telas | **concluída** (v0.6.1) |
| 4.2 | Observação nos serviços dos pastos (na hora de anotar ou depois, com histórico) | **concluída** (v0.6.2) |
| 4 | Contas a receber e pagamentos parciais: recebimentos por venda, parcelas pagas/parciais/vencidas, estorno, venda à vista já recebida, Pix pelo saldo | **concluída** (v0.6.0) |
| 5 | Reserva financeira de 35%: separar 35% de cada recebimento, conta separada (depósitos e retiradas com motivo), saldo e alerta | **concluída** (v0.7.0) |
| 5.1 | Conferência do saldo da reserva com o Mercado Pago (digitado), com ajuste e histórico | **concluída** (v0.8.1) |
| 5.2 | Percentual da reserva definido pelo responsável de cada fazenda (padrão 35%), com histórico | **concluída** (v0.8.2) |
| 6 | Relatórios mês a mês e por ano, na tela e em PDF: vendas, arrobas, recebimentos, inadimplência, reserva, nascimentos e mortes, rebanho por pasto e categoria | **concluída** (v0.8.0) |
| 7.1 | Responsáveis + estoque de insumos em sacos (meio saco), consumo no cocho por pasto, estoque negativo só com autorização | **concluída** (v0.9.0) |
| 7.1.1 | Mistura de sal (receita do responsável; "Mistura feita" desconta branco e mineral; cocho em sacos de mistura) | **concluída** (v0.9.1) |
| 7.1.2 | Painel com serviços pendentes por pasto; contagem parte do saldo do sistema | **concluída** (v0.9.2–0.9.3) |
| 7.2 | Diesel: compras, equipamentos, consumo, custo médio ponderado | **concluída** (v0.10.0) |
| 7.2.1 | Financeiro com dados do responsável (CPF) e ajustes visuais da reserva | **concluída** (v0.10.1) |
| 7.3 | Relatórios de combustível (semana, mês, equipamento, responsável, L/h), na tela e em PDF | **concluída** (v0.11.0) |
| 7.3.1 | Painel operacional: indicadores, Central de Pendências, Novo lançamento, Agenda, Atividades recentes; sistema e backup em Configurações | **concluída** (v0.12.0) |
| 7.4 | Vacinação com cobertura parcial e várias aplicações por campanha | planejada |
| 7 | Sincronização em nuvem (Supabase), login entre aparelhos e possível integração com Mercado Pago | próxima |

Observação: os itens "Controle de pastos" e "Nascimentos e mortes" do plano original foram incorporados à Etapa 2,
porque o rebanho é controlado por pasto e por contagem.
