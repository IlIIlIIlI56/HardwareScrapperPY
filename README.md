# Builds de Custo-Beneficio — Comprasparaguai Informatica

Ferramenta que raspa os precos da categoria Informatica (componentes de PC) da
[comprasparaguai.com.br](https://www.comprasparaguai.com.br/informatica/), cruza com uma base de
performance de hardware e monta automaticamente ate 7 builds completas de PC, cada uma ancorada
no item "TOP Custo-Beneficio" de uma categoria (CPU, Placa-Mae, RAM, GPU, Fonte, Armazenamento).
A build de melhor custo-beneficio geral e destacada no topo.

Toda a analise (extracao de specs, calculo de performance/preco, escolha das pecas, montagem das
builds) e feita por codigo -- Python no scraper, JavaScript puro na pagina. Nenhuma etapa e manual.
A revisao humana existe so para **corrigir dados de entrada** que o regex nao conseguiu extrair do
nome do anuncio; quem decide se um item pontua continua sendo o mesmo codigo, sempre.

## Estrutura

```
HardwareScrapperPY/
├── index.html               <- pagina principal: builds (abrir com Live Server)
├── catalogo.html            <- pagina secundaria: base de dados / revisao / backup
├── css/style.css              design system: preto e branco + verde-eco, tema claro/escuro
├── js/
│   ├── theme.js               tema claro/escuro (carregado no <head>, evita flash)
│   ├── format.js              formatacao de preco, score, data, bytes
│   ├── ui.js                  helpers de DOM, icones SVG, miniaturas, toasts, modal
│   ├── matcher.js             normalizacao e casamento model_key <-> base de benchmarks
│   ├── scoring.js             performance/preco por categoria + diagnostico de exclusao
│   ├── builder.js             algoritmo de montagem das builds
│   ├── render.js              renderizacao da UI de builds
│   ├── overrides.js           persistencia: decisoes, benchmarks, apelidos, ajustes, backup
│   ├── scrape-control.js      botao "Coletar dados agora" (fala com trigger_server.py)
│   ├── app.js                 orquestracao da pagina de builds
│   ├── catalog-state.js       estado + pontuacao em lote + esquemas de formulario
│   ├── review.js              painel de revisao de um produto
│   ├── benchdb.js             aba "Base de performance": navegar/editar benchmarks e ajustes
│   ├── backup.js              aba "Backup e exportacao"
│   └── catalog.js             orquestracao da pagina de base de dados
├── data/
│   ├── products.json          gerado pelo scraper
│   └── benchmarks.json        base de referencia de performance (CPU/GPU/chipsets/parametros)
└── scraper/
    ├── scrape_comprasparaguai.py
    ├── trigger_server.py      servidor local que liga o botao "Coletar dados agora" ao scraper
    ├── spec_extractor.py      extracao de specs por regex a partir do nome do produto
    ├── reextract_specs.py     reaplica a extracao sobre dados ja coletados, sem rede
    └── requirements.txt
```

## 1) Instalar as dependencias do scraper (uma vez)

```bash
cd HardwareScrapperPY/scraper
pip install -r requirements.txt
```

## 2) Abrir a pagina

Abra `index.html` com a extensao **Live Server** do VSCode (botao "Go Live" ou clique direito ->
"Open with Live Server"). A pagina le `data/products.json` e `data/benchmarks.json` via `fetch`,
por isso precisa ser servida por um servidor local -- abrir o arquivo direto pelo `file://` pode
bloquear o `fetch` dependendo do navegador.

Use a navegacao no topo para ir a **Base de dados** (`catalogo.html`) -- veja a secao abaixo.
O botao redondo ao lado da navegacao alterna **tema claro/escuro**; sem escolha explicita, a pagina
segue o tema do sistema operacional.

## 3) Coletar/atualizar os dados

Um navegador nao consegue executar um script Python sozinho (nao existe API JS para rodar
processos locais) -- por isso a coleta tem dois caminhos:

**Pelo botao "Coletar dados agora" (recomendado):** abra um segundo terminal e rode

```bash
cd HardwareScrapperPY/scraper
python trigger_server.py
```

e deixe essa janela aberta. Ela sobe um servidor local minimo (so biblioteca padrao do Python, sem
dependencias novas) em `http://127.0.0.1:8787`, que so aceita conexoes da propria maquina. Com ele
rodando, o botao no topo de `index.html` dispara a coleta, mostra o progresso ao vivo e recarrega a
pagina automaticamente quando termina. Se o botao mostrar "servidor nao encontrado", e porque esse
terminal nao esta rodando.

Na primeira vez (sem nenhum dado ainda), o botao mostra "Coletar dados agora". Depois que
`data/products.json` ja tem produtos, o mesmo botao vira **"Reiniciar coleta"**: clicar nele pede
confirmacao e, se confirmado, apaga `data/products.json` e coleta tudo de novo do zero. Se a nova
coleta falhar no meio do caminho, os dados antigos ja terao sido apagados (o log mostra
`[reiniciar] dados anteriores apagados`); rode a coleta de novo para preencher o arquivo outra vez.

> **Importante:** `trigger_server.py` e um processo Python de vida longa -- ele NAO recarrega o
> proprio codigo sozinho. Depois de atualizar os arquivos do projeto (`git pull`, uma correcao,
> etc.), pare o terminal onde ele esta rodando (`Ctrl+C`) e rode `python trigger_server.py` de
> novo antes de usar o botao.

**Pela linha de comando (alternativa/avancado):**

```bash
cd HardwareScrapperPY/scraper
python scrape_comprasparaguai.py

# so algumas categorias, para testar rapido
python scrape_comprasparaguai.py --categories cpu gpu --max-pages 3

# delay maior entre paginas (mais educado com o servidor)
python scrape_comprasparaguai.py --delay 1.0
```

Os dois caminhos percorrem `/processador/`, `/placa-mae/`, `/memoria-ram/`, `/placa-de-video/`,
`/fonte/` e `/hd-ssd/`, extraem nome/preco/specs de cada produto e sobrescrevem
`data/products.json`. Uma coleta completa faz algumas centenas de requisicoes com um pequeno delay
entre paginas -- leva alguns minutos.

### 3b) Reaplicar a extracao de specs sem raspar de novo

Nome e descricao de cada produto ja estao salvos em `data/products.json` -- as specs sao derivadas
deles por regex. Quando `spec_extractor.py` melhora, nao e preciso refazer a coleta inteira:

```bash
cd HardwareScrapperPY/scraper
python reextract_specs.py --dry-run   # mostra o que mudaria, sem gravar
python reextract_specs.py             # mostra e pergunta antes de gravar
```

O script lista campo a campo o que muda, separa "campos preenchidos que antes estavam vazios" de
"campos que ficaram vazios" (esse segundo grupo indica regressao numa regra nova) e grava um
backup em `data/products.json.bak` antes de escrever.

## Como funciona o pipeline

1. **Scraping (Python):** para cada categoria, o script pagina os resultados ate a lista vir
   vazia, extrai nome, preco em USD/BRL, numero de ofertas, imagem e link de cada produto.
2. **Extracao de specs (regex, Python):** a partir do nome do produto (unico dado estruturado
   disponivel), extrai soquete, chipset, capacidade, velocidade, wattagem, selo 80 PLUS,
   interface de armazenamento etc. Ver `scraper/spec_extractor.py`.
3. **Pontuacao de performance (JavaScript, no navegador):**
   - **CPU/GPU:** a `model_key` extraida (ex: `i5-12400`, `rtx 4060`) e casada contra
     `data/benchmarks.json`, que traz indices de performance aproximados inspirados em agregadores
     publicos (PassMark CPU Mark e PassMark G3D). Ver "Casamento de modelos" abaixo.
   - **RAM:** capacidade x velocidade (MT/s, ja comparavel entre geracoes DDR2/3/4/5 -- largura de
     banda = MT/s x 8 bytes, independente da geracao) x um fator de latencia real. Quando o anuncio
     informa o CAS Latency (CL), ele e convertido para nanossegundos (`ns = CL x 2000 / MT/s`, a
     unica forma correta de comparar timings entre geracoes DDR diferentes -- CL16 num DDR4-3200 e
     CL36 num DDR5-6000 tem latencias reais parecidas apesar do numero de CL ser bem diferente) e
     comparado contra uma referencia configuravel (`ram_scoring`). Sem CL no anuncio, o fator fica
     neutro.
   - **Fonte / Armazenamento:** formula direta sobre as specs (wattagem x eficiencia, capacidade x
     interface) -- ver `js/scoring.js`.
   - **Placa-Mae:** tier do chipset **x fator de plataforma** -- ver abaixo.
4. **TOP Custo-Beneficio por categoria:** maior indice performance/preco, descartando o quartil de
   performance mais fraco da categoria (para nao eleger sempre a peca mais fraca/barata).
5. **Montagem das builds (`js/builder.js`):** a partir de cada peca TOP, o algoritmo escolhe as
   outras 5 pecas pelo melhor indice de valor entre as opcoes **compativeis** (mesmo soquete
   CPU<->Placa-Mae, mesmo tipo de memoria RAM<->Placa-Mae, fonte com wattagem suficiente para
   CPU+GPU) e de **faixa de preco equivalente** (tier) a da peca ancora.
6. **RAM x plataforma:** a escolha da RAM tambem leva em conta `max_ram_mhz` do CPU/placa-mae
   escolhidos -- a velocidade tipica que aquela plataforma aproveita com folga para XMP/EXPO. Um
   kit rodando bem acima disso tem seu score reduzido proporcionalmente (`cappedRamScore` /
   `effectiveRamRank`) tanto na escolha da RAM quanto no indice de performance final da build --
   pagar por MHz que a plataforma nao usa e desperdicio de orcamento. RAM mais lenta que o
   recomendado nao e penalizada da mesma forma: ela ja pontua naturalmente mais baixo.
7. Builds identicas (quando duas ancoras convergem para o mesmo conjunto de pecas) sao mescladas.
   As restantes sao ranqueadas pelo indice de valor (performance ponderada / preco total) e a
   melhor e destacada no topo.

### Casamento de modelos (CPU/GPU) e apelidos

O casamento tenta, nesta ordem: **chave exata**, **apelido cadastrado pelo usuario** e
**similaridade textual** (coeficiente de Dice sobre bigramas).

A similaridade sozinha nao e confiavel para nomes de hardware, e por isso ela roda com duas travas
(`compatibleModel` em `js/matcher.js`):

- os **numeros** do modelo tem que ser identicos dos dois lados;
- os **sufixos** de modelo (`Ti`, `Super`, `XT`, `XTX`, `GRE`, `F`, `K`, `KF`, `X3D`, ...) tem que
  bater.

Sem essas travas, o Dice puro cruzava pares como `RTX 5050` -> `RTX 3050` (0,73), `i5-11400` ->
`i5-14400` (0,86), `Ryzen 5 4500` -> `Ryzen 5 5500` (0,82) e `i9-11900K` -> `i9-10900K` (0,75):
todos acima do limiar, todos com scores de PassMark muito diferentes, e todos silenciosos. Com as
travas, a similaridade so resolve o que ela resolve bem -- ruido de formatacao (`rtx4060` vs
`rtx 4060`) -- e o que sobra vira um item **pendente** com um caminho explicito para o usuario:
apontar um **apelido** para uma entrada existente, ou cadastrar uma entrada nova.

### Fator de plataforma da placa-mae

O score da placa-mae era `tier x 10` e mais nada, ou seja, cego a plataforma: uma B85 (LGA1150,
DDR3, teto no i7-4790) recebia a mesma nota de uma B550 (AM4, DDR4, teto no Ryzen 9 5950X) por
serem as duas "tier 2" -- e, custando um terco do preco, vencia o custo-beneficio da categoria e
ancorava a build inteira numa plataforma morta. O descarte do quartil mais fraco tambem nao ajudava:
com so quatro valores possiveis (10/20/30/40), quase nada cai fora dele.

Agora o score e `tier x 10 x fatorDePlataforma`, onde o fator e o **maior score de CPU que a base
conhece para aquele soquete**, normalizado pelo maior de todos. E uma medida direta do teto que a
placa destrava, nao exige nenhum campo novo em `benchmarks.json` e se atualiza sozinha conforme a
base de CPUs cresce. Soquetes sem nenhuma CPU na base (FM2+, LGA775) recebem o menor teto conhecido,
de proposito -- o fator neutro faria justamente a plataforma desconhecida liderar o indice de valor.

## Pagina "Base de Dados" (`catalogo.html`)

Tres abas.

### Aba "Produtos"

Lista todos os produtos raspados, com filtros por categoria, status e busca por nome, **ordenacao**
(indice de valor, desempenho, preco, nome) e paginacao incremental. O status exibido roda **a mesma
pontuacao em lote usada na pagina de builds**, entao um item nunca aparece como "Pontuado" aqui e de
fora das builds ao mesmo tempo.

Cada item mostra miniatura, specs legiveis, desempenho e indice de valor, e (quando aplicavel) uma
etiqueta indicando que o modelo casou por **similaridade** ou por **apelido** -- passe o mouse para
ver com qual entrada da base.

**Motivos de exclusao especificos.** Um item que nao pontua agora diz exatamente por que, em vez do
antigo "specs insuficientes / sem match na base" para tudo:

| Codigo | Significado | O que fazer |
| --- | --- | --- |
| `no_price` | anuncio sem preco valido em USD | ignorar |
| `missing_fields` | falta um campo especifico (a mensagem lista quais) | preencher no formulario |
| `no_benchmark` | modelo lido corretamente, mas ausente da base | apelido ou cadastro |
| `unknown_chipset` | nem chipset nem soquete reconhecidos | preencher soquete/chipset |
| `sodimm` | memoria de notebook | corrigir "Formato" se for falso positivo, senao ignorar |
| `price_outlier` | indice desempenho/preco fora do padrao da categoria | conferir o anuncio |

**Revisar qualquer item, nao so os pendentes.** O botao vira "Corrigir specs" para itens que ja
pontuam. Isso existe porque um SSD cuja capacidade o regex leu do codigo do modelo
(`KDS240G-L21` -> 240GB, quando o anuncio e de 480GB) pontuava normalmente, com o numero errado, e
nao havia tela nenhuma para corrigi-lo. Uma decisao ja salva reabre com os valores preenchidos, para
editar em vez de desfazer e recomecar.

**Apagar uma spec.** Campos de texto vazios e a opcao `(vazio)` nos seletores gravam `null`, que
sobrescreve o valor do scraper. Antes so dava para TROCAR um valor errado por outro, nunca remove-lo.

**Acoes em lote.** "Ignorar os N filtrados" e "Desfazer N decisoes" agem sobre exatamente o que o
filtro atual mostra -- a fila de pendentes tem centenas de itens e boa parte deles e a mesma decisao
repetida (todas as SO-DIMM de uma vez, por exemplo).

**Filtros especificos por categoria.** Com uma unica categoria selecionada e a aba "Pontuados"
ativa, aparecem filtros sobre campos que so aquela categoria tem: marca/soquete/nucleos (CPU),
soquete/tipo de RAM/tier (Placa-Mae), velocidade/capacidade/geracao/CL (RAM), marca/VRAM (GPU),
wattagem/selo (Fonte), interface/capacidade (Armazenamento).

**Itens com preco fora do padrao.** Um produto pode ficar de fora por ter indice desempenho/preco
muito acima do restante da categoria (`flagValueOutliers`, desvio absoluto mediano). Isso evita que
um erro de preco na fonte (um produto de US$ 200 listado por engano a US$ 10) distorca o TOP.
Confirmar o preco e uma acao **explicita e separada** de corrigir specs: o botao vira "Confirmar
preco e incluir". Antes, qualquer revisao dava essa isencao de brinde -- corrigir uma digitacao numa
spec desligava silenciosamente a protecao contra erro de preco naquele item.

### Aba "Base de performance"

Navegador e editor de `data/benchmarks.json`. Antes, a base curada era invisivel pela interface: so
dava para ver o que o usuario tinha cadastrado por cima dela.

- **Tabela** com processadores, placas de video e chipsets, marcando a origem de cada linha:
  `base` (so do arquivo), `editada` (o arquivo, com um valor seu por cima) ou `manual` (so sua).
  Busca por modelo/marca e um filtro "so minhas alteracoes".
- **Editar o score direto na linha.** Corrigir um valor errado da base curada agora e possivel --
  o formulario de revisao so aparecia quando NAO havia match, entao uma entrada existente mas
  equivocada nao tinha por onde ser consertada. Digitar o valor original de volta (ou esvaziar o
  campo) remove o override, em vez de gravar uma "edicao" identica ao arquivo.
- **Apelidos**: lista, com botao de remover, todos os `model_key -> chave da base` cadastrados.
- **Ajustes do modelo de pontuacao**: latencia de referencia da RAM e limites do multiplicador,
  multiplicadores de eficiencia de fonte, multiplicadores de interface de armazenamento e RAM
  maxima por soquete. Antes so davam para mudar editando o JSON na mao -- o que some num `git pull`
  e nao da para experimentar rapido. Campos alterados ficam destacados e mostram o padrao do arquivo
  no tooltip.

Toda entrada digitada passa por **validacao de faixa** antes de ser gravada (`validateBenchmarkEntry`
em `js/overrides.js`). O score e copiado a mao de um site externo: um "40000" com um zero a mais numa
CPU vira, sem aviso nenhum, a peca TOP de todas as builds. As faixas sao generosas -- servem para
pegar erro de digitacao, nao para julgar hardware.

### Aba "Backup e exportacao"

Tudo vive no `localStorage` do navegador, o que e comodo (nao exige backend) e fragil (limpar os
dados do site apaga meses de curadoria). Quatro saidas:

- **Baixar backup (.json)** -- formato desta pagina, versionado (`schema_version: 2`), para
  restaurar ou mesclar depois.
- **Exportar benchmarks.json mesclado** -- um `data/benchmarks.json` COMPLETO com suas entradas,
  edicoes, apelidos (convertidos em entradas reais, marcadas com `aliased_from`) e ajustes ja
  aplicados. **Este era o caminho que faltava na curadoria**: sem ele, o trabalho de cadastrar
  dezenas de modelos ficava preso no navegador -- sobrevivia a um F5, mas nao a uma troca de maquina
  nem virava parte do projeto. Substitua o arquivo do repositorio por ele e a curadoria passa a
  valer para qualquer maquina.
- **Exportar catalogo (.csv)** -- a lista pontuada inteira (separador `;` e BOM UTF-8, abre direto
  no Excel em portugues), para conferir numeros numa planilha.
- **Apagar todas as decisoes** -- reset explicito, atras de confirmacao.

**A importacao deixou de ser um merge cego.** A versao anterior mesclava dando prioridade ao arquivo
e so avisava "importado: N itens" -- se o arquivo fosse antigo, ele sobrescrevia revisoes locais mais
recentes sem dizer quais nem deixar desfazer. Agora o arquivo e analisado primeiro (`analyzeImport`,
sem gravar nada), uma tela mostra **novos / conflitos / ja iguais / invalidos** com a lista do que
sera tocado, e havendo conflito voce escolhe quem vence:

- **o arquivo importado** (comportamento antigo, para quando o backup e mais recente);
- **o que ja esta neste navegador** (so entram chaves novas; nada local se perde);
- **substituir tudo pelo arquivo** (apaga as decisoes locais antes de importar).

Entradas invalidas sao descartadas em qualquer modo, nunca gravadas. Backups no formato antigo (sem
`schema_version`) continuam sendo lidos normalmente.

### Onde as decisoes ficam salvas

Duas chaves no `localStorage`, separadas de proposito:

| Chave | Conteudo | Por que separada |
| --- | --- | --- |
| `hw-overrides-v1` | decisoes por produto (uma URL de anuncio) | some quando o catalogo e recoletado |
| `hw-benchmark-overrides-v1` | conhecimento sobre hardware: entradas, apelidos, ajustes | vale para qualquer anuncio do mesmo modelo e sobrevive a uma nova coleta |

As chaves seguem sendo `-v1` mesmo com o conteudo tendo ganhado campos novos: a leitura normaliza o
que encontrar, entao uma gaveta gravada pela versao anterior da pagina continua sendo lida sem
migracao nem perda de dados. A pagina de builds aplica tudo isso automaticamente a cada
carregamento, antes de rodar o pipeline. Como e por navegador, limpar os dados do site reseta --
por isso o backup.

## Atualizando a base de performance

`data/benchmarks.json` traz valores de referencia aproximados (nao um scrape ao vivo -- os sites de
benchmark carregam a tabela via JavaScript e nao expoem API publica estavel). Ha dois caminhos:

- **pela interface**, na aba "Base de performance" -- o mais pratico, e o resultado pode voltar para
  o repositorio pelo botao "Exportar benchmarks.json mesclado";
- **editando o arquivo**, consultando:
  - CPU: https://www.cpubenchmark.net/cpu_list.php
  - GPU: https://www.videocardbenchmark.net/gpu_list.php

Chipsets de placa-mae (incluindo `max_ram_mhz`), multiplicadores de eficiencia de fonte, de
interface de armazenamento e a referencia de latencia de RAM (`ram_scoring.reference_latency_ns`)
tambem estao nesse arquivo.
