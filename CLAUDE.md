# ARGO — instruções para desenvolvimento

- O usuário trabalha **apenas pelo iPhone**. Ele não tem computador. Comunicação em português.
- Leia `docs/ARQUITETURA.md` antes de alterar dados. Toda gravação passa por `Repository`, e a exclusão é lógica.
- Nunca altere um `db.version(n)` publicado. Crie uma nova versão com migração.
- Nunca crie dados fictícios da fazenda nem telas de funcionalidade falsa. Um módulo não pronto usa `PlannedModulePage`.
- Valores monetários em centavos (inteiros).
- Antes de enviar: `npm test`, `npm run build` e `npm run lint`. Verifique no navegador (Playwright) quando houver mudança de UI.
