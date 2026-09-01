package com.eemovel.hardwarescrapper

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform

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
        return entry.callAttr("start", dataDir).toString()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing && Python.isStarted()) {
            Python.getInstance().getModule("appcore.android_entry").callAttr("stop")
        }
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
