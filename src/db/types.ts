import type { CategoryId } from '../domain/categories'
import type { CountReason, MovementType } from '../domain/movements'
import type { PixKeyType } from '../domain/pix'

/**
 * Campos obrigatórios de todo registro de negócio do ARGO.
 * Garantem rastreabilidade, histórico e sincronização futura.
 */
export interface BaseRecord {
  /** UUID gerado no aparelho. Nunca muda. */
  id: string
  createdAt: string
  updatedAt: string
  /** Exclusão lógica: registros nunca são apagados fisicamente. */
  deletedAt: string | null
  /** Revisão: incrementa a cada alteração (base para resolver conflitos). */
  rev: number
  /** Aparelho que fez a última alteração. */
  deviceId: string
  /** "pending" = alteração local ainda não enviada à nuvem. */
  syncStatus: 'pending' | 'synced'
}

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'import' | 'remote'

/** Histórico imutável de cada alteração. */
export interface AuditEntry {
  id: string
  entity: string
  entityId: string
  action: AuditAction
  at: string
  deviceId: string
  rev: number
  before: unknown
  after: unknown
}

/** Fila de saída para sincronização: uma entrada por registro alterado. */
export interface OutboxEntry {
  /** `${entity}:${entityId}` — evita entradas duplicadas do mesmo registro. */
  id: string
  entity: string
  entityId: string
  rev: number
  queuedAt: string
  attempts: number
  lastError: string | null
}

export interface MetaEntry {
  key: string
  value: unknown
}

/**
 * Registro de teste de armazenamento (tela Configurações).
 * Não representa dado da fazenda.
 */
export interface DiagnosticRecord extends BaseRecord {
  note: string
}

export interface GeoPoint {
  lat: number
  lng: number
}

/** Cidade de origem das rotas (coordenada vinda do OpenStreetMap). */
export interface AccessOrigin {
  id: string
  name: string
  /** Estado/região, ex.: "Pará". */
  region: string
  lat: number
  lng: number
  /** Referência do OpenStreetMap, ex.: "R185557". */
  osm: string
}

/** Fazenda. Cada pasto, movimentação, cliente e venda pertence a uma fazenda. */
export interface Farm extends BaseRecord {
  name: string
  responsible: string
  /** CPF do responsável (só números, validado). Fica só no aparelho; aparece mascarado. */
  responsibleCpf?: string | null
  city: string
  /** PIN opcional (hash SHA-256 com sal). null = sem senha. */
  pinHash: string | null
  pinSalt: string | null
  /** Recebimento por Pix (opcional). A chave fica guardada já normalizada. */
  pixKeyType?: PixKeyType | null
  pixKey?: string | null
  /** Nome e cidade do recebedor, como aparecem no QR Code (sem acento). */
  pixName?: string
  pixCity?: string
  /** Nome e cidade completos, como digitados (aparecem no comprovante; o QR usa a versão abreviada). */
  pixFullName?: string
  pixFullCity?: string
  /** Coordenada OFICIAL da entrada principal (porteira). Nunca é alterada pelo roteamento. */
  entrance?: GeoPoint | null
  /** Cidades de origem para as rotas de acesso. */
  accessOrigins?: AccessOrigin[]
  /**
   * Percentual da reserva financeira, definido pelo responsável. Cada item vale a partir de `since`
   * (AAAA-MM-DD). Sem itens = 35%. Recebimentos usam o percentual vigente na data deles.
   */
  reserveRates?: { since: string; percent: number }[]
  /** itens do checklist diário das máquinas (ausente = itens iniciais) */
  checklistItems?: string[]
}

export type LandmarkKind = 'referencia' | 'bifurcacao' | 'atencao'

/** Ponto de referência / bifurcação no caminho até a fazenda (cadastrado pelo usuário). */
export interface Landmark extends BaseRecord {
  farmId: string
  name: string
  kind: LandmarkKind
  /** Instrução, ex.: "Na bifurcação, siga à direita". */
  note: string
  lat: number
  lng: number
}

export type PaymentMethod = 'pix' | 'dinheiro' | 'transferencia' | 'cheque' | 'outro'

/**
 * Recebimento de uma venda (pode ser parcial). Abate as parcelas em aberto da mais antiga
 * para a mais nova. Nunca é apagado: um lançamento errado é estornado e fica no histórico.
 */
export interface Payment extends BaseRecord {
  farmId: string
  saleId: string
  clientId: string
  /** Data do recebimento (AAAA-MM-DD). */
  date: string
  amountCents: number
  method: PaymentMethod
  notes: string
  status: 'ativo' | 'estornado'
  reversedAt: string | null
  reverseReason: string
}

/**
 * Movimento da conta da reserva financeira (conta separada).
 * Depósito: dinheiro transferido para a reserva (normalmente o percentual da reserva de um recebimento).
 * Retirada: dinheiro tirado da reserva (motivo obrigatório).
 */
export interface ReserveEntry extends BaseRecord {
  farmId: string
  type: 'deposito' | 'retirada'
  date: string
  amountCents: number
  /** Depósito ligado a um recebimento (opcional). */
  paymentId: string | null
  notes: string
  status: 'ativo' | 'estornado'
  reversedAt: string | null
  reverseReason: string
}

/**
 * Conferência do saldo da reserva: o saldo informado (visto no banco, ex.: Mercado Pago)
 * comparado com o saldo calculado pelo ARGO naquele momento.
 */
export interface ReserveCheck extends BaseRecord {
  farmId: string
  /** Onde o saldo foi conferido, ex.: "Mercado Pago". */
  account: string
  date: string
  informedCents: number
  systemCents: number
  /** informado − ARGO (negativo = no banco tem menos que no ARGO). */
  differenceCents: number
  notes: string
}

/** Responsável (pessoa) para combustível, vacinação etc. Nunca é apagado: é desativado. */
export interface Responsible extends BaseRecord {
  farmId: string
  name: string
  role: string
  active: boolean
}

/** Insumo controlado em SACOS (ex.: sal branco, sal mineral). */
/** Ingrediente da receita de uma mistura (quantidade em meios sacos). */
export interface RecipeItem {
  supplyId: string
  halves: number
}

export interface Supply extends BaseRecord {
  farmId: string
  name: string
  /** Mistura (ex.: sal branco + mineral): ingredientes de UMA mistura. Ausente/null = produto comum. */
  recipe?: RecipeItem[] | null
  /** Mistura: quantos meios sacos de mistura UMA mistura rende. */
  yieldHalves?: number | null
  /** Peso de um saco, em gramas (null = ainda não informado). */
  gramsPerSack: number | null
  active: boolean
  /** Categoria (ausente = 'geral': sal, mistura e outros em sacos). */
  category?: SupplyCategory
  /** Unidade do estoque (ausente = 'saco', em meios sacos). 'L' e 'kg' guardam mililitros / gramas em `qty`. */
  unit?: SupplyUnit
  manufacturer?: string
  /** Herbicida: princípio ativo. */
  activeIngredient?: string
  /** Semente: espécie e cultivar/variedade, valor cultural (VC% × 10). */
  species?: string
  cultivar?: string
  culturalValue?: number | null
  /** Estoque mínimo (mesma unidade do estoque: meios sacos, mL ou g). null = sem alerta. */
  minQty?: number | null
  notes?: string
}

export type SupplyCategory = 'geral' | 'herbicida' | 'semente'
export type SupplyUnit = 'saco' | 'L' | 'kg'

/**
 * Movimento do estoque de insumos. Quantidade em MEIOS SACOS (inteiro com sinal):
 * 1 saco = 2; meio saco = 1. Entrada (+), saída (−).
 */
export interface SupplyMovement extends BaseRecord {
  farmId: string
  supplyId: string
  /** mistura: saída dos ingredientes e entrada da mistura (mesmo batchId) */
  type: 'compra' | 'consumo' | 'ajuste' | 'mistura'
  date: string
  halfSacks: number
  /** Mistura feita: liga os lançamentos da mesma mistura (estornados juntos). */
  batchId?: string | null
  /** Produtos em L/kg: quantidade com sinal em mL/g (o `halfSacks` fica 0). */
  qty?: number | null
  /** Compra: nota fiscal e lote. */
  invoice?: string
  lot?: string
  /** Lançamento gerado por uma operação de campo (só é corrigido pela operação). */
  operationId?: string | null
  /** Baixa de peça/óleo/filtro numa manutenção (só é corrigida pela manutenção). */
  maintenanceId?: string | null
  /** Compra: valor pago (centavos). */
  costCents: number | null
  supplier: string
  /** Consumo no cocho: pasto. */
  pastureId: string | null
  notes: string
  /** Saída que deixou o estoque negativo com autorização explícita. */
  authorizedNegative: boolean
  status: 'ativo' | 'estornado'
  reversedAt: string | null
  reverseReason: string
}

/** Equipamento que consome diesel. */
export interface Equipment extends BaseRecord {
  farmId: string
  name: string
  type: string
  identification: string
  responsibleId: string | null
  meter: 'horimetro' | 'km' | 'nenhum'
  active: boolean
  brand?: string
  model?: string
  year?: number | null
  acquiredAt?: string | null
  notes?: string
  /** situação (ausente = ativo se `active`, senão inativo) */
  status?: EquipmentStatus
  /** horímetro inicial (centésimos de hora) e quando foi lido */
  meterInitial?: number | null
  meterInitialAt?: string | null
}

export type EquipmentStatus = 'ativo' | 'parado' | 'manutencao' | 'inativo'

/**
 * Sessão do horímetro digital: uma máquina num serviço, com horários reais de início, pausas e fim.
 * As máquinas de um mesmo serviço compartilham `serviceId`. Horas = (fim − início) − pausas.
 */
export interface MachineSession extends BaseRecord {
  farmId: string
  serviceId: string
  equipmentId: string
  serviceType: FieldOperationType
  customType: string
  pastureId: string | null
  location: string
  responsibleId: string | null
  startedAt: string
  endedAt: string | null
  pauses: { start: string; end: string | null }[]
  status: 'em-andamento' | 'pausada' | 'encerrada' | 'cancelada'
  /** calculado ao encerrar */
  workedSeconds: number | null
  /** ajuste autorizado do tempo (com motivo) */
  adjustedSeconds?: number | null
  adjustReason?: string
  /** operação de campo em que as horas foram lançadas (uma só) */
  operationId: string | null
  notes: string
}

/**
 * Plano de manutenção preventiva de uma máquina: intervalo por horas, por dias, ou os dois
 * (vale o que vencer primeiro). `baseline*` = última vez feita antes de começar a usar o ARGO.
 */
export interface MaintenancePlan extends BaseRecord {
  farmId: string
  equipmentId: string
  name: string
  /** centésimos de hora */
  intervalHours: number | null
  intervalDays: number | null
  /** avisar com antecedência: centésimos de hora / dias */
  warnHours: number | null
  warnDays: number | null
  baselineDate: string | null
  baselineMeter: number | null
  active: boolean
  notes: string
}

/** Peça, óleo, filtro ou serviço usado numa manutenção. Do estoque (baixa) ou comprado direto (despesa). */
export interface MaintenancePart {
  supplyId: string | null
  description: string
  /** do estoque: quantidade na unidade do produto (meios sacos, mL ou g) */
  qty: number | null
  unit: SupplyUnit | null
  /** do estoque: custo médio da baixa; comprado direto: valor pago */
  costCents: number
  movementId: string | null
}

/** Manutenção: solicitada (ex.: problema no checklist) ou concluída. */
export interface MaintenanceRecord extends BaseRecord {
  farmId: string
  equipmentId: string
  planId: string | null
  kind: string
  status: 'solicitada' | 'concluida' | 'cancelada'
  date: string | null
  /** horímetro no momento (centésimos) */
  meter: number | null
  responsibleId: string | null
  parts: MaintenancePart[]
  /** mão de obra / oficina paga (despesa) */
  serviceCents: number
  /** peças do estoque (custo gerencial, sem nova despesa) */
  stockCents: number
  /** comprado direto + serviço (saída financeira) */
  directCents: number
  notes: string
  /** descrição do problema (solicitação) e o checklist de origem */
  problem: string
  checklistId: string | null
  cancelReason: string
}

export type ChecklistStatus = 'ok' | 'atencao' | 'problema' | 'na'

/** Inspeção diária de uma máquina. Só é gravada com todos os itens marcados. */
export interface MachineChecklist extends BaseRecord {
  farmId: string
  equipmentId: string
  at: string
  responsibleId: string | null
  items: { label: string; status: ChecklistStatus; note: string }[]
  /** fotos (JPEG reduzido, data URL) */
  photos: string[]
  notes: string
  hasProblem: boolean
  /** solicitação de manutenção aberta a partir desta inspeção */
  requestId: string | null
}

/** Trabalhador diarista. Meia diária = metade da diária, salvo ajuste autorizado (`halfCents`). */
export interface Worker extends BaseRecord {
  farmId: string
  name: string
  dailyCents: number
  /** null = metade da diária */
  halfCents: number | null
  halfReason: string
  startDate: string
  active: boolean
  notes: string
}

export type WorkDayKind = 'integral' | 'meia' | 'falta' | 'falta-justificada' | 'folga'

/**
 * Dia no calendário do diarista. id = `${workerId}:${date}` (um registro por dia: sem duplicidade).
 * Valor guardado na marcação (preserva o valor da época). Dia passado sem registro = não trabalhou.
 */
export interface WorkDay extends BaseRecord {
  farmId: string
  workerId: string
  date: string
  kind: WorkDayKind
  valueCents: number
  notes: string
  /** operação de campo em que o custo desta diária foi atribuído (uma só) */
  operationId: string | null
}

/** Pagamento ao diarista (saída financeira). Pode ser parcial e cobrir vários dias. */
export interface WorkerPayment extends BaseRecord {
  farmId: string
  workerId: string
  date: string
  amountCents: number
  method: string
  /** mês a que se refere (AAAA-MM) */
  refMonth: string
  notes: string
  status: 'ativo' | 'estornado'
  reversedAt: string | null
  reverseReason: string
}

/** Diarista numa operação de campo (custo gerencial; a saída de dinheiro é o pagamento). */
export interface FieldOperationWorker {
  workerId: string
  name: string
  kind: 'integral' | 'meia'
  valueCents: number
  workDayId: string
}

/** Ajuste manual autorizado do horímetro (valor absoluto, centésimos de hora). */
export interface MeterAdjustment extends BaseRecord {
  farmId: string
  equipmentId: string
  value: number
  reason: string
  at: string
}

/**
 * Movimento do diesel. Litros em CENTILITROS (inteiro com sinal): compra (+), consumo (−), ajuste (±).
 */
export interface FuelMovement extends BaseRecord {
  farmId: string
  type: 'compra' | 'consumo' | 'ajuste'
  date: string
  centiliters: number
  /** Compra: valor total pago (centavos). */
  totalCents: number | null
  station: string
  equipmentId: string | null
  responsibleId: string | null
  /** Leitura do horímetro (horas × 10) ou do hodômetro (km × 10). */
  meterReading: number | null
  /** Consumo gerado por uma operação de campo (só é corrigido pela operação) e o pasto trabalhado. */
  operationId?: string | null
  pastureId?: string | null
  /** leitura vinda do horímetro digital (não é leitura digitada) */
  meterFromSession?: boolean
  notes: string
  authorizedNegative: boolean
  status: 'ativo' | 'estornado'
  reversedAt: string | null
  reverseReason: string
}

export type FieldOperationType = 'herbicida' | 'plantio' | 'replantio' | 'recuperacao' | 'rocada' | 'limpeza' | 'adubacao' | 'transporte' | 'preparo' | 'outra'

/** Produto usado na operação (custo guardado no momento: custo médio do estoque). */
export interface FieldOperationProduct {
  supplyId: string
  name: string
  category: SupplyCategory
  unit: SupplyUnit
  /** quantidade usada: meios sacos (saco) ou mL/g (L/kg) */
  qty: number
  costCents: number
  /** semente: espécie, cultivar e lote usados */
  species?: string
  cultivar?: string
  lot?: string
  movementId: string
}

/** Equipamento usado na operação. */
export interface FieldOperationEquipment {
  equipmentId: string
  name: string
  responsibleId: string | null
  /** horímetro (horas × 10) inicial / final, quando houver */
  meterStart: number | null
  meterEnd: number | null
  /** horas trabalhadas × 10 */
  hoursTenths: number | null
  /** diesel em centilitros e o custo (custo médio do diesel no momento) */
  dieselCl: number
  dieselCents: number
  fuelMovementId: string | null
  /** horas vindas do horímetro digital (sessão) */
  sessionId?: string | null
  sessionSeconds?: number | null
}

export interface FieldOperationCost {
  description: string
  costCents: number
}

/** Operação de campo: aplicação de herbicida, plantio, replantio, recuperação ou outra. */
export interface FieldOperation extends BaseRecord {
  farmId: string
  number: number
  type: FieldOperationType
  /** "outra": nome do serviço digitado pelo produtor */
  customType?: string
  date: string
  /** '' = serviço fora de pasto (ex.: transporte); então vale `location` */
  pastureId: string
  location?: string
  /** área do pasto (snapshot, centésimos de ha) e área efetivamente trabalhada */
  pastureAreaCentiHa: number | null
  workedAreaCentiHa: number
  responsibleId: string | null
  products: FieldOperationProduct[]
  equipments: FieldOperationEquipment[]
  otherCosts: FieldOperationCost[]
  /** diaristas (mão de obra) — custo vem das diárias do calendário, sem duplicar */
  workers?: FieldOperationWorker[]
  laborCents?: number
  /** totais em centavos (guardados: preservam o custo histórico) */
  productsCents: number
  seedsCents: number
  dieselCents: number
  otherCents: number
  totalCents: number
  notes: string
  status: 'concluida' | 'cancelada'
  canceledAt: string | null
  cancelReason: string
  /** correção: a operação nova aponta para a que ela substitui */
  replacesId: string | null
  replacedById: string | null
}

/** Campanha de vacinação de um lote (cobertura pode ser parcial). */
export interface Vaccination extends BaseRecord {
  farmId: string
  pastureId: string
  lot: string
  vaccine: string
  product: string
  plannedQty: number
  responsibleId: string | null
  /** Próxima vacinação (opcional — nem toda vacina tem reforço). */
  nextDate: string | null
  notes: string
  /** Campanha criada a partir desta para a próxima vacinação (tira o lembrete da agenda). */
  followUpId?: string | null
}

/** Aplicação (parcial ou total) de uma campanha de vacinação. */
export interface VaccinationApplication extends BaseRecord {
  farmId: string
  vaccinationId: string
  date: string
  quantity: number
  responsibleId: string | null
  notes: string
  status: 'ativo' | 'estornado'
  reversedAt: string | null
  reverseReason: string
}

/** Pasto da fazenda. */
export interface Pasture extends BaseRecord {
  farmId: string
  name: string
  /** Área em hectares (null = não informada). */
  areaHa: number | null
  notes: string
}

/** Serviço/pendência de um pasto (ex.: "cerca a ser feita"). */
/**
 * Tarefa (aba Tarefas). Com `pastureId` = serviço de um pasto; '' = tarefa geral da fazenda.
 * Prazo, responsável e prioridade são opcionais (campos sem índice: o banco não muda de versão).
 */
export interface PastureTask extends BaseRecord {
  farmId: string
  pastureId: string
  description: string
  /** Observação / detalhes do serviço (ex.: o que fazer na cerca). Opcional. */
  notes?: string
  done: boolean
  doneAt: string | null
  dueDate?: string | null
  responsibleId?: string | null
  priority?: 'normal' | 'alta'
}

/** Uma linha de movimentação: soma (+) ou tira (−) animais de uma categoria num pasto. */
export interface MovementEntry {
  pastureId: string
  category: CategoryId
  delta: number
  reason?: CountReason
}

/**
 * Movimentação do rebanho. O saldo de cada pasto/categoria é a SOMA de todas as
 * movimentações — nunca é digitado diretamente. Movimentações não são editadas:
 * corrige-se com um estorno (que também fica registrado).
 */
export interface Movement extends BaseRecord {
  farmId: string
  type: MovementType
  /** Data em que o fato aconteceu (AAAA-MM-DD). */
  date: string
  entries: MovementEntry[]
  /** Pastos envolvidos (índice para busca). */
  pastureIds: string[]
  notes: string
  /** Se for estorno: id da movimentação estornada. */
  reversalOf: string | null
  /** Se foi estornada: id do estorno. */
  reversedBy: string | null
  /** Se foi gerada por uma venda: id da venda (só pode ser desfeita cancelando a venda). */
  saleId?: string | null
  /** Especificação: diferença entre o total contado e o que havia (0 = só reclassificação). */
  difference?: number
  /** Especificação com diferença: motivo da diferença. */
  differenceReason?: CountReason | null
}

/** Cliente (comprador). */
export interface Client extends BaseRecord {
  farmId: string
  name: string
  phone: string
  city: string
  /** CPF ou CNPJ (opcional, só números). Exibido sempre mascarado. */
  document: string
}

/** Animais que saíram do rebanho na venda (pasto × categoria × quantidade). */
export interface SaleItem {
  pastureId: string
  category: CategoryId
  quantity: number
}

/** Animal pesado na venda por arroba. */
export interface WeighedAnimal {
  pastureId: string
  category: CategoryId
  /** Peso vivo: kg × 10 (décimos de kg). Carcaça: arrobas × 100 (centésimos de @). */
  amount: number
}

export interface Installment {
  /** Vencimento (AAAA-MM-DD). */
  due: string
  amountCents: number
}

export type PaymentKind = 'avista' | 'prazo' | 'parcelado'

/**
 * Venda. Valores em CENTAVOS (inteiros). Ao salvar, gera a movimentação de saída
 * do rebanho na mesma transação. Cancelar a venda devolve os animais (estorno).
 */
export interface Sale extends BaseRecord {
  farmId: string
  /** Número sequencial por fazenda (1, 2, 3…). */
  number: number
  date: string
  clientId: string
  mode: 'arroba' | 'cabeca'
  items: SaleItem[]
  /** Venda por arroba: pesagem e preço da arroba. */
  weighing: 'vivo' | 'carcaca' | null
  animals: WeighedAnimal[]
  pricePerArrobaCents: number | null
  /** Venda por cabeça: preço por cabeça de cada categoria. */
  pricePerHeadCents: Partial<Record<CategoryId, number>>
  /** Total de arrobas × 100 (para exibição). */
  arrobasHundredths: number
  totalCents: number
  paymentKind: PaymentKind
  installments: Installment[]
  notes: string
  movementId: string
  status: 'ativa' | 'cancelada'
  canceledAt: string | null
  cancelReason: string
}

/**
 * Mapa de entidades de negócio sincronizáveis.
 * Novos módulos (animais, pastos, vendas...) entram aqui.
 */
export interface EntityMap {
  diagnostics: DiagnosticRecord
  farms: Farm
  clients: Client
  sales: Sale
  landmarks: Landmark
  payments: Payment
  reserveEntries: ReserveEntry
  reserveChecks: ReserveCheck
  responsibles: Responsible
  supplies: Supply
  supplyMovements: SupplyMovement
  equipments: Equipment
  fuelMovements: FuelMovement
  vaccinations: Vaccination
  vaccinationApplications: VaccinationApplication
  fieldOperations: FieldOperation
  machineSessions: MachineSession
  meterAdjustments: MeterAdjustment
  maintenancePlans: MaintenancePlan
  maintenanceRecords: MaintenanceRecord
  machineChecklists: MachineChecklist
  workers: Worker
  workDays: WorkDay
  workerPayments: WorkerPayment
  pastures: Pasture
  pastureTasks: PastureTask
  movements: Movement
}

export type EntityName = keyof EntityMap

export const ENTITY_NAMES: readonly EntityName[] = ['diagnostics', 'farms', 'pastures', 'pastureTasks', 'movements', 'clients', 'sales', 'landmarks', 'payments', 'reserveEntries', 'reserveChecks', 'responsibles', 'supplies', 'supplyMovements', 'equipments', 'fuelMovements', 'vaccinations', 'vaccinationApplications', 'fieldOperations', 'machineSessions', 'meterAdjustments', 'maintenancePlans', 'maintenanceRecords', 'machineChecklists', 'workers', 'workDays', 'workerPayments']

/** Campos que o usuário informa (o resto é preenchido pelo repositório). */
export type EntityInput<E extends EntityName> = Omit<EntityMap[E], keyof BaseRecord>

/** Passo da rota (manobra do serviço de roteamento). */
export interface RouteStep {
  type: string
  modifier: string
  name: string
  ref: string
  distance: number
  lat: number
  lng: number
  exit?: number
}

/**
 * Rota calculada (cópia local, não é dado de negócio): permite ver o guia sem internet.
 * Recalculada quando a entrada ou a cidade de origem mudam.
 */
export interface CachedRoute {
  /** `${farmId}|${originId}` */
  id: string
  farmId: string
  originId: string
  origin: GeoPoint
  dest: GeoPoint
  /** metros */
  distance: number
  /** segundos */
  duration: number
  /** [lat, lng] ao longo das estradas */
  coords: [number, number][]
  steps: RouteStep[]
  /** Distância (m) entre o ponto da cidade e a estrada onde a rota começa. */
  snapStart: number
  /** Distância (m) entre a coordenada oficial da porteira e o fim da estrada mapeada. */
  snapEnd: number
  computedAt: string
}
