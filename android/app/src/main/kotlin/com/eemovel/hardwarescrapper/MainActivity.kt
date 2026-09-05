package com.eemovel.hardwarescrapper

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ShareCompat
import androidx.core.content.FileProvider
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import java.io.File

/**
 * Equivalente Android de app.py: sobe o mesmo backend Python
 * (appcore/server.py, via appcore/android_entry.py) dentro do proprio
 * processo do app, com o Chaquopy, e aponta uma WebView para ele -- no lugar
 * da janela nativa que o pywebview/WebView2 abrem no Windows.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = LocalOnlyWebViewClient()

        // Registrada ANTES do loadUrl: o WebView injeta a ponte em cada contexto
        // JS novo no momento em que ele e criado, entao a interface ja encontra
        // window.HWAndroid no primeiro script da pagina (js/app-bridge.js, no
        // <head>). Registrar depois do loadUrl exigiria um reload para valer.
        webView.addJavascriptInterface(ShareBridge(), "HWAndroid")

        webView.loadUrl(startBackend())
    }

    /**
     * `android:configChanges` no manifesto ja evita que a Activity seja
     * recriada por rotacao de tela, mas o guard em android_entry.py continua
     * como segunda linha de defesa: se mesmo assim onCreate rodar de novo no
     * mesmo processo, devolve a URL do servidor ja em pe em vez de subir um
     * segundo servidor numa porta nova.
     */
    private fun startBackend(): String {
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(applicationContext))
        }
        val entry = Python.getInstance().getModule("appcore.android_entry")
        val dataDir = filesDir.resolve("dados").absolutePath
        val downloadDir = File(cacheDir, UPDATE_DIR).absolutePath
        // A versao vem do PackageManager, e nao do BuildConfig: desde o AGP 8 a
        // geracao do BuildConfig e desligada por padrao, e o PackageManager tem
        // a vantagem de ser impossivel de dessincronizar do APK instalado. Sem
        // isto o default "1.0.0" de android_entry.start() vencia, e o rodape
        // mostrava uma versao errada -- o que agora tambem faria a checagem de
        // atualizacao oferecer para sempre uma versao ja instalada.
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName ?: "0.0.0"
        return entry.callAttr("start", dataDir, versionName, downloadDir).toString()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing && Python.isStarted()) {
            Python.getInstance().getModule("appcore.android_entry").callAttr("stop")
        }
    }

    /**
     * Menu nativo de compartilhamento, para a interface.
     *
     * Existe porque o filesDir do app e privado no Android: a exportacao que no
     * Windows vai para dados/exportacoes/ produziria aqui um arquivo que nenhum
     * gerenciador de arquivos alcanca -- o usuario pediria "baixar" e nunca
     * acharia nada. O caminho util e o ACTION_SEND, que deixa ele escolher o
     * destino (WhatsApp, Drive, e-mail).
     *
     * Fica no Kotlin, e nao em appcore/, de proposito: o Intent e codigo
     * Android, e appcore/ e o MESMO codigo que o app Windows roda -- nenhum
     * Context precisa vazar para o Python por causa disto.
     *
     * ATENCAO: todo metodo @JavascriptInterface roda numa thread de background
     * do WebView, nunca na UI. Gravar o arquivo aqui e bom (nao trava a
     * interface), mas startActivity() PRECISA da UI thread.
     */
    private inner class ShareBridge {

        /**
         * Grava `content` num arquivo temporario e abre o seletor do sistema.
         * Devolve "" quando deu certo, ou a mensagem do erro -- um booleano
         * esconderia o motivo justamente quando o usuario precisa dele.
         *
         * O "" nao quer dizer que o usuario chegou a compartilhar: o seletor e
         * postado na UI thread e o resultado dele nao volta para o JS. Quer
         * dizer "o arquivo existe e o seletor foi despachado", que e tudo o que
         * a interface precisa para escolher o toast.
         */
        @JavascriptInterface
        fun shareTextFile(fileName: String, content: String, mimeType: String, subject: String): String {
            return try {
                val dir = File(cacheDir, SHARE_DIR).apply { mkdirs() }
                pruneOldShares(dir)

                val file = File(dir, sanitizeFileName(fileName))
                // Cinto e suspensorio contra path traversal: mesmo com o
                // sanitize, so aceita um caminho que resolve DENTRO da pasta de
                // compartilhamento. O JS e nosso, mas a ponte fica exposta a
                // qualquer coisa que rode naquele WebView.
                if (file.canonicalFile.parentFile != dir.canonicalFile) {
                    return "nome de arquivo recusado"
                }
                file.writeText(content, Charsets.UTF_8)

                val uri = FileProvider.getUriForFile(
                    this@MainActivity,
                    "$packageName.fileprovider", // casa com ${applicationId}.fileprovider no manifesto
                    file
                )
                val safeMime = if (mimeType.matches(MIME_RE)) mimeType else "text/plain"

                runOnUiThread { startChooser(uri, safeMime, subject) }
                ""
            } catch (err: Exception) {
                Log.e("ShareBridge", "falha ao compartilhar", err)
                err.message ?: err.javaClass.simpleName
            }
        }

        /**
         * O Android exige que o usuario libere este app como fonte confiavel
         * antes de deixar ele instalar um APK. Nao e permissao de runtime: nao
         * passa por requestPermissions, e sim por uma tela de Configuracoes.
         */
        @JavascriptInterface
        fun canInstall(): Boolean = packageManager.canRequestPackageInstalls()

        @JavascriptInterface
        fun requestInstallPermission() {
            runOnUiThread {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName")
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
        }

        /**
         * Entrega um APK ja baixado ao instalador do sistema. Mesmo contrato do
         * shareTextFile: "" quando o Intent foi despachado, a mensagem do erro
         * quando nao. O "" nao promete que a instalacao aconteceu -- o
         * resultado do instalador nao volta para o JS, e a recusa mais comum
         * (assinatura diferente da instalacao atual) so aparece na tela dele.
         */
        @JavascriptInterface
        fun installApk(absolutePath: String): String {
            return try {
                val dir = File(cacheDir, UPDATE_DIR)
                val file = File(absolutePath)
                // O caminho vem do Python, mas a ponte fica exposta a qualquer
                // coisa que rode naquele WebView: so aceita um arquivo que
                // resolve DENTRO da pasta de atualizacao.
                if (file.canonicalFile.parentFile != dir.canonicalFile || !file.isFile) {
                    return "arquivo de atualização não encontrado"
                }
                val uri = FileProvider.getUriForFile(
                    this@MainActivity,
                    "$packageName.fileprovider",
                    file
                )
                runOnUiThread { startInstaller(uri) }
                ""
            } catch (err: Exception) {
                Log.e("ShareBridge", "falha ao instalar", err)
                err.message ?: err.javaClass.simpleName
            }
        }
    }

    private fun startInstaller(uri: Uri) {
        val host = Uri.parse(webView.url ?: "").host
        if (host != "127.0.0.1" && host != "localhost") return

        // Sem guard de resolveActivity, pelo mesmo motivo do startChooser: com
        // targetSdk 30+ ele devolve null sem um <queries> no manifesto e o
        // "protetor" viraria a causa do bug. O instalador e do sistema.
        startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    }

    private fun startChooser(uri: Uri, mimeType: String, subject: String) {
        // Roda na UI thread, entao webView.url pode ser lido com seguranca. A
        // ponte so deve servir a interface local: se por qualquer motivo o
        // WebView estiver em outra origem, nao abre nada.
        val host = Uri.parse(webView.url ?: "").host
        if (host != "127.0.0.1" && host != "localhost") return

        val intent = ShareCompat.IntentBuilder(this)
            .setType(mimeType)
            .setStream(uri)
            // EXTRA_SUBJECT e usado por e-mail e Drive como titulo. De proposito
            // NAO mandamos EXTRA_TEXT junto com um stream: varios destinos (o
            // WhatsApp entre eles) mostram so o texto e DESCARTAM o anexo, sem
            // avisar.
            .setSubject(subject)
            .setChooserTitle(R.string.share_chooser_title)
            .intent
            // O ShareCompat ja migra o stream para o ClipData, mas o flag
            // explicito e o que garante a leitura nos destinos que ignoram o
            // ClipData.
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

        // De proposito SEM um guard de intent.resolveActivity(packageManager):
        // no targetSdk 30+ o package visibility filtering faz isso devolver null
        // sem um <queries> no manifesto, e o guard "protetor" viraria a causa do
        // bug. Um createChooser sempre resolve -- o seletor e do sistema.
        startActivity(Intent.createChooser(intent, getString(R.string.share_chooser_title)))
    }

    /**
     * O nome vem do JS (slugify + ".txt"), mas a ponte nao confia nele: reduz a
     * um conjunto minimo de caracteres, corta separadores de caminho e ".." e
     * limita o tamanho. Sem isso um nome como "../../databases/x" escreveria
     * fora da pasta de compartilhamento.
     */
    private fun sanitizeFileName(raw: String): String {
        val base = raw.substringAfterLast('/').substringAfterLast('\\')
        val cleaned = base
            .replace(Regex("[^A-Za-z0-9._-]"), "-")
            .replace(Regex("-{2,}"), "-")
            .trimStart('.', '-')
            .take(80)
        val safe = cleaned.ifBlank { "lista" }
        return if (safe.endsWith(".txt", ignoreCase = true)) safe else "$safe.txt"
    }

    /**
     * Copias de entrega sao descartaveis: o destino ja leu o que precisava assim
     * que o seletor fechou. Limpar por idade a cada compartilhamento evita a
     * pasta crescer para sempre com nomes de builds antigas, sem apagar um
     * arquivo que um destino lento ainda possa estar lendo.
     */
    private fun pruneOldShares(dir: File) {
        val cutoff = System.currentTimeMillis() - SHARE_TTL_MS
        dir.listFiles()?.forEach { if (it.isFile && it.lastModified() < cutoff) it.delete() }
    }

    private companion object {
        const val SHARE_DIR = "compartilhar"
        // Precisa casar com o <cache-path> de res/xml/file_paths.xml e com o
        // downloadDir passado ao backend Python -- os tres apontam para a mesma
        // pasta, e um FileProvider so entrega arquivos de um caminho declarado.
        const val UPDATE_DIR = "atualizacao"
        const val SHARE_TTL_MS = 60L * 60L * 1000L // 1h: tempo de sobra para o destino ler
        val MIME_RE = Regex("^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$")
    }
}

/**
 * So deixa a WebView navegar dentro do servidor local (127.0.0.1); qualquer
 * outro link -- o unico caso hoje e o link do rodape para
 * comprasparaguai.com.br -- abre no navegador do celular em vez de sequestrar
 * a WebView do app.
 */
private class LocalOnlyWebViewClient : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val host = request.url.host
        if (host == "127.0.0.1" || host == "localhost") {
            return false
        }
        view.context.startActivity(Intent(Intent.ACTION_VIEW, request.url))
        return true
    }
}
