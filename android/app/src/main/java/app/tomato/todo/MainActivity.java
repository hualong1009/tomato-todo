package app.tomato.todo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetPlugin.class);
        registerPlugin(ThemePlugin.class);
        super.onCreate(savedInstanceState);
        // 默认按深色主题处理系统栏；Web 层加载后会按用户主题再次调用 TomatoTheme.apply。
        // 系统栏 insets 留白必须在原生侧做（Android WebView 的 safe-area-inset 恒为 0）。
        ThemePlugin.applyToWindow(this, false);
        ThemePlugin.applyInsetsPadding(this);
    }
}
