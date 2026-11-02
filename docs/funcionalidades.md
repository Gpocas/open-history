# Funcionalidades

## Layout

```
 view:▾ ‹ranking›  recents   favorites  (C-/)                       25/25/0 esc
 match:▾ ‹keywords›  exact   regexp  (C-e)       [ ] case (C-t) [x] dedup (C-d)
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⌕ Type to search commands...                                   25/25 matches │
└──────────────────────────────────────────────────────────────────────────────┘
    git status                                                               #1
    bun dev                                                                  #2
    ...
 ▪ v0.2.0  help f1    move ↑/↓ · run enter · edit tab · fav ctrl+f · delete del
```

- **Linha da view:** alterna entre `ranking`, `recents` e `favorites` (a opção ativa aparece entre `‹ ›`). À direita ficam os contadores `itens/total/favoritos` e o `esc` (clicável).
- **Linha do match:** alterna entre `keywords`, `exact` e `regexp`, e os checkboxes `[x] case` (busca case-sensitive) e `[x] dedup` (remove duplicatas).
- **Input de busca:** `<input>` nativo do OpenTUI com contador `X/Y matches` em tempo real e botão `[× C-u]` para limpar o texto.
- **Rodapé:** versão, atalho do **Help** (`F1`) e os atalhos principais. Enquanto o regex digitado for inválido, o erro ocupa o rodapé.
- **Dialog `Keyboard shortcuts`** (`F1`): lista todos os atalhos. Rola com `↑`/`↓`, `PgUp`/`PgDn`, `Home`/`End` ou mouse e fecha com `Esc`, `F1` ou `q`.
- **Toasts:** confirmam ações (comando copiado, favorito adicionado, itens removidos) no canto inferior direito, encostados no rodapé. Somem sozinhos após ~2,5 s, empilham até 3 e fecham com um clique.

Todos os seletores, checkboxes e itens da lista também funcionam com o mouse.

## Temas

- **Escuro (padrão):** paleta baseada no tema escuro do DuckDuckGo. Lista em `#181818`; input e linhas de status (view, match, rodapé) em `#212123`. Cada view tem sua cor: `ranking` laranja, `recents` azul e `favorites` roxo.
- **Monocromático:** sem cores nem fundos, com alternativas em ASCII para alguns símbolos. Ative com `HSTR_CONFIG=monochromatic`.

## Destaque dos Termos & Janela Inteligente para Comandos Grandes

- Os termos encontrados são destacados em **azul claro em negrito** (`#adc2fc` sobre `#1f2738`).
- Em comandos muito extensos, a janela de elisão (`...`) se desloca automaticamente para centralizar o trecho onde o termo foi encontrado, evitando que o match fique oculto.

## Dialog `Run Command` & Split Pane In-TUI (estilo tmux)

Ao pressionar `Enter` sobre um comando, abre um Dialog perguntando como deseja executar:

- **`Split Vertical (│)`** (`v` / `Enter`): divide a TUI lado a lado e executa o comando sem sair da TUI.
- **`Split Horizontal (─)`** (`h`): divide a TUI em cima/embaixo e executa o comando sem sair da TUI.
- **`Copy Command`** (`c`): copia o comando para o clipboard do sistema e do terminal (OSC52).
- **`Insert & Run in Shell`** (`s`): fecha a TUI e entrega o comando ao shell. Pelo `Ctrl+R` ou `hh` no Zsh, o comando é colocado no prompt e você confirma com `Enter`. Sem a integração com o shell, ele é executado diretamente.

Exibe **loading spinner** (`⠋ Running…`) enquanto o processo executa em streaming, carregando previamente os profiles, variáveis e `alias` do seu `~/.bashrc` ou `~/.zshrc`. `Esc` ou `Alt+x` fecham o split.

## Dialog `Edit Command` (Shell Prompt vs `$EDITOR`)

Ao pressionar `Tab` (ou `→` na lista), abre um Dialog com 2 formas de edição:

- **`Edit in Shell Prompt`** (`i` / `Enter`): fecha a TUI e coloca o comando na linha de comando do shell, sem executar.
- **`Edit in Default Editor ($EDITOR)`** (`e`): abre o comando no editor padrão do terminal (`$VISUAL` / `$EDITOR` / `nvim` / `vim` / `nano`) e, após salvar e fechar, coloca o comando editado no prompt do shell, sem executar.

Os dois funcionam pelo `Ctrl+R` e, no Zsh, pelo `hh`, mesmo com `TIOCSTI` bloqueado pelo kernel (veja a configuração no [README](../README.md)).

## Dialog `Delete`

Ao pressionar `Del` sobre um comando, abre um Dialog com as opções:

| Opção | Tecla | Efeito |
| :--- | :--- | :--- |
| **Delete this line only** | `l` / `Enter` | Remove só a ocorrência mais recente do histórico |
| **Delete all occurrences** | `a` | Remove todas as ocorrências do comando do histórico |
| **Delete all N filtered items** | `f` | Remove todos os comandos que batem com o filtro atual (sem filtro, remove a lista inteira) |
| **Cancel** | `Esc` / `n` | Volta para a busca |

Na view `favorites`, a primeira opção é **Delete this favorite** (`a` / `Enter`). Com `HSTR_CONFIG=no-confirm`, `Del` remove direto, sem o Dialog.

---

# Atalhos e Controles na TUI

| Controle / Tecla | Ação |
| :--- | :--- |
| **Digitar texto** | Filtra os comandos em tempo real no `<input>` nativo |
| **`←` / `→`, `Home` / `End`, `Backspace`** | Move o cursor e edita o texto dentro do input de busca |
| **`↑` / `↓`, `Ctrl-p` / `Ctrl-n`, `Ctrl-k` / `Ctrl-j`, `Ctrl-r`** | Navega pelos comandos (com scroll automático além da janela visível) |
| **`PgUp` / `PgDn` ou Scroll do Mouse** | Salta 10 itens / rola a lista de comandos |
| **`Ctrl-/`** (ou `Ctrl-w` no macOS) / **`Alt+1..3`** / **Clique** | Alterna a View: `‹ranking›` → `‹recents›` → `‹favorites›` |
| **`Ctrl-e`** / **Clique** | Alterna o modo de Match: `‹keywords›` → `‹exact›` → `‹regexp›` |
| **`Ctrl-t`** / **Clique em `[x] case`** | Habilita/desabilita busca `case-sensitive` |
| **`Ctrl-d`** / **Clique em `[x] dedup`** | Habilita/desabilita remoção de duplicatas |
| **`Enter`** ou **Clique no item** | Abre o Dialog **`Run Command`** (`v` Split Vertical, `h` Split Horizontal, `c` Copy, `s` Insert & Run in Shell) |
| **`Alt+v` / `Alt+h`** | Executa diretamente em Split Vertical (`Alt+v`) ou Split Horizontal (`Alt+h`) |
| **`Alt+x`** | Fecha o Split Pane |
| **`Tab`** (ou **`→`** com item selecionado) | Abre o Dialog **`Edit Command`** (`i` Edit in Shell Prompt, `e` Edit in Default Editor `$EDITOR`) |
| **`←`** (com item selecionado na lista) | Seleciona o comando com `fc "<cmd>"` |
| **`Ctrl-f`** | Adiciona o comando selecionado aos favoritos (`~/.hstr_favorites`) |
| **`Del`** | Abre o Dialog **`Delete`** (`l` linha, `a` todas as ocorrências, `f` itens filtrados) |
| **`Ctrl-u` / `Ctrl-w`** ou clique em **`[× C-u]`** | Limpa o texto de busca |
| **`Ctrl-l`** | Alterna minúsculas/maiúsculas do filtro |
| **`F1`** ou clique em **`help f1`** | Abre/fecha o Dialog de atalhos |
| **`Esc` / `Ctrl-g`** | Fecha o Dialog / fecha o Split Pane ativo / cancela e sai da TUI |
| **`Ctrl-c` / `Ctrl-x`** | Sai da TUI |

`Alt` aparece como `M-` no Dialog de atalhos (notação Meta). No macOS, configure o terminal para usar **Option como Meta**.
