# Sistema de Temas de Cor

> Implementação em duas entregas (`6c62023a` → `601b46ed`) na branch `color-themes`.
> Branch: `color-themes` · Commits: `6c62023a feat: add option to select color theme` e `601b46ed Add sidebar color to theme system`.

## 1. Visão geral

Permite ao usuário:

- Trocar a preferência de tema (light / dark / system).
- Selecionar uma paleta de cores (built-in + custom importadas via JSON).
- Ajustar por paleta quatro tokens: `accent`, `background`, `foreground`, `sidebar`.
- Importar e exportar paletas como JSON.
- Resetar para a paleta padrão.

A pintura correta acontece **antes** do React montar, evitando FOUC. Desktop (Electron) e Web compartilham a mesma UI; apenas o `webview` de preview tem um caminho IPC próprio para receber os tokens.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           apps/web/index.html                            │
│  <script type="application/json" id="t3code-builtin-palettes">           │
│  <script> resolve + aplica CSS vars no <html> antes do #root montar       │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  apps/web/src/theme/palettes.ts (modelo)                 │
│                  apps/web/src/hooks/useTheme.ts  (estado + DOM)          │
│                  apps/web/src/index.css            (tokens + no-transit.) │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
┌────────────────────────────┐            ┌────────────────────────────────┐
│ apps/web .../SettingsPanels │            │ apps/desktop (Electron)        │
│ ThemePaletteSection         │            │ ElectronTheme service          │
│ Theme row + color rows      │            │ setSource via IPC              │
└────────────────────────────┘            └────────────────────────────────┘
                                                     │
                                                     ▼
                                apps/web/src/browser/ElectronBrowserHost.tsx
                                apps/web/src/browser/annotationTheme.ts
                                → apps/desktop/src/preview/PickPreload.ts
                                  (injeta --t3-theme-* no webview)
```

## 2. Modelo de dados

`apps/web/src/theme/palettes.ts:1`

```ts
export interface ThemeColors {
  accent: string;      // hex 6 dígitos, minúsculo
  background: string;
  foreground: string;
  sidebar: string;
}

export type ThemeFontStyle = "sans" | "serif" | "mono";

export interface ThemePalette {
  id: string;          // chave em builtin/custom storage
  name: string;        // rótulo humano
  glyph: string;       // até 3 chars exibidos no select
  fontStyle: ThemeFontStyle;
  dark: ThemeColors;
  light?: ThemeColors; // opcional; quando ausente usa dark no light mode
}
```

Normalização (sempre retorna hex minúsculo de 6 dígitos ou `undefined`):

```ts
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;
export function normalizeThemeHex(v): string | undefined { /* trim + match + toLowerCase */ }
export function normalizeThemeColors(v): ThemeColors | undefined { /* valida todos os 4 */ }
```

Constantes importantes:

- `DEFAULT_PALETTE_ID = "default"`
- `BUILTIN_PALETTES` — mapa `id -> ThemePalette`. Hoje só tem a paleta `default` (dark, serif, glyph "Aa").
- `THEME_COLOR_FIELDS = ["accent", "background", "foreground", "sidebar"]`.

Adicionar uma nova paleta built-in significa:

1. Inserir em `BUILTIN_PALETTES` (com `id`, `name`, `glyph`, `fontStyle`, `dark`, `light?`).
2. Espelhar o mesmo objeto no `index.html` no `<script id="t3code-builtin-palettes">`.
   (O script inline precisa do JSON para resolver antes do React subir.)

## 3. Storage local

| Chave                          | Conteúdo                                        | Leitura          | Escrita               |
| ------------------------------ | ----------------------------------------------- | ---------------- | --------------------- |
| `t3code:theme`                 | `"light" \| "dark" \| "system"`                 | `readThemePreference` | `writeThemePreference` |
| `t3code:theme-palette`         | `string` (id da paleta ativa)                   | `readPalettePreference` | `writePalettePreference` |
| `t3code:theme-palettes-custom` | `Record<id, ThemePalette>` (JSON)               | `readCustomPalettes` | `writeCustomPalettes` |

Todas as falhas de storage são normalizadas via `ThemeStorageError` (`Schema.TaggedErrorClass`) com `operation: "read" \| "write"`, `storageKey`, `cause` e, quando aplicável, `theme` ou `paletteId`. O log filtra o `cause` usando `safeErrorLogAttributes` para não vazar mensagens de erro de `localStorage` (ex.: modo privado).

`themeStorageReadFailure` é um latch em memória: uma vez que a leitura falhou, o snapshot volta ao default até chegar um `storage` event para uma das três chaves — isso evita loop de erro em ambientes com `localStorage` indisponível.

## 4. Hook `useTheme` (apps/web/src/hooks/useTheme.ts)

É o coração. Não é só um hook — também aplica o tema no DOM no momento do import do módulo (linhas 455-457) e expõe funções imperativas para uso em callbacks e testes.

### 4.1 Estado em closure (módulo)

```ts
let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: Theme | null = null;
let lastAppliedTheme: Theme | null = null;
let lastAppliedSystemDark = false;
let lastAppliedPaletteColors: ThemeColors | null = null;
let themeStorageReadFailure: ThemeStorageError | null = null;
let customPalettesCache: Record<string, ThemePalette> | null = null;
```

Tudo persiste entre renders e entre hooks — é o que permite o `useSyncExternalStore` funcionar.

### 4.2 Snapshot

```ts
type ThemeSnapshot = {
  theme: Theme;             // light | dark | system
  systemDark: boolean;      // estado do media query quando theme === "system"
  paletteId: string;
  palette: ThemePalette;    // resolved (builtin + custom)
  paletteColors: ThemeColors; // cores que estão no DOM
  resolvedTheme: "light" | "dark";
};
```

`getSnapshot()` memoiza (`lastSnapshot`) e só troca referência quando algo realmente mudou (usa `isPaletteEqual` para evitar re-render em mutações idempotentes). `getServerSnapshot()` retorna `DEFAULT_THEME_SNAPSHOT` para SSR.

### 4.3 Subscribe

`subscribe()` registra o listener e, ao mesmo tempo, dois observadores globais:

- `matchMedia("(prefers-color-scheme: dark)").addEventListener("change", …)` — re-aplica o tema se o usuário estiver em `system`.
- `window.addEventListener("storage", …)` — outro tab trocou a preferência; re-aplica e invalida o cache de paletas custom quando a chave relevante muda.

O cleanup remove os dois listeners.

### 4.4 API pública

```ts
useTheme() => {
  theme,                       // Theme
  setTheme(next),              // grava em storage + aplica + emite
  resolvedTheme,               // "light" | "dark"
  palette,                     // ThemePalette ativa
  paletteId,                   // string
  paletteColors,               // ThemeColors (o que está no DOM)
  setPalette(idOrNull),        // troca paleta ativa
  setPaletteColor(field, hex), // edita um campo; cria custom palette automaticamente
  resetPalette(),              // volta ao DEFAULT_PALETTE_ID e deleta a custom
  availablePalettes,           // builtin + custom
}
```

Mais utilidades exportadas para testes e outros módulos:

- `readThemePreference`, `writeThemePreference`
- `readPalettePreference`, `writePalettePreference`
- `listAllPalettes`, `resolvePalette(id)`
- `saveCustomPalette(palette)`, `deleteCustomPalette(id)`
- `syncDesktopTheme(theme)` — repassa para o Electron
- `syncBrowserChromeTheme()` — usado para casar o `theme-color` da barra do navegador com a cor de fundo do app
- `ThemeStorageError`, `DesktopThemeSyncError`, predicados `isThemeStorageError`, `isDesktopThemeSyncError`

### 4.5 Pintura no DOM

`applyPaletteToDocument(palette, resolvedTheme)` (`useTheme.ts:339`) é o único lugar que toca as CSS vars. Estratégia:

- Se `resolvedTheme === "light"` e a paleta **não** tem `light`, **remove** as overrides (`removeProperty`) para o CSS de `index.css` assumir.
- Caso contrário, faz `setProperty` em:
  - `--background`
  - `--foreground`
  - `--app-chrome-background` (espelha o background — usado para o splash pré-paint)
  - `--theme-accent`
  - `--sidebar`

`applyTheme()` (`useTheme.ts:383`):

1. Calcula `systemDark` e `resolvedTheme`.
2. Resolve paleta e cores; se nada mudou, faz `syncDesktopTheme` e sai.
3. Adiciona `.dark` no `documentElement` quando aplicável.
4. Chama `applyPaletteToDocument`, `syncBrowserChromeTheme` e `syncDesktopTheme`.
5. Com `suppressTransitions = true` adiciona `.no-transitions`, força reflow e remove no próximo `requestAnimationFrame`. Isso evita o flash de transições quando o usuário troca a paleta em Settings.

### 4.6 Tratamento de erros

Todos os `try` de `localStorage` capturam, embrulham em `ThemeStorageError` se necessário, e logam **sem** o `cause` (segurança de PII). O estado de `themeStorageReadFailure` impede re-leituras; só destrava num `storage` event das chaves relevantes.

O sync com o desktop (`syncDesktopTheme`) é fire-and-forget mas o erro vira `DesktopThemeSyncError`, é logado e o latch `lastDesktopTheme` é resetado para permitir nova tentativa.

## 5. Pre-paint anti-FOUC (apps/web/index.html)

`apps/web/index.html:14-129`

O `index.html` embute dois blocos **antes** do `<script type="module" src="/src/main.tsx">`:

1. `<script type="application/json" id="t3code-builtin-palettes">` — espelha o objeto `BUILTIN_PALETTES`. Necessário porque o script inline não tem acesso ao módulo.
2. `<script>` IIFE que:
   - Lê `t3code:theme`, `t3code:theme-palette` e `t3code:theme-palettes-custom`.
   - Decide `isDark` e `paletteId` (default = `"default"`).
   - Resolve a paleta (builtin > custom > default).
   - Se todos os 4 hex forem válidos, **escreve diretamente em `documentElement.style`** as 5 CSS vars (`--theme-accent`, `--background`, `--foreground`, `--app-chrome-background`, `--sidebar`) + `backgroundColor` + `<meta name="theme-color">`.
   - Se algo falhar (storage indisponível, JSON corrompido), cai para `LIGHT_BACKGROUND`/`DARK_BACKGROUND` fixos e nunca lança.

Mantenha esse script **idêntico em semântica** ao `applyPaletteToDocument` no hook. Foi feito em vanilla JS deliberadamente para não depender do bundle.

## 6. CSS tokens (apps/web/src/index.css)

- `index.css:37-90` — bloco `@theme inline` que mapeia tokens do Tailwind v4:
  - `--color-theme-accent: var(--theme-accent)`
  - `--color-sidebar`, `--color-sidebar-foreground`, `--color-sidebar-accent`, `--color-sidebar-accent-foreground`, `--color-sidebar-border` (todos `var(--sidebar*)`)
  - `--font-serif` adicionado.
- `index.css:236-282` — defaults para `:root` (light) e `@variant dark` (dark) declaram `--sidebar`, `--sidebar-foreground`, etc. Quando o JS remove os overrides, esses defaults é que prevalecem.
- `index.css:227-234` — `.no-transitions, .no-transitions *, .no-transitions *::before, .no-transitions *::after { transition-duration: 0s !important; animation-duration: 0s !important; }` — usado durante trocas de paleta.
- `apps/web/src/components/AppSidebarLayout.tsx:85` — `className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground"`. A sidebar agora é colorida pelos tokens de tema.

## 7. Settings UI (apps/web/src/components/settings/SettingsPanels.tsx)

### 7.1 Linha de "Theme" (em GeneralSettingsPanel, `SettingsPanels.tsx:868-898`)

- `useTheme().theme` + `setTheme`.
- `<Select>` com as opções de `THEME_OPTIONS` (light/dark/system).
- Botão de reset (SettingResetButton) aparece quando o tema não é `system`.

### 7.2 Seção "Theme palette" (ThemePaletteSection, `SettingsPanels.tsx:573-825`)

- `useTheme()` destrutura: `palette`, `paletteId`, `paletteColors`, `availablePalettes`, `setPalette`, `setPaletteColor`, `resetPalette`.
- `useCopyToClipboard({ target: "theme" })` para o botão "Copy theme".
- `useRef<HTMLInputElement>` para o input `type="file" accept="application/json,.json"` escondido.
- Botões da linha de controle: **Import** (abre file picker) · **Copy theme** (JSON serializado) · `<Select>` com `paletteId`.
- Cada item do select mostra um chip com `glyph` colorido via `style={{ color: "var(--theme-accent)" }}` e a classe de fonte certa (`font-serif`/`font-sans`/`font-mono`).
- Lista de 4 `<PaletteColorRow>` (Accent, Background, Foreground, Sidebar) — cada um é um `<input type="color">` + um `<DraftInput>` que valida hex via `normalizeThemeHex` antes de commitar.
- `paletteFromImportCandidate(candidate, fallbackId)` (`SettingsPanels.tsx:508`) — valida JSON, normaliza cores, gera id único (`${DEFAULT_PALETTE_ID}-imported-${timestampBase36}`) e resolve colisão.
- Aplica o tema importado chamando `setPaletteColor` quatro vezes e depois `setPalette(finalId)`.

### 7.3 Restore defaults (`useSettingsRestore`, `SettingsPanels.tsx:393-502`)

- Considera dirty quando `theme !== "system"` ou `paletteId !== DEFAULT_PALETTE_ID`.
- No `restoreDefaults`: `setTheme("system")` + `resetPalette()` (se dirty) + reset de todas as outras settings via `updateSettings`.

## 8. Bridge desktop (Electron)

### 8.1 `setTheme` IPC

Já existia (commit anterior). O hook `useTheme` reaproveita:

- `apps/desktop/src/preload.ts:101` — `setTheme: (theme) => ipcRenderer.invoke(IpcChannels.SET_THEME_CHANNEL, theme)`.
- `apps/desktop/src/ipc/methods/window.ts:221` — handler Effect que delega para `ElectronTheme.setSource(theme)`.
- `apps/desktop/src/electron/ElectronTheme.ts` — service que troca o `nativeTheme` do Chromium. Falha vira `ElectronThemeSetSourceError`.

### 8.2 Annotation theme no webview de preview

`apps/web/src/browser/annotationTheme.ts:6-32` — `readPreviewAnnotationTheme()` lê do `documentElement` (que está com a paleta aplicada) e devolve um `DesktopPreviewAnnotationTheme`:

```ts
return {
  colorScheme: isDark ? "dark" : "light",
  radius, background, foreground,
  popover, popoverForeground,
  primary, primaryForeground,
  muted, mutedForeground,
  accent, accentForeground,
  border, input, ring,
  fontSans, fontMono,
  themeAccent, themeBackground, themeForeground, themeSidebar, // ← novos
};
```

`apps/web/src/browser/ElectronBrowserHost.tsx:39-43` — chama `preview.setAnnotationTheme(theme)` quando o host Electron monta. `apps/desktop/src/preview/PickPreload.ts:52-91` aplica no webview via `host.style.setProperty` em CSS vars `--t3-theme-accent/background/foreground/sidebar` (e os demais `--t3-*`). `apps/desktop/src/preview/Annotation.css` mapeia essas vars para o Tailwind: `--color-theme-accent: var(--t3-theme-accent); --color-sidebar: var(--t3-theme-sidebar);` etc.

O contrato vive em `packages/contracts/src/ipc.ts:598-645` (`DesktopPreviewAnnotationThemeSchema`) — qualquer campo novo precisa ser adicionado lá e propagado para `readPreviewAnnotationTheme` + `applyAnnotationTheme`.

## 9. Testes (apps/web/src/hooks/useTheme.test.ts)

Coberturas importantes que precisam ser replicadas:

- **Storage failure**: `ThemeStorageError` mantém `operation`, `storageKey`, `theme`/`paletteId` e `cause` exatos; o log de console **não** inclui o `cause` (testa via `expect(JSON.stringify(attributes)).not.toContain(cause.message)`).
- **Retry apenas em storage events relevantes**: unrelated `storage` event não deve re-tentar a leitura.
- **Sync desktop**: causa preservada, retentativa permitida após falha, atributos do log sem `cause`.
- **Paleta unknown**: stored id que não casa volta a `default`.
- **Aplicação correta no dark/light**: testa `setProperty` e `removeProperty` pelos nomes esperados.
- **Custom palettes**: leitura de storage, normalização, rejeição de hex inválido, fallback para o built-in.

Os testes usam `vi.doMock("react")` para retornar `useCallback`/`useEffect`/`useSyncExternalStore` determinísticos e `vi.stubGlobal` para `window`/`document`/`localStorage`. Reproduzir essa estratégia se a suíte mudar.

## 10. Fluxo end-to-end (resumo)

1. Carrega `index.html`. Script inline aplica a paleta ativa via CSS vars antes do #root existir.
2. Bundle carrega `useTheme.ts`. Módulo aplica novamente (idempotente) e inscreve listeners de `matchMedia` + `storage`.
3. `<AppSidebarLayout>` lê `bg-sidebar text-sidebar-foreground` (tokens já resolvidos).
4. Usuário abre Settings → Theme palette.
5. Troca a paleta via `<Select>` → `setPalette(id)` → grava em `t3code:theme-palette` → `applyTheme(suppressTransitions=true)` → CSS vars novas no `<html>` → `syncDesktopTheme(theme)` (Electron) → `syncBrowserChromeTheme()` (theme-color).
6. Usuário edita um `PaletteColorRow` → `setPaletteColor(field, hex)` → cria/atualiza a paleta custom em `t3code:theme-palettes-custom` + seta `palettePreference` para o id → re-aplica.
7. Usuário clica Reset → `resetPalette()` → deleta custom e volta para `default`.
8. Usuário importa um JSON → file picker → `FileReader` → valida + `setPaletteColor` x4 + `setPalette(finalId)` + toast.
9. Usuário clica "Copy theme" → `useCopyToClipboard` serializa a paleta atual para JSON.
10. No Electron, ao montar o preview webview, `ElectronBrowserHost` lê as vars e envia via IPC; o `PickPreload` aplica no webview para que a anotação tenha as mesmas cores.

## 11. Armadilhas e detalhes que costumam quebrar

- **Duplicar a paleta built-in** no `index.html`. Esquecer o JSON no HTML faz o script inline cair no fallback fixo e a página inteira fica com a cor padrão.
- **Hex inválido no script inline**: parseHex retorna `null` → cai no fallback, MAS não dá throw. O React hook depois aplica a paleta correta. Resultado: splash branco/escuro por ~1 frame.
- **`sidebar` no `ThemeColors`**: foi adicionado no commit `601b46ed`. Esquecer de atualizar `palettes.ts` + index.html + schema quebrará tanto o import quanto a renderização.
- **Default snapshot em SSR**: `getServerSnapshot` precisa retornar algo estável para React 18+.
- **`--app-chrome-background`**: espelha `--background` por design. Usado no `<html>`/`<body>` durante o boot e em componentes que precisam do "fundo da janela" sem misturar com sidebar. Não confundir com `--background`.
- **`.no-transitions`**: esquecer de remover depois de um frame trava a UI sem animação até reload. O reflow forçado (`documentElement.offsetHeight`) é proposital.
- **Listeners do `useTheme`**: o subscribe adiciona listeners no **módulo**; se houver mais de uma instância do hook (ex.: testes), os listeners se acumulam. Os testes usam `vi.resetModules` no `afterEach` para evitar isso.
- **`themeStorageReadFailure`**: latch em memória. Se um `localStorage` começar a falhar após inicializar, só destrava com um `storage` event.
- **`ElectronBrowserHost`** assume que o `desktopBridge.preview.setAnnotationTheme` existe; web builds ignoram silenciosamente.
- **Não inserir comentários** no código (regra do AGENTS.md) — a doc fica em `docs/`.

## 12. Checklist para replicar

1. Criar `apps/web/src/theme/palettes.ts` com tipos, normalização e `BUILTIN_PALETTES`.
2. Criar `apps/web/src/hooks/useTheme.ts` com:
   - Erros tipados `ThemeStorageError` e `DesktopThemeSyncError` (Effect Schema).
   - Storage helpers (`read*Preference`, `readCustomPalettes`, `writeCustomPalettes`, `saveCustomPalette`, `deleteCustomPalette`).
   - `applyTheme`, `applyPaletteToDocument`, `syncBrowserChromeTheme`, `syncDesktopTheme`.
   - Snapshot memoizado, `useSyncExternalStore`, subscribe com listeners de `matchMedia` e `storage`.
   - API pública: `theme`, `setTheme`, `setPalette`, `setPaletteColor`, `resetPalette`, `availablePalettes`, `paletteColors`, `palette`, `paletteId`, `resolvedTheme`.
   - Auto-aplicação no load do módulo.
3. Atualizar `apps/web/index.html`:
   - `<script type="application/json" id="t3code-builtin-palettes">` com o mesmo objeto.
   - IIFE que resolve paleta + aplica CSS vars + theme-color antes do bundle.
4. Atualizar `apps/web/src/index.css`:
   - `--color-theme-accent`, `--color-sidebar*` no `@theme inline`.
   - Defaults de `--sidebar*` no `:root` e `@variant dark`.
   - Regra `.no-transitions`.
5. Adicionar `<ThemePaletteSection>` em `SettingsPanels.tsx`, com `PaletteColorRow`, `paletteFromImportCandidate`, file picker, import/export, reset, e plugar no GeneralSettingsPanel.
6. Atualizar `useSettingsRestore` para incluir `isPaletteDirty` (cor e tema resetados juntos).
7. Atualizar `apps/web/src/components/AppSidebarLayout.tsx` para usar tokens de sidebar.
8. Adicionar 4 campos opcionais (`themeAccent`, `themeBackground`, `themeForeground`, `themeSidebar`) em `packages/contracts/src/ipc.ts` (`DesktopPreviewAnnotationTheme`).
9. Atualizar `apps/web/src/browser/annotationTheme.ts` para ler do `documentElement`.
10. Atualizar `apps/desktop/src/preview/PickPreload.ts` (`applyAnnotationTheme`) e `apps/desktop/src/preview/Annotation.css` para mapear os novos `--t3-theme-*`.
11. Adicionar testes em `apps/web/src/hooks/useTheme.test.ts` cobrindo: erros de storage, retry em `storage` event, sync desktop, normalização de hex, paleta unknown, custom inválida, custom válida, aplicação e remoção das CSS vars.
12. Rodar `vp check` e `vp run typecheck`.

## 13. Arquivos e linhas-âncora

| Arquivo                                                              | O que tem                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/src/theme/palettes.ts`                                     | Modelo, normalização, built-in                                    |
| `apps/web/src/hooks/useTheme.ts`                                     | Estado, snapshot, subscribe, aplicação DOM, IPC desktop, erros    |
| `apps/web/src/hooks/useTheme.test.ts`                                | Cobertura de erros e paleta                                        |
| `apps/web/index.html`                                                | Anti-FOUC + JSON de paletas built-in                               |
| `apps/web/src/index.css`                                             | Tokens Tailwind v4, defaults, `.no-transitions`                    |
| `apps/web/src/components/settings/SettingsPanels.tsx:573-825`        | UI da paleta (select, color rows, import, copy, reset)             |
| `apps/web/src/components/settings/SettingsPanels.tsx:393-502`        | `useSettingsRestore` (considera paleta dirty)                       |
| `apps/web/src/components/settings/SettingsPanels.tsx:827-898`        | Linha "Theme" no GeneralSettingsPanel                              |
| `apps/web/src/components/AppSidebarLayout.tsx:85`                    | Sidebar colorida via tokens de tema                                |
| `apps/web/src/browser/annotationTheme.ts:6-32`                       | Serializa paleta ativa para o webview de preview                   |
| `apps/web/src/browser/ElectronBrowserHost.tsx:39-43`                 | Envia annotation theme via IPC                                     |
| `apps/desktop/src/preview/PickPreload.ts:52-91`                      | Aplica `--t3-theme-*` no webview                                   |
| `apps/desktop/src/preview/Annotation.css`                            | Mapeia `--t3-theme-*` para os tokens Tailwind do annotation UI     |
| `apps/desktop/src/ipc/methods/window.ts:221-229`                     | `setTheme` IPC handler (já existia)                                |
| `apps/desktop/src/electron/ElectronTheme.ts`                         | Service que aplica `nativeTheme` no Chromium                       |
| `packages/contracts/src/ipc.ts:598-645`                              | `DesktopPreviewAnnotationTheme` / `Schema`                         |
