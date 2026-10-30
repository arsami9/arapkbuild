'use strict';
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
const WORK_DIR = process.env.WORK_DIR || path.join(os.tmpdir(), 'wevlo-builds');
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024;
const RETENTION_HOURS = Number(process.env.RETENTION_HOURS || 12);
fs.mkdirSync(WORK_DIR, { recursive: true });
const jobs = new Map();
app.disable('x-powered-by');
app.use(cors({ origin(origin, cb) { if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return cb(null, true); cb(new Error('Origin not allowed by build server CORS policy')); }, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'wevlo-build-server', builder: 'gradle-apksigner', mode: 'webview-wrapper' }));
const buildLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: Number(process.env.BUILDS_PER_IP_PER_HOUR || 10), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Build rate limit reached. Try again later.' } });
const upload = multer({ dest: path.join(WORK_DIR, 'uploads'), limits: { fileSize: MAX_UPLOAD, files: 1 } });

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error((err || out || `${cmd} exited ${code}`).slice(-7000))));
  });
}
function safePackage(v) {
  if (typeof v !== 'string' || v.length > 180 || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,7}$/.test(v)) throw new Error('Invalid Android package name. Use lowercase, for example com.example.myapp.');
  return v;
}
function xml(v) { return String(v ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
function log(job, message) { job.logs.push(new Date().toISOString() + ' ' + message); if (job.logs.length > 250) job.logs.shift(); }
function step(job, state, message) { job.step = state; log(job, message); }
function write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
function javaPackagePath(pkg) { return pkg.replace(/\./g, '/'); }
function manifestFor(c) {
  const perms = ['android.permission.INTERNET'];
  if (c.camera) perms.push('android.permission.CAMERA');
  if (c.mic) perms.push('android.permission.RECORD_AUDIO');
  if (c.location) perms.push('android.permission.ACCESS_FINE_LOCATION');
  if (c.notifications || c.push) perms.push('android.permission.POST_NOTIFICATIONS');
  const orient = ({portrait:'portrait',landscape:'landscape',auto:'unspecified'})[c.orient] || 'unspecified';
  return `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n${perms.map(p => `  <uses-permission android:name="${p}" />`).join('\n')}\n  <application android:allowBackup="false" android:label="${xml(c.name || 'Wevlo App')}" android:usesCleartextTraffic="false" android:theme="@android:style/Theme.Material.Light.NoActionBar">\n    <activity android:name=".MainActivity" android:exported="true" android:screenOrientation="${orient}">\n      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>\n    </activity>\n  </application>\n</manifest>\n`;
}
async function unpackZip(zipPath, dest) {
  const listing = await run('unzip', ['-Z1', zipPath]);
  const names = listing.split(/\r?\n/).filter(Boolean);
  if (names.length > 5000) throw new Error('ZIP contains too many files (maximum 5000).');
  for (const n of names) {
    if (n.startsWith('/') || n.includes('\\') || n.split('/').includes('..') || /^[A-Za-z]:/.test(n)) throw new Error('Unsafe path found in uploaded ZIP.');
  }
  await run('unzip', ['-q', zipPath, '-d', dest]);
  return names;
}
function createAndroidProject(root, c, sourceDir) {
  const pkg = safePackage(c.pkg || 'com.wevlo.generated');
  const appDir = path.join(root, 'app');
  const assetDir = path.join(appDir, 'src/main/assets/www');
  const javaDir = path.join(appDir, 'src/main/java', javaPackagePath(pkg));
  fs.mkdirSync(assetDir, { recursive: true }); fs.mkdirSync(javaDir, { recursive: true });
  let startUrl = '';
  if (c.source === 'url' || c.tab === 'web' && c.source === 'url') {
    const u = new URL(c.url);
    if (!['https:','http:'].includes(u.protocol)) throw new Error('Website URL must use HTTP or HTTPS.');
    if (u.protocol !== 'https:' && process.env.ALLOW_HTTP_URLS !== 'true') throw new Error('Use an HTTPS website URL. Plain HTTP URLs are disabled by default.');
    startUrl = u.toString();
  } else {
    if (!sourceDir) throw new Error('A source ZIP is required for a project build.');
    const index = path.join(sourceDir, 'index.html');
    if (!fs.existsSync(index)) {
      const nested = findIndexHtml(sourceDir);
      if (!nested) throw new Error('Uploaded ZIP must contain index.html at its root or in a single top-level project folder.');
      copyTree(nested, assetDir);
    } else copyTree(sourceDir, assetDir);
    if (!fs.existsSync(path.join(assetDir, 'index.html'))) throw new Error('Could not locate index.html after extracting project ZIP.');
    startUrl = 'file:///android_asset/www/index.html';
  }
  write(path.join(root, 'settings.gradle.kts'), `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name = "WevloGeneratedApp"\ninclude(":app")\n`);
  write(path.join(root, 'build.gradle.kts'), `plugins { id("com.android.application") version "8.7.3" apply false }\n`);
  write(path.join(root, 'gradle.properties'), 'org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\norg.gradle.parallel=false\n');
  write(path.join(appDir, 'build.gradle.kts'), `plugins { id("com.android.application") }\nandroid { namespace = "${pkg}"; compileSdk = 35; defaultConfig { applicationId = "${pkg}"; minSdk = ${Math.max(21, Math.min(35, Number(c.minSdk) || 23))}; targetSdk = 35; versionCode = ${Math.max(1, Math.min(2100000000, Number(c.vcode) || 1))}; versionName = "${String(c.vname || '1.0').replace(/[^A-Za-z0-9._+-]/g, '').slice(0,32)}" } }\n`);
  const java = `package ${pkg};\nimport android.app.Activity;\nimport android.os.Bundle;\nimport android.webkit.WebChromeClient;\nimport android.webkit.WebView;\nimport android.webkit.WebViewClient;\nimport android.webkit.WebSettings;\nimport android.view.ViewGroup;\npublic class MainActivity extends Activity { private WebView web; @Override public void onCreate(Bundle b) { super.onCreate(b); web = new WebView(this); web.setLayoutParams(new ViewGroup.LayoutParams(-1,-1)); WebSettings s = web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setAllowFileAccess(true); s.setAllowContentAccess(true); s.setMediaPlaybackRequiresUserGesture(true); web.setWebViewClient(new WebViewClient()); web.setWebChromeClient(new WebChromeClient()); setContentView(web); web.loadUrl("${startUrl.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"); } @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); } @Override protected void onDestroy() { if (web != null) web.destroy(); super.onDestroy(); } }\n`;
  write(path.join(javaDir, 'MainActivity.java'), java);
  write(path.join(appDir, 'src/main/AndroidManifest.xml'), manifestFor(c));
  return pkg;
}
function findIndexHtml(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory());
  if (entries.length === 1) { const p = path.join(root, entries[0].name); if (fs.existsSync(path.join(p, 'index.html'))) return p; }
  return null;
}
function copyTree(src, dst) {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const a = path.join(src, ent.name), b = path.join(dst, ent.name);
    if (ent.isDirectory()) copyTree(a, b);
    else if (ent.isFile()) { if (fs.statSync(a).size > 15 * 1024 * 1024) throw new Error(`File too large: ${ent.name}`); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); }
  }
}
async function build(job, sourceZip, config) {
  const root = path.join(WORK_DIR, job.id), extracted = path.join(root, 'source');
  fs.mkdirSync(root, { recursive: true });
  try {
    step(job, 'connect', 'Build worker allocated.');
    let sourceDir = null;
    if (sourceZip) { step(job, 'configure', 'Inspecting source ZIP and validating paths.'); sourceDir = extracted; fs.mkdirSync(sourceDir, { recursive: true }); await unpackZip(sourceZip, sourceDir); }
    const pkg = safePackage(config.pkg || 'com.wevlo.generated');
    step(job, 'configure', 'Updating Android Manifest and app configuration.');
    createAndroidProject(root, config, sourceDir);
    // A temporary per-build signing key is generated on the worker; keep it private and do not expose it.
    const ks = path.join(root, 'release.keystore');
    await run('keytool', ['-genkeypair','-v','-keystore',ks,'-storepass','changeit','-keypass','changeit','-alias','wevlo-release','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Wevlo Build,O=Wevlo,C=BD']);
    const gradle = path.join(root, 'app/build.gradle.kts');
    fs.appendFileSync(gradle, `\nandroid { signingConfigs { create("release") { storeFile = file("../release.keystore"); storePassword = "changeit"; keyAlias = "wevlo-release"; keyPassword = "changeit" } }; buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release"); isMinifyEnabled = false } } }\n`);
    step(job, 'package', 'Compiling Android resources and packaging release APK with Gradle.');
    await run('gradle', ['--no-daemon','--stacktrace','assembleRelease'], { cwd: root, env: { ...process.env, ANDROID_HOME: process.env.ANDROID_HOME || '/opt/android-sdk', ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || '/opt/android-sdk' } });
    const apk = path.join(root, 'app/build/outputs/apk/release/app-release.apk');
    if (!fs.existsSync(apk)) throw new Error('Gradle completed but release APK was not found.');
    step(job, 'sign', 'Verifying APK signature with apksigner.');
    const bt = process.env.ANDROID_BUILD_TOOLS || '/opt/android-sdk/build-tools/35.0.0';
    await run(path.join(bt, 'apksigner'), ['verify','--verbose',apk]);
    const finalPath = path.join(root, `${pkg.replace(/\./g,'-')}-${String(config.vname || '1.0').replace(/[^A-Za-z0-9._-]/g,'_')}.apk`);
    fs.copyFileSync(apk, finalPath);
    job.file = finalPath; job.size = +(fs.statSync(finalPath).size / 1048576).toFixed(2); job.state = 'done'; job.step = 'done';
    job.downloadUrl = `${BASE_URL}/api/build/download/${job.id}`;
    log(job, `BUILD SUCCESSFUL — signed APK ready (${job.size} MB).`);
  } catch (e) {
    job.state = 'failed'; job.error = String(e.message || e).slice(-7000); log(job, 'BUILD FAILED: ' + job.error);
  } finally {
    try { if (sourceZip && fs.existsSync(sourceZip)) fs.unlinkSync(sourceZip); } catch {}
    // Remove the private keystore immediately after signing; retain APK and status for a short period.
    try { const ks = path.join(root, 'release.keystore'); if (fs.existsSync(ks)) fs.unlinkSync(ks); } catch {}
  }
}
app.post('/api/build', buildLimiter, upload.single('source'), async (req, res) => {
  let config;
  try { config = JSON.parse(req.body.config || '{}'); } catch { if (req.file) fs.rmSync(req.file.path,{force:true}); return res.status(400).json({ error: 'config must be valid JSON' }); }
  if (!config || typeof config !== 'object') { if (req.file) fs.rmSync(req.file.path,{force:true}); return res.status(400).json({ error: 'config must be a JSON object' }); }
  if (!req.file && config.source !== 'url') return res.status(400).json({ error: 'Upload a project ZIP or set source=url with an HTTPS website URL.' });
  const id = crypto.randomUUID(); const job = { id, state: 'queued', step: 'queued', logs: [], created: Date.now(), size: 0, downloadUrl: null, error: null };
  jobs.set(id, job); log(job, 'Build queued.'); res.status(202).json({ id });
  build(job, req.file ? req.file.path : null, config).catch(e => { job.state='failed'; job.error=String(e.message||e); log(job,'BUILD FAILED: '+job.error); });
});
app.get('/api/build/status/:id', (req, res) => {
  const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: 'Build job not found or expired.' });
  res.json({ id:j.id, state:j.state, step:j.step, logs:j.logs, downloadUrl:j.downloadUrl, size:j.size, error:j.error });
});
app.get('/api/build/download/:id', (req, res) => {
  const j = jobs.get(req.params.id); if (!j || j.state !== 'done' || !j.file || !fs.existsSync(j.file)) return res.status(404).json({ error: 'APK is not ready or has expired.' });
  res.download(j.file, path.basename(j.file));
});
app.use((err, _req, res, _next) => { const status = err instanceof multer.MulterError ? 413 : 400; res.status(status).json({ error: err.message || 'Request failed.' }); });
setInterval(() => { const cutoff = Date.now() - RETENTION_HOURS * 3600000; for (const [id,j] of jobs) if (j.created < cutoff) { jobs.delete(id); fs.rmSync(path.join(WORK_DIR,id),{recursive:true,force:true}); } }, 30 * 60 * 1000).unref();
app.listen(PORT, '0.0.0.0', () => console.log(`Wevlo APK build server listening on :${PORT}`));
