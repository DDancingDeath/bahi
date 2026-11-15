package com.happa;

import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.LayerDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private int topColor;
    private int bottomColor;
    private boolean lightTop;
    private boolean lightBottom;
    private int topInset = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppShellPlugin.class);
        super.onCreate(savedInstanceState);

        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        topColor = bottomColor = ContextCompat.getColor(this, R.color.splash_background);
        lightTop = lightBottom = !night;
        drawEdgeToEdge();
    }

    /**
     * The same layout on every Android version: the app draws behind the system bars (Android 15 forces
     * this for targetSdk 35) and the WebView is kept clear of them and of the keyboard with margins, so
     * Save and the tab bar are never under the Back/Home buttons and the keyboard never covers a field.
     * The bars show the colours the web app sends (setBarColors).
     */
    @SuppressWarnings("deprecation")
    private void drawEdgeToEdge() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        View webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            mlp.leftMargin = bars.left;
            mlp.topMargin = bars.top;
            mlp.rightMargin = bars.right;
            mlp.bottomMargin = Math.max(bars.bottom, ime.bottom);
            v.setLayoutParams(mlp);
            if (topInset != bars.top) {
                topInset = bars.top;
                paintBars();
            }
            return WindowInsetsCompat.CONSUMED;
        });
        paintBars();
    }

    void setBarColors(int top, int bottom, boolean lightTopBar, boolean lightBottomBar) {
        topColor = top;
        bottomColor = bottom;
        lightTop = lightTopBar;
        lightBottom = lightBottomBar;
        paintBars();
    }

    /** The area behind the bars is the WebView's parent: the bottom colour, with the top colour in a band of status-bar height. */
    private void paintBars() {
        View webView = bridge != null ? bridge.getWebView() : null;
        View root = webView != null && webView.getParent() instanceof View ? (View) webView.getParent() : null;
        if (root != null) {
            LayerDrawable bg = new LayerDrawable(new Drawable[] { new ColorDrawable(bottomColor), new ColorDrawable(topColor) });
            bg.setLayerGravity(1, Gravity.TOP | Gravity.FILL_HORIZONTAL);
            bg.setLayerHeight(1, topInset);
            root.setBackground(bg);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(lightTop);
        controller.setAppearanceLightNavigationBars(lightBottom);
    }
}
