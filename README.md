# open-history

Recriação completa do [HSTR](https://github.com/dvorka/hstr) (Bash & Zsh Shell History Suggest Box) construída com **Bun**, **TypeScript** e **OpenTUI (`@opentui/solid`)**.

## Instalação

```bash
bun install
```

## Uso

```bash
# Modo interativo (TUI)
bun run index.ts

# Modo interativo já iniciando com filtro
bun run index.ts -- git checkout

# Modo não-interativo (imprime histórico filtrado no stdout)
bun run index.ts -n git

# Abrir direto na view de favoritos
bun run index.ts -f

# Mostrar configuração para Bash ou Zsh
bun run index.ts --show-bash-configuration
bun run index.ts --show-zsh-configuration
```

## Atalhos e Controles na TUI

| Controle / Tecla | Ação |
| :--- | :--- |
| **Search Input Box** | Caixa de pesquisa contornada e destacada com realce do termo buscado (`pattern█`) e contador `X/Y matches` |
| **Select de View (`[● Ranking]`, `[○ Recents]`, `[○ Favorites]`)** | Clicável com o mouse, `Ctrl-/` (ou `Ctrl-w` no macOS) para ciclar, ou `Alt+1` / `Alt+2` / `Alt+3` |
| **Select de Match (`‹keywords›`, `‹exact›`, `‹regexp›`)** | Clicável com o mouse ou `Ctrl-e` para alternar |
| **Checkbox `[✓]Regex`** | Clicável com o mouse ou `Ctrl-e` para habilitar/desabilitar busca por expressão regular |
| **Checkbox `[✓]Case(C-t)`** | Clicável com o mouse ou `Ctrl-t` para alternar `case-sensitive` |
| **Checkbox `[✓]Dedup(C-d)`** | Clicável com o mouse ou `Ctrl-d` para remover/manter comandos duplicados |
| `Up` / `Down`, `Ctrl-p` / `Ctrl-n`, `Ctrl-k` / `Ctrl-j`, `Ctrl-r` | Navega pelos itens |
| `PgUp` / `PgDn`, `Home` / `End` | Salta 10 itens / vai para o primeiro ou último item |
| `Ctrl-f` | Adiciona o comando selecionado aos favoritos (`~/.hstr_favorites`) |
| `Del` | Remove o comando selecionado do histórico (ou dos favoritos) |
| `Ctrl-u` / `Ctrl-w` ou clique em `[× C-u]` | Limpa o texto de busca |
| `Ctrl-l` | Alterna minúsculas/maiúsculas do filtro |
| `Enter` ou clique no item | Seleciona o comando |
| `Tab` / `Right` | Seleciona o comando para edição no prompt |
| `Left` | Seleciona o comando com `fc "<cmd>"` |
| `Esc` / `Ctrl-g` / `Ctrl-x` / `Ctrl-c` | Cancela e sai |

## Testes

```bash
bun test
```
