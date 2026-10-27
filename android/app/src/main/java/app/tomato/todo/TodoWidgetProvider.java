package app.tomato.todo;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 「最近待办」桌面小组件。
 *
 * 数据来源：WidgetPlugin 写入的轻量摘要（SharedPreferences "tomato-widget" 的 "summary" 键），
 * 不直接解析应用数据文件——正文里可能内嵌几十 MB 的 base64 图片/附件。
 */
public class TodoWidgetProvider extends AppWidgetProvider {

    public static final String PREFS_NAME = "tomato-widget";
    public static final String PREF_KEY = "summary";
    public static final String ACTION_REFRESH = "app.tomato.todo.ACTION_WIDGET_REFRESH";
    public static final int ROW_COUNT = 5;

    static class WidgetTodo {
        final String id;
        final String title;
        final String meta;
        final String color;

        WidgetTodo(String id, String title, String meta, String color) {
            this.id = id;
            this.title = title;
            this.meta = meta;
            this.color = color;
        }
    }

    static class WidgetData {
        final int total;
        final int overdue;
        final List<WidgetTodo> items;

        WidgetData(int total, int overdue, List<WidgetTodo> items) {
            this.total = total;
            this.overdue = overdue;
            this.items = items;
        }
    }

    static WidgetData readData(Context context) {
        List<WidgetTodo> items = new ArrayList<>();
        try {
            String raw = context
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(PREF_KEY, null);
            if (raw != null) {
                JSONObject root = new JSONObject(raw);
                int total = root.optInt("total", 0);
                int overdue = root.optInt("overdue", 0);
                JSONArray array = root.optJSONArray("items");
                if (array != null) {
                    for (int i = 0; i < array.length() && i < ROW_COUNT; i++) {
                        JSONObject item = array.optJSONObject(i);
                        if (item == null) continue;
                        String id = item.optString("id", "");
                        String title = item.optString("title", "");
                        if (id.isEmpty() || title.isEmpty()) continue;
                        items.add(
                            new WidgetTodo(
                                id,
                                title,
                                item.optString("meta", ""),
                                item.optString("color", "#4d7cfe")
                            )
                        );
                    }
                }
                return new WidgetData(total, overdue, items);
            }
        } catch (Exception ignored) {
            // 解析失败按空数据渲染
        }
        return new WidgetData(0, 0, items);
    }

    private static int parseColor(String color, int fallback) {
        try {
            return 0xff000000 | (Integer.parseInt(color.replaceFirst("^#", ""), 16) & 0xffffff);
        } catch (Exception e) {
            return fallback;
        }
    }

    static void render(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        if (appWidgetIds == null || appWidgetIds.length == 0) return;
        WidgetData data = readData(context);

        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tomato);

            String count = data.total == 0 ? "" : data.total + " 条待办" + (data.overdue > 0 ? " · 逾期 " + data.overdue : "");
            views.setTextViewText(R.id.widget_count, count);

            for (int i = 0; i < ROW_COUNT; i++) {
                int rowId = context.getResources().getIdentifier("widget_row_" + i, "id", context.getPackageName());
                int dotId = context.getResources().getIdentifier("widget_dot_" + i, "id", context.getPackageName());
                int titleId = context.getResources().getIdentifier("widget_todo_" + i, "id", context.getPackageName());
                int metaId = context.getResources().getIdentifier("widget_meta_" + i, "id", context.getPackageName());
                boolean has = i < data.items.size();
                WidgetTodo todo = has ? data.items.get(i) : null;
                views.setViewVisibility(rowId, has ? android.view.View.VISIBLE : android.view.View.GONE);
                if (has && todo != null) {
                    views.setTextViewText(titleId, todo.title);
                    views.setTextViewText(metaId, todo.meta);
                    views.setInt(dotId, "setColorFilter", parseColor(todo.color, 0xff4d7cfe));
                    views.setOnClickPendingIntent(rowId, buildOpenIntent(context, todo.id));
                }
            }

            views.setViewVisibility(
                R.id.widget_empty,
                data.items.isEmpty() ? android.view.View.VISIBLE : android.view.View.GONE
            );
            views.setOnClickPendingIntent(R.id.widget_root, buildOpenIntent(context, null));

            Intent refresh = new Intent(context, TodoWidgetProvider.class);
            refresh.setAction(ACTION_REFRESH);
            views.setOnClickPendingIntent(
                R.id.widget_refresh,
                PendingIntent.getBroadcast(
                    context,
                    0,
                    refresh,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                )
            );

            manager.updateAppWidget(appWidgetId, views);
        }
    }

    private static PendingIntent buildOpenIntent(Context context, String todoId) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (todoId != null) intent.putExtra("todoId", todoId);
        return PendingIntent.getActivity(
            context,
            todoId == null ? 1 : todoId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /** 让插件/刷新按钮触发所有小组件重绘。 */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        render(context, manager, manager.getAppWidgetIds(new ComponentName(context, TodoWidgetProvider.class)));
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        render(context, manager, appWidgetIds);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            refreshAll(context);
        }
    }
}
