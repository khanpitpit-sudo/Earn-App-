# 🪙 আয় অ্যাপ (Earn App)

বিজ্ঞাপন দেখে আয় করার একটি আধুনিক Android অ্যাপ। ব্যবহারকারী AdMob-এর **Rewarded Ad** দেখে **টাকা** উপার্জন করতে পারে, ব্যালেন্স ও আয়ের হিসাব দেখতে পারে এবং **উইথড্র/ক্যাশ আউট** রিকোয়েস্ট করতে পারে। প্রতি বিজ্ঞাপন দেখলে **২ টাকা** পাওয়া যায়।

> 🔥 **নতুন:** এই সংস্করণে **ব্যাকএন্ড সার্ভার** যুক্ত হয়েছে! ব্যালেন্স সার্ভারে (SQLite) সংরক্ষিত হয়, রিওয়ার্ড সার্ভারে যোগ হয়, এবং উইথড্র রিকোয়েস্ট অ্যাডমিন প্যানেলে জমা হয়। bKash/Nagad/Rocket পেমেন্ট মাধ্যম ও মোবাইল নম্বর নেওয়া হয়।

---

## ✨ বৈশিষ্ট্য

- 🎨 **আধুনিক বাংলা ইন্টারফেস** — সহজ ও সুন্দর UI
- 📺 **AdMob Rewarded Ad** — বিজ্ঞাপন দেখলে টাকা পাওয়া যায় (প্রতি বিজ্ঞাপনে ২ টাকা)
- 💰 **টাকা ব্যালেন্স** — সার্ভারে সংরক্ষিত
- 📊 **ড্যাশবোর্ড** — ব্যালেন্স, মোট আয়, বিজ্ঞাপন সংখ্যা ও লেনদেনের ইতিহাস
- 💵 **উইথড্র/ক্যাশ আউট** — bKash/Nagad/Rocket + মোবাইল নম্বর দিয়ে রিকোয়েস্ট
- 🔐 **লগইন/রেজিস্টার** — ফোন নম্বর + পাসওয়ার্ড
- 🖥️ **অ্যাডমিন প্যানেল** — উইথড্র রিকোয়েস্ট অনুমোদন/বাতিল

## 📱 স্ক্রিন

| ট্যাব | কাজ |
|-------|-----|
| **ড্যাশবোর্ড** | ব্যালেন্স, মোট আয়, বিজ্ঞাপন সংখ্যা, লেনদেনের ইতিহাস |
| **আয় করুন** | "বিজ্ঞাপন দেখুন ও আয় করুন" বাটন — Rewarded Ad দেখে ২ টাকা |
| **উইথড্র** | টাকা উত্তোলনের রিকোয়েস্ট — bKash/Nagad/Rocket + মোবাইল নম্বর |

---

## 🔌 ব্যাকএন্ড সংযোগ (গুরুত্বপূর্ণ)

এই অ্যাপটি ব্যাকএন্ড সার্ভারের সাথে সংযুক্ত। **`earn-app-backend`** ফোল্ডারের সার্ভারটি চালু থাকতে হবে।

### BASE_URL সেট করুন
`app/src/main/java/com/khanpitpit/earnapp/data/ApiClient.kt`-এ `BASE_URL` পরিবর্তন করুন:

| পরিস্থিতি | BASE_URL |
|-----------|----------|
| **Emulator** (লোকাল) | `http://10.0.2.2:3000/` |
| **আসল ফোন** (একই Wi-Fi) | `http://<আপনারIP>:3000/` |
| **প্রোডাকশন** (Render/Railway) | `https://your-app.onrender.com/` |

### ব্যাকএন্ড চালু করুন
```bash
cd earn-app-backend
npm install
npm start
```

### অ্যাডমিন প্যানেল
- URL: `http://localhost:3000/admin`
- লগইন: `admin` / `admin123`

> 📖 সম্পূর্ণ ব্যাকএন্ড নির্দেশনা: `earn-app-backend/README.md`

---

## 🛠️ প্রযুক্তি

- **Kotlin** — আধুনিক Android ডেভেলপমেন্ট
- **Material Design 3** — সুন্দর UI কম্পোনেন্ট
- **AdMob (Google Mobile Ads SDK)** — Rewarded + Interstitial বিজ্ঞাপন
- **SharedPreferences** — ডেটা সংরক্ষণ
- **ViewBinding** — নিরাপদ ভিউ অ্যাক্সেস
- **Bottom Navigation** — ৩টি ট্যাব

---

## 📂 প্রজেক্ট স্ট্রাকচার

```
earn-app/
├── settings.gradle
├── build.gradle
├── gradle.properties
├── gradle/wrapper/gradle-wrapper.properties
└── app/
    ├── build.gradle
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/khanpitpit/earnapp/
        │   ├── MainActivity.kt
        │   ├── data/
        │   │   ├── PrefsManager.kt      (ব্যালেন্স/টাকা/লেনদেন)
        │   │   ├── Transaction.kt       (লেনদেন মডেল)
        │   │   └── AdManager.kt         (AdMob রিওয়ার্ডেড + ইন্টারস্টিশিয়াল)
        │   └── ui/
        │       ├── DashboardFragment.kt
        │       ├── EarnFragment.kt
        │       ├── WithdrawFragment.kt
        │       └── TransactionAdapter.kt
        └── res/
            ├── layout/                  # XML লেআউট
            ├── values/                  # strings (বাংলা), colors, themes
            ├── drawable/                # আইকন ও ব্যাকগ্রাউন্ড
            ├── menu/                    # বটম নেভিগেশন মেনু
            └── mipmap/                  # লঞ্চার আইকন
```

---

## 🚀 Android Studio-তে চালানোর ধাপ

### ধাপ ১: প্রজেক্ট খুলুন
1. **Android Studio** খুলুন (Hedgehog বা নতুন)
2. **File → Open** → `earn-app` ফোল্ডারটি নির্বাচন করুন
3. Gradle sync সম্পন্ন হওয়ার জন্য অপেক্ষা করুন

### ধাপ ২: AdMob সেটআপ (গুরুত্বপূর্ণ)
1. [AdMob](https://admob.google.com) এ যান এবং অ্যাকাউন্ট তৈরি করুন
2. **Apps → Add App** → আপনার অ্যাপ যোগ করুন
3. **App ID** কপি করুন এবং `AndroidManifest.xml`-এ বসান:
   ```xml
   <meta-data
       android:name="com.google.android.gms.ads.APPLICATION_ID"
       android:value="ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX" />
   ```
4. **Rewarded Ad Unit** তৈরি করুন এবং `AdManager.kt`-এ বসান:
   ```kotlin
   private const val REWARDED_AD_UNIT_ID = "ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX"
   ```
5. **Interstitial Ad Unit** তৈরি করুন এবং `AdManager.kt`-এ বসান:
   ```kotlin
   private const val INTERSTITIAL_AD_UNIT_ID = "ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX"
   ```

> ⚠️ **নোট:** বর্তমানে Google-এর **টেস্ট Ad Unit ID** ব্যবহার করা হয়েছে, যাতে ডেভেলপমেন্টের সময় আসল বিজ্ঞাপন না দেখায়। প্রকাশের আগে অবশ্যই নিজের আসল ID বসান।

### ধাপ ৩: বিল্ড ও রান
1. উপরের টুলবারে **Run ▶** বাটনে চাপুন
2. একটি **Emulator** বা **ফিজিক্যাল ডিভাইস** নির্বাচন করুন
3. অ্যাপটি ইনস্টল ও চালু হবে

### ধাপ ৪: APK তৈরি (Release)
```bash
# Debug APK
./gradlew assembleDebug

# Release APK
./gradlew assembleRelease
```
APK ফাইল পাওয়া যাবে: `app/build/outputs/apk/debug/app-debug.apk`

---

## 🎮 অ্যাপ ব্যবহার

1. **ড্যাশবোর্ড** — আপনার বর্তমান ব্যালেন্স, মোট আয় ও বিজ্ঞাপন সংখ্যা দেখুন
2. **আয় করুন** — "📺 বিজ্ঞাপন দেখুন ও আয় করুন" বাটনে চাপুন → বিজ্ঞাপন সম্পূর্ণ দেখুন → ২ টাকা যোগ হবে
3. **উইথড্র** — পরিমাণ লিখে "উইথড্র রিকোয়েস্ট করুন" চাপুন (ডেমো)

---

## ⚙️ কাস্টমাইজেশন

### প্রতি বিজ্ঞাপনের রিওয়ার্ড পরিবর্তন
`AdManager.kt`-এ:
```kotlin
const val REWARD_PER_AD = 2.0   // প্রতি বিজ্ঞাপনে ২ টাকা
```

### সর্বনিম্ন উইথড্র পরিবর্তন
`WithdrawFragment.kt`-এ:
```kotlin
val minimumWithdraw = 50.0   // ৫০ টাকা
```

### অ্যাপের নাম পরিবর্তন
`res/values/strings.xml`-এ:
```xml
<string name="app_name">আপনার নাম</string>
```

---

## 📝 লাইসেন্স

এই প্রজেক্টটি শিক্ষামূলক/ডেমো উদ্দেশ্যে তৈরি। বাণিজ্যিক ব্যবহারের আগে AdMob-এর নীতিমালা ও স্থানীয় আইন মেনে চলুন।

---

## ❓ সমস্যা সমাধান

**প্রশ্ন: বিজ্ঞাপন দেখাচ্ছে না?**
- ইন্টারনেট সংযোগ আছে কিনা দেখুন
- AdMob App ID ও Ad Unit ID সঠিকভাবে বসানো হয়েছে কিনা দেখুন
- টেস্ট ID ব্যবহার করলে আসল বিজ্ঞাপন দেখাবে না (এটি স্বাভাবিক)

**প্রশ্ন: Gradle sync fail করছে?**
- Android Studio আপডেট করুন
- `File → Sync Project with Gradle Files` চাপুন
- ইন্টারনেট সংযোগ আছে কিনা দেখুন

**প্রশ্ন: বাংলা টেক্সট ঠিকঠাক দেখাচ্ছে না?**
- ডিভাইসে বাংলা ফন্ট সাপোর্ট আছে কিনা দেখুন (সাধারণত Android-এ আছে)