package com.benmcbratney.officetv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;

/**
 * The Study (or the Office TV page) full screen on a Fire TV.
 *
 * The page does all the work; this wrapper keeps the screen awake while the page wants it
 * (it lets the TV sleep after hours), passes the remote's media buttons through to the
 * page, reloads after a network hiccup, and asks for the Worker URL and hub key once.
 * The key is handed to the page in the address's #fragment, and the page keeps it in its
 * own storage, the same way the iPad's setup link works.
 */
public class MainActivity extends Activity {

    private static final String HOST = "https://benmcbratney.github.io";
    private static final String STUDY = HOST + "/hub/study/";
    private static final String MODERN = HOST + "/hub/tv/";
    private static final long RETRY_MS = 30 * 1000;

    private WebView web;
    private SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable retry = new Runnable() {
        @Override public void run() { loadPage(null); }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("officetv", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        buildWebView();
        if (!handleIntent(getIntent())) {
            loadPage(null);
            if (!prefs.getBoolean("configured", false)) showSetup();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void buildWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);           // the page keeps its settings in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);                     // ignore the TV's font-size setting; the page scales itself
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.addJavascriptInterface(new Bridge(), "HubTV");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Stay on the hub; there's nowhere else to go on a TV.
                return !request.getUrl().toString().startsWith(HOST + "/hub/");
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) offline();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page's process died (out of memory, usually): start over cleanly.
                recreate();
                return true;
            }
        });
        setContentView(web);
        web.requestFocus();
    }

    /** Open the page this TV is set to, optionally with a #worker=…&key=… setup fragment. */
    private void loadPage(String fragment) {
        handler.removeCallbacks(retry);
        String page = prefs.getString("page", STUDY);
        web.loadUrl(fragment == null ? page : page + "#" + fragment);
    }

    private void offline() {
        web.loadData("<body style='background:#000;color:#777;font:28px sans-serif;display:flex;align-items:center;"
                + "justify-content:center;height:100vh;margin:0'>No connection. Trying again in 30 seconds…</body>",
                "text/html", "utf-8");
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
    }

    /**
     * Setup without the remote's keyboard, from a computer:
     *   adb shell am start -n com.benmcbratney.officetv/.MainActivity -d 'https://benmcbratney.github.io/hub/study/#worker=…&key=…'
     */
    private boolean handleIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !data.toString().startsWith(HOST + "/hub/")) return false;
        String url = data.toString();
        int hash = url.indexOf('#');
        prefs.edit()
                .putString("page", hash >= 0 ? url.substring(0, hash) : url)
                .putBoolean("configured", true)
                .apply();
        handler.removeCallbacks(retry);
        web.loadUrl(url);
        return true;
    }

    /** First run, or the remote's ☰ button: the Worker URL, the hub key, and which page. */
    private void showSetup() {
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(pad, pad / 2, pad, 0);

        TextView hint = new TextView(this);
        hint.setText("Tip: the Amazon Fire TV app on your phone has a keyboard, so you can paste these. "
                + "Leave them blank to keep what's saved (or to run on demo data).");
        form.addView(hint);

        final EditText worker = new EditText(this);
        worker.setHint("Worker URL (https://home-hub.….workers.dev)");
        worker.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        form.addView(worker);

        final EditText key = new EditText(this);
        key.setHint("Hub key");
        key.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        form.addView(key);

        final RadioGroup pages = new RadioGroup(this);
        RadioButton study = new RadioButton(this);
        study.setText("The Study (mahogany and brass)");
        study.setId(View.generateViewId());
        RadioButton modern = new RadioButton(this);
        modern.setText("Office TV (modern)");
        modern.setId(View.generateViewId());
        pages.addView(study);
        pages.addView(modern);
        pages.check(MODERN.equals(prefs.getString("page", STUDY)) ? modern.getId() : study.getId());
        final int studyId = study.getId();
        form.addView(pages);

        new AlertDialog.Builder(this)
                .setTitle("Set up The Study")
                .setView(form)
                .setPositiveButton("Save", (d, w) -> {
                    prefs.edit()
                            .putString("page", pages.getCheckedRadioButtonId() == studyId ? STUDY : MODERN)
                            .putBoolean("configured", true)
                            .apply();
                    String u = worker.getText().toString().trim(), k = key.getText().toString().trim();
                    String fragment = null;
                    if (!u.isEmpty() || !k.isEmpty()) {
                        fragment = (u.isEmpty() ? "" : "worker=" + Uri.encode(u)) + (u.isEmpty() || k.isEmpty() ? "" : "&")
                                + (k.isEmpty() ? "" : "key=" + Uri.encode(k));
                    }
                    loadPage(fragment);
                })
                .setNegativeButton("Cancel", (d, w) -> prefs.edit().putBoolean("configured", true).apply())
                .show();
    }

    /** The remote's media buttons become the key presses the page listens for (Spotify). */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String key = mediaKey(event.getKeyCode());
        if (key != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "',bubbles:true}))", null);
            }
            return true;
        }
        if (event.getKeyCode() == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_UP) showSetup();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private static String mediaKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "MediaPlayPause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "MediaPlay";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "MediaPause";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "MediaFastForward";
            case KeyEvent.KEYCODE_MEDIA_NEXT: return "MediaTrackNext";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "MediaRewind";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: return "MediaTrackPrevious";
            default: return null;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(retry);
        web.destroy();
        super.onDestroy();
    }

    /** window.HubTV in the page. */
    private class Bridge {
        /** The page calls keepAwake(false) after hours so the TV's own screensaver and sleep take over. */
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }
}
