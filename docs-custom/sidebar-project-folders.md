# Sidebar Project Folders

## Objetivo

Esta implementação adiciona uma camada de folders configuráveis acima da lista de projetos da sidebar web. Cada folder pode ter nome, cor e estado de collapse/expand. Projetos podem ser movidos para folders pelo menu contextual, e projetos sem folder continuam aparecendo soltos na lista.

## Arquivos principais

- `packages/contracts/src/settings.ts`
  - Define os dados persistidos em `ClientSettings`.
  - Adiciona `sidebarProjectFolders`, `sidebarProjectFolderAssignments` e `sidebarProjectFolderOrder`.
  - Define `SidebarProjectFolderColor`, aceitando presets e hex `#RRGGBB`.

- `apps/web/src/uiStateStore.ts`
  - Persiste estado local de expansão das folders em `sidebarProjectFolderExpandedById`.
  - Adiciona `setSidebarProjectFolderExpanded`.
  - Folders sem valor salvo começam expandidas.

- `apps/web/src/sidebarProjectFolders.ts`
  - Contém a lógica pura de folders.
  - `buildSidebarProjectFolderBuckets` separa projetos em buckets de folders e unfiled.
  - `assignSidebarProjectToFolder` aplica/remova assignments usando `physicalProjectKey`.
  - `sanitizeSidebarProjectFolders` limpa folders inválidas, ordem obsoleta e assignments quebrados.

- `apps/web/src/components/Sidebar.tsx`
  - Renderiza headers de folders, collapse/expand, indentação de projetos dentro de folders e menu contextual.
  - Adiciona diálogo de criação/edição de folder.
  - Projetos fora de folders não recebem header “Projects”.

## Modelo de dados

Folders:

```ts
sidebarProjectFolders: Array<{
  id: string;
  name: string;
  color: SidebarProjectFolderColor;
}>;
```

Assignments:

```ts
sidebarProjectFolderAssignments: Record<string, string>;
```

A chave do assignment é o `physicalProjectKey`, não o `projectKey` lógico. Isso é importante porque a sidebar já pode agrupar projetos por repositório/path/separado; usando a chave física, a folder continua estável mesmo quando o modo de agrupamento muda.

Ordem:

```ts
sidebarProjectFolderOrder: string[];
```

Guarda a ordem dos ids das folders. Projetos dentro de cada folder preservam a ordenação já calculada pela sidebar.

## Regras de renderização

- Projetos com folder aparecem abaixo do header da folder.
- Projetos dentro de folder recebem indentação visual leve (`ml-3`, borda esquerda e padding).
- Projetos sem folder aparecem soltos, sem header extra.
- Folder colapsada esconde seus projetos e threads.
- Projetos sem folder ficam sempre visíveis.
- O collapse do projeto continua independente do collapse da folder.
- O preview “Show more / Show less” de threads continua por projeto.

## Menus e ações

No menu contextual de projeto:

- `Move to folder`
  - Lista folders existentes.
  - `New folder...` cria folder e move o projeto para ela.
  - `Remove from folder` remove o assignment quando o projeto está dentro de uma folder.

No menu contextual do header da folder:

- `Rename`
- `Change color`
- `Delete folder`

Excluir folder só remove a folder e seus assignments. Não remove projetos nem threads.

## Cores

Presets suportados:

```ts
(gray, red, orange, amber, yellow, green, teal, cyan, blue, indigo, violet, pink, rose);
```

Também é aceito custom hex no formato:

```text
#3b82f6
```

## Testes adicionados

- `apps/web/src/sidebarProjectFolders.test.ts`
  - Bucketing de projetos.
  - Ordem de folders.
  - Projetos unfiled no final.
  - Assignments inválidos ignorados.
  - Assignments para projetos agrupados.
  - Sanitização de folders.

- `apps/web/src/uiStateStore.test.ts`
  - Persistência e parsing de `sidebarProjectFolderExpandedById`.

- `packages/contracts/src/settings.test.ts`
  - Defaults para settings antigas.
  - Round-trip das settings de folders.
  - Rejeição de cor inválida.

## Verificação

Com dependências instaladas:

```powershell
vp check
vp run typecheck
vp test run --passWithNoTests apps/web/src/sidebarProjectFolders.test.ts apps/web/src/uiStateStore.test.ts packages/contracts/src/settings.test.ts
```

`vp check` pode mostrar warnings preexistentes no repo, mas não deve falhar por erro de formatação ou lint nos arquivos da feature.
