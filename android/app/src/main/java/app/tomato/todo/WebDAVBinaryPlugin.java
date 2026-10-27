package app.tomato.todo;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * WebDAV 需要 MKCOL/PROPFIND 扩展动词和原样传输二进制备份。
 * CapacitorHttp 在 JSON Content-Type 下会把 GET 的数据提前解析为文本，
 * 即使 responseType=arraybuffer；含中文的备份不能再交给 atob 解码。
 * 同时 Android 7 (minSdk 24) 的 dataType=file 分支不写入任何字节，
 * 因此读写都由 OkHttp 原样传输、通过 JS 桥传 base64。
 */
@CapacitorPlugin(name = "TomatoWebDAVBinary")
public class WebDAVBinaryPlugin extends Plugin {
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .build();

    /** 原样写入 TTENC2 容器；JS 桥传 base64，HTTP 上发送的是原始字节。 */
    @PluginMethod
    public void put(PluginCall call) {
        String base64 = call.getString("data");
        if (base64 == null) {
            call.reject("缺少 WebDAV 上传内容");
            return;
        }
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            execute(call, "PUT", RequestBody.create(data, MediaType.parse("application/octet-stream")), false);
        } catch (IllegalArgumentException error) {
            call.reject("WebDAV 上传内容编码不正确");
        }
    }

    /** 不受服务端 Content-Type 影响，始终返回原始字节的 base64。 */
    @PluginMethod
    public void get(PluginCall call) {
        execute(call, "GET", null, true);
    }

    /** MKCOL 创建目录，PROPFIND 列出已存在的 blob；不使用 HttpURLConnection。 */
    @PluginMethod
    public void request(PluginCall call) {
        String method = call.getString("method");
        if (!"MKCOL".equals(method) && !"PROPFIND".equals(method)) {
            call.reject("不支持的 WebDAV 方法");
            return;
        }
        String data = call.getString("data", "");
        String contentType = "PROPFIND".equals(method) ? "application/xml; charset=utf-8" : null;
        execute(call, method, RequestBody.create(data, contentType == null ? null : MediaType.parse(contentType)), false);
    }

    private void execute(PluginCall call, String method, RequestBody body, boolean binaryResponse) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("http")) {
            call.reject("WebDAV 地址格式不正确");
            return;
        }
        try {
            Request.Builder builder = new Request.Builder().url(url);
            JSObject headers = call.getObject("headers", new JSObject());
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                builder.addHeader(key, headers.getString(key));
            }
            builder.method(method, body);
            try (Response response = client.newCall(builder.build()).execute()) {
                JSObject result = new JSObject();
                result.put("status", response.code());
                result.put("data", response.body() == null ? "" : binaryResponse
                    ? Base64.encodeToString(response.body().bytes(), Base64.NO_WRAP)
                    : response.body().string());
                call.resolve(result);
            }
        } catch (IOException | IllegalArgumentException error) {
            // 不把 URL、密码或 Authorization 头写进日志/异常提示。
            call.reject("WebDAV 请求失败，请检查网络和服务器设置");
        }
    }
}
