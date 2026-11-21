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
  /** Coordenada OFICIAL da entrada principal (porteira). Nunca é alterada pelo roteamento. */
  entrance?: GeoPoint | null
  /** Cidades de origem para as rotas de acesso. */
  accessOrigins?: AccessOrigin[]
  /**
   * Percentual da reserva financeira, definido pelo responsável. Cada item vale a partir de `since`
   * (AAAA-MM-DD). Sem itens = 35%. Recebimentos usam o percentual vigente na data deles.
   */
  reserveRates?: { since: string; percent: number }[]
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
}

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
  notes: string
  authorizedNegative: boolean
  status: 'ativo' | 'estornado'
  reversedAt: string | null
  reverseReason: string
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
export interface PastureTask extends BaseRecord {
  farmId: string
  pastureId: string
  description: string
  /** Observação / detalhes do serviço (ex.: o que fazer na cerca). Opcional. */
  notes?: string
  done: boolean
  doneAt: string | null
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
  pastures: Pasture
  pastureTasks: PastureTask
  movements: Movement
}

export type EntityName = keyof EntityMap

export const ENTITY_NAMES: readonly EntityName[] = ['diagnostics', 'farms', 'pastures', 'pastureTasks', 'movements', 'clients', 'sales', 'landmarks', 'payments', 'reserveEntries', 'reserveChecks', 'responsibles', 'supplies', 'supplyMovements', 'equipments', 'fuelMovements', 'vaccinations', 'vaccinationApplications']

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
