package app.tomato.todo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetPlugin.class);
        registerPlugin(ThemePlugin.class);
        super.onCreate(savedInstanceState);
        // 默认按深色主题处理系统栏；Web 层加载后会按用户主题再次调用 TomatoTheme.apply
        ThemePlugin.applyToWindow(this, false);
    }
}
