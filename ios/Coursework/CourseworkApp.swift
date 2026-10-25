import SwiftUI
import WebKit

// Coursework for iPhone: the cnv.byhrt.com site in a full-screen native shell.
// The site itself does everything; this app adds the home-screen icon, pull to refresh,
// swipe back, and sends Canvas and other outside links to Safari.

@main
struct CourseworkApp: App {
    var body: some Scene {
        WindowGroup {
            CourseworkView().ignoresSafeArea()
        }
    }
}

struct CourseworkView: UIViewRepresentable {
    static let home = URL(string: "https://cnv.byhrt.com/")!

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()   // keeps sign-in and settings between launches

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        // The site handles the notch and home bar itself (viewport-fit=cover + safe-area CSS).
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.isOpaque = false
        web.backgroundColor = .systemBackground

        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pulledToRefresh(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh

        context.coordinator.web = web
        web.load(URLRequest(url: Self.home))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var web: WKWebView?

        @objc func pulledToRefresh(_ sender: UIRefreshControl) {
            web?.reload()
            sender.endRefreshing()
        }

        private func isOurs(_ url: URL) -> Bool {
            url.host == CourseworkView.home.host || ["about", "blob", "data"].contains(url.scheme ?? "")
        }

        // Stay in the app for Coursework pages; open everything else (Canvas, links in
        // assignments, downloads) in Safari.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.cancel) }
            if action.targetFrame?.isMainFrame == false || isOurs(url) { return decisionHandler(.allow) }
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }

        // Links that ask for a new window (target="_blank").
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if isOurs(url) { webView.load(action.request) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showOffline(webView, error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showOffline(webView, error)
        }

        private func showOffline(_ webView: WKWebView, _ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            let html = """
            <!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font: 17px -apple-system, system-ui; display: grid; place-items: center; height: 100vh; margin: 0;
                     text-align: center; color: #1b1a17; background: #f6f5f2; }
              @media (prefers-color-scheme: dark) { body { color: #eceae4; background: #111110; } }
              button { font: inherit; font-weight: 600; padding: 12px 22px; border: 0; border-radius: 12px; background: #3b5bdb; color: #fff; }
              p { opacity: .7; margin: 8px 24px 20px; }
            </style>
            <div><h2>Can't reach Coursework</h2><p>Check your internet connection and try again.</p>
            <button onclick="location.href='\(CourseworkView.home.absoluteString)'">Try again</button></div>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
    }
}
