package app.tomato.todo;

import android.content.res.Configuration;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetPlugin.class);
        registerPlugin(ThemePlugin.class);
        registerPlugin(WebDAVBinaryPlugin.class);
        registerPlugin(ExternalPlugin.class);
        super.onCreate(savedInstanceState);
        // 首次安装还没有持久化设置，默认主题跟随系统；启动时先应用系统配色，
        // Web 层就绪后再按用户选中的主题调用 TomatoTheme.apply。
        // 系统栏 insets 留白必须在原生侧做（Android WebView 的 safe-area-inset 恒为 0）。
        boolean isLight = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            != Configuration.UI_MODE_NIGHT_YES;
        ThemePlugin.applyToWindow(this, isLight);
        ThemePlugin.applyInsetsPadding(this);
    }
}
