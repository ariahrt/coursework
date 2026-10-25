# Coursework for iPhone

A native iPhone app that shows cnv.byhrt.com full screen, with its own icon, pull to
refresh and swipe back. Canvas links and downloads open in Safari. Because it loads the
live site, every website deploy updates the app too; you only rebuild the app if
something in this `ios/` folder changes.

iPhone apps can only be built on a Mac, so GitHub builds it for you (free), and you
install it from Windows with Sideloadly (free).

## 1. Build it

1. Push this project to a GitHub repository.
2. On GitHub, open the repo's **Actions** tab, pick **Build iPhone app**, click
   **Run workflow**. It takes about 5 minutes.
3. When it finishes, open the run and download **Coursework-ipa** at the bottom.
   Unzip it to get `Coursework.ipa`.

## 2. Install it on your iPhone

1. Install **Apple Devices** from the Microsoft Store (it provides the iPhone USB driver).
2. Install **Sideloadly** from sideloadly.io.
3. Plug in your iPhone, unlock it, and tap **Trust** if it asks.
4. Open Sideloadly, drag in `Coursework.ipa`, type your Apple ID email, click **Start**,
   then sign in to your Apple ID when it asks.
5. On the iPhone:
   - **Settings → General → VPN & Device Management** → tap your Apple ID → **Trust**.
   - **Settings → Privacy & Security → Developer Mode** → turn it on (the phone restarts).

## The 7-day catch

With a free Apple ID, Apple makes sideloaded apps stop opening after **7 days**. Plug in and
run Sideloadly again to renew it (your sign-in and settings are kept). Sideloadly can also
renew automatically over Wi-Fi while your PC is on. With a paid Apple Developer account
($99/year) it lasts a year instead.

If that's too much hassle, the free alternative works the same day to day: open
cnv.byhrt.com in Safari → Share → **Add to Home Screen**.
