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
  app/          modules.ts (registro dos 12 módulos), navigation.ts (abas), routes.tsx (rotas)
  components/   Layout, Icon, StatusItem, UpdatePrompt
  core/         ids (UUID, datas ISO), format (pt-BR)
  db/           database.ts (esquema Dexie), types.ts (modelos), repository.ts (gravação), device.ts
  sync/         types.ts (contrato SyncAdapter), engine.ts (push/pull), localOnlyAdapter.ts
  backup/       backup.ts (exportar, validar, restaurar com mesclagem)
  platform/     storage.ts (armazenamento persistente), files.ts (salvar/compartilhar arquivo no iPhone)
  hooks/        useOnline, useStorageStatus
  modules/      uma pasta por módulo (dashboard, settings, …)
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
5. **Movimentação de animais** (etapas futuras) será uma tabela própria de eventos (entrada, transferência de pasto,
   nascimento, morte, venda). A situação atual do animal é derivada desses eventos, o que garante rastreabilidade completa.
6. **Valores financeiros** serão gravados em **centavos (inteiros)** para evitar erros de arredondamento.
   Pagamentos parciais serão registros próprios ligados à conta a receber. O saldo é calculado e nunca sobrescrito.

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
