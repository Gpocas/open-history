# open-history

Recriação moderna do [HSTR](https://github.com/dvorka/hstr) (Bash & Zsh Shell History Suggest Box) construída com **Bun**, **TypeScript** e **OpenTUI (`@opentui/solid`)**, com interface inspirada no **OpenCode**.

## Instalação

```bash
bun install -g github:gpocas/open-history
# ou
npm install -g github:gpocas/open-history
```

## Configuração no Shell (`Ctrl+R` e alias `hh`)

```zsh
# Zsh
open-history --show-zsh-configuration >> ~/.zshrc && source ~/.zshrc
```

```bash
# Bash
open-history --show-bash-configuration >> ~/.bashrc && source ~/.bashrc
```

## Uso

```bash
open-history              # abre a TUI
open-history -- git       # abre já filtrando por termos
open-history -f           # abre na view de favoritos
open-history -n docker    # modo não-interativo (stdout)
open-history --help       # todas as opções
```

## Documentação

- [Funcionalidades e atalhos da TUI](docs/funcionalidades.md)

## Desenvolvimento

```bash
bun run index.ts   # modo de desenvolvimento
bun run build      # gera ./dist/index.js
bun test           # testes unitários + TUI
```
