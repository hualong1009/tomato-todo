package app.tomato.todo;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统栏（状态栏 / 手势条）外观：跟随应用主题改为透明沉浸式。
 *
 * targetSdk 35+ 系统强制边到边绘制，窗口颜色会被忽略，所以：
 * 1. 窗口背景色 = 主题背景色（状态栏/导航栏区域露出的就是主题色）
 * 2. 内容按系统 insets 留白（applyInsetsPadding），按钮不会被系统栏压住
 * 图标明暗由 Web 层在主题切换时调用 apply 同步。
 */
@CapacitorPlugin(name = "TomatoTheme")
public class ThemePlugin extends Plugin {

    /** 与 Web 层 base.css 的 --bg 保持一致 */
    private static final int BG_DARK = 0xFF070A12;
    private static final int BG_LIGHT = 0xFFEDF1F7;

    @PluginMethod
    public void apply(PluginCall call) {
        String scheme = call.getString("scheme", "dark");
        boolean isLight = "light".equals(scheme);
        Activity activity = getActivity();
        if (activity != null) {
            applyToWindow(activity, isLight);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    static void applyToWindow(Activity activity, boolean isLight) {
        Window window = activity.getWindow();
        // 边到边绘制，系统栏透明；窗口背景 = 主题色
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        window.setBackgroundDrawable(new ColorDrawable(isLight ? BG_LIGHT : BG_DARK));
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                window.setNavigationBarContrastEnforced(false);
            } catch (Exception ignored) {
            }
        }
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(isLight);
        controller.setAppearanceLightNavigationBars(isLight);
    }

    /**
     * 让内容避开系统栏与键盘：按 insets 给内容视图留白。
     * WebView 里 env(safe-area-inset-*) 在 Android 上恒为 0，必须在原生侧处理。
     */
    static void applyInsetsPadding(Activity activity) {
        View content = activity.findViewById(android.R.id.content);
        if (content == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(
            content,
            (view, insets) -> {
                Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return insets;
            }
        );
    }
}
