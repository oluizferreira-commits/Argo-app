/**
 * Novidades do ARGO (notas de atualização), da mais nova para a mais antiga.
 * A cada versão publicada, acrescente uma entrada NO TOPO com a mesma versão do package.json.
 * Escreva para quem usa o app no campo: o que mudou e onde encontrar.
 */
export interface ChangelogEntry {
  version: string
  /** AAAA-MM-DD */
  date: string
  title: string
  items: string[]
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.26.0',
    date: '2026-11-26',
    title: 'Venda por kg',
    items: [
      'Nova venda "Por kg": preço do quilo vivo e pesagens de 1, 2 ou 3 cabeças por vez na balança.',
      'Lançamento rápido para lotes grandes: escolha quantas cabeças subiram, digite o peso e toque em Lançar (ou Enter).',
      'Mostra o andamento (ex.: 87 de 100 cab.), o peso total e a média por cabeça; dá para apagar uma pesagem errada.',
      'O comprovante sai com o total em kg, a média e o preço por kg; o app mostra quanto o preço do kg dá por arroba.',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-11-24',
    title: 'Venda para a fazenda ou para gastos pessoais; conta do diarista',
    items: [
      'Na venda de gado, escolha: "Para a fazenda" ou "Para gastos pessoais". Dá para mudar depois na página da venda.',
      'Venda para gastos pessoais fica fora do caixa da fazenda: diesel, sal, manutenção e diaristas não descontam desse dinheiro. O Painel mostra as duas coisas separadas.',
      'Relatório de vendas com a coluna Destino e os totais "Para a fazenda" e "Para gastos pessoais".',
      'Diaristas: o saldo mostra a conta (diárias marcadas − pagamentos). Se a diária foi alterada depois de marcar os dias, o app avisa quais dias ficaram com o valor antigo e corrige com um toque.',
      'Botões de filtro maiores (44 px) e campos de busca que aceitam o toque na caixa inteira.',
    ],
  },
  {
    version: '0.24.0',
    date: '2026-11-24',
    title: 'Lembrete de backup a cada 12 horas',
    items: [
      'A cada 12 horas aparece o aviso "Hora de fazer o backup" com o botão "Fazer backup agora".',
      'Se ninguém abrir o app nesse tempo, o aviso aparece assim que abrir.',
      'O backup abre a folha do iPhone: escolha "Salvar em Arquivos" › iCloud Drive.',
      '"Depois" esconde o aviso até a próxima abertura do app (ou por 1 hora).',
      'Corrigido no ARGO Maps: ao encaixar um pasto na cerca, o ponto podia ficar até 1 metro fora e o pasto aparecia como "fora do perímetro".',
    ],
  },
  {
    version: '0.23.1',
    date: '2026-11-23',
    title: 'Tarefa por voz corrigida no iPhone',
    items: [
      'No iPhone, a tarefa por voz agora usa o ditado do teclado da Apple, que funciona de verdade (até sem internet): o teclado já abre pronto, é só tocar no microfone e falar.',
      'Antes de anotar, o ARGO mostra o que entendeu: prazo, pasto, responsável e urgência.',
      'Se o reconhecimento de voz não captar nada em 8 segundos, passa sozinho para o ditado do teclado.',
    ],
  },
  {
    version: '0.23.0',
    date: '2026-11-23',
    title: 'Novidades dentro do app',
    items: [
      'Nova tela "Novidades": o que mudou em cada versão do ARGO.',
      'Depois de cada atualização, o Painel avisa a versão nova com um atalho para as novidades.',
      'Atalho em Mais › Fazenda e sistema › Novidades e em Configurações.',
    ],
  },
  {
    version: '0.22.0',
    date: '2026-11-23',
    title: 'Mapa dos pastos semi-realista',
    items: [
      'ARGO Maps abre no modo Ilustrado: capim com textura, cercas com mourões, mata, água e sede.',
      'Placas com nome, área e cabeças de cada pasto, sem uma ficar por cima da outra.',
      'Gado nelore ilustrativo nos pastos que têm animais no Rebanho (não mostra a posição real).',
      'Ao desenhar uma área não produtiva, escolha o tipo: mata, água, sede ou outra.',
      'Corrigido: a dica do editor bloqueava toques na parte de baixo do mapa.',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-11-23',
    title: 'Tela Mais em aplicativos e ARGO Maps',
    items: [
      'Tela Mais com ícones grandes em quatro pastas coloridas e busca.',
      'ARGO Maps: localize a fazenda no satélite, desenhe o perímetro e os pastos, veja as áreas.',
      'Pastos vizinhos dividem a mesma cerca; sobreposição é recusada.',
      'Revisão com alertas e confirmação com versão salva (com PIN, se houver).',
      'Toque num pasto do mapa para ver área, cabeças e categorias.',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-11-23',
    title: 'Clima, tarefa por voz e Painel animado',
    items: [
      'Temperatura e clima da região da fazenda e de onde você está, também sem internet (última leitura).',
      'Tarefa por voz: fale e o ARGO anota com prazo, pasto, responsável e urgência.',
      'Gado e vaqueiro a cavalo andando na paisagem do Painel.',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-11-23',
    title: 'Nova identidade Terra & Tecnologia',
    items: [
      'Visual verde-floresta com dourado em todo o app.',
      'Painel novo: paisagem da fazenda, rebanho total, pastos, fluxo do mês, reserva e ações rápidas.',
      'Barra de baixo e cabeçalho redesenhados, com transições suaves.',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-11-23',
    title: 'Aba Tarefas',
    items: ['Anotar rápido ou com detalhes, prazo, responsável, pasto e prioridade.', 'Tarefas atrasadas aparecem na Central de Pendências e as com prazo na Agenda.'],
  },
  {
    version: '0.17.0',
    date: '2026-11-21',
    title: 'Diaristas',
    items: ['Calendário de diárias, fechamento do mês e pagamentos parciais.', 'Relatórios de máquinas e de diaristas.'],
  },
  {
    version: '0.16.0',
    date: '2026-11-21',
    title: 'Manutenção das máquinas',
    items: ['Manutenção programada por horas ou dias, com alertas.', 'Checklist diário com fotos.'],
  },
  {
    version: '0.15.0',
    date: '2026-11-21',
    title: 'Máquinas e horímetro digital',
    items: ['Cadastro completo das máquinas.', 'Horímetro digital: iniciar, pausar e encerrar serviço pelo relógio.'],
  },
  {
    version: '0.14.0',
    date: '2026-11-21',
    title: 'Manejo de pastagens',
    items: ['Herbicidas e sementes no estoque.', 'Operações de campo com máquinas, diesel e custo por pasto e por hectare.'],
  },
  {
    version: '0.13.0',
    date: '2026-11-21',
    title: 'Vacinação',
    items: ['Vacinação por pasto e lote, com cobertura parcial e várias aplicações.', 'PDFs sempre com a página deitada; relatório de vendas mensal e anual.'],
  },
  {
    version: '0.12.0',
    date: '2026-11-21',
    title: 'Painel operacional e aba Pastos',
    items: ['Indicadores, Central de Pendências, Novo lançamento e Agenda Operacional.', 'Aba Pastos com resumo, pesquisa e filtros.', 'Pix com o nome completo do recebedor.'],
  },
  {
    version: '0.10.0',
    date: '2026-11-21',
    title: 'Diesel',
    items: ['Compras, abastecimentos e custo médio.', 'Relatórios do diesel na tela e em PDF.', 'Financeiro organizado com os dados do responsável.'],
  },
  {
    version: '0.9.0',
    date: '2026-11-21',
    title: 'Insumos e responsáveis',
    items: ['Sal e outros insumos em sacos, com mistura feita na fazenda.', 'Cadastro de responsáveis.', 'Contagem: os botões + e − partem do número do sistema.'],
  },
  {
    version: '0.8.0',
    date: '2026-11-21',
    title: 'Primeiras etapas',
    items: [
      'Rebanho por contagem e pastos, com categorias e "a especificar".',
      'Vendas, clientes e comprovante com QR Code Pix.',
      'Contas a receber, pagamentos parciais e reserva financeira.',
      'Relatórios mês a mês e por ano, em PDF.',
      'Como chegar à fazenda, várias fazendas com PIN e funcionamento offline.',
    ],
  },
]

/** Compara versões "1.2.3". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** Entradas novas desde a versão que a pessoa tinha (exclusiva) até a atual (inclusiva). */
export function changesSince(previous: string, current: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => compareVersions(e.version, previous) > 0 && compareVersions(e.version, current) <= 0)
}

const SEEN_KEY = 'argo.versaoVista'

/**
 * Versão que a pessoa tinha antes desta abertura. Na primeira abertura do app (instalação nova) não há aviso.
 * Devolve null quando não há novidade para mostrar.
 */
export function pendingUpdateNotice(current: string, farmCreatedAt?: string): string | null {
  try {
    let seen = localStorage.getItem(SEEN_KEY)
    if (seen === null) {
      // quem já usava o app antes de existir esta tela (fazenda criada há mais de 1 hora) vinha da 0.22.0
      const old = farmCreatedAt !== undefined && Date.now() - Date.parse(farmCreatedAt) > 3600_000
      if (!old) {
        localStorage.setItem(SEEN_KEY, current)
        return null
      }
      seen = '0.22.0'
    }
    return compareVersions(current, seen) > 0 ? seen : null
  } catch {
    return null
  }
}

export function markVersionSeen(current: string) {
  try {
    localStorage.setItem(SEEN_KEY, current)
  } catch {
    /* sem armazenamento: só não lembra */
  }
}
