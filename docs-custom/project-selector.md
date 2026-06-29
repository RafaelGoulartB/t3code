# Project Selector na BranchToolbar

Funcionalidade adicionada no commit `37a30760` ("Add project selector to
BranchToolbar") que permite ao usuário escolher qual projeto está ativo em uma
thread diretamente pela toolbar do composer, em vez de depender exclusivamente
do `Sidebar` ou do `CommandPalette`.

## Visão geral

- Aparece como um `Select` "ghost" no `BranchToolbar` com ícone de pasta
  (`FolderIcon`) à esquerda do nome do projeto.
- Quando o thread já iniciou, o seletor vira um `span` estático (lock visual) —
  o `projectId` é server-authoritative em threads ativas e não pode mais ser
  alterado pelo client.
- Itens puramente git (env mode, branch, environment picker) ficam escondidos
  quando o repositório não é um repo git, ou seja, `isGitRepo === false`.
- Toda a toolbar só renderiza quando existe um `activeProject` válido para o
  thread (o `BranchToolbar` passa a ser envolvido por `activeProject ?` no
  `ChatView`).

## Arquivos tocados

| Arquivo | Tipo | Mudança |
| --- | --- | --- |
| `apps/web/src/components/BranchToolbarProjectSelector.tsx` | novo | Componente que renderiza o `Select`/lock do projeto. |
| `apps/web/src/components/BranchToolbarProjectSelector.test.tsx` | novo | Testes do componente. |
| `apps/web/src/components/BranchToolbar.tsx` | alterado | Recebe props de projeto e decide quando mostrar cada item. |
| `apps/web/src/components/BranchToolbar.logic.ts` | alterado | Novo helper `resolveProjectLockedLabel`. |
| `apps/web/src/components/BranchToolbar.logic.test.ts` | alterado | Testes para o helper. |
| `apps/web/src/components/ChatView.tsx` | alterado | Calcula `availableProjects` / `projectLocked` / `onProjectChange` e passa para o toolbar; troca o gate `isGitRepo` por `activeProject`. |

## Como funciona

### 1. Lógica de negócio — `ChatView.tsx`

```ts
// Projetos que podem ser escolhidos como ativos para esta thread de draft.
// O escopo é o ambiente ativo, fazendo match com o workspace que o usuário
// está mirando hoje; a troca de ambiente é responsabilidade do environment
// picker.
const availableProjects = useMemo(() => {
  if (!activeThread) return [];
  const targetEnvironmentId = activeThread.environmentId;
  return allProjects.filter(
    (project) => project.environmentId === targetEnvironmentId,
  );
}, [activeThread, allProjects]);

// Trava o picker assim que a conversa começa de fato, para que a identidade
// server-side do projeto não mude enquanto há mensagens em voo.
const projectLocked = threadHasStarted(activeThread);

// Trocar de projeto só é suportado antes da thread iniciar. Para threads
// server-side isso é no-op (o projeto é autoritativo no servidor).
const onProjectChange = useCallback(
  (projectRef: ScopedProjectRef) => {
    if (isServerThread) return;
    const composerTarget = composerDraftTarget ?? draftId;
    if (!composerTarget) return;
    setDraftThreadContext(composerTarget, { projectRef });
  },
  [composerDraftTarget, draftId, isServerThread, setDraftThreadContext],
);
```

Pontos-chave:

- `availableProjects` é derivado de `allProjects` (vindo de
  `useProjects()`) filtrando pelo `environmentId` da thread atual — o usuário
  só vê projetos que estão fisicamente disponíveis no ambiente ativo.
- `projectLocked` usa o helper existente `threadHasStarted` que já considera
  `latestTurn`, `messages.length > 0` ou `session !== null`.
- `onProjectChange` é seguro contra threads server-side (no-op) e contra
  ausência de `draftId` (early return).

### 2. Gate no `ChatView.tsx`

O `BranchToolbar` antes era envolvido por `isGitRepo && (...)`. Agora é:

```tsx
{activeProject ? (
  <div className="pointer-events-auto">
    <BranchToolbar
      ...
      isGitRepo={isGitRepo}
      availableProjects={availableProjects}
      projectLocked={projectLocked}
      onProjectChange={onProjectChange}
    />
  </div>
) : null}
```

Razão: o `BranchToolbarBranchSelector` mais interno já assume um `activeProject`
para resolver o `cwd` do branch, então faz mais sentido esconder a toolbar
inteira quando não há projeto resolvido do que tentar uma renderização
quebrada.

### 3. Componente — `BranchToolbarProjectSelector.tsx`

```tsx
interface BranchToolbarProjectSelectorProps {
  projectLocked: boolean;
  activeProject: EnvironmentProject | null;
  availableProjects: ReadonlyArray<EnvironmentProject>;
  onProjectChange: (projectRef: ScopedProjectRef) => void;
}
```

Comportamento:

- `projectLocked || availableProjects.length === 0` → renderiza `<span>`
  estático com `data-testid="branch-toolbar-project-locked"` e
  `data-project-locked="true"`. Usa `resolveProjectLockedLabel(activeProject)`
  (que devolve `project.title` ou `"Project"` como fallback).
- Caso contrário → renderiza um `Select` "ghost" com `SelectValue` mostrando
  o título do projeto ativo e um popup com `SelectGroup` rotulado
  `"Project"`. Cada item mostra `FolderIcon` + título.
- `onValueChange` acha o `EnvironmentProject` correspondente e propaga via
  `onProjectChange({ environmentId, projectId })`.
- Marcadores de teste: `data-testid="branch-toolbar-project-trigger"` e
  `data-project-locked="false"`.

### 4. Integração no `BranchToolbar.tsx`

- Novas props no `BranchToolbar`:
  - `isGitRepo: boolean`
  - `availableProjects: ReadonlyArray<EnvironmentProject>`
  - `projectLocked: boolean`
  - `onProjectChange: (projectRef: ScopedProjectRef) => void`
- Desktop (não-mobile) ordem visual:
  1. `BranchToolbarProjectSelector` (sempre)
  2. Separador + `BranchToolbarEnvironmentSelector` (apenas se `isGitRepo`
     e houver múltiplos ambientes)
  3. Separador + `BranchToolbarEnvModeSelector` (apenas se `isGitRepo`)
  4. `BranchToolbarBranchSelector` (apenas se `isGitRepo`)
- Mobile (`MobileRunContextSelector`): ganha um `MenuGroup` "Project" no topo
  do popup com `MenuRadioGroup` de `MenuRadioItem`s, mostrado apenas quando
  `availableProjects.length > 0`.

### 5. Helper puro — `BranchToolbar.logic.ts`

```ts
export function resolveProjectLockedLabel(
  project: { title: string } | null,
): string {
  return project?.title ?? "Project";
}
```

Função deliberadamente pura para ser fácil de testar e reusar tanto no
`span` travado quanto no `SelectValue` placeholder.

## Como replicar em outro lugar

1. **Origem dos dados** — garanta acesso a `allProjects` via
   `useProjects()` e a `activeThread` para derivar o `environmentId` alvo.
2. **Derivação** — calcule `availableProjects` filtrando `allProjects` por
   `project.environmentId === activeThread.environmentId`.
3. **Lock** — use `threadHasStarted(activeThread)` para decidir se o picker
   está travado.
4. **Persistência** — para threads draft, chame `setDraftThreadContext(target,
   { projectRef })` com `scopeProjectRef(envId, projectId)`. Não faça nada
   para threads server-side.
5. **UI** — use o `BranchToolbarProjectSelector` ou copie a estrutura
   (`<Select modal={false}>` + `<SelectTrigger variant="ghost" size="xs">` +
   `FolderIcon`). Adicione os `data-testid`s se for testar com selectors.
6. **Gate** — envolva o seletor (e qualquer UI git-only) por um check de
   `isGitRepo` / `activeProject` para não renderizar toolbar sem destino.

## Testes

Cobertos por `BranchToolbarProjectSelector.test.tsx` (renderToStaticMarkup):

- Estado `projectLocked` renderiza o `<span>` com `data-testid` correto e o
  título do projeto.
- Estado `projectLocked` + `activeProject === null` cai no fallback
  `"Project"`.
- Estado editável renderiza o trigger com `data-testid`, `aria-label="Project"`
  e o título.
- Estado editável + `activeProject === null` mostra `"Project"` como
  placeholder.

E por `BranchToolbar.logic.test.ts` (novo describe `resolveProjectLockedLabel`):

- Devolve `project.title` quando há projeto.
- Devolve `"Project"` quando recebe `null`.

## Validação

Para validar mudanças nessa área, rode:

```bash
vp test -- apps/web/src/components/BranchToolbarProjectSelector.test.tsx
vp test -- apps/web/src/components/BranchToolbar.logic.test.ts
vp check
vp run typecheck
```
