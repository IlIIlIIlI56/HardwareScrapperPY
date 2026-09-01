plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
            // Chaquopy so publica o interpretador embarcado para estes ABIs.
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }

        python {
            pip {
                // Pacotes puro-Python (scraper usa o "html.parser" do stdlib,
                // nao o lxml, entao nao ha dependencia nativa a resolver).
                install("requests")
                install("beautifulsoup4")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            // Fonte unica de verdade: o backend Python e a interface
            // HTML/CSS/JS empacotados aqui sao os MESMOS arquivos que o build
            // Windows usa (raiz do repo, dois niveis acima deste arquivo) --
            // nao copias dentro de android/. So appcore/, scraper/, data/,
            // css/, js/ e os tres .html da raiz importam; o resto (git,
            // artefatos do PyInstaller, a propria pasta android/, dados/ do
            // usuario) e excluido para nao inchar o APK nem criar uma
            // referencia circular com o proprio build do Android.
            python {
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
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
