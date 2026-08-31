<#
.SYNOPSIS
    Gera a pasta portatil do aplicativo em dist/HardwareScrapper/.

.DESCRIPTION
    Cria (ou reaproveita) um ambiente virtual em .venv-build, instala as
    dependencias la dentro e roda o PyInstaller com HardwareScrapper.spec.

    O venv separado existe para o build nao depender do que por acaso esteja
    instalado no Python do sistema: o PyInstaller empacota exatamente as
    bibliotecas que enxerga, entao um ambiente sujo vira um executavel
    inflado -- ou, pior, um que funciona nesta maquina e falha na de destino.

.PARAMETER Clean
    Apaga build/, dist/ e o venv antes de comecar. Use quando trocar de versao
    do Python ou quando o resultado der comportamento estranho.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File build.ps1
    powershell -ExecutionPolicy Bypass -File build.ps1 -Clean
#>
param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$VenvDir = Join-Path $PSScriptRoot ".venv-build"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$DistDir = Join-Path $PSScriptRoot "dist\HardwareScrapper"

function Write-Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Green
}

if ($Clean) {
    Write-Step "Limpando build anterior"
    foreach ($path in @("build", "dist", ".venv-build")) {
        if (Test-Path $path) {
            Remove-Item -Recurse -Force $path
            Write-Host "    removido: $path"
        }
    }
}

# --------------------------------------------------------------- ambiente ---

if (-not (Test-Path $VenvPython)) {
    Write-Step "Criando ambiente de build em .venv-build"
    $SystemPython = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $SystemPython) {
        throw "Python nao encontrado no PATH. Instale o Python 3.10+ e rode de novo."
    }
    & $SystemPython -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw "falha ao criar o ambiente virtual" }
}

Write-Step "Instalando dependencias"
& $VenvPython -m pip install --quiet --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "falha ao atualizar o pip" }
& $VenvPython -m pip install --quiet -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "falha ao instalar as dependencias" }

# ------------------------------------------------------------------ icone ---

Write-Step "Gerando o icone"
& $VenvPython assets\make_icon.py
if ($LASTEXITCODE -ne 0) { throw "falha ao gerar o icone" }

# ---------------------------------------------------------------- empacota ---

# O PyInstaller recria dist/HardwareScrapper do zero, e a pasta `dados` do
# usuario mora dentro dela. Quem estiver usando o app direto de dist/ (em vez de
# uma copia) perderia a curadoria inteira sem aviso nenhum.
$DataDir = Join-Path $DistDir "dados"
if (Test-Path $DataDir) {
    Write-Host ""
    Write-Host "ATENCAO: $DataDir ja existe e sera APAGADA por este build." -ForegroundColor Yellow
    Write-Host "         Ela contem os dados coletados e as suas decisoes de revisao."
    $answer = Read-Host "         Copie-a antes se precisar. Continuar assim mesmo? [s/N]"
    if ($answer -notin @("s", "S", "sim", "y", "Y")) {
        Write-Host "Cancelado -- nada foi apagado." -ForegroundColor Yellow
        exit 1
    }
}

Write-Step "Empacotando com o PyInstaller"
& $VenvPython -m PyInstaller --noconfirm --clean HardwareScrapper.spec
if ($LASTEXITCODE -ne 0) { throw "falha no PyInstaller" }

if (-not (Test-Path (Join-Path $DistDir "HardwareScrapper.exe"))) {
    throw "o PyInstaller terminou sem erro, mas HardwareScrapper.exe nao esta em $DistDir"
}

# ------------------------------------------------------------------ resumo ---

$SizeMb = [math]::Round(
    ((Get-ChildItem $DistDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB), 1
)

Write-Step "Pronto"
Write-Host "    pasta portatil: $DistDir"
Write-Host "    tamanho:        $SizeMb MB"
Write-Host ""
Write-Host "    Copie a pasta HardwareScrapper inteira para onde quiser e execute"
Write-Host "    HardwareScrapper.exe. A pasta 'dados' e criada ao lado dele na"
Write-Host "    primeira abertura e e onde tudo o que voce coleta e cura fica."
