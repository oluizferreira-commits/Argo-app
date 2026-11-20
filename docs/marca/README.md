# Identidade visual do ARGO

Logotipo: touro em traço contínuo, dourado sobre verde. O arquivo original fornecido está em `logo-original.jpg`.

## Paleta oficial (medida no logotipo)

| Uso | Cor |
|---|---|
| Verde do logotipo (principal) | `#276153` |
| Verdes escuros (cabeçalho, barra, cartões) | `#1D4A3E` · `#16392F` · `#0C241E` |
| Dourado, ponta clara | `#EBCB94` |
| Dourado, tom médio | `#C9A376` |
| Dourado, ponta bronze | `#A9743F` |
| Neutros | `#141714` (texto) · `#F4F2EC` (fundo) · `#FFFFFF` (cartões) |

Os tokens CSS correspondentes estão em `src/styles/global.css`.

## Arquivos gerados

- `public/logo-mark.svg`: touro vetorizado com fundo transparente (cabeçalho e marca-d'água).
- `public/favicon.svg`: ícone com fundo verde.
- `public/*.png`: ícones da Tela de Início, gerados com `node scripts/generate-icons.mjs`.

O vetor foi obtido do logotipo original com o potrace (traço isolado do fundo, ampliado 4× e vetorizado),
e depois preenchido com o degradê dourado acima.
