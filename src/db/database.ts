import Dexie, { type EntityTable, type Table } from 'dexie'
import type { AuditEntry, CachedRoute, EntityMap, EntityName, MetaEntry, OutboxEntry } from './types'

export type ArgoDatabase = Dexie & {
  meta: EntityTable<MetaEntry, 'key'>
  auditLog: EntityTable<AuditEntry, 'id'>
  outbox: EntityTable<OutboxEntry, 'id'>
  routeCache: EntityTable<CachedRoute, 'id'>
} & { [E in keyof EntityMap]: EntityTable<EntityMap[E], 'id'> }

export const DB_NAME = 'argo'

/**
 * REGRAS DE MIGRAÇÃO (preservação de dados):
 * - Nunca altere ou remova um `version(n)` já publicado.
 * - Para mudar o esquema, adicione `version(n + 1)` com as tabelas/índices novos
 *   e, se necessário, `.upgrade(tx => ...)` para converter os dados existentes.
 * - Índice com "&" = único (ex.: '&brinco' impede dois animais com o mesmo brinco).
 */
export function createDatabase(name = DB_NAME): ArgoDatabase {
  const db = new Dexie(name) as ArgoDatabase

  db.version(1).stores({
    meta: 'key',
    auditLog: 'id, [entity+entityId], at',
    outbox: 'id, queuedAt',
    diagnostics: 'id, createdAt, updatedAt',
  })

  // v2 — Etapa 2: pastos, serviços dos pastos e movimentações do rebanho.
  db.version(2).stores({
    pastures: 'id, createdAt, updatedAt, name',
    pastureTasks: 'id, pastureId, createdAt, updatedAt',
    movements: 'id, createdAt, updatedAt, date, type, *pastureIds',
  })

  // v3 — várias fazendas: os dados passam a pertencer a uma fazenda (farmId).
  // Registros anteriores sem farmId são adotados pela primeira fazenda cadastrada.
  db.version(3).stores({
    farms: 'id, createdAt, updatedAt, name',
    pastures: 'id, createdAt, updatedAt, name, farmId',
    pastureTasks: 'id, pastureId, createdAt, updatedAt, farmId',
    movements: 'id, createdAt, updatedAt, date, type, *pastureIds, farmId',
  })

  // v4 — Etapa 3: clientes e vendas.
  db.version(4).stores({
    clients: 'id, farmId, createdAt, updatedAt, name',
    sales: 'id, farmId, createdAt, updatedAt, date, clientId, number',
  })

  // v5 — Como chegar: pontos de referência (dado de negócio) e cópia local das rotas calculadas.
  db.version(5).stores({
    landmarks: 'id, farmId, createdAt, updatedAt',
    routeCache: 'id, farmId',
  })

  // v6 — Etapa 4: recebimentos (contas a receber e pagamentos parciais).
  db.version(6).stores({
    payments: 'id, farmId, saleId, clientId, date, createdAt, updatedAt',
  })

  // v7 — Etapa 5: reserva financeira (depósitos e retiradas da conta separada).
  db.version(7).stores({
    reserveEntries: 'id, farmId, date, paymentId, createdAt, updatedAt',
  })

  // v8 — conferência do saldo da reserva com o banco (ex.: Mercado Pago).
  db.version(8).stores({
    reserveChecks: 'id, farmId, date, createdAt, updatedAt',
  })

  // v9 — insumos (sacos), diesel (compras, equipamentos, consumo), responsáveis e vacinação.
  db.version(9).stores({
    responsibles: 'id, farmId, createdAt, updatedAt',
    supplies: 'id, farmId, createdAt, updatedAt',
    supplyMovements: 'id, farmId, supplyId, date, createdAt, updatedAt',
    equipments: 'id, farmId, createdAt, updatedAt',
    fuelMovements: 'id, farmId, date, equipmentId, responsibleId, createdAt, updatedAt',
    vaccinations: 'id, farmId, pastureId, createdAt, updatedAt',
    vaccinationApplications: 'id, farmId, vaccinationId, date, createdAt, updatedAt',
  })

  // v10 — operações de campo (herbicida, plantio, replantio, recuperação). Só tabela nova:
  // produtos e diesel continuam nos estoques existentes (lançamentos ligados por operationId).
  db.version(10).stores({
    fieldOperations: 'id, farmId, pastureId, date, createdAt, updatedAt',
  })

  // v11 — horímetro digital (sessões de máquina) e ajustes autorizados do horímetro.
  db.version(11).stores({
    machineSessions: 'id, farmId, equipmentId, serviceId, status, startedAt, createdAt, updatedAt',
    meterAdjustments: 'id, farmId, equipmentId, at, createdAt, updatedAt',
  })

  // v12 — manutenção programada (planos e registros/solicitações) e checklist diário das máquinas.
  db.version(12).stores({
    maintenancePlans: 'id, farmId, equipmentId, createdAt, updatedAt',
    maintenanceRecords: 'id, farmId, equipmentId, planId, status, date, createdAt, updatedAt',
    machineChecklists: 'id, farmId, equipmentId, at, createdAt, updatedAt',
  })

  // v13 — diaristas: cadastro, calendário de diárias (um registro por trabalhador e dia) e pagamentos.
  db.version(13).stores({
    workers: 'id, farmId, createdAt, updatedAt',
    workDays: 'id, farmId, workerId, date, createdAt, updatedAt',
    workerPayments: 'id, farmId, workerId, date, createdAt, updatedAt',
  })

  return db
}

export const db = createDatabase()

/**
 * Acesso genérico a uma tabela de entidade (backup, sincronização).
 * Todas as entidades estendem BaseRecord, então a tabela é tratada como de BaseRecord.
 */
export function entityTable(db: ArgoDatabase, entity: EntityName): Table<EntityMap[EntityName], string> {
  return db[entity] as unknown as Table<EntityMap[EntityName], string>
}
