package com.labourkatta.app;

/** Shown when the phone has no internet or the server cannot be reached. */
final class OfflinePage {
    private OfflinePage() {}

    static String html(String appUrl) {
        return "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{margin:0;font-family:sans-serif;background:#F6F4EF;color:#1C1B19;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}"
                + ".m{width:64px;height:64px;border-radius:16px;background:#E8A317;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:26px;margin:0 auto 16px}"
                + "a{display:inline-block;margin-top:20px;background:#E8A317;color:#1C1B19;padding:14px 28px;border-radius:12px;font-weight:700;text-decoration:none}</style></head>"
                + "<body><div><div class='m'>LK</div>"
                + "<h2>No internet connection</h2><p>इंटरनेट कनेक्शन नहीं है · इंटरनेट कनेक्शन नाही</p>"
                + "<p>Check your mobile data or Wi-Fi, then try again.</p>"
                + "<a href='" + appUrl + "/'>Try again · फिर कोशिश करें</a></div></body></html>";
    }
}
