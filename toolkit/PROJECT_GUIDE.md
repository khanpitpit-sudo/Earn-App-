# 🛠️ Earn App — Build & Deploy Guide

> **উদ্দেশ্য:** এই প্রজেক্টে আগে যে ভুলগুলো বারবার হয়েছে (৮ বার Gradle crash,
> duplicate resource, ভুল curl, ভুল ফাইল টুল) — সেগুলো যাতে আর না হয়।
> **এই ফাইলটা পড়লেই নতুন কেউ (বা আমি নিজেও) একই ভুল করব না।**

---

# 📦 ১. প্রজেক্টের কাঠামো

```
Earn-App-/
├── server.js              # Express API (v2.0.0) — সব route async
├── db.js                  # ⭐ Dual-engine DB adapter (PostgreSQL ⊕ sql.js)
├── package.json           # pg + sql.js + express + jsonwebtoken + bcrypt
├── admin/                 # অ্যাডমিন প্যানেল (ব্রাউজারে /admin)
├── .github/workflows/
│   └── keep-alive.yml     # প্রতি ১০ মিনিটে সার্ভার পিং (Render ঘুমায় না)
├── toolkit/               # ⭐ এই গাইড + স্ক্রিপ্টগুলো
│   ├── PROJECT_GUIDE.md
│   ├── RENDER_POSTGRES_SETUP_GUIDE.md
│   ├── check-resources.sh # Android রিসোর্স যাচাই
│   └── build-safe.sh      # মেমরি-সেফ APK বিল্ড
└── (Android build files — build.gradle, settings.gradle, gradle.properties)
```

**লাইভ সার্ভার:** https://earn-app-11.onrender.com
**অ্যাডমিন প্যানেল:** https://earn-app-11.onrender.com/admin
**টেস্ট অ্যাকাউন্ট:** `01712345678` / `123456`
**অ্যাডমিন:** `admin` / `admin123` ⚠️ (বদলে ফেলা উচিত)

---

# 🧠 ২. ডেটাবেস — dual-engine ডিজাইন

`db.js` একটাই কোড, দুইটা ইঞ্জিন চালায়:

```
DATABASE_URL সেট আছে?  ──হ্যাঁ──▶  PostgreSQL   (persistent: true  ✅)
        │
        না
        ▼
   sql.js / SQLite ফাইল   (persistent: false ⚠️  Render-এ মুছে যেতে পারে)
```

**কেন এভাবে:** Render-এ env var সেট করার আগেও সার্ভার চলে, আর সেট করার পরে
কোড **এক লাইনও** বদলাতে হয় না।

**কীভাবে বোঝা যায় কোনটা চলছে:**
```bash
curl -s https://earn-app-11.onrender.com/api/db-status
# {"engine":"postgres","persistent":true}   ← এটাই চাই
# {"engine":"sqlite","persistent":false}    ← তখনো সেট করা হয়নি
```

> ⚠️ **মনে রাখুন:** `sqlite` মানে ডেটা সার্ভারের ভেতরে — Render কন্টেইনার
> মুছে ফেললে **সব ইউজার হারিয়ে যাবে**। বিস্তারিত: `RENDER_POSTGRES_SETUP_GUIDE.md`

---

# 🚫 ৩. নিরীহ (হলেও ভয় পাওয়ার কিছু নেই)

লাল ✗ মানেই সমস্যা নয়। নিচেরগুলো **ইচ্ছে করে** ঘটে:

| যা দেখবেন | কেন হয় | সঠিক পদ্ধতি |
|---|---|---|
| `create_file` ✗ — "ফাইল আগে থেকেই আছে" | নিরাপত্তা: ভুলে পুরনো ফাইল মুছে না যায় | **`full_file_rewrite`** (পুরো ফাইল) বা **`str_replace`** (এক জায়গা) |
| `ls <file>` ✗ — exit code 1 | না থাকাটাই ছিল উত্তর | `ls x 2>/dev/null \|\| echo "নেই"` |
| `grep` ✗ — কিছু পেল না | "পাওয়া যায়নি" মানে ব্যর্থতা নয় | ফল নিজেই উত্তর |
| `curl` **403** | `/sites/…` URL access-controlled | **সম্পূর্ণ URL সরাসরি curl করুন** — শেল নিজেই টোকেন বসায় |
| `wget` ✗ — TLS error | sandbox egress proxy | **সবসময় `curl`**, কখনো `wget` নয় |

**চেনার নিয়ম:** লাল ✗-এর **পরে** একই কাজে সবুজ ✓ এলে → নিরীহ।

---

# 🔴 ৪. আসল সমস্যা ও সমাধান

## ৪.১ Gradle daemon "disappeared unexpectedly" — **৮ বার build ভেঙেছে** 🔥

**কারণ:** sandbox-এর মেমরি সীমা ~2 GB। Gradle daemon heap + dexing worker +
Kotlin daemon-এর সর্বোচ্চ সীমা যোগ করে ২ GB ছাড়িয়ে গেলে OOM killer daemon মেরে দেয়।
সাথে **আগের রান থেকে পড়ে থাকা daemon** ~1.4 GB ধরে রাখে।

**সমাধান — `gradle.properties`-এ এই প্রোফাইল (v11-এ কাজ করেছে):**
```properties
org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=256m -XX:+UseSerialGC -Dfile.encoding=UTF-8
org.gradle.daemon=false
org.gradle.parallel=false
org.gradle.workers.max=1
kotlin.compiler.execution.strategy=in-process
android.dexingWorkerOptions.jvmArgs=-Xmx768m
kotlin.daemon.jvmargs=-Xmx512m
```
**➕ বিল্ডের আগে সবসময় daemon পরিষ্কার করুন:**
```bash
./gradlew --stop
pkill -f GradleDaemon
pkill -f KotlinCompileDaemon
free -m          # ~800 MB+ খালি থাকা দরকার
```
➡️ সব একসাথে: **`./toolkit/build-safe.sh /path/to/project`**

## ৪.২ Build timeout (৬০ সেকেন্ড)

Gradle release build-এ **৮০–৯০ সেকেন্ড** লাগে — ডিফল্ট ৬০s timeout-এ কাটা পড়ে।

**ভুল:** `execute_command(..., blocking=true)` ← টাইমআউট হবে
**সঠিক:**
```
execute_command(command="./toolkit/build-safe.sh /workspace/build-earn-v11",
                blocking=false, session_name="apkbuild")
# তারপর:
check_command_output(session_name="apkbuild")
```

## ৪.৩ Duplicate resource / ভাঙা রেফারেন্স

```
./toolkit/check-resources.sh /path/to/project
```
যাচাই করে: duplicate `<string>`/`<color>`, `values/` ⊕ `res/color/` clash,
✨ ১৩০টি ডেফিনিশনের বিপরীতে সব `@color/…` reference resolve হয় কিনা, keystore সেটআপ।

**নিয়ম:** নতুন color/string যোগ করার আগে চেক করুন একই নাম আগে নেই।
`res/color/x.xml` (colour-state-list) আর `values/colors.xml`-এর `<color name="x">`
**একসাথে থাকলে AAPT ভাঙবে**।

## ৪.৪ সাইনিং / keystore

```
keystore.properties:
  storeFile=keystore/earn-app-release.jks
  storePassword=EarnApp@2026#Secure
  keyAlias=earnapp
  keyPassword=EarnApp@2026#Secure
```
⚠️ **কখনো বদলাবেন না** — keystore/alias/password একটুও বদলালে APK পুরনো অ্যাপের
**উপরে ইনস্টল হবে না**। সার্টিফিকেট:
```
CN=Earn App, OU=Mobile, O=KhanPitpit, L=Dhaka, ST=Dhaka, C=BD
SHA-256: c8ba5fc1bf7923639b0f851f3850e73832d270be9ab8701cada23d23688979c6
```
যাচাই:
```bash
$ANDROID_HOME/build-tools/*/apksigner verify --print-certs app-release.apk
```

## ৪.৫ সার্ভার cold start (৩০–৫০ সেকেন্ড)

Render ফ্রি সার্ভিস ১৫ মিনিট নিষ্ক্রিয় থাকলে ঘুমিয়ে পড়ে।
**সমাধান:** `.github/workflows/keep-alive.yml` — প্রতি ১০ মিনিটে
`/api/health` পিং করে ✅ (রেপোতে আছে, চালু আছে)।

## ৪.৬ ডিস্ক ভরে যাওয়া

প্রতিটা বিল্ড ~২০–৮৫ MB। পুরনো ডিরেক্টরি জমে ডিস্ক ভরে।
```bash
du -sh build-earn* | sort -h        # কত জমেছে দেখুন
rm -rf build-earn-v2 build-earn-v3  # যা দরকার নেই মুছুন
```

---

# ✅ ৫. কাজের আদর্শ নিয়ম (চেকলিস্ট)

**APK বিল্ড করার আগে:**
- [ ] `./toolkit/check-resources.sh <project>` → **CLEAN** আসতে হবে
- [ ] `./gradlew --stop && pkill -f GradleDaemon` → পুরনো daemon পরিষ্কার
- [ ] `free -m` → কমপক্ষে **৮০০ MB** available
- [ ] `blocking=false` + `check_command_output` দিয়ে চালান

**সার্ভার বদলানোর পরে:**
- [ ] `curl /api/health` → **200**
- [ ] `curl /api/db-status` → কোন engine চলছে দেখুন
- [ ] টেস্ট লগইন: `POST /api/login` → **200** + token

**ফাইল লেখার সময়:**
- [ ] ফাইল আগে আছে কি না দেখুন → থাকলে `full_file_rewrite`, নাহলে `create_file`
- [ ] আর্টিফ্যাক্ট URL হলে **সম্পূর্ণ URL সরাসরি curl** (ভাগ করে বসাবেন না)

---

# 🔧 ৬. টুলকিট স্ক্রিপ্ট

| স্ক্রিপ্ট | কাজ |
|---|---|
| `./toolkit/check-resources.sh <project>` | Duplicate + ভাঙা রেফারেন্স + keystore যাচাই |
| `./toolkit/build-safe.sh <project>` | Daemon পরিষ্কার → মেমরি চেক → রিসোর্স চেক → নিরাপদ বিল্ড → APK + SHA256 |

দুটোই `chmod +x` করা আছে। আউটপুট লগ যায় `<project>/build-logs/`-এ।

---

# 📞 ৭. সমস্যা হলে দ্রুত ডায়াগনসিস

| লক্ষণ | সম্ভাব্য কারণ | প্রথমে চেক করুন |
|---|---|---|
| APK onboard হয় না | keystore বদলেছে | `apksigner verify --print-certs` |
| Build "daemon disappeared" | OOM | `free -m`, daemon kill |
| Build ৩ মিনিটে কাটা | timeout | `blocking=false` ব্যবহার |
| অ্যাপে "Login hosse na" | ইউজার DB মুছে গেছে | `curl /api/db-status` → `persistent` |
| লগইন ৩০+ সেকেন্ড | সার্ভার ঘুমিয়ে | keep-alive workflow চলছে? |
| `@color/x` "not found" | ভাঙা রেফারেন্স | `check-resources.sh` |
| 403 on download | টোকেন ছাড়া URL | সম্পূর্ণ URL সরাসরি curl |
