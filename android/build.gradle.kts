// Combinacao confirmada em developer.android.com e chaquo.com/chaquopy em
// 01/09/2026: a escolha inicial (AGP 8.13.0 + Gradle 8.13) travou porque o
// Gradle 8.13 nao roda sob o Java 25 do JBR do Android Studio -- so a serie
// Gradle 9.x suporta esse JDK. Isso empurrou para AGP 9.0.0 (exige Gradle >=
// 9.1.0; fixamos 9.3.0 em gradle/wrapper/gradle-wrapper.properties, ja
// baixada e usada pelo proprio Android Studio nesta maquina), que troca o
// plugin Kotlin separado pelo "built-in Kotlin support" (ver
// android/app/build.gradle.kts) -- por isso nao ha mais um
// `id("org.jetbrains.kotlin.android")` aqui. Chaquopy 17.0.0 suporta AGP de
// 7.3.x a 9.2.x, entao 9.0.0 fica dentro do intervalo.
plugins {
    id("com.android.application") version "9.0.0" apply false
    id("com.chaquo.python") version "17.0.0" apply false
}
