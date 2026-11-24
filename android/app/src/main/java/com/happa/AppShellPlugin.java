package com.happa;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Small native helpers for the web app (Capacitor.Plugins.AppShell): system bar colours,
 * the app's settings page, external links that report whether an app opened them, printing, and hiding the
 * screen from recent apps while the phone lock is on, and a bill picture straight into WhatsApp.
 */
@CapacitorPlugin(name = "AppShell")
public class AppShellPlugin extends Plugin {

    private static final List<String> EXTERNAL_SCHEMES = Arrays.asList("https", "http", "upi", "whatsapp", "tel", "mailto", "sms");
    private static final List<String> WHATSAPP_PACKAGES = Arrays.asList("com.whatsapp", "com.whatsapp.w4b");

    // The print framework reads the page after print() returns, so the WebView must outlive the call.
    private WebView printView;

    @PluginMethod
    public void setSystemBars(PluginCall call) {
        Integer top = parseColor(call.getString("top"));
        Integer bottom = parseColor(call.getString("bottom"));
        boolean lightTop = Boolean.TRUE.equals(call.getBoolean("lightTop", true));
        boolean lightBottom = Boolean.TRUE.equals(call.getBoolean("lightBottom", true));
        if (top == null || bottom == null) {
            call.reject("Colours must be #rrggbb");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).setBarColors(top, bottom, lightTop, lightBottom);
            }
            call.resolve();
        });
    }

    /** The web start-up screen is drawn: the system splash may go. */
    @PluginMethod
    public void splashDone(PluginCall call) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).webDrawn();
        call.resolve();
    }

    /** Phone lock on: the app's screen is hidden from the recent-apps preview (and screenshots). */
    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        JSObject ret = new JSObject();
        try {
            getContext().startActivity(intent);
            ret.put("opened", true);
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        JSObject ret = new JSObject();
        if (!EXTERNAL_SCHEMES.contains(scheme)) {
            ret.put("opened", false);
            call.resolve(ret);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            ret.put("opened", true);
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        String title = call.getString("title", "Bahi");
        if (html == null) {
            call.reject("No page to print");
            return;
        }
        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getActivity());
            view.getSettings().setJavaScriptEnabled(false);
            view.setWebViewClient(new WebViewClient() {
                private boolean started = false;

                @Override
                public void onPageFinished(WebView v, String url) {
                    if (started) return;
                    started = true;
                    try {
                        PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                        manager.print(title, v.createPrintDocumentAdapter(title),
                                new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                        call.resolve();
                    } catch (RuntimeException e) {
                        call.reject("Print failed", e);
                    }
                }
            });
            printView = view;
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }

    /**
     * A picture from the app's cache to WhatsApp (or WhatsApp Business), with a caption; with `phone`
     * (country code + number) WhatsApp opens that chat ("jid"), else it asks whom to send it to. Both
     * installed: Android asks which. Resolves {opened: false} when neither is installed or it fails,
     * so the web app can use the share sheet.
     */
    @PluginMethod
    public void shareToWhatsApp(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("opened", false);
        Uri content = cacheFileUri(call.getString("uri", ""));
        if (content == null) {
            call.resolve(ret);
            return;
        }
        String text = call.getString("text", "");
        String phone = call.getString("phone", "");
        List<Intent> intents = new ArrayList<>();
        PackageManager pm = getContext().getPackageManager();
        for (String pkg : WHATSAPP_PACKAGES) {
            if (pm.getLaunchIntentForPackage(pkg) == null) continue;
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setPackage(pkg);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, content);
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            if (phone != null && phone.matches("\\d{8,15}")) send.putExtra("jid", phone + "@s.whatsapp.net");
            send.setClipData(ClipData.newRawUri("", content));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intents.add(send);
        }
        if (intents.isEmpty()) {
            call.resolve(ret);
            return;
        }
        Intent launch = intents.get(0);
        if (intents.size() > 1) {
            launch = Intent.createChooser(intents.get(0), null);
            launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, intents.subList(1, intents.size()).toArray(new Intent[0]));
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(launch);
            ret.put("opened", true);
            ret.put("app", intents.size() > 1 ? "choose" : intents.get(0).getPackage());
        } catch (ActivityNotFoundException | SecurityException e) {
            ret.put("opened", false);
        }
        call.resolve(ret);
    }

    /** A content:// uri for a file:// uri inside the app's cache, or null for anything else. */
    private Uri cacheFileUri(String uri) {
        try {
            String path = Uri.parse(uri).getPath();
            if (path == null) return null;
            File file = new File(path).getCanonicalFile();
            File cache = getContext().getCacheDir().getCanonicalFile();
            if (!file.isFile() || !file.getPath().startsWith(cache.getPath() + File.separator)) return null;
            return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        } catch (IOException | IllegalArgumentException e) {
            return null;
        }
    }

    private static Integer parseColor(String value) {
        if (value == null || !value.matches("#[0-9a-fA-F]{6}")) return null;
        try {
            return Color.parseColor(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
