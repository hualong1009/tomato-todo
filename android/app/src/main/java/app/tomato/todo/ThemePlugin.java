package app.tomato.todo;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统栏（状态栏 / 手势条）外观：跟随应用主题改为透明沉浸式，
 * 由 Web 层在主题切换时调用；图标明暗随主题自动调整。
 */
@CapacitorPlugin(name = "TomatoTheme")
public class ThemePlugin extends Plugin {

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
        // 边到边绘制，内容由 Web 层的 safe-area-inset 顶开
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                window.setNavigationBarContrastEnforced(false);
            } catch (Exception ignored) {
            }
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(isLight);
        controller.setAppearanceLightNavigationBars(isLight);
    }
}
