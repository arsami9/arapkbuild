# Wevlo: GitHub Actions APK Build (Android phone only)

This is a free-tier, manual cloud build workflow. It is **not** a permanently running build API and does not automatically connect the existing website Build button to GitHub Actions.

## One-time setup from your Android phone

1. Open https://github.com and sign in.
2. Create a new repository, e.g. `wevlo-apk-builder`. Choose Private if you prefer. Do not add a README/license/gitignore if uploading this project as a ZIP.
3. In the repository, use **Add file → Upload files**. Upload the contents of this project folder (not the outer folder itself), keeping folder paths. If GitHub's mobile page cannot upload folders, use the GitHub app or upload files in smaller batches; the `.github/workflows/build-apk.yml` path must be preserved.
4. Ensure `web-project/index.html` exists. Upload the rest of your website's HTML/CSS/JS/assets into `web-project/` too, preserving relative folders.
5. Open repository **Actions** tab. If prompted, enable Actions.
6. Select **Wevlo Android APK Build** → **Run workflow**. Enter app name, package name (e.g. `com.example.myapp`), version `1.0`, version code `1`, then tap Run workflow.
7. Open the running workflow. Wait until all steps finish with a green check. Open the completed run → **Artifacts** → `wevlo-release-apk` to download the APK.

## Important signing warning

The included workflow generates a temporary signing key on each run, so a later APK will not be install as an update over the earlier APK. For a real published app, create and securely preserve one permanent keystore, save it as GitHub Actions secrets, and configure the workflow to reuse it. Never publish keystore files or passwords in the repository.

## Limits

- GitHub Actions has usage quotas and concurrency/retention limits; check your account's current plan limits.
- This workflow wraps a web project in a basic Android WebView app. It is not a compiler for arbitrary native Java/Kotlin Android projects.
- The workflow builds the contents of `web-project/`; it does not currently receive ZIP uploads from the live Wevlo website or expose a REST `/api/build` endpoint.
- Test the APK on an Android device before distributing it. Camera, microphone, geolocation, push notifications, and advanced WebView file-upload behavior need additional native permissions and implementation.
