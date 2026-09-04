# HardwareScrapper — Comprasparaguai Informática

**Monte o PC com o melhor custo-benefício, automaticamente, a partir dos preços reais da categoria
Informática do [comprasparaguai.com.br](https://www.comprasparaguai.com.br/informatica/).**

Para quem compra componentes de PC em Ciudad del Este (ou acompanha os preços de lá): o
HardwareScrapper raspa os anúncios, cruza cada peça com uma base de performance curada e monta até
7 builds completas de computador sozinho — cada uma ancorada no item de melhor custo-benefício de
uma categoria (Processador, Placa-Mãe, RAM, GPU, Fonte, Armazenamento). A build de melhor
custo-benefício geral é destacada no topo. Sem trabalho manual: você só revisa o que a extração
automática não conseguiu ler direito.

> 🖼️ **[IMAGEM 1 — capa]** Screenshot (ou GIF curto) da página "Análise" mostrando a lista de
> builds já montadas, com o card da build de melhor custo-benefício geral destacado no topo.
> Ideal: pelo menos 2–3 builds visíveis na tela, para dar noção de variedade de preço.

## Por que usar

- **Zero trabalho de montagem.** O algoritmo escolhe as peças, checa compatibilidade (soquete,
  tipo de RAM, wattagem da fonte) e ranqueia tudo pelo índice de performance por dólar.
- **Curadoria é sua, para sempre.** Correções de specs, apelidos de modelo e ajustes na base de
  performance ficam guardados localmente e sobrevivem a cada nova coleta de preços.
- **100% local.** Roda inteiro no seu computador ou celular — nada é enviado para servidor nenhum
  além da própria busca de preços no site de origem. Sem conta, sem nuvem, sem telemetria.
- **Windows e Android, o mesmo motor.** As duas versões rodam exatamente o mesmo código de coleta
  e pontuação — só a "casca" nativa muda.
- **Monte na mão, se preferir.** Um assistente guiado de 6 etapas deixa escolher cada peça você
  mesmo, sem perder as checagens de compatibilidade.

## Capturas de tela

> 🖼️ **[IMAGEM 2 — Database]** Screenshot da página "Database", aba "Produtos", mostrando a
> lista de itens raspados com filtros de categoria, specs legíveis e índice de valor visíveis.

> 🖼️ **[IMAGEM 3 — Build manual]** Screenshot da página "Build" no meio do assistente de 6
> etapas, mostrando a etapa atual e as peças compatíveis listadas abaixo.

> 🖼️ **[IMAGEM 4 — Android]** Screenshot do app rodando num celular Android — de preferência a
> mesma tela "Análise" da imagem 1, para comparar lado a lado com a versão Windows.

## Como usar

### Windows

1. Baixe o `.zip` da [página de Releases](../../releases/latest) e extraia a pasta onde quiser.
2. Execute **`HardwareScrapper.exe`**. Sem instalador, sem precisar de Python, nada é gravado no
   registro do Windows.
3. Na primeira abertura, clique em **"Coletar dados agora"** — a coleta leva alguns minutos e dá
   para cancelar no meio sem perder nada.

Requisitos: Windows 10 ou 11 com o WebView2 Runtime (já vem instalado por padrão desde 2021).

### Android

1. Baixe o `.apk` da [página de Releases](../../releases/latest) e instale — como não vem de uma
   loja, o Android vai pedir para liberar "instalar de fontes desconhecidas" na primeira vez.
2. Abra o app e colete os dados. Funciona sozinho, sem precisar do computador ligado nem de rede
   local — só da conexão do próprio celular.

Requisitos: Android 7.0 (API 24) ou mais novo, arquitetura `arm64-v8a` ou `x86_64` (a grande
maioria dos aparelhos vendidos nos últimos anos).

**Seus dados são só seus.** Preços coletados, curadoria e ajustes de pontuação ficam guardados
localmente (pasta `dados/` no Windows, área privada do app no Android) — copiar essa pasta (ou
gerar um backup pela aba "Backup e exportação") é o backup inteiro, pronto para levar para outra
máquina.

## Quer entender por dentro ou contribuir?

Arquitetura do backend, o algoritmo completo de pontuação e montagem das builds, como rodar a
partir do código-fonte e como gerar as próprias builds de release estão documentados em
[DEVELOPMENT.md](DEVELOPMENT.md).

## Licença

[MIT](LICENSE) — use, modifique e distribua livremente, inclusive em versões customizadas ou
integradas a outro projeto, desde que o aviso de copyright original seja mantido.
