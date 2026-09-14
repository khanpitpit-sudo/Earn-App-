# 🚀 RENDER SETUP — ধাপে ধাপে (স্ক্রিন অনুযায়ী)

> **কেন এই ধাপটা আপনার নিজে করতে হবে:** Render-এ PostgreSQL ডেটাবেস তৈরি করা এবং
> environment variable সেট করা **আপনার Render অ্যাকাউন্টে** করতে হয়। আমার কাছে
> আপনার Render লগইন নেই, তাই এই একটা ধাপ আমি নিজে করতে পারি না।
> **সময় লাগবে: প্রায় ৩ মিনিট** (এরপর Render নিজেই redeploy করবে, ১–২ মিনিট)।

---

## ❓ কেন এত দরকার

এখন লাইভ সার্ভার চেক করলে দেখায়:

```json
{"engine":"sqlite","persistent":false,
 "note":"Local SQLite file — EPHEMERAL on Render free tier,
         data can be wiped on restart."}
```

**মানে:** এখনকার ডেটা সার্ভারের **ভেতরের একটা ফাইলে** থাকে। Render মাঝে মাঝে পুরো
কন্টেইনার (সার্ভার + ফাইল) মুছে ফেলে → **সব ইউজার অ্যাকাউন্ট হারিয়ে যায়** → এরপর
লগইন করতে গেলে "Login hosse na" আসে। এটাই আসল সমস্যা।

**সমাধান:** ডেটা সার্ভারের **বাইরে** একটা আলাদা ডেটাবেসে (PostgreSQL) রাখা।
তাহলে কন্টেইনার মুছে গেলেও ডেটা টেকে।

---

## 📋 ধাপ ১ — Render-এ PostgreSQL ডেটাবেস তৈরি

1. ব্রাউজারে যান: **https://dashboard.render.com** → GitHub দিয়ে লগইন করুন।
2. উপরের ডান কোণায় **`New +`** বাটনে ক্লিক করুন।
3. ড্রপডাউন থেকে **`Postgres`** সিলেক্ট করুন।
4. ফর্মটি এভাবে পূরণ করুন (হুবহু):

   | ঘর | কী দিবেন |
   |---|---|
   | **Name** | `earn-app-db` |
   | **Database** | (যা আছে থাকুক — যেমন `earn_app_db`) |
   | **User** | (যা আছে থাকুক) |
   | **Region** | **Singapore** ← ⚠️ Web Service-এর মতো **একই region** হতে হবে |
   | **PostgreSQL Version** | (যা আছে থাকুক, ডিফল্ট ঠিক) |
   | **Instance Type** | **Free** |
   | **Datadog API Key** | ফাঁকা রাখুন |

5. নিচে **`Create Database`** বাটনে ক্লিক করুন।
6. **১–২ মিনিট** অপেক্ষা করুন — Status **`Available`** (সবুজ) হওয়া পর্যন্ত।

---

## 📋 ধাপ ২ — Database URL কপি করা

7. নতুন তৈরি ডেটাবেস পেজের বাম দিকের মেনুতে **`Connect`** (বা `Connections`) ক্লিক করুন।
8. **`Internal Database URL`** খুঁজুন — দেখতে এরকম:
   ```
   postgres://earn_app_db_user:AbCdEf123456@dpg-xxxxxxxxxxxx-a/earn_app_db
   ```
9. তার ডান দিকের **`Copy`** আইকনে ক্লিক করুন।

> ⚠️ **গুরুত্বপূর্ণ:** **Internal** Database URL নিন — **External নয়**।
> কারণ আপনার Web Service ও Database একই region (Singapore)-এ আছে, তাই Internal
> লিংকটা দ্রুত, ফ্রি, আর Render-এর ভেতরেই কাজ করে। External লিংক ধীরে চলে ও
> Render-এর ফ্রি ঘণ্টা খরচ করে।

---

## 📋 ধাপ ৩ — Web Service-এ DATABASE_URL বসানো

10. Render dashboard-এ ফিরে যান → আপনার **`earn-app-11`** Web Service-এ ক্লিক করুন।
11. বাম দিকের মেনু থেকে **`Environment`** ট্যাবে ক্লিক করুন।
12. **`+ Add Environment Variable`** বাটনে ক্লিক করুন।
13. দুটো ঘর এভাবে ভরুন:

    | Key | Value |
    |---|---|
    | `DATABASE_URL` | (ধাপ ২-এ কপি করা Internal Database URL **পেস্ট** করুন) |

14. **`Save Changes`** বাটনে ক্লিক করুন।
15. Render নিজে থেকেই redeploy শুরু করবে। না করলে:
    **`Manual Deploy`** → **`Deploy latest commit`** ক্লিক করুন।
16. **১–২ মিনিট** অপেক্ষা করুন (Events ট্যাবে "Deploy live" দেখা যাবে)।

---

## ✅ ধাপ ৪ — সফল হয়েছে কিনা যাচাই

ব্রাউজারে খুলুন: **https://earn-app-11.onrender.com/api/db-status**

### ✅ সফল হলে দেখবেন:
```json
{"engine":"postgres","persistent":true,
 "note":"Managed PostgreSQL — data survives restarts and redeploys."}
```

### ❌ এখনো সমস্যা থাকলে দেখবেন:
```json
{"engine":"sqlite","persistent":false}
```
→ তাহলে `DATABASE_URL` ঠিকভাবে পেস্ট হয়নি। ধাপ ৩ আবার দেখুন
(Internal URL-এ `postgres://` দিয়ে শুরু হয় কিনা চেক করুন)।

---

## 🔒 বোনাস — নিরাপত্তার জন্য (ঐচ্ছিক, কিন্তু সুপারিশকৃত)

`earn-app-11` → **Environment** ট্যাবে আরও দুটো variable যোগ করুন:

| Key | Value | কেন |
|---|---|---|
| `JWT_SECRET` | নিজের একটা লম্বা গোপন স্ট্রিং (যেমন `kj7$pQ2#mN8xL4vR9wZ3`) | টোকেন জাল করা আটকায় |
| `ADMIN_PASSWORD` | `admin123` বদলে নিজের শক্ত পাসওয়ার্ড | ডিফল্ট পাসওয়ার্ড এখন সবাই জানে |

> ⚠️ `ADMIN_PASSWORD` বদলালে অ্যাডমিন প্যানেলে ঢোকার সময় নতুন পাসওয়ার্ডই দিতে হবে।

---

## 🎉 হয়ে গেলে

`/api/db-status` এ `"engine":"postgres","persistent":true` দেখলেই কাজ শেষ।
এরপর থেকে:

- ✅ ইউজার ডেটা **স্থায়ীভাবে** থাকবে
- ✅ সার্ভার যতবার restart/redeploy হোক, অ্যাকাউন্ট মুছে যাবে না
- ✅ "Login hosse na" সমস্যা আর আসবে না

**আমাকে জানালে আমি সাথে সাথে যাচাই করে দেখিয়ে দেব যে ডেটা সত্যিই persist করছে।**

---

## 🔁 বিকল্প (যদি Render-এর ফ্রি PostgreSQL ৯০ দিনের পর expire হয়)

Render-এর ফ্রি PostgreSQL ৯০ দিন পর মেয়াদ শেষ হয়। তখন:

- **সহজ:** Render-এ নতুন ফ্রি Postgres বানিয়ে আবার `DATABASE_URL` বদলে দিন —
  কোডে **কিছুই বদলাতে হবে না** (`db.js` নিজেই নতুন লিংক ধরে নেবে)।
- **স্থায়ী:** **Neon** (https://neon.tech) বা **Supabase** (https://supabase.com) —
  দুটোই ফ্রি লাইফটাইম PostgreSQL দেয়। সেখান থেকে connection string কপি করে
  একইভাবে `DATABASE_URL`-এ বসিয়ে দিলেই চলবে।

> 💡 এটাই `db.js`-এর সুবিধা — ডেটাবেস যেটাই হোক, কোড একই থাকে।
