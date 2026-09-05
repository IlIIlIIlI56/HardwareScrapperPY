# Desenvolvimento

Documentação técnica do HardwareScrapper: arquitetura, como rodar a partir do código-fonte, como
gerar as builds de release e como o algoritmo de pontuação/montagem funciona por dentro.

Se você só quer usar o app, veja o [README.md](README.md) — lá tem o link de download e as
instruções de uso.

## Rodar pelo código-fonte

Para desenvolver não é preciso empacotar a cada mudança:

```bash
python -m pip install -r requirements.txt
python app.py                # abre a janela, lendo os arquivos direto do repositorio
python app.py --debug        # o mesmo, com o DevTools da janela habilitado
python app.py --headless     # so o servidor local; imprime a URL para abrir num navegador
```

`--headless` é o modo mais confortável para mexer em CSS e JavaScript: a página roda num navegador
de verdade, com DevTools completo, falando com o mesmo servidor local que o app usa.

Rodando do código-fonte, a pasta `dados/` é criada na raiz do projeto -- mesma lógica, mesmo
comportamento, sem um "modo de desenvolvimento" separado.

## Gerar as builds de release

Só é necessário para quem vai modificar o projeto -- quem só quer usar baixa da página de Releases.

### Automatizado (GitHub Actions)

`.github/workflows/release.yml` builda Windows e Android em paralelo e publica os dois artefatos
numa Release, disparado ao empurrar uma tag `vX.Y.Z`:

```bash
# depois de atualizar APP_VERSION em app.py e versionName/versionCode em
# android/app/build.gradle.kts para o mesmo numero (troque v1.2.0 pela versao de verdade):
git tag v1.2.0
git push origin v1.2.0
```

**Sempre confira o número da versão antes de criar a tag.** Ele é mantido à mão em **dois** arquivos
independentes — `APP_VERSION` em `app.py` e `versionName`/`versionCode` em
`android/app/build.gradle.kts` — e o workflow não mexe em nenhum dos dois: ele só deriva o nome dos
artefatos da tag. Taguear com os arquivos desatualizados publica pacotes chamados `1.3.0` contendo um
app que se reporta como `1.2.1`, e a divergência só aparece no rodapé depois de publicada.

Com o botão "Buscar atualizações" isso deixou de ser cosmético: um app que se acha mais antigo do que
é fica oferecendo eternamente uma versão que já está instalada — e no Android, onde a instalação é
automática, o usuário não sai desse laço sozinho. Por isso o job `versoes` do `release.yml` falha o
build quando qualquer um dos dois arquivos não bate com a tag. Ele é a rede de segurança, não a
substituição da conferência.

Dá para rodar o workflow manualmente pela aba **Actions** (`workflow_dispatch`) sem empurrar tag
nenhuma -- ele builda os dois artefatos e disponibiliza para download ali mesmo, mas só publica uma
Release de verdade quando o gatilho foi uma tag.

A assinatura do APK Android usa 4 secrets do repositório (`ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), configurados em
**Settings → Secrets and variables → Actions**. A keystore de assinatura em si nunca entra no
repositório -- só o conteúdo dela, codificado em base64, guardado como secret.

**Cuidado ao mexer nas tags depois de publicadas.** Apagar e recriar uma tag `vX.Y.Z` que já tem uma
Release por trás também apaga a Release (e os arquivos anexados a ela) -- não é só o ponteiro do
commit que muda. Se precisar corrigir o commit de uma tag antiga, prefira recriar a Release na mão
pela interface do GitHub depois, em vez de assumir que ela sobrevive à troca.

O job `android` roda num runner Linux e precisa do bit de execução em `android/gradlew`. Um clone ou
commit feito no Windows pode perdê-lo (`core.filemode` costuma vir `false` por lá), e nesse caso o
job falha logo no primeiro passo com "Process completed with exit code 126". Confira com
`git ls-files -s android/gradlew` -- o modo tem que começar com `100755`, não `100644`; se estiver
errado, `git update-index --chmod=+x android/gradlew` conserta.

### Windows, manual

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

O script cria um ambiente virtual isolado em `.venv-build`, instala as dependências, gera o ícone e
empacota tudo em `dist/HardwareScrapper/`. Use `-Clean` para refazer do zero.

O ambiente separado existe para o build não depender do que por acaso esteja instalado no Python do
sistema: o PyInstaller empacota exatamente as bibliotecas que enxerga, então um ambiente sujo vira um
executável inflado -- ou, pior, um que funciona na máquina de quem compilou e falha na de destino.

#### Uma build baixada não é o mesmo arquivo que você acabou de compilar

Tudo que sai de um `.zip` baixado pelo navegador herda a "marca da web": um fluxo alternativo NTFS
chamado `Zone.Identifier`, com `ZoneId=3` ("Internet"), que o extrator do Explorer propaga para cada
arquivo extraído. O .NET Framework **se recusa a carregar um assembly** de um arquivo marcado assim
(`Assembly.LoadFrom` levanta `FileLoadException`, HRESULT 0x80131515), e o pywebview depende do .NET:
ele faz `clr.AddReference` nos assemblies do WebView2 em `_internal/webview/lib/`.

O resultado não se parece nada com a causa. O app abre e funciona -- mas a janela é do Edge em modo
`--app` (o fallback do `app.py`), com o `<title>` cru da página como legenda, o favicon no lugar do
ícone, e um `HardwareScrapper.exe` órfão que fica vivo sem janela nenhuma e precisa ser fechado pelo
Gerenciador de Tarefas. Isso custou três releases e duas correções erradas, porque **não dá para
reproduzir recompilando localmente**: uma árvore recém-compilada nasce sem a marca, não importa a
versão do Python, do PyInstaller ou o commit.

O `app.py` agora limpa esse fluxo da própria pasta `_internal/` antes de importar o `webview`, e o
caminho de fallback grava o traceback em `dados/erros.log`. A lição geral vale para qualquer
depuração daqui em diante: **numa build `console=False` do PyInstaller não existe stdout nem stderr**,
então todo `print` num caminho de erro é invisível por construção -- nunca diagnostique uma falha de
build empacotada por `print`. E se um bug só aparece no artefato publicado, confira
`Get-Item <arquivo> -Stream Zone.Identifier` antes de desconfiar do build.

### Android, manual

Requer [Android Studio](https://developer.android.com/studio) (com o SDK do Android configurado) e
um Python 3.14 instalado na máquina de build (usado só para resolver os pacotes do `pip` do
Chaquopy -- não é o que vai para o celular). Abra a pasta `android/` como projeto no Android Studio
(não a raiz do repositório) e deixe a primeira sincronização do Gradle rodar, ou pela linha de
comando:

```bash
cd android
./gradlew assembleDebug     # gera um APK de teste, sem assinatura de release
./gradlew assembleRelease   # exige android/keystore.properties (ver abaixo) -- gera o APK assinado
```

Para gerar um APK de release localmente (fora do GitHub Actions), crie `android/keystore.properties`
(ignorado pelo git) apontando para uma keystore sua:

```properties
storeFile=C:/caminho/para/sua-keystore.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Sem uma keystore ainda? Gere uma com o `keytool` que acompanha qualquer JDK (inclusive o do próprio
Android Studio, em `<pasta de instalação>/jbr/bin/keytool.exe`):

```bash
keytool -genkeypair -v -keystore sua-keystore.jks -alias seu-alias \
  -keyalg RSA -keysize 2048 -validity 10000
```

**Guarde essa keystore com cuidado e nunca a perca**: o Android trata um APK assinado com uma chave
diferente como um app diferente, então perder a keystore significa que ninguém consegue atualizar por
cima de uma instalação já existente -- só desinstalar e instalar de novo, perdendo os dados do app.

#### Por que as falhas do Windows não têm equivalente aqui

Uma pergunta que vale responder de uma vez, porque a resposta explica o desenho dos dois lados: os
quatro problemas que o app Windows teve (janela nativa que não abria, ícone genérico, título errado e
processos órfãos) **não se propagam para o Android** -- e não por sorte.

- **A marca da web não existe neste caminho.** Ela depende de três coisas que são todas do Windows:
  fluxo alternativo NTFS, o carregador de assemblies do .NET Framework e o backend WinForms do
  pywebview. Aqui o APK é instalado pelo instalador do sistema, que valida assinatura em vez de
  procedência de download, e a WebView é nativa do Android -- não há assembly nenhum para ser
  recusado.
- **A falha silenciosa, que era o verdadeiro habilitador, é justamente onde o Android está melhor.**
  No Windows o aviso de erro ia para um `print` que numa build `console=False` não tem para onde ir.
  O Chaquopy redireciona o `stdout`/`stderr` do Python para o logcat, então aqui `print` aparece. Os
  `catch` do `MainActivity.kt` registram com `Log.e` **e** devolvem a mensagem de erro para o JS, em
  vez de um booleano que esconderia o motivo. E `startBackend()` não tem `try/catch` nenhum de
  propósito: se o backend falhar, o app quebra alto, com stack trace, em vez de degradar em silêncio
  para um estado que parece funcionar.
- **Instância única já vem de duas fontes.** `android:launchMode="singleTask"` no manifesto impede
  uma segunda Activity, e o guard em `android_entry.start()` devolve a URL do servidor já em pé caso
  `onCreate` rode de novo no mesmo processo (rotação de tela, por exemplo) -- em vez de subir um
  segundo servidor numa porta nova. No Windows isso precisou de um Mutex nomeado, escrito à mão.
- **Não há título de janela para errar.** O rótulo vem do `android:label` do manifesto, não do
  `<title>` da página.

A lição que sobra, essa sim compartilhada: quando a interface é a mesma HTML nas duas plataformas, um
erro de plataforma pode se disfarçar de erro de interface. Antes de mexer no HTML/CSS/JS por causa de
um sintoma visual que só acontece numa das duas, confirme primeiro **de quem é a janela** que está na
tela.

## Estrutura do projeto

```
HardwareScrapperPY/
├── app.py                   <- ponto de entrada Windows: prepara dados/, sobe o servidor, abre a janela
├── build.ps1                   gera dist/HardwareScrapper/ (a pasta portátil)
├── HardwareScrapper.spec       receita do PyInstaller
├── requirements.txt
├── .github/workflows/
│   └── release.yml            builda Windows + Android e publica os dois numa Release, por tag
├── appcore/
│   ├── paths.py               recursos (só leitura) x dados do usuário (escrita)
│   ├── server.py              servidor local: interface + API, na mesma origem
│   ├── scrape_job.py          a coleta em segundo plano, com cancelamento
│   ├── updater.py             checagem de nova versao no GitHub (e, no Android, o
│   │                          download do APK) -- ver "Atualizacoes" abaixo
│   ├── bootstrap.py           sequência de boot do backend, compartilhada Windows/Android
│   └── android_entry.py       ponto de entrada Android: chamado pelo Kotlin via Chaquopy
├── android/                    projeto Gradle/Kotlin do app Android (Chaquopy embarca este
│                                mesmo backend Python); ver "Gerar as builds de release" acima
├── assets/
│   ├── make_icon.py           gera o ícone do Windows por código, sem dependências
│   ├── make_android_icons.py  gera os ícones do launcher Android com o mesmo desenho
│   └── icon.ico
├── index.html               <- página "Análise": builds automáticas
├── catalogo.html            <- página "Database": revisão / benchmarks / backup
├── build.html               <- página "Build": montagem manual, uma peça de cada vez
├── css/style.css              design system: preto e branco + verde-eco, tema claro/escuro
├── js/
│   ├── app-bridge.js          ponte com o Python (e, no Android, com o Kotlin): API, HWStore,
│   │                          exportações, compartilhamento de arquivo
│   ├── app-chrome.js          rodapé do app: versão e acesso à pasta de dados
│   ├── theme.js               tema claro/escuro (carregado no head, evita flash)
│   ├── format.js              formatação de preço, score, data, bytes
│   ├── ui.js                  helpers de DOM, ícones SVG, miniaturas, toasts, modal, menu suspenso,
│   │                          clipboard
│   ├── matcher.js             normalização e casamento model_key <-> base de benchmarks
│   ├── scoring.js             performance/preço por categoria + diagnóstico de exclusão
│   ├── builder.js             algoritmo de montagem automática das builds
│   ├── render.js              renderização da UI de builds (página Análise)
│   ├── overrides.js           persistência: decisões, benchmarks, apelidos, ajustes, backup
│   ├── scrape-control.js      painel "Coletar dados agora"
│   ├── updater.js             botao "Buscar atualizacoes" do rodape
│   ├── app.js                 orquestração da página Análise
│   ├── catalog-state.js       estado + pontuação em lote + esquemas de formulário
│   ├── review.js              painel de revisão de um produto
│   ├── benchdb.js             aba "Base de performance": navegar/editar benchmarks e ajustes
│   ├── backup.js              aba "Backup e exportação"
│   ├── catalog.js             orquestração da página Database
│   └── pc-builder.js          orquestração da página Build (montagem manual)
├── data/                       SEMENTE que acompanha o app -- não é onde você lê/escreve
│   └── benchmarks.json           base de performance, copiada para dados/ no primeiro uso
├── dados/                      seus dados (criada no primeiro uso; fora do controle de versão)
└── scraper/
    ├── scrape_comprasparaguai.py
    ├── spec_extractor.py      extração de specs por regex a partir do nome do produto
    ├── reextract_specs.py     reaplica a extração sobre dados já coletados, sem rede
    └── requirements.txt
```

### Por que `data/` e `dados/` são pastas diferentes

Um app portátil tem duas árvores de arquivos que não podem ser a mesma. `data/` são os arquivos que
**acompanham o programa** e podem ser substituídos a cada atualização; `dados/` é o que **pertence a
quem usa** e precisa sobreviver a elas. Na primeira abertura, o que estiver faltando em `dados/` é
copiado de `data/` -- e nunca o contrário, então uma versão nova do app jamais sobrescreve um
`benchmarks.json` que você já editou.

## Como a coleta funciona por dentro

Um navegador não pode executar um script Python (não existe API JS para rodar processos locais), e a
versão anterior desta ferramenta resolvia isso pedindo ao usuário que mantivesse **dois** processos
de pé: o Live Server do VSCode servindo os arquivos, e um `trigger_server.py` numa segunda janela de
terminal atendendo o botão de coleta. Eram três coisas para acertar antes de ver qualquer build, e o
botão falhava com "servidor não encontrado" toda vez que o segundo terminal era esquecido.

O aplicativo é um processo só. Ele sobe um servidor local que serve **a interface e a API na mesma
origem**, e a coleta roda numa thread dele -- se a janela abriu, o Python que raspa está rodando. A
porta é sorteada pelo sistema a cada abertura, então duas cópias do app nunca brigam por ela.

Esse servidor escuta apenas em `127.0.0.1` e exige um token, sorteado a cada execução e entregue só
para a própria página. Sem isso, qualquer site aberto no computador poderia varrer as portas locais e
disparar coletas ou descobrir o caminho dos seus arquivos.

### Linha de comando (depuração)

Os scripts do scraper continuam funcionando sozinhos, para testar uma mudança no regex sem abrir a
janela. Eles escrevem na mesma pasta `dados/` que o app lê:

```bash
python scraper/scrape_comprasparaguai.py

# so algumas categorias, para testar rapido
python scraper/scrape_comprasparaguai.py --categories cpu gpu --max-pages 3

# delay maior entre paginas (mais educado com o servidor)
python scraper/scrape_comprasparaguai.py --delay 1.0
```

### Reaplicar a extração de specs sem raspar de novo

Nome e descrição de cada produto já estão salvos em `dados/products.json` -- as specs são derivadas
deles por regex. Quando `spec_extractor.py` melhora, não é preciso refazer a coleta inteira:

```bash
python scraper/reextract_specs.py --dry-run   # mostra o que mudaria, sem gravar
python scraper/reextract_specs.py             # mostra e pergunta antes de gravar
```

O script lista campo a campo o que muda, separa "campos preenchidos que antes estavam vazios" de
"campos que ficaram vazios" (esse segundo grupo indica regressão numa regra nova) e grava um
backup em `dados/products.json.bak` antes de escrever.

## Como funciona o pipeline

1. **Scraping (Python):** para cada categoria, o script pagina os resultados até a lista vir
   vazia, extrai nome, preço em USD/BRL, número de ofertas, imagem e link de cada produto.
2. **Extração de specs (regex, Python):** a partir do nome do produto (único dado estruturado
   disponível), extrai soquete, chipset, capacidade, velocidade, wattagem, selo 80 PLUS,
   interface de armazenamento etc. Ver `scraper/spec_extractor.py`.
3. **Pontuação de performance (JavaScript, na janela do app):**
   - **CPU/GPU:** a `model_key` extraída (ex: `i5-12400`, `rtx 4060`) é casada contra
     `dados/benchmarks.json`, que traz índices de performance aproximados inspirados em agregadores
     públicos (PassMark CPU Mark e PassMark G3D). Ver "Casamento de modelos" abaixo.
   - **RAM:** capacidade x velocidade (MT/s, já comparável entre gerações DDR2/3/4/5 -- largura de
     banda = MT/s x 8 bytes, independente da geração) x um fator de latência real. Quando o anúncio
     informa o CAS Latency (CL), ele é convertido para nanossegundos (`ns = CL x 2000 / MT/s`, a
     única forma correta de comparar timings entre gerações DDR diferentes -- CL16 num DDR4-3200 e
     CL36 num DDR5-6000 têm latências reais parecidas apesar do número de CL ser bem diferente) e
     comparado contra uma referência configurável (`ram_scoring`). Sem CL no anúncio, o fator fica
     neutro.
   - **Fonte / Armazenamento:** fórmula direta sobre as specs (wattagem x eficiência, capacidade x
     interface) -- ver `js/scoring.js`.
   - **Placa-Mãe:** tier do chipset **x fator de plataforma** -- ver abaixo.
4. **TOP Custo-Benefício por categoria:** maior índice performance/preço, descartando o quartil de
   performance mais fraco da categoria (para não eleger sempre a peça mais fraca/barata).
5. **Montagem das builds (`js/builder.js`):** a partir de cada peça TOP, o algoritmo escolhe as
   outras 5 peças pelo melhor índice de valor entre as opções **compatíveis** (mesmo soquete
   CPU<->Placa-Mãe, mesmo tipo de memória RAM<->Placa-Mãe, fonte com wattagem suficiente para
   CPU+GPU) e de **faixa de preço equivalente** (tier) à da peça âncora.
6. **RAM x plataforma:** a escolha da RAM também leva em conta `max_ram_mhz` do CPU/placa-mãe
   escolhidos -- a velocidade típica que aquela plataforma aproveita com folga para XMP/EXPO. Um
   kit rodando bem acima disso tem seu score reduzido proporcionalmente (`cappedRamScore` /
   `effectiveRamRank`) tanto na escolha da RAM quanto no índice de performance final da build --
   pagar por MHz que a plataforma não usa é desperdício de orçamento. RAM mais lenta que o
   recomendado não é penalizada da mesma forma: ela já pontua naturalmente mais baixo.
7. Builds idênticas (quando duas âncoras convergem para o mesmo conjunto de peças) são mescladas.
   As restantes são ranqueadas pelo índice de valor (performance ponderada / preço total) e a
   melhor é destacada no topo.

### Casamento de modelos (CPU/GPU) e apelidos

O casamento tenta, nesta ordem: **chave exata**, **apelido cadastrado pelo usuário** e
**similaridade textual** (coeficiente de Dice sobre bigramas).

A similaridade sozinha não é confiável para nomes de hardware, e por isso ela roda com duas travas
(`compatibleModel` em `js/matcher.js`):

- os **números** do modelo têm que ser idênticos dos dois lados;
- os **sufixos** de modelo (`Ti`, `Super`, `XT`, `XTX`, `GRE`, `F`, `K`, `KF`, `X3D`, ...) têm que
  bater.

Sem essas travas, o Dice puro cruzava pares como `RTX 5050` -> `RTX 3050` (0,73), `i5-11400` ->
`i5-14400` (0,86), `Ryzen 5 4500` -> `Ryzen 5 5500` (0,82) e `i9-11900K` -> `i9-10900K` (0,75):
todos acima do limiar, todos com scores de PassMark muito diferentes, e todos silenciosos. Com as
travas, a similaridade só resolve o que ela resolve bem -- ruído de formatação (`rtx4060` vs
`rtx 4060`) -- e o que sobra vira um item **pendente** com um caminho explícito para o usuário:
apontar um **apelido** para uma entrada existente, ou cadastrar uma entrada nova.

### Fator de plataforma da placa-mãe

O score da placa-mãe era `tier x 10` e mais nada, ou seja, cego à plataforma: uma B85 (LGA1150,
DDR3, teto no i7-4790) recebia a mesma nota de uma B550 (AM4, DDR4, teto no Ryzen 9 5950X) por
serem as duas "tier 2" -- e, custando um terço do preço, vencia o custo-benefício da categoria e
ancorava a build inteira numa plataforma morta. O descarte do quartil mais fraco também não ajudava:
com só quatro valores possíveis (10/20/30/40), quase nada cai fora dele.

Agora o score é `tier x 10 x fatorDePlataforma`, onde o fator é o **maior score de CPU que a base
conhece para aquele soquete**, normalizado pelo maior de todos. É uma medida direta do teto que a
placa destrava, não exige nenhum campo novo em `benchmarks.json` e se atualiza sozinha conforme a
base de CPUs cresce. Soquetes sem nenhuma CPU na base (FM2+, LGA775) recebem o menor teto conhecido,
de propósito -- o fator neutro faria justamente a plataforma desconhecida liderar o índice de valor.

## Página "Database" (`catalogo.html`)

Três abas.

### Aba "Produtos"

Lista todos os produtos raspados, com filtros por categoria, status e busca por nome, **ordenação**
(índice de valor, desempenho, preço, nome) e paginação incremental. O status exibido roda **a mesma
pontuação em lote usada na página de builds**, então um item nunca aparece como "Pontuado" aqui e de
fora das builds ao mesmo tempo.

Cada item mostra miniatura, specs legíveis, desempenho e índice de valor, e (quando aplicável) uma
etiqueta indicando que o modelo casou por **similaridade** ou por **apelido** -- passe o mouse para
ver com qual entrada da base.

**Motivos de exclusão específicos.** Um item que não pontua agora diz exatamente por que, em vez do
antigo "specs insuficientes / sem match na base" para tudo:

| Código | Significado | O que fazer |
| --- | --- | --- |
| `no_price` | anúncio sem preço válido em USD | ignorar |
| `missing_fields` | falta um campo específico (a mensagem lista quais) | preencher no formulário |
| `no_benchmark` | modelo lido corretamente, mas ausente da base | apelido ou cadastro |
| `unknown_chipset` | nem chipset nem soquete reconhecidos | preencher soquete/chipset |
| `sodimm` | memória de notebook | corrigir "Formato" se for falso positivo, senão ignorar |
| `price_outlier` | índice desempenho/preço fora do padrão da categoria | conferir o anúncio |

**Revisar qualquer item, não só os pendentes.** O botão vira "Corrigir specs" para itens que já
pontuam. Isso existe porque um SSD cuja capacidade o regex leu do código do modelo
(`KDS240G-L21` -> 240GB, quando o anúncio é de 480GB) pontuava normalmente, com o número errado, e
não havia tela nenhuma para corrigi-lo. Uma decisão já salva reabre com os valores preenchidos, para
editar em vez de desfazer e recomeçar.

**Apagar uma spec.** Campos de texto vazios e a opção `(vazio)` nos seletores gravam `null`, que
sobrescreve o valor do scraper. Antes só dava para TROCAR um valor errado por outro, nunca removê-lo.

**Ações em lote.** "Ignorar os N filtrados" e "Desfazer N decisões" agem sobre exatamente o que o
filtro atual mostra -- a fila de pendentes tem centenas de itens e boa parte deles é a mesma decisão
repetida (todas as SO-DIMM de uma vez, por exemplo).

**Filtros específicos por categoria.** Com uma única categoria selecionada e a aba "Pontuados"
ativa, aparecem filtros sobre campos que só aquela categoria tem: marca/soquete/núcleos (CPU),
soquete/tipo de RAM/tier (Placa-Mãe), velocidade/capacidade/geração/CL (RAM), marca/VRAM (GPU),
wattagem/selo (Fonte), interface/capacidade (Armazenamento).

**Itens com preço fora do padrão.** Um produto pode ficar de fora por ter índice desempenho/preço
muito acima do restante da categoria (`flagValueOutliers`, desvio absoluto mediano). Isso evita que
um erro de preço na fonte (um produto de US$ 200 listado por engano a US$ 10) distorça o TOP.
Confirmar o preço é uma ação **explícita e separada** de corrigir specs: o botão vira "Confirmar
preço e incluir". Antes, qualquer revisão dava essa isenção de brinde -- corrigir uma digitação numa
spec desligava silenciosamente a proteção contra erro de preço naquele item.

### Aba "Base de performance"

Navegador e editor de `dados/benchmarks.json`. Antes, a base curada era invisível pela interface: só
dava para ver o que o usuário tinha cadastrado por cima dela.

- **Tabela** com processadores, placas de vídeo e chipsets, marcando a origem de cada linha:
  `base` (só do arquivo), `editada` (o arquivo, com um valor seu por cima) ou `manual` (só sua).
  Busca por modelo/marca e um filtro "só minhas alterações".
- **Editar o score direto na linha.** Corrigir um valor errado da base curada agora é possível --
  o formulário de revisão só aparecia quando NÃO havia match, então uma entrada existente mas
  equivocada não tinha por onde ser consertada. Digitar o valor original de volta (ou esvaziar o
  campo) remove o override, em vez de gravar uma "edição" idêntica ao arquivo.
- **Apelidos**: lista, com botão de remover, todos os `model_key -> chave da base` cadastrados.
- **Ajustes do modelo de pontuação**: latência de referência da RAM e limites do multiplicador,
  multiplicadores de eficiência de fonte, multiplicadores de interface de armazenamento e RAM
  máxima por soquete. Antes só davam para mudar editando o JSON na mão -- o que some num `git pull`
  e não dá para experimentar rápido. Campos alterados ficam destacados e mostram o padrão do arquivo
  no tooltip.

Toda entrada digitada passa por **validação de faixa** antes de ser gravada (`validateBenchmarkEntry`
em `js/overrides.js`). O score é copiado à mão de um site externo: um "40000" com um zero a mais numa
CPU vira, sem aviso nenhum, a peça TOP de todas as builds. As faixas são generosas -- servem para
pegar erro de digitação, não para julgar hardware.

### Aba "Backup e exportação"

Tudo vive em `dados/decisoes.json`. Quatro saídas:

- **Gerar backup (.json)** -- formato desta página, versionado (`schema_version: 2`), para
  restaurar ou mesclar depois.
- **Exportar benchmarks.json mesclado** -- um `benchmarks.json` COMPLETO com suas entradas,
  edições, apelidos (convertidos em entradas reais, marcadas com `aliased_from`) e ajustes já
  aplicados. **Este era o caminho que faltava na curadoria**: sem ele, o trabalho de cadastrar
  dezenas de modelos ficava preso na gaveta de decisões, sem nunca virar a base propriamente dita.
  Copie-o por cima de `dados/benchmarks.json` e a curadoria passa a valer mesmo depois de um
  "apagar todas as decisões", e já numa instalação nova.
- **Exportar catálogo (.csv)** -- a lista pontuada inteira (separador `;` e BOM UTF-8, abre direto
  no Excel em português), para conferir números numa planilha.
- **Apagar todas as decisões** -- reset explícito, atrás de confirmação.

Dentro do aplicativo esses arquivos não são "baixados": a janela não tem barra de downloads, então
eles são gravados em `dados/exportacoes/` e o botão **"Abrir pasta de exportações"**, ao lado, leva
você até lá. Um download comum deixaria a pasta de Downloads -- fora da pasta portátil, que é
justamente de onde a curadoria não deveria escapar.

**A importação deixou de ser um merge cego.** A versão anterior mesclava dando prioridade ao arquivo
e só avisava "importado: N itens" -- se o arquivo fosse antigo, ele sobrescrevia revisões locais mais
recentes sem dizer quais nem deixar desfazer. Agora o arquivo é analisado primeiro (`analyzeImport`,
sem gravar nada), uma tela mostra **novos / conflitos / já iguais / inválidos** com a lista do que
será tocado, e havendo conflito você escolhe quem vence:

- **o arquivo importado** (comportamento antigo, para quando o backup é mais recente);
- **o que já está gravado aqui** (só entram chaves novas; nada local se perde);
- **substituir tudo pelo arquivo** (apaga as decisões locais antes de importar).

Entradas inválidas são descartadas em qualquer modo, nunca gravadas. Backups no formato antigo (sem
`schema_version`) continuam sendo lidos normalmente.

### Onde as decisões ficam salvas

Em `dados/decisoes.json`, sob duas chaves separadas de propósito:

| Chave | Conteúdo | Por que separada |
| --- | --- | --- |
| `hw-overrides-v1` | decisões por produto (uma URL de anúncio) | some quando o catálogo é recoletado |
| `hw-benchmark-overrides-v1` | conhecimento sobre hardware: entradas, apelidos, ajustes | vale para qualquer anúncio do mesmo modelo e sobrevive a uma nova coleta |

As chaves seguem sendo `-v1` mesmo com o conteúdo tendo ganhado campos novos: a leitura normaliza o
que encontrar, então uma gaveta gravada por uma versão anterior continua sendo lida sem migração nem
perda de dados. A página de builds aplica tudo isso automaticamente a cada carregamento, antes de
rodar o pipeline.

**Por que um arquivo e não o `localStorage`.** Até a versão anterior essas duas chaves viviam no
`localStorage`, que era a única opção num site estático. Num aplicativo isso seria uma armadilha
silenciosa: o motor da janela separa o `localStorage` **por origem**, e a origem inclui a porta --
que o servidor local sorteia a cada abertura, justamente para nunca brigar por uma porta fixa. Meses
de curadoria evaporariam a cada vez que o app fosse fechado e reaberto, sem erro nenhum na tela. Num
arquivo dentro de `dados/`, elas ainda ganham o que importa num app portátil: viajam junto quando a
pasta é copiada, entram no backup por um Ctrl+C na pasta, e não esbarram na cota de ~5 MB.

## Página "Build" (`build.html`)

Enquanto "Análise" monta builds sozinha e "Database" é sobre curadoria, "Build" é para quem
quer escolher cada peça na mão: um assistente de 6 etapas, na ordem **CPU > Placa-Mãe > RAM > GPU >
Armazenamento > Fonte**.

Cada etapa lista as peças **já pontuadas** daquela categoria (as mesmas usadas em "Análise") e, por
padrão, só mostra as que são compatíveis com o que já foi escolhido nas etapas anteriores -- mesmo
soquete (CPU/placa-mãe), mesmo tipo de memória (RAM/placa-mãe) e wattagem mínima de fonte (calculada
a partir da CPU e da GPU escolhidas, pela mesma fórmula de `js/builder.js`). Escolher uma peça abre
a próxima etapa em aberto automaticamente; reabrir uma etapa já preenchida permite trocar a peça, e
se isso tornar uma escolha posterior incompatível, ela é desfeita com um aviso.

O checkbox **"Filtrar por compatibilidade"** desliga essas restrições -- a lista passa a mostrar
qualquer peça da categoria. Nesse caso, se a combinação final tiver um problema real, a build atual
mostra um **aviso laranja** (reaproveitando o estilo do painel de builds automáticas) explicando
exatamente qual é o problema (soquete, memória ou fonte), em vez de um alerta genérico.

A build em andamento é salva automaticamente (em `dados/decisoes.json`, sob a chave
`hw-pcbuild-draft-v1`) -- fechar o app no meio de uma montagem não perde o progresso. Com as 6 peças
escolhidas, **"Salvar build"** guarda uma cópia nomeada (chave `hw-pcbuild-saved-v1`) na lista de
builds salvas, de onde dá para **carregar de volta** para continuar editando, **excluir**, ou
**Compartilhar** -- um menu com duas saídas para o mesmo `.txt` (nome, preço e link de cada peça):

- **Baixar Lista (.txt)** -- no Windows grava em `dados/exportacoes/` (ou baixa pelo navegador, fora
  do app); no Android o rótulo vira "Enviar lista (.txt)" e abre o menu nativo de compartilhamento do
  sistema, porque ali a pasta do app é privada e nenhum gerenciador de arquivos a alcança.
- **Copiar para Clipboard** -- o mesmo conteúdo direto na área de transferência, em qualquer
  plataforma.

## Atualizações ("Buscar atualizações", no rodapé)

O botão consulta a API de releases do GitHub e compara com a versão do app. Ele checa sozinho uma vez
a cada 24h ao abrir — em silêncio, sem modal e sem mostrar erro de rede — e nesse caso apenas fica
destacado se houver versão nova. O resultado é guardado em `dados/atualizacao.json`: sem esse cache,
trocar de aba gastaria três das 60 consultas por hora que o GitHub permite sem autenticação, porque o
rodapé existe nas três páginas.

**O comportamento é diferente nas duas plataformas de propósito.**

No **Windows** o app só avisa: o modal mostra o que mudou e leva à página de download. Não há troca
automática de arquivos, e a razão é que ela não pagaria o próprio custo. O zip do CI é gerado com
`Compress-Archive -Path "dist/HardwareScrapper"`, então ele contém uma pasta raiz com apenas o `.exe`
e `_internal/` — extrair por cima da pasta do app substitui exatamente esses dois itens e **não pode**
tocar em `dados/`, que nem existe no pacote. O caminho manual já é seguro; automatizá-lo compraria
heurística de antivírus (um executável não assinado que baixa e substitui outro executável), locks de
DLL do processo vivo, um ajudante externo para esperar o processo morrer e lógica de rollback — tudo
rodando na máquina de outra pessoa, sem telemetria.

No **Android** o app baixa o APK e chama o instalador do sistema. Ali não existe alternativa: um APK
sideloaded não tem loja atrás dele. O instalador faz a troca e `filesDir/dados` sobrevive por garantia
da plataforma. Três detalhes que precisam andar juntos:

- o APK vai para `cacheDir/atualizacao/`, **não** para `dados/`. O `FileProvider` é estreito de
  propósito, e um `files-path` largo o bastante para alcançar `dados/` exporia a curadoria inteira;
- `res/xml/file_paths.xml`, o `UPDATE_DIR` de `MainActivity.kt` e o `download_dir` passado ao Python
  apontam para a mesma pasta. Se um deles mudar sem os outros, `getUriForFile` lança
  `IllegalArgumentException`;
- o app precisa de `REQUEST_INSTALL_PACKAGES` e da liberação do usuário em Configurações
  (`canRequestPackageInstalls()`). A volta dessa tela não tem callback confiável, então o botão
  simplesmente recheca a permissão no clique seguinte.

**Armadilha da assinatura.** Um APK instalado a partir de `assembleDebug` usa a chave de debug e o
Android **recusa** instalar por cima dele o APK de release do CI (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
A única saída é desinstalar, o que apaga `filesDir/dados` — a curadoria inteira. O modal avisa isso
antes, mas vale lembrar ao testar: para validar o fluxo de instalação de verdade são necessárias duas
releases assinadas com a **mesma** keystore.

**Testando sem publicar uma release.** A variável de ambiente `HW_UPDATE_REPO` troca o repositório
consultado (`dono/repo`), o que permite exercitar "tem atualização", "não tem" e o parsing sem tocar
no repositório de verdade.

## Atualizando a base de performance

`dados/benchmarks.json` traz valores de referência aproximados (não um scrape ao vivo -- os sites de
benchmark carregam a tabela via JavaScript e não expõem API pública estável). Há dois caminhos:

- **pela interface**, na aba "Base de performance" -- o mais prático, e o resultado vira o próprio
  arquivo pelo botão "Exportar benchmarks.json mesclado";
- **editando o arquivo direto**, consultando:
  - CPU: https://www.cpubenchmark.net/cpu_list.php
  - GPU: https://www.videocardbenchmark.net/gpu_list.php

Chipsets de placa-mãe (incluindo `max_ram_mhz`), multiplicadores de eficiência de fonte, de
interface de armazenamento e a referência de latência de RAM (`ram_scoring.reference_latency_ns`)
também estão nesse arquivo.
