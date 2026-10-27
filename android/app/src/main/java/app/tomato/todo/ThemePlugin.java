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
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统栏（状态栏 / 手势条）外观：跟随应用主题改为透明沉浸式。
 *
 * targetSdk 35+ 系统强制边到边绘制，窗口颜色会被忽略，所以：
 * 1. 窗口与内容背景色 = 主题背景色（Web 层就绪前的兜底底色）
 * 2. 启动阶段用原生 insets 给内容留白；Web 层就绪后调用 activateWebViewInsets，
 *    由原生把 insets 数值传给 JS，用 CSS 变量留白——这样应用背景（含渐变）
 *    可以真正绘制到系统栏底下，与界面完全无缝
 * 3. 关闭状态栏 / 导航栏的强制对比遮罩（否则透明栏上会有一层白色纱罩）
 *
 * 注意：插件方法运行在桥接线程，所有窗口操作必须切回主线程，
 * 否则会抛 CalledFromWrongThreadException 导致应用闪退。
 */
@CapacitorPlugin(name = "TomatoTheme")
public class ThemePlugin extends Plugin {

    /** 与 Web 层 base.css 的 --bg 保持一致 */
    private static final int BG_DARK = 0xFF070A12;
    private static final int BG_LIGHT = 0xFFEDF1F7;

    private static ThemePlugin instance;
    /** Web 层是否已接管 insets（true 时原生不再 padding，由 CSS 变量留白） */
    private static volatile boolean webHandlesInsets = false;
    private static int lastTop = 0;
    private static int lastBottom = 0;
    private static int lastLeft = 0;
    private static int lastRight = 0;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    @PluginMethod
    public void apply(PluginCall call) {
        String scheme = call.getString("scheme", "dark");
        boolean isLight = "light".equals(scheme);
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> applyToWindow(activity, isLight));
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * Web 层就绪后接管 insets：返回当前 insets 数值并把原生 padding 清零，
     * 之后 insets 变化（旋转、键盘、手势条）通过 safeArea 事件持续推给 JS。
     */
    @PluginMethod
    public void activateWebViewInsets(PluginCall call) {
        webHandlesInsets = true;
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                View content = activity.findViewById(android.R.id.content);
                if (content != null) {
                    content.setPadding(0, 0, 0, 0);
                    content.requestApplyInsets();
                }
            });
        }
        JSObject ret = new JSObject();
        ret.put("top", toCssPx(lastTop));
        ret.put("bottom", toCssPx(lastBottom));
        ret.put("left", toCssPx(lastLeft));
        ret.put("right", toCssPx(lastRight));
        call.resolve(ret);
    }

    private void dispatchSafeArea() {
        JSObject data = new JSObject();
        data.put("top", toCssPx(lastTop));
        data.put("bottom", toCssPx(lastBottom));
        data.put("left", toCssPx(lastLeft));
        data.put("right", toCssPx(lastRight));
        notifyListeners("safeArea", data);
    }

    /** 原生 insets 是物理像素，Web/CSS 的 px 是逻辑像素，必须除以屏幕密度 */
    private int toCssPx(int physicalPx) {
        float density = getContext().getResources().getDisplayMetrics().density;
        if (density <= 0f) return physicalPx;
        return Math.round(physicalPx / density);
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
                // 关闭透明系统栏上的强制对比白纱（状态栏 + 导航栏），
                // 否则边缘会显示出一条白边
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            } catch (Exception ignored) {
            }
        }
        // 内容视图背景也刷成主题色，保证 Web 层就绪前 insets 留白区域是主题色
        View content = activity.findViewById(android.R.id.content);
        if (content != null) {
            content.setBackgroundColor(isLight ? BG_LIGHT : BG_DARK);
        }
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(isLight);
        controller.setAppearanceLightNavigationBars(isLight);
    }

    /**
     * 启动阶段让内容避开系统栏与键盘（Web 层就绪后由 CSS 变量接管）。
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
                lastTop = bars.top;
                lastLeft = bars.left;
                lastRight = bars.right;
                // 键盘弹出时内容要整体抬到键盘上方
                lastBottom = Math.max(bars.bottom, ime.bottom);
                if (!webHandlesInsets) {
                    view.setPadding(lastLeft, lastTop, lastRight, lastBottom);
                }
                ThemePlugin plugin = instance;
                if (plugin != null && webHandlesInsets) {
                    plugin.dispatchSafeArea();
                }
                return insets;
            }
        );
    }
}
