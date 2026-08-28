# Builds de Custo-Beneficio — Comprasparaguai Informatica

Ferramenta que raspa os precos da categoria Informatica (componentes de PC) da
[comprasparaguai.com.br](https://www.comprasparaguai.com.br/informatica/), cruza com uma base de
performance de hardware e monta automaticamente ate 7 builds completas de PC, cada uma ancorada
no item "TOP Custo-Beneficio" de uma categoria (CPU, Placa-Mae, RAM, GPU, Fonte, Armazenamento).
A build de melhor custo-beneficio geral e destacada no topo.

Toda a analise (extracao de specs, calculo de performance/preco, escolha das pecas, montagem das
builds) e feita por codigo -- Python no scraper, JavaScript puro na pagina. Nenhuma etapa e manual.

## Estrutura

```
HardwareScrapperPY/
├── index.html              <- pagina principal: builds (abrir com Live Server)
├── catalogo.html            <- pagina secundaria: base de dados / revisao manual
├── css/style.css
├── js/
│   ├── format.js             formatacao de preco (compartilhado entre paginas)
│   ├── matcher.js             normalizacao de texto e casamento aproximado (fuzzy)
│   ├── scoring.js               performance/preco por categoria
│   ├── builder.js               algoritmo de montagem das builds
│   ├── render.js                 renderizacao da UI de builds
│   ├── overrides.js               decisoes manuais e benchmarks customizados (localStorage)
│   ├── scrape-control.js            botao "Coletar dados agora" (fala com trigger_server.py)
│   ├── app.js                        orquestracao da pagina de builds
│   └── catalog.js                     orquestracao da pagina de base de dados
├── data/
│   ├── products.json         gerado pelo scraper (nao versionar se o catalogo mudar muito)
│   └── benchmarks.json       base de referencia de performance (CPU/GPU/chipsets/etc)
└── scraper/
    ├── scrape_comprasparaguai.py
    ├── trigger_server.py     servidor local que liga o botao "Coletar dados agora" ao scraper
    ├── spec_extractor.py
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
por isso precisa ser servida por um servidor local (Live Server) -- abrir o arquivo direto pelo
`file://` pode bloquear o `fetch` dependendo do navegador.

Use a navegacao no topo da pagina para ir a **Base de dados** (`catalogo.html`) -- veja a secao
abaixo.

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
confirmacao e, se confirmado, apaga `data/products.json` e coleta tudo de novo do zero (em vez de
so atualizar por cima) -- util para descartar dados antigos/desatualizados antes de uma nova
coleta completa. Se a nova coleta falhar no meio do caminho, os dados antigos ja terao sido
apagados (o log mostra `[reiniciar] dados anteriores apagados`); rode a coleta de novo para
preencher `data/products.json` outra vez.

> **Importante:** `trigger_server.py` e um processo Python de vida longa -- ele NAO recarrega o
> proprio codigo sozinho. Depois de atualizar os arquivos do projeto (`git pull`, uma correcao,
> etc.), pare o terminal onde ele esta rodando (`Ctrl+C`) e rode `python trigger_server.py` de
> novo antes de usar o botao. Um terminal com a versao antiga ainda de pe pode responder aos
> endpoints de um jeito desatualizado (por exemplo, nao reconhecer `?reset=1` e devolver HTTP 404);
> o botao detecta esse erro e mostra a mensagem no log em vez de fingir que a coleta rodou.

**Pela linha de comando (alternativa/avancado):**

```bash
cd HardwareScrapperPY/scraper
python scrape_comprasparaguai.py

# so algumas categorias, para testar rapido
python scrape_comprasparaguai.py --categories cpu gpu --max-pages 3

# delay maior entre paginas (mais educado com o servidor)
python scrape_comprasparaguai.py --delay 1.0
```

Os dois caminhos fazem a mesma coisa: percorrem `/processador/`, `/placa-mae/`, `/memoria-ram/`,
`/placa-de-video/`, `/fonte/` e `/hd-ssd/` no site, extraem nome/preco/specs de cada produto e
sobrescrevem `data/products.json`. Uma coleta completa faz algumas centenas de requisicoes com um
pequeno delay entre paginas -- leva alguns minutos.

## Como funciona o pipeline

1. **Scraping (Python):** para cada categoria, o script pagina os resultados ate a lista vir
   vazia, extrai nome, preco em USD/BRL, numero de ofertas e link de cada produto.
2. **Extracao de specs (regex, Python):** a partir do nome do produto (unico dado estruturado
   disponivel), extrai soquete, chipset, capacidade, velocidade, wattagem, selo 80 PLUS,
   interface de armazenamento etc. Ver `scraper/spec_extractor.py`.
3. **Pontuacao de performance (JavaScript, no navegador):**
   - **CPU/GPU:** a `model_key` extraida (ex: `i5-12400`, `rtx 4060`) e casada contra
     `data/benchmarks.json`, que traz indices de performance aproximados, inspirados em
     agregadores publicos como PassMark CPU Mark e PassMark G3D (videocardbenchmark.net). Se nao
     houver chave exata, o casamento cai para similaridade textual (coeficiente de Dice sobre
     bigramas) respeitando a marca.
   - **RAM:** capacidade x velocidade (MT/s, ja comparavel entre geracoes DDR2/3/4/5 -- largura de
     banda = MT/s x 8 bytes, independente da geracao) x um fator de latencia real. Quando o anuncio
     informa o CAS Latency (CL), ele e convertido para nanossegundos (`ns = CL x 2000 / MT/s`, a
     unica forma correta de comparar timings entre geracoes DDR diferentes -- CL16 num DDR4-3200 e
     CL36 num DDR5-6000 tem latencias reais parecidas apesar do numero de CL ser bem diferente) e
     comparado contra uma referencia configuravel em `data/benchmarks.json` (`ram_scoring`). Sem CL
     no anuncio, o fator fica neutro (nem bonus nem penalidade).
   - **Fonte / Armazenamento / Placa-Mae:** performance calculada por formula direta sobre as specs
     (wattagem x eficiencia, capacidade x interface, tier de chipset) -- ver `js/scoring.js` para as
     formulas exatas.
4. **TOP Custo-Beneficio por categoria:** maior indice performance/preco, descartando o quartil de
   performance mais fraco da categoria (para nao eleger sempre a peca mais fraca/barata).
5. **Montagem das builds (`js/builder.js`):** a partir de cada peca TOP, o algoritmo escolhe as
   outras 5 pecas pelo melhor indice de valor entre as opcoes **compativeis** (mesmo soquete
   CPU<->Placa-Mae, mesmo tipo de memoria RAM<->Placa-Mae, fonte com wattagem suficiente para
   CPU+GPU) e de **faixa de preco equivalente** (tier) a da peca ancora.
6. **RAM x plataforma:** a escolha da RAM tambem leva em conta `max_ram_mhz` do CPU/placa-mae
   escolhidos (`data/benchmarks.json`) -- a velocidade tipica que aquela plataforma aproveita com
   folga para XMP/EXPO. Um kit rodando bem acima disso tem seu score reduzido proporcionalmente
   (`cappedRamScore`/`effectiveRamRank` em `js/builder.js`) tanto na hora de escolher a RAM quanto
   no indice de performance final da build -- pagar por MHz que a plataforma nao usa e desperdicio
   de orcamento, mesmo que a RAM isolada pareca um bom negocio. RAM mais lenta que o recomendado
   nao e penalizada da mesma forma: ela ja pontua naturalmente mais baixo (score e linear em
   MHz) e pode ser uma escolha legitima se o preco compensar.
7. Builds identicas (quando duas ancoras convergem para o mesmo conjunto de pecas) sao mescladas.
   As builds restantes sao ranqueadas pelo indice de valor (performance ponderada / preco total) e
   a melhor e destacada no topo da pagina.

## Pagina "Base de Dados" (`catalogo.html`)

Lista todos os produtos raspados de cada categoria, com filtros por categoria, status (pontuado /
pendente / adicionado manualmente / ignorado) e busca por nome. O status exibido aqui roda **a
mesma pontuacao em lote usada na pagina de builds** (incluindo o filtro de outliers de preco
descrito abaixo), entao um item nunca aparece como "Pontuado" aqui e de fora das builds ao mesmo
tempo. O foco principal e a fila de **itens pendentes**: produtos que o pipeline nao incluiu no
calculo automaticamente -- por preco invalido, specs nao reconhecidas no nome, nenhuma
correspondencia na base de benchmarks de CPU/GPU/chipset, ou indice desempenho/preco estatisticamente
fora do padrao da categoria (ver "Itens com preco fora do padrao" mais abaixo).

Para cada item pendente, o botao "Revisar item" abre um formulario com os campos daquela categoria
(ex: para CPU/GPU, marca + modelo; para RAM, capacidade/velocidade/geracao/formato; etc). Conforme
voce preenche, a pagina roda **a mesma funcao de pontuacao usada no pipeline principal**
(`js/scoring.js`) em tempo real e mostra se aquele conjunto de specs passa a ser pontuavel -- so
entao o botao "Adicionar a base" fica habilitado. Ou seja, o codigo continua sendo quem decide se
o item pontua; a revisao manual so corrige/completa os dados que o regex do scraper nao conseguiu
extrair do nome do produto (ou corrige falsos positivos, como uma memoria RAM identificada como
"de notebook" por engano).

Cada item tambem pode ser explicitamente **ignorado**, o que o exclui do calculo de builds mesmo
que ele viesse a se tornar pontuavel no futuro.

### Aba "Pontuados": score visivel e filtros especificos por categoria

Com a aba de status **"Pontuados"** ativa, cada card passa a mostrar a linha "Desempenho: ... ·
Indice de valor: ..." com o mesmo `perfScore`/`valueRatio` calculados por `js/scoring.js` --
o mesmo numero usado para escolher o "TOP Custo-Beneficio" e montar as builds.

Alem disso, ao selecionar **uma unica categoria** junto com "Pontuados", aparecem filtros extras
especificos daquele tipo de peca (definidos em `EXTRA_FILTER_SCHEMAS`, `js/catalog.js`), sobre
campos que so uma categoria tem:

- **CPU:** marca, nucleos (minimo).
- **Placa-Mae:** soquete, tipo de RAM suportado, tier (minimo).
- **RAM:** velocidade minima (MHz), geracao (DDR2-5), CAS Latency maxima.
- **GPU:** marca, VRAM minima (GB).
- **Fonte:** wattagem minima, selo 80 PLUS.
- **Armazenamento:** interface, capacidade minima (GB).

Esses filtros operam sobre as specs extraidas e sobre a performance ja calculada (nucleos, VRAM e
soquete resolvidos, por exemplo, so existem depois da pontuacao) -- por isso so aparecem com
"Pontuados" selecionado. Trocar de categoria limpa os filtros extras, ja que os campos mudam de um
tipo de peca para outro.

### Por que RAM nao mostra o bloco "Modelo nao encontrado na base de benchmarks"

Diferente de CPU, GPU e chipset de Placa-Mae, a **RAM nao e casada contra nenhuma tabela de
modelos** em `data/benchmarks.json` -- olhe `scoreRam` em `js/scoring.js`. A performance de um kit
de memoria e calculada direto por formula a partir de `capacity_gb`, `speed_mhz` e (se informado)
`cas_latency`, os mesmos campos que ja aparecem no formulario de revisao. Por isso, uma vez que
esses campos estejam preenchidos, o item pontua -- nao existe um "modelo desconhecido" para RAM
como existe para um Ryzen ou uma RTX cujo `model_key` nao bate com nada na base curada. O bloco de
cadastro de benchmark (`renderBenchmarkAddSection` em `js/catalog.js`) so e acionado para
`cpu`/`gpu`/`motherboard`, que sao as unicas categorias com esse tipo de dependencia.

Se um item de RAM continuar como **pendente** mesmo depois de preencher capacidade e velocidade, a
causa e outra: o anuncio foi identificado como memoria de notebook (SO-DIMM) -- corrija o campo
"Formato" para "DIMM" se for um falso positivo -- ou o item foi marcado como **outlier estatistico
de preco** (ver secao seguinte), que e um motivo diferente de "specs insuficientes" e aparece
explicado no proprio painel de revisao.

### Itens com preco fora do padrao ("outlier estatistico")

Alem de specs insuficientes, um produto (de qualquer categoria) pode ficar de fora do calculo de
builds por ter um indice desempenho/preco muito acima do restante da categoria --
`flagValueOutliers` em `js/scoring.js`, baseado em desvio absoluto mediano (MAD). Isso existe para
nao deixar um erro de preco na fonte (ex: um produto de US$ 200 listado por engano a US$ 10)
distorcer o "TOP Custo-Beneficio". Esses itens tambem aparecem como **pendentes** na pagina Base de
Dados, com uma mensagem especifica explicando o motivo (distinta da mensagem de "specs
insuficientes"). Se o preco do anuncio estiver realmente correto, use "Adicionar a base": isso
isenta aquele item do filtro de outlier dali em diante (ele passa a contar como confirmado
manualmente), sem precisar editar nenhuma spec.

Essas decisoes ficam salvas no `localStorage` do navegador (chave `hw-overrides-v1`) -- nao alteram
`data/products.json` nem exigem rodar o scraper de novo. A pagina de builds (`index.html`) aplica
essas decisoes automaticamente a cada carregamento, antes de rodar o pipeline de pontuacao. Como
tudo fica no navegador, as decisoes sao por maquina/navegador; limpar os dados do site as reseta.

### Backup: exportar e importar as decisoes

Como tudo fica no `localStorage`, um botao **"Baixar backup (.json)"** no topo da pagina Base de
Dados baixa um arquivo com todas as decisoes de produto e entradas de benchmark customizadas. O
botao **"Importar backup"** ao lado le um desses arquivos e **mescla** com o que ja estiver salvo
no navegador atual (em caso de conflito na mesma chave, o arquivo importado tem prioridade; nada
que ja estava salvo e apagado). Use isso para nao perder as decisoes ao limpar os dados do site,
para levar para outro navegador/maquina, ou simplesmente como backup.

### Cadastrando um modelo que nao esta na base de benchmarks

Ao revisar um CPU ou GPU cujo modelo nao bate com nada em `data/benchmarks.json` (ou uma Placa-Mae
com um chipset desconhecido), depois de preencher marca/modelo no formulario principal aparece um
segundo bloco destacado: **"Modelo nao encontrado na base de benchmarks"**. Ele traz:

- um termo de busca pronto (ex: `AMD Ryzen 5 8400F passmark cpu mark score`) com um link que abre
  a pesquisa numa nova aba -- aponta para o mesmo tipo de fonte usada para montar a base original
  (PassMark CPU Mark / G3D via cpubenchmark.net e videocardbenchmark.net para CPU/GPU);
- um campo para digitar o score de performance encontrado (e, para CPU, soquete/nucleos; para GPU,
  TDP estimado; para chipset de placa-mae, tier de 1 a 4 e tipo de memoria suportado);
- um botao **"Salvar no benchmarks"**.

Ao salvar, a entrada vai para uma segunda chave no `localStorage`
(`hw-benchmark-overrides-v1`, separada das decisoes por produto) e passa a valer para **qualquer**
produto raspado com aquela mesma model_key/chipset dali em diante -- nao so o item que estava sendo
revisado. A pagina de builds tambem aplica essas entradas automaticamente. Todas as entradas
cadastradas ficam listadas (com botao para remover) no final da pagina Base de Dados.

## Atualizando a base de performance

`data/benchmarks.json` traz valores de referencia aproximados (nao um scrape ao vivo -- os sites
de benchmark carregam a tabela via JavaScript e nao expoem API publica estavel). Para refinar,
edite os campos `score` de `cpu`/`gpu` consultando diretamente:

- CPU: https://www.cpubenchmark.net/cpu_list.php
- GPU: https://www.videocardbenchmark.net/gpu_list.php

Chipsets de placa-mae (incluindo `max_ram_mhz`, a velocidade de RAM tipica daquela plataforma),
multiplicadores de eficiencia de fonte, de interface de armazenamento e a referencia de latencia de
RAM (`ram_scoring.reference_latency_ns`) tambem estao nesse arquivo e podem ser ajustados
livremente.
