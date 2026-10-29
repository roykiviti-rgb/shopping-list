# 🛒 רשימת הקניות שלנו

רשימת קניות משותפת לשניים, שמתעדכנת בזמן אמת. אפשר לפתוח כמה רשימות (סופר, סופר-פארם…), להוסיף פריטים עם כמות והערה, לסמן מה כבר נקנה, לערוך ולמחוק.
הרשימה עובדת גם בלי קליטה בסופר: השינויים נשמרים בטלפון ומסתנכרנים כשהחיבור חוזר.

- **קוד**: HTML/CSS/JS רגיל, בלי שלב build.
- **מידע והתחברות**: Firebase (Firestore + התחברות עם Google).
- **אחסון**: Vercel (אתר סטטי).
- **הרשאות**: רק שתי כתובות הג'ימייל שמופיעות ב-`firestore.rules` יכולות לקרוא ולכתוב.

## הקמה (פעם אחת, בערך 10 דקות)

### 1. Firebase
1. נכנסים ל-<https://console.firebase.google.com> ← **Create a project** (אפשר לכבות את Google Analytics).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** ← שומרים.
3. **Build → Firestore Database → Create database** ← בוחרים מיקום (למשל `eur3`) ← **Start in production mode**.
4. בלשונית **Rules** של Firestore מדביקים את התוכן של `firestore.rules`, מחליפים את `PARTNER_EMAIL@gmail.com` במייל של בת הזוג ← **Publish**.
5. **Project settings (⚙️) → Your apps → `</>` (Web)** ← נותנים שם ← **Register app**. מעתיקים את האובייקט `firebaseConfig` לקובץ `firebase-config.js` בריפו.

### 2. GitHub
מעלים את התיקייה לריפו חדש (למשל `shopping-list`).

### 3. Vercel
1. <https://vercel.com/new> ← **Import** של הריפו.
2. Framework Preset: **Other**, בלי Build Command ← **Deploy**.
3. מעתיקים את הכתובת שקיבלתם (למשל `shopping-list-xyz.vercel.app`).

### 4. לחבר בין Vercel ל-Firebase
ב-Firebase: **Authentication → Settings → Authorized domains → Add domain** ← מדביקים את כתובת ה-Vercel (בלי `https://`).

### 5. בטלפון
פותחים את הכתובת, מתחברים עם Google, ו"הוספה למסך הבית" (בספארי: כפתור השיתוף; בכרום: ⋮). מעכשיו זה נראה ומתנהג כמו אפליקציה.

## עדכונים
כל `git push` ל-`main` מתפרס אוטומטית ב-Vercel.
להוספת משתמש נוסף: מוסיפים את המייל שלו לרשימה ב-Rules של Firestore.

## פיתוח מקומי
```bash
npx serve .
```
ואז להוסיף `localhost` ל-Authorized domains (בדרך כלל כבר קיים).
