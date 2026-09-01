plugins {
    id("com.android.application")
    // Sem plugin Kotlin separado: AGP 9.0+ compila .kt nativamente (built-in
    // Kotlin support), e o plugin classico nao e mais compativel com isso.
    id("com.chaquo.python")
}

android {
    namespace = "com.eemovel.hardwarescrapper"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.eemovel.hardwarescrapper"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        ndk {
            // Python 3.14 do Chaquopy so existe para estes dois -- armeabi-v7a
            // (ARM 32-bit) nao e mais publicado, e e raro em aparelhos atuais.
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    // Sob o built-in Kotlin support (AGP 9.0+), o jvmTarget do Kotlin herda
    // deste targetCompatibility automaticamente -- nao precisa de um bloco
    // kotlin{ compilerOptions { ... } } separado so para repetir o mesmo 17.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// A configuracao do codigo-fonte Python do Chaquopy fica num bloco proprio
// (chaquopy.sourceSets), NAO dentro de android.sourceSets -- diferente do que
// a doc do Chaquopy sugeriria por analogia com sourceSets comuns do Android.
// Fonte unica de verdade: o backend Python e a interface HTML/CSS/JS
// empacotados aqui sao os MESMOS arquivos que o build Windows usa (raiz do
// repo, dois niveis acima deste arquivo) -- nao copias dentro de android/. So
// appcore/, scraper/, data/, css/, js/ e os tres .html da raiz importam; o
// resto (git, artefatos do PyInstaller, a propria pasta android/, dados/ do
// usuario) e excluido para nao inchar o APK nem criar uma referencia circular
// com o proprio build do Android.
chaquopy {
    defaultConfig {
        // Python embarcado no APK: mesma serie que o app Windows ja roda
        // (`python app.py` nesta maquina usa 3.14). Chaquopy tambem precisa
        // de um Python desta versao DISPONIVEL NA MAQUINA DE BUILD (nao no
        // celular) para resolver os pacotes do pip abaixo. O launcher `py`
        // fica no PATH do usuario, mas nao no PATH que o processo do Gradle
        // enxerga -- por isso o caminho absoluto do interpretador.
        version = "3.14"
        buildPython("C:/Users/ratan/AppData/Local/Python/pythoncore-3.14-64/python.exe")

        pip {
            // Pacotes puro-Python (scraper usa o "html.parser" do stdlib,
            // nao o lxml, entao nao ha dependencia nativa a resolver).
            install("requests")
            install("beautifulsoup4")
        }
    }

    sourceSets {
        getByName("main") {
            srcDir("../..")
            exclude("android/**")
            exclude(".git/**")
            exclude(".venv-build/**")
            exclude("build/**")
            exclude("dist/**")
            exclude("dados/**")
            exclude("**/__pycache__/**")
            exclude("*.spec")
            exclude("*.ps1")
            exclude("*.md")
            exclude("requirements.txt")
            exclude(".gitignore")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
