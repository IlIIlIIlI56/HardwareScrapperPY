# Builds de Custo-Beneficio — Comprasparaguai Informatica

Aplicativo portatil para Windows que raspa os precos da categoria Informatica (componentes de PC) da
[comprasparaguai.com.br](https://www.comprasparaguai.com.br/informatica/), cruza com uma base de
performance de hardware e monta automaticamente ate 7 builds completas de PC, cada uma ancorada
no item "TOP Custo-Beneficio" de uma categoria (CPU, Placa-Mae, RAM, GPU, Fonte, Armazenamento).
A build de melhor custo-beneficio geral e destacada no topo.

Toda a analise (extracao de specs, calculo de performance/preco, escolha das pecas, montagem das
builds) e feita por codigo -- Python na coleta, JavaScript puro na interface. Nenhuma etapa e manual.
A revisao humana existe so para **corrigir dados de entrada** que o regex nao conseguiu extrair do
nome do anuncio; quem decide se um item pontua continua sendo o mesmo codigo, sempre.

## Como usar

Copie a pasta `HardwareScrapper` para onde quiser e execute **`HardwareScrapper.exe`**. E so isso:
nao ha instalador, nao ha Python para instalar, nada e gravado no registro nem em `%APPDATA%`.

Na primeira abertura o app cria uma pasta **`dados`** ao lado do executavel e a janela abre vazia,
com o botao **"Coletar dados agora"** em destaque. A coleta percorre as seis categorias de
componentes, mostra o progresso ao vivo e recarrega a tela sozinha quando termina -- sao algumas
centenas de requisicoes com um pequeno intervalo entre paginas, entao leva alguns minutos. Da para
**cancelar** no meio: nada e gravado, e a base anterior fica intacta.

Depois que ja existem dados, o mesmo botao vira **"Reiniciar coleta"**, que refaz tudo do zero.

```
HardwareScrapper/
├── HardwareScrapper.exe      <- duplo clique
├── _internal/                  Python, bibliotecas e a interface, empacotados
└── dados/                      criada no primeiro uso -- e tudo o que e SEU
    ├── products.json             produtos coletados
    ├── benchmarks.json           base de performance (semeada, depois sua)
    ├── decisoes.json             suas revisoes, apelidos e ajustes
    ├── exportacoes/              backups e CSVs gerados pela aba de backup
    └── perfil-janela/            cache da janela
```

**A pasta `dados` e o backup.** Copiar a pasta `HardwareScrapper` inteira leva junto os precos
coletados e toda a curadoria -- para outra maquina, para um pendrive, para onde for. Nada fica para
tras, porque nada e gravado fora dela.

### Requisitos

Windows 10 ou 11 com o **WebView2 Runtime**, que ja vem instalado por padrao desde 2021 (e o mesmo
motor do Edge). Se por acaso faltar, o app abre a interface numa janela do Edge em modo aplicativo e
continua funcionando igual. Nenhuma outra dependencia.

## Gerar o executavel

So e necessario para quem vai modificar o projeto -- quem so quer usar recebe a pasta pronta.

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

O script cria um ambiente virtual isolado em `.venv-build`, instala as dependencias, gera o icone e
empacota tudo em `dist/HardwareScrapper/`. Use `-Clean` para refazer do zero.

O ambiente separado existe para o build nao depender do que por acaso esteja instalado no Python do
sistema: o PyInstaller empacota exatamente as bibliotecas que enxerga, entao um ambiente sujo vira um
executavel inflado -- ou, pior, um que funciona na maquina de quem compilou e falha na de destino.

## Rodar pelo codigo-fonte

Para desenvolver nao e preciso empacotar a cada mudanca:

```bash
python -m pip install -r requirements.txt
python app.py                # abre a janela, lendo os arquivos direto do repositorio
python app.py --debug        # o mesmo, com o DevTools da janela habilitado
python app.py --headless     # so o servidor local; imprime a URL para abrir num navegador
```

`--headless` e o modo mais confortavel para mexer em CSS e JavaScript: a pagina roda num navegador
de verdade, com DevTools completo, falando com o mesmo servidor local que o app usa.

Rodando do codigo-fonte, a pasta `dados/` e criada na raiz do projeto -- mesma logica, mesmo
comportamento, sem um "modo de desenvolvimento" separado.

## Estrutura do projeto

```
HardwareScrapperPY/
├── app.py                   <- ponto de entrada: prepara dados/, sobe o servidor, abre a janela
├── build.ps1                   gera dist/HardwareScrapper/ (a pasta portatil)
├── HardwareScrapper.spec       receita do PyInstaller
├── requirements.txt
├── appcore/
│   ├── paths.py               recursos (so leitura) x dados do usuario (escrita)
│   ├── server.py              servidor local: interface + API, na mesma origem
│   └── scrape_job.py          a coleta em segundo plano, com cancelamento
├── assets/
│   ├── make_icon.py           gera o icone por codigo, sem dependencias
│   └── icon.ico
├── index.html               <- pagina "Analise": builds automaticas
├── catalogo.html            <- pagina "Base de dados": revisao / benchmarks / backup
├── build.html               <- pagina "Build": montagem manual, uma peca de cada vez
├── css/style.css              design system: preto e branco + verde-eco, tema claro/escuro
├── js/
│   ├── app-bridge.js          ponte com o Python: API, HWStore, exportacoes
│   ├── app-chrome.js          rodape do app: versao e acesso a pasta de dados
│   ├── theme.js               tema claro/escuro (carregado no head, evita flash)
│   ├── format.js              formatacao de preco, score, data, bytes
│   ├── ui.js                  helpers de DOM, icones SVG, miniaturas, toasts, modal
│   ├── matcher.js             normalizacao e casamento model_key <-> base de benchmarks
│   ├── scoring.js             performance/preco por categoria + diagnostico de exclusao
│   ├── builder.js             algoritmo de montagem automatica das builds
│   ├── render.js              renderizacao da UI de builds (pagina Analise)
│   ├── overrides.js           persistencia: decisoes, benchmarks, apelidos, ajustes, backup
│   ├── scrape-control.js      painel "Coletar dados agora"
│   ├── app.js                 orquestracao da pagina Analise
│   ├── catalog-state.js       estado + pontuacao em lote + esquemas de formulario
│   ├── review.js              painel de revisao de um produto
│   ├── benchdb.js             aba "Base de performance": navegar/editar benchmarks e ajustes
│   ├── backup.js              aba "Backup e exportacao"
│   ├── catalog.js             orquestracao da pagina Base de dados
│   └── pc-builder.js          orquestracao da pagina Build (montagem manual)
├── data/                       SEMENTE que acompanha o app -- nao e onde voce le/escreve
│   └── benchmarks.json           base de performance, copiada para dados/ no primeiro uso
├── dados/                      seus dados (criada no primeiro uso; fora do controle de versao)
└── scraper/
    ├── scrape_comprasparaguai.py
    ├── spec_extractor.py      extracao de specs por regex a partir do nome do produto
    ├── reextract_specs.py     reaplica a extracao sobre dados ja coletados, sem rede
    └── requirements.txt
```

### Por que `data/` e `dados/` sao pastas diferentes

Um app portatil tem duas arvores de arquivos que nao podem ser a mesma. `data/` sao os arquivos que
**acompanham o programa** e podem ser substituidos a cada atualizacao; `dados/` e o que **pertence a
quem usa** e precisa sobreviver a elas. Na primeira abertura, o que estiver faltando em `dados/` e
copiado de `data/` -- e nunca o contrario, entao uma versao nova do app jamais sobrescreve um
`benchmarks.json` que voce ja editou.

## Como a coleta funciona por dentro

Um navegador nao pode executar um script Python (nao existe API JS para rodar processos locais), e a
versao anterior desta ferramenta resolvia isso pedindo ao usuario que mantivesse **dois** processos
de pe: o Live Server do VSCode servindo os arquivos, e um `trigger_server.py` numa segunda janela de
terminal atendendo o botao de coleta. Eram tres coisas para acertar antes de ver qualquer build, e o
botao falhava com "servidor nao encontrado" toda vez que o segundo terminal era esquecido.

O aplicativo e um processo so. Ele sobe um servidor local que serve **a interface e a API na mesma
origem**, e a coleta roda numa thread dele -- se a janela abriu, o Python que raspa esta rodando. A
porta e sorteada pelo sistema a cada abertura, entao duas copias do app nunca brigam por ela.

Esse servidor escuta apenas em `127.0.0.1` e exige um token, sorteado a cada execucao e entregue so
para a propria pagina. Sem isso, qualquer site aberto no computador poderia varrer as portas locais e
disparar coletas ou descobrir o caminho dos seus arquivos.

### Linha de comando (depuracao)

Os scripts do scraper continuam funcionando sozinhos, para testar uma mudanca no regex sem abrir a
janela. Eles escrevem na mesma pasta `dados/` que o app le:

```bash
python scraper/scrape_comprasparaguai.py

# so algumas categorias, para testar rapido
python scraper/scrape_comprasparaguai.py --categories cpu gpu --max-pages 3

# delay maior entre paginas (mais educado com o servidor)
python scraper/scrape_comprasparaguai.py --delay 1.0
```

### Reaplicar a extracao de specs sem raspar de novo

Nome e descricao de cada produto ja estao salvos em `dados/products.json` -- as specs sao derivadas
deles por regex. Quando `spec_extractor.py` melhora, nao e preciso refazer a coleta inteira:

```bash
python scraper/reextract_specs.py --dry-run   # mostra o que mudaria, sem gravar
python scraper/reextract_specs.py             # mostra e pergunta antes de gravar
```

O script lista campo a campo o que muda, separa "campos preenchidos que antes estavam vazios" de
"campos que ficaram vazios" (esse segundo grupo indica regressao numa regra nova) e grava um
backup em `dados/products.json.bak` antes de escrever.

## Como funciona o pipeline

1. **Scraping (Python):** para cada categoria, o script pagina os resultados ate a lista vir
   vazia, extrai nome, preco em USD/BRL, numero de ofertas, imagem e link de cada produto.
2. **Extracao de specs (regex, Python):** a partir do nome do produto (unico dado estruturado
   disponivel), extrai soquete, chipset, capacidade, velocidade, wattagem, selo 80 PLUS,
   interface de armazenamento etc. Ver `scraper/spec_extractor.py`.
3. **Pontuacao de performance (JavaScript, na janela do app):**
   - **CPU/GPU:** a `model_key` extraida (ex: `i5-12400`, `rtx 4060`) e casada contra
     `dados/benchmarks.json`, que traz indices de performance aproximados inspirados em agregadores
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

Navegador e editor de `dados/benchmarks.json`. Antes, a base curada era invisivel pela interface: so
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

Tudo vive em `dados/decisoes.json`. Quatro saidas:

- **Gerar backup (.json)** -- formato desta pagina, versionado (`schema_version: 2`), para
  restaurar ou mesclar depois.
- **Exportar benchmarks.json mesclado** -- um `benchmarks.json` COMPLETO com suas entradas,
  edicoes, apelidos (convertidos em entradas reais, marcadas com `aliased_from`) e ajustes ja
  aplicados. **Este era o caminho que faltava na curadoria**: sem ele, o trabalho de cadastrar
  dezenas de modelos ficava preso na gaveta de decisoes, sem nunca virar a base propriamente dita.
  Copie-o por cima de `dados/benchmarks.json` e a curadoria passa a valer mesmo depois de um
  "apagar todas as decisoes", e ja numa instalacao nova.
- **Exportar catalogo (.csv)** -- a lista pontuada inteira (separador `;` e BOM UTF-8, abre direto
  no Excel em portugues), para conferir numeros numa planilha.
- **Apagar todas as decisoes** -- reset explicito, atras de confirmacao.

Dentro do aplicativo esses arquivos nao sao "baixados": a janela nao tem barra de downloads, entao
eles sao gravados em `dados/exportacoes/` e o botao **"Abrir pasta de exportacoes"**, ao lado, leva
voce ate la. Um download comum deixaria a pasta de Downloads -- fora da pasta portatil, que e
justamente de onde a curadoria nao deveria escapar.

**A importacao deixou de ser um merge cego.** A versao anterior mesclava dando prioridade ao arquivo
e so avisava "importado: N itens" -- se o arquivo fosse antigo, ele sobrescrevia revisoes locais mais
recentes sem dizer quais nem deixar desfazer. Agora o arquivo e analisado primeiro (`analyzeImport`,
sem gravar nada), uma tela mostra **novos / conflitos / ja iguais / invalidos** com a lista do que
sera tocado, e havendo conflito voce escolhe quem vence:

- **o arquivo importado** (comportamento antigo, para quando o backup e mais recente);
- **o que ja esta gravado aqui** (so entram chaves novas; nada local se perde);
- **substituir tudo pelo arquivo** (apaga as decisoes locais antes de importar).

Entradas invalidas sao descartadas em qualquer modo, nunca gravadas. Backups no formato antigo (sem
`schema_version`) continuam sendo lidos normalmente.

### Onde as decisoes ficam salvas

Em `dados/decisoes.json`, sob duas chaves separadas de proposito:

| Chave | Conteudo | Por que separada |
| --- | --- | --- |
| `hw-overrides-v1` | decisoes por produto (uma URL de anuncio) | some quando o catalogo e recoletado |
| `hw-benchmark-overrides-v1` | conhecimento sobre hardware: entradas, apelidos, ajustes | vale para qualquer anuncio do mesmo modelo e sobrevive a uma nova coleta |

As chaves seguem sendo `-v1` mesmo com o conteudo tendo ganhado campos novos: a leitura normaliza o
que encontrar, entao uma gaveta gravada por uma versao anterior continua sendo lida sem migracao nem
perda de dados. A pagina de builds aplica tudo isso automaticamente a cada carregamento, antes de
rodar o pipeline.

**Por que um arquivo e nao o `localStorage`.** Ate a versao anterior essas duas chaves viviam no
`localStorage`, que era a unica opcao num site estatico. Num aplicativo isso seria uma armadilha
silenciosa: o motor da janela separa o `localStorage` **por origem**, e a origem inclui a porta --
que o servidor local sorteia a cada abertura, justamente para nunca brigar por uma porta fixa. Meses
de curadoria evaporariam a cada vez que o app fosse fechado e reaberto, sem erro nenhum na tela. Num
arquivo dentro de `dados/`, elas ainda ganham o que importa num app portatil: viajam junto quando a
pasta e copiada, entram no backup por um Ctrl+C na pasta, e nao esbarram na cota de ~5 MB.

## Pagina "Build" (`build.html`)

Enquanto "Analise" monta builds sozinha e "Base de dados" e sobre curadoria, "Build" e para quem
quer escolher cada peca na mao: um assistente de 6 etapas, na ordem **CPU > Placa-Mae > RAM > GPU >
Armazenamento > Fonte**.

Cada etapa lista as pecas **ja pontuadas** daquela categoria (as mesmas usadas em "Analise") e, por
padrao, so mostra as que sao compativeis com o que ja foi escolhido nas etapas anteriores -- mesmo
soquete (CPU/placa-mae), mesmo tipo de memoria (RAM/placa-mae) e wattagem minima de fonte (calculada
a partir da CPU e da GPU escolhidas, pela mesma formula de `js/builder.js`). Escolher uma peca abre
a proxima etapa em aberto automaticamente; reabrir uma etapa ja preenchida permite trocar a peca, e
se isso tornar uma escolha posterior incompativel, ela e desfeita com um aviso.

O checkbox **"Filtrar por compatibilidade"** desliga essas restricoes -- a lista passa a mostrar
qualquer peca da categoria. Nesse caso, se a combinacao final tiver um problema real, a build atual
mostra um **aviso laranja** (reaproveitando o estilo do painel de builds automaticas) explicando
exatamente qual e o problema (soquete, memoria ou fonte), em vez de um alerta generico.

A build em andamento e salva automaticamente (em `dados/decisoes.json`, sob a chave
`hw-pcbuild-draft-v1`) -- fechar o app no meio de uma montagem nao perde o progresso. Com as 6 pecas
escolhidas, **"Salvar build"** guarda uma copia nomeada (chave `hw-pcbuild-saved-v1`) na lista de
builds salvas, de onde da para **baixar a lista** (um `.txt` com nome, preco e link de cada peca,
gravado em `dados/exportacoes/`), **carregar de volta** para continuar editando, ou **excluir**.

## Atualizando a base de performance

`dados/benchmarks.json` traz valores de referencia aproximados (nao um scrape ao vivo -- os sites de
benchmark carregam a tabela via JavaScript e nao expoem API publica estavel). Ha dois caminhos:

- **pela interface**, na aba "Base de performance" -- o mais pratico, e o resultado vira o proprio
  arquivo pelo botao "Exportar benchmarks.json mesclado";
- **editando o arquivo direto**, consultando:
  - CPU: https://www.cpubenchmark.net/cpu_list.php
  - GPU: https://www.videocardbenchmark.net/gpu_list.php

Chipsets de placa-mae (incluindo `max_ram_mhz`), multiplicadores de eficiencia de fonte, de
interface de armazenamento e a referencia de latencia de RAM (`ram_scoring.reference_latency_ns`)
tambem estao nesse arquivo.
