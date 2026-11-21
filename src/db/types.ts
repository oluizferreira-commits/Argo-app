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
  pastures: Pasture
  pastureTasks: PastureTask
  movements: Movement
}

export type EntityName = keyof EntityMap

export const ENTITY_NAMES: readonly EntityName[] = ['diagnostics', 'farms', 'pastures', 'pastureTasks', 'movements', 'clients', 'sales', 'landmarks', 'payments']

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
