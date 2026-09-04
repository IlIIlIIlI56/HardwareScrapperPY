import java.util.Properties

plugins {
    id("com.android.application")
    // Sem plugin Kotlin separado: AGP 9.0+ compila .kt nativamente (built-in
    // Kotlin support), e o plugin classico nao e mais compativel com isso.
    id("com.chaquo.python")
}

// Segredos da assinatura de release NUNCA ficam no build.gradle.kts nem no
// git -- vem de android/keystore.properties (ignorado pelo git), que por sua
// vez aponta para a keystore de verdade fora do repositorio. Sem esse
// arquivo (num clone novo, por exemplo), a assinatura de release fica
// ausente e so a build debug funciona -- nao trava o projeto inteiro.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("keystore.properties")
val hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystoreProperties.load(keystorePropertiesFile.inputStream())
}

android {
    namespace = "com.eemovel.hardwarescrapper"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.eemovel.hardwarescrapper"
        minSdk = 24
        targetSdk = 34
        versionCode = 4
        versionName = "1.2.1"

        ndk {
            // Python 3.14 do Chaquopy so existe para estes dois -- armeabi-v7a
            // (ARM 32-bit) nao e mais publicado, e e raro em aparelhos atuais.
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                // rootProject.file (nao file()) para um caminho relativo em
                // keystore.properties resolver a partir de android/, nao de
                // android/app/ -- e o que o workflow de CI usa (a keystore
                // decodificada vai para android/release.jks).
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
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
        // (`python app.py` usa 3.14). Chaquopy tambem precisa de um Python
        // desta versao DISPONIVEL NA MAQUINA DE BUILD (nao no celular) para
        // resolver os pacotes do pip abaixo -- por padrao ele tenta
        // "py -3.14", depois "python" no PATH, o que basta no runner Linux
        // do CI (actions/setup-python coloca o Python certo la). Nesta
        // maquina Windows especifica isso falhava (nem "py" nem "python" no
        // PATH que o processo do Gradle enxerga), entao so aqui forcamos o
        // caminho absoluto do interpretador.
        version = "3.14"
        if (System.getProperty("os.name").lowercase().contains("windows")) {
            buildPython("C:/Users/ratan/AppData/Local/Python/pythoncore-3.14-64/python.exe")
        }

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
