# open-history

Recriação moderna do [HSTR](https://github.com/dvorka/hstr) (Bash & Zsh Shell History Suggest Box) construída com **Bun**, **TypeScript** e **OpenTUI (`@opentui/solid`)**, com interface inspirada no **OpenCode** e tema escuro baseado na paleta do DuckDuckGo.

## Instalação

```bash
bun add -g github:gpocas/open-history
```

### Atualizar

```bash
bun remove -g open-history
bun add -g github:gpocas/open-history
open-history --version
```

Para instalar a partir de um clone local (desenvolvimento), troque o último comando por `bun add -g /caminho/para/open-history`.

## Configuração no Shell (`Ctrl+R` e `hh`)

```zsh
# Zsh
open-history --show-zsh-configuration >> ~/.zshrc && source ~/.zshrc
```

```bash
# Bash
open-history --show-bash-configuration >> ~/.bashrc && source ~/.bashrc
```

Se você já tinha uma configuração anterior, **substitua** o bloco `open-history (HSTR) configuration` em vez de adicionar outro.

No Zsh, tanto o `Ctrl+R` quanto o `hh` colocam o comando escolhido no prompt sem depender de `TIOCSTI` (bloqueado por padrão nos kernels Linux ≥ 6.2, `dev.tty.legacy_tiocsti=0`). No Bash, o `hh` ainda depende de `TIOCSTI`; prefira o `Ctrl+R`.

## Uso

```bash
open-history              # abre a TUI
open-history -- git       # abre já filtrando por termos
open-history -f           # abre na view de favoritos
open-history -n docker    # modo não-interativo (stdout)
open-history -k           # remove o último comando do histórico
open-history --help       # todas as opções
```

Dentro da TUI, pressione **`F1`** para ver todos os atalhos.

## Desenvolvimento

```bash
bun install
bun start        # roda a TUI a partir do código-fonte
bun run test
bun run bundle   # gera o bundle (build.ts)
```

## Documentação

- [Funcionalidades e atalhos da TUI](docs/funcionalidades.md)
