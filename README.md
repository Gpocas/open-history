# open-history

Recriação moderna do [HSTR](https://github.com/dvorka/hstr) (Bash & Zsh Shell History Suggest Box) construída com **Bun**, **TypeScript** e **OpenTUI (`@opentui/solid`)**, com interface inspirada no **OpenCode**.

## Sumário

- [Principais Funcionalidades](#principais-funcionalidades)
- [Instalação](#instalação)
  - [Direto do GitHub (sem precisar estar publicado no npmjs)](#direto-do-github-sem-precisar-estar-publicado-no-npmjs)
  - [A partir do repositório local](#a-partir-do-repositório-local)
- [Configuração no Shell (`Ctrl+R` e alias `hh`)](#configuração-no-shell-ctrlr-e-alias-hh)
  - [Zsh (`~/.zshrc`)](#zsh-zshrc)
  - [Bash (`~/.bashrc`)](#bash-bashrc)
- [Uso pela CLI](#uso-pela-cli)
- [Atalhos e Controles na TUI](#atalhos-e-controles-na-tui)
- [Desenvolvimento e Testes](#desenvolvimento-e-testes)

---

## Principais Funcionalidades

- **Interface Moderna (OpenCode UI)**:
  - Tema semântico (`dark`, `light` e `monochromatic`) com suporte completo a teclado e mouse.
  - **Search Input Box** em destaque com `<input>` nativo do OpenTUI, contador `X/Y matches` em tempo real e botão rápido `[× C-u]`.
  - **Selects e Checkboxes Interativos** na barra superior para alternar **View** (`Ranking`, `Recents`, `Favorites`), **Match** (`keywords`, `exact`, `regexp`) e opções (`[✓]Regex`, `[✓]Case`, `[✓]Dedup`).
- **Destaque Visual em Azul & Janela Inteligente para Comandos Grandes**:
  - Os termos encontrados são destacados em **azul brilhante em negrito** (`#82b4fb` sobre `#0f3364`).
  - Em comandos muito extensos, a janela de elisão (`...`) se desloca automaticamente para centralizar o trecho onde o termo foi encontrado, evitando que o match fique oculto.
- **Dialog `Run Command` & Split Pane In-TUI (estilo tmux)**:
  - Ao pressionar `Enter` sobre um comando, abre um Dialog perguntando como deseja executar:
    - **`Split Vertical (│)`** (`v` / `Enter`): divide a TUI lado a lado e executa o comando sem sair da TUI.
    - **`Split Horizontal (─)`** (`h`): divide a TUI em cima/embaixo e executa o comando sem sair da TUI.
    - **`Copy Command`** (`c`): copia o comando para o clipboard do sistema e terminal (OSC52).
    - **`Insert & Run in Shell`** (`s`): envia e executa o comando no shell pai.
  - Exibe **loading spinner azul** (`⠋ Running…`) enquanto o processo executa em streaming, carregando previamente os profiles, variáveis e `alias` do seu `~/.bashrc` ou `~/.zshrc`.
- **Dialog `Edit Command` (Shell Prompt vs `$EDITOR`)**:
  - Ao pressionar `Tab` (ou `→` na lista), abre um Dialog com 2 formas de edição:
    - **`Edit in Shell Prompt`** (`i` / `Enter`): fecha a TUI e injeta o comando diretamente na linha de comando do seu `bash`/`zsh` sem pressionar Enter.
    - **`Edit in Default Editor ($EDITOR)`** (`e`): abre o comando no editor padrão do terminal (`$VISUAL` / `$EDITOR` / `nvim` / `vim` / `nano`) e, após salvar e fechar, entrega o comando editado diretamente no prompt do seu shell ainda em estado de edição (sem pressionar Enter).

---

## Instalação

### Direto do GitHub (sem precisar estar publicado no npmjs)

Com **Bun**:
```bash
bun install -g github:gpocas/open-history
```

Com **npm**:
```bash
npm install -g github:gpocas/open-history
```

---

## Configuração no Shell (`Ctrl+R` e alias `hh`)

### Zsh (`~/.zshrc`)

Execute para adicionar automaticamente ao final do seu `~/.zshrc`:

```zsh
open-history --show-zsh-configuration >> ~/.zshrc && source ~/.zshrc
```

Ou adicione manualmente no `~/.zshrc`:

```zsh
# open-history (HSTR) configuration - add this to ~/.zshrc
alias hh=open-history            # hh to be alias for open-history
setopt histignorespace           # skip cmds w/ leading space from history
export HSTR_CONFIG=hicolor       # get more colors

hstr_no_tiocsti() {
    zle -I
    { HSTR_OUT="$( { </dev/tty open-history -- ${BUFFER}; } 2>&1 1>&3 3>&- )"; } 3>&1;
    if [ -n "${HSTR_OUT}" ]; then
        BUFFER="${HSTR_OUT}"
        CURSOR=${#BUFFER}
    fi
    zle redisplay
}
zle -N hstr_no_tiocsti
bindkey '\C-r' hstr_no_tiocsti
```

### Bash (`~/.bashrc`)

Execute para adicionar automaticamente ao final do seu `~/.bashrc`:

```bash
open-history --show-bash-configuration >> ~/.bashrc && source ~/.bashrc
```

---

## Uso pela CLI

```bash
# Abrir a TUI interativa
open-history

# Abrir já filtrando por termos iniciais
open-history -- git checkout

# Abrir direto na view de favoritos
open-history -f

# Modo não-interativo (imprime histórico filtrado no stdout e sai)
open-history -n docker

# Remover o último comando do histórico
open-history -k

# Exibir blacklist carregada
open-history -b

# Mostrar opções de ajuda e versão
open-history --help
open-history --version
```

---

## Atalhos e Controles na TUI

| Controle / Tecla | Ação |
| :--- | :--- |
| **Digitar texto** | Filtra os comandos em tempo real no `<input>` nativo |
| **`←` / `→`, `Home` / `End`, `Backspace`** | Move o cursor e edita o texto dentro do input de busca |
| **`↑` / `↓`, `Ctrl-p` / `Ctrl-n`, `Ctrl-k` / `Ctrl-j`, `Ctrl-r`** | Navega pelos comandos (com scroll automático além da janela visível) |
| **`PgUp` / `PgDn` ou Scroll do Mouse** | Salta 10 itens / rola a lista de comandos |
| **`Ctrl-/`** (ou `Ctrl-w` no macOS) / **`Alt+1..3`** / **Clique** | Alterna a View: `Ranking` → `Recents` → `Favorites` |
| **`Ctrl-e`** / **Clique** | Alterna o modo de Match: `‹keywords›` → `‹exact›` → `‹regexp›` |
| **Checkbox `[✓]Regex`** (`Ctrl-e` / Clique) | Habilita/desabilita busca por expressão regular |
| **Checkbox `[✓]Case(C-t)`** (`Ctrl-t` / Clique) | Habilita/desabilita busca `case-sensitive` |
| **Checkbox `[✓]Dedup(C-d)`** (`Ctrl-d` / Clique) | Habilita/desabilita remoção de duplicatas |
| **`Enter`** ou **Clique no item** | Abre o Dialog **`Run Command`** (`v` Split Vertical, `h` Split Horizontal, `c` Copy, `s` Insert & Run in Shell) |
| **`Alt+v` / `Alt+h`** | Executa diretamente em Split Vertical (`Alt+v`) ou Split Horizontal (`Alt+h`) |
| **`Tab`** (ou **`→`** com item selecionado) | Abre o Dialog **`Edit Command`** (`i` Edit in Shell Prompt, `e` Edit in Default Editor `$EDITOR`) |
| **`←`** (com item selecionado na lista) | Seleciona o comando com `fc "<cmd>"` |
| **`Ctrl-f`** | Adiciona o comando selecionado aos favoritos (`~/.hstr_favorites`) |
| **`Del`** | Remove o comando selecionado do histórico (ou dos favoritos) com confirmação `y/n` |
| **`Ctrl-u` / `Ctrl-w`** ou clique em **`[× C-u]`** | Limpa o texto de busca |
| **`Ctrl-l`** | Alterna minúsculas/maiúsculas do filtro |
| **`Esc` / `Ctrl-g`** | Fecha o Dialog / fecha o Split Pane ativo / cancela e sai da TUI |

---

## Desenvolvimento e Testes

```bash
# Executar em modo de desenvolvimento
bun run index.ts

# Gerar build em ./dist/index.js
bun run build

# Executar a suíte de testes (unitários + testes interativos de TUI)
bun test
```
