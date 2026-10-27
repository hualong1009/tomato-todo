package app.tomato.todo;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/**
 * 桌面小组件数据通道：渲染层把轻量摘要（最近待办）写进来，然后触发所有小组件重绘。
 */
@CapacitorPlugin(name = "TomatoWidget")
public class WidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String summary = call.getString("summary", "{}");
        Context context = getContext().getApplicationContext();
        try {
            // 先校验是合法 JSON，避免把坏数据写进小组件
            new JSONObject(summary);
            context
                .getSharedPreferences(TodoWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(TodoWidgetProvider.PREF_KEY, summary)
                .apply();
            TodoWidgetProvider.refreshAll(context);
        } catch (Exception ignored) {
            // 解析失败时小组件保持上一次内容
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
