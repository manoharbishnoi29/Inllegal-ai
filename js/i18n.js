import { LANGS, CONTENT_LANG, translateText, isRTL } from './translate.js';

/* English is the base. Hindi and Urdu are written by hand.
   Every other language in LANGS is translated automatically the first time it is chosen (then cached on the device). */
const EN = {
  status: 'Online · instant answers', menu: 'Menu', search: 'Search answers', install: 'Install app', close: 'Close',
  getPremium: '👑 Get Premium', premiumOn: '👑 Premium', managePremium: '👑 Manage Premium',
  searchPh: 'Search by keyword', askPh: 'Type your question…', typeMore: 'Type at least 2 letters.',
  noResults: 'Nothing found. Send your question in the chat and it will be forwarded to the admin.', premiumAnswer: 'Premium answer',
  freePlan: 'Free plan', premiumUntil: 'Premium · until {date}', newChat: 'New chat', prevChats: 'Previous chats',
  noChats: 'No previous chats yet.', logout: 'Log out', logoutConfirm: 'Log out?', language: 'Language',
  today: 'Today', yesterday: 'Yesterday',
  welcome: 'Hello! 👋 Ask your question in any language. Saved answers appear instantly, along with links and downloads.',
  fallback: "Sorry! We don't have an answer yet. Your question has been forwarded to the admin.",
  locked: '🔒 This answer is available to Premium members only.', preview: 'Preview: {text}', getPremiumLock: 'Get Premium',
  newReply: 'New reply received', netProblem: 'Network problem. Please try again.',
  loadFail: 'Could not load the chat. Check the Firestore rules.', transFail: 'Translation is unavailable right now. Showing the original text.',
  openApp: 'Open App', openWebsite: 'Open Website', downloadApk: 'Download APK',
  tabLogin: 'Log in', tabSignup: 'Sign up', authSubLogin: 'Log in to ask your questions.',
  authSubSignup: 'Create a new account. You will need to verify your email.',
  email: 'Email', password: 'Password', emailPh: 'you@gmail.com', passPh: 'At least 6 characters', show: 'Show', hide: 'Hide',
  login: 'Log in', create: 'Create account', or: 'or', google: 'Continue with Google', forgot: 'Forgot password?',
  adminSees: 'Your chats and account details are visible to the admin.', wait: 'Please wait…',
  eEmail: 'That email address is not valid.', eNoPass: 'Enter your password.', eWeak: 'Password must be at least 6 characters.',
  eInUse: 'This email is already registered. Please log in.', eCred: 'Incorrect email or password.',
  eNoUser: 'No account found for this email. Please sign up.', eMany: 'Too many attempts. Please try again later.',
  eNet: 'Check your internet connection.', ePopup: 'Google sign-in was closed.', ePopupBlocked: 'The popup was blocked. Allow popups and try again.',
  eDomain: 'This site is not an authorized domain in Firebase.', eMethod: 'This sign-in method is not enabled in Firebase.',
  eGeneric: 'Something went wrong.', enterBoth: 'Enter both email and password.',
  enterEmailFirst: 'Enter your email above first, then tap this again.', resetSent: 'Password reset link sent. Check your inbox or spam folder.',
  verifyTitle: 'Verify your email', verifySentTo: 'We sent a verification link to:',
  verifyHint: "Open your email, tap the link, then come back here. Check your spam folder if you can't find it.",
  iVerified: "I've verified", resend: 'Resend email', resendIn: 'Resend ({n}s)', diffEmail: 'Use a different email',
  verifySent: 'Verification email sent.', verifyFirst: 'Please verify this email first.',
  notVerifiedYet: 'Not verified yet. Tap the link in the email, then press this button again.', sentAgain: 'Email sent again. Check your spam folder too.',
  premium: 'Premium', premActive: '✅ Premium active ({plan}) until {date}. You can renew below to add more time.',
  premIntro: 'Unlock premium answers. Pay by UPI and the admin will activate your plan.',
  premUnavailable: 'Premium is not available right now. Please check back later.', monthly: 'Monthly', yearly: 'Yearly',
  days30: '30 days', days365: '365 days', step1: 'Step 1: Pay ₹{price} by UPI', openUpi: 'Open UPI app and pay ₹{price}', upiId: 'UPI ID',
  copy: 'Copy', copied: 'UPI ID copied', copyFail: 'Copy failed. Please copy it manually.',
  payExact: 'Pay exactly ₹{price}. After paying, copy the UTR / transaction ID from your UPI app.',
  step2: 'Step 2: Enter your payment details', utrLabel: 'UPI transaction ID (UTR)', utrPh: '12-digit UTR / reference number',
  nameLabel: 'Your name', namePh: 'Full name', mobileLabel: 'Mobile number (optional)', mobilePh: '10-digit mobile number',
  submitPay: 'Submit payment details', startsAfter: 'Premium starts after the admin verifies your payment.',
  myRequests: 'My payment requests', noRequests: 'No payment requests yet.', pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
  reasonLbl: 'Reason: {text}', errUtr: 'Enter a valid UTR / transaction ID (letters and numbers only).', errName: 'Please enter your name.',
  errMobile: 'Enter a valid mobile number or leave it empty.', errPlan: 'This plan is not available.',
  utrDup: 'This UTR was already submitted, or the details are not valid.', submitFail: 'Could not submit. Please try again.',
  paySubmitted: 'Payment details submitted. The admin will verify them soon.', premActivated: 'Premium activated! 🎉',
};

const HI = {
  status: 'ऑनलाइन · तुरंत जवाब', menu: 'मेन्यू', search: 'जवाब खोजें', install: 'ऐप इंस्टॉल करें', close: 'बंद करें',
  getPremium: '👑 प्रीमियम लें', premiumOn: '👑 प्रीमियम', managePremium: '👑 प्रीमियम मैनेज करें',
  searchPh: 'कीवर्ड से खोजें', askPh: 'अपना सवाल लिखें…', typeMore: 'कम से कम 2 अक्षर लिखें।',
  noResults: 'कुछ नहीं मिला। अपना सवाल चैट में भेजें, वह एडमिन को भेज दिया जाएगा।', premiumAnswer: 'प्रीमियम जवाब',
  freePlan: 'फ्री प्लान', premiumUntil: 'प्रीमियम · {date} तक', newChat: 'नई चैट', prevChats: 'पुरानी चैट',
  noChats: 'अभी कोई पुरानी चैट नहीं है।', logout: 'लॉग आउट', logoutConfirm: 'लॉग आउट करें?', language: 'भाषा',
  today: 'आज', yesterday: 'कल',
  welcome: 'नमस्ते! 👋 अपना सवाल किसी भी भाषा में पूछें। सेव किए गए जवाब लिंक और डाउनलोड के साथ तुरंत दिखेंगे।',
  fallback: 'माफ़ कीजिए! अभी हमारे पास इसका जवाब नहीं है। आपका सवाल एडमिन को भेज दिया गया है।',
  locked: '🔒 यह जवाब सिर्फ़ प्रीमियम सदस्यों के लिए है।', preview: 'झलक: {text}', getPremiumLock: 'प्रीमियम लें',
  newReply: 'नया जवाब आया है', netProblem: 'नेटवर्क की समस्या है। कृपया फिर कोशिश करें।',
  loadFail: 'चैट लोड नहीं हो पाई। Firestore नियम जाँचें।', transFail: 'अनुवाद अभी उपलब्ध नहीं है। मूल टेक्स्ट दिखाया जा रहा है।',
  openApp: 'ऐप खोलें', openWebsite: 'वेबसाइट खोलें', downloadApk: 'APK डाउनलोड करें',
  tabLogin: 'लॉग इन', tabSignup: 'साइन अप', authSubLogin: 'अपने सवाल पूछने के लिए लॉग इन करें।',
  authSubSignup: 'नया अकाउंट बनाएँ। आपको अपना ईमेल वेरिफ़ाई करना होगा।',
  email: 'ईमेल', password: 'पासवर्ड', emailPh: 'you@gmail.com', passPh: 'कम से कम 6 अक्षर', show: 'दिखाएँ', hide: 'छुपाएँ',
  login: 'लॉग इन', create: 'अकाउंट बनाएँ', or: 'या', google: 'Google से जारी रखें', forgot: 'पासवर्ड भूल गए?',
  adminSees: 'आपकी चैट और अकाउंट की जानकारी एडमिन देख सकता है।', wait: 'कृपया प्रतीक्षा करें…',
  eEmail: 'यह ईमेल पता सही नहीं है।', eNoPass: 'अपना पासवर्ड लिखें।', eWeak: 'पासवर्ड कम से कम 6 अक्षर का होना चाहिए।',
  eInUse: 'यह ईमेल पहले से रजिस्टर्ड है। कृपया लॉग इन करें।', eCred: 'ईमेल या पासवर्ड गलत है।',
  eNoUser: 'इस ईमेल का अकाउंट नहीं मिला। कृपया साइन अप करें।', eMany: 'बहुत ज़्यादा कोशिशें हो गईं। थोड़ी देर बाद फिर कोशिश करें।',
  eNet: 'अपना इंटरनेट कनेक्शन जाँचें।', ePopup: 'Google साइन-इन बंद हो गया।', ePopupBlocked: 'पॉपअप ब्लॉक हो गया। पॉपअप की अनुमति देकर फिर कोशिश करें।',
  eDomain: 'यह साइट Firebase में अधिकृत डोमेन नहीं है।', eMethod: 'यह साइन-इन तरीका Firebase में चालू नहीं है।',
  eGeneric: 'कुछ गड़बड़ हो गई।', enterBoth: 'ईमेल और पासवर्ड दोनों लिखें।',
  enterEmailFirst: 'पहले ऊपर अपना ईमेल लिखें, फिर इसे दोबारा दबाएँ।', resetSent: 'पासवर्ड रीसेट लिंक भेज दिया गया है। इनबॉक्स या स्पैम फ़ोल्डर देखें।',
  verifyTitle: 'अपना ईमेल वेरिफ़ाई करें', verifySentTo: 'हमने यहाँ वेरिफ़िकेशन लिंक भेजा है:',
  verifyHint: 'अपना ईमेल खोलें, लिंक पर टैप करें, फिर यहाँ वापस आएँ। ईमेल न मिले तो स्पैम फ़ोल्डर देखें।',
  iVerified: 'मैंने वेरिफ़ाई कर लिया', resend: 'ईमेल दोबारा भेजें', resendIn: 'दोबारा भेजें ({n} सेकंड)', diffEmail: 'दूसरे ईमेल से लॉग इन करें',
  verifySent: 'वेरिफ़िकेशन ईमेल भेज दिया गया है।', verifyFirst: 'कृपया पहले इस ईमेल को वेरिफ़ाई करें।',
  notVerifiedYet: 'अभी वेरिफ़ाई नहीं हुआ। ईमेल में दिए लिंक पर टैप करें, फिर यह बटन दोबारा दबाएँ।', sentAgain: 'ईमेल दोबारा भेज दिया गया। स्पैम फ़ोल्डर भी देखें।',
  premium: 'प्रीमियम', premActive: '✅ प्रीमियम चालू है ({plan}), {date} तक। ज़्यादा समय जोड़ने के लिए नीचे रीन्यू करें।',
  premIntro: 'प्रीमियम जवाब अनलॉक करें। UPI से भुगतान करें, एडमिन आपका प्लान चालू कर देगा।',
  premUnavailable: 'प्रीमियम अभी उपलब्ध नहीं है। कृपया बाद में देखें।', monthly: 'मासिक', yearly: 'वार्षिक',
  days30: '30 दिन', days365: '365 दिन', step1: 'स्टेप 1: UPI से ₹{price} का भुगतान करें', openUpi: 'UPI ऐप खोलें और ₹{price} दें', upiId: 'UPI आईडी',
  copy: 'कॉपी', copied: 'UPI आईडी कॉपी हो गई', copyFail: 'कॉपी नहीं हो पाई। कृपया हाथ से कॉपी करें।',
  payExact: 'ठीक ₹{price} ही दें। भुगतान के बाद अपने UPI ऐप से UTR / ट्रांज़ैक्शन आईडी कॉपी करें।',
  step2: 'स्टेप 2: अपने भुगतान की जानकारी भरें', utrLabel: 'UPI ट्रांज़ैक्शन आईडी (UTR)', utrPh: '12 अंकों का UTR / रेफ़रेंस नंबर',
  nameLabel: 'आपका नाम', namePh: 'पूरा नाम', mobileLabel: 'मोबाइल नंबर (वैकल्पिक)', mobilePh: '10 अंकों का मोबाइल नंबर',
  submitPay: 'भुगतान की जानकारी भेजें', startsAfter: 'एडमिन के भुगतान जाँचने के बाद प्रीमियम शुरू होगा।',
  myRequests: 'मेरे भुगतान अनुरोध', noRequests: 'अभी कोई भुगतान अनुरोध नहीं है।', pending: 'लंबित', approved: 'मंज़ूर', rejected: 'अस्वीकृत',
  reasonLbl: 'कारण: {text}', errUtr: 'सही UTR / ट्रांज़ैक्शन आईडी लिखें (सिर्फ़ अक्षर और अंक)।', errName: 'कृपया अपना नाम लिखें।',
  errMobile: 'सही मोबाइल नंबर लिखें या खाली छोड़ दें।', errPlan: 'यह प्लान उपलब्ध नहीं है।',
  utrDup: 'यह UTR पहले ही भेजा जा चुका है, या जानकारी सही नहीं है।', submitFail: 'भेजा नहीं जा सका। कृपया फिर कोशिश करें।',
  paySubmitted: 'भुगतान की जानकारी भेज दी गई। एडमिन जल्द ही जाँच करेगा।', premActivated: 'प्रीमियम चालू हो गया! 🎉',
};

const UR = {
  status: 'آن لائن · فوری جوابات', menu: 'مینو', search: 'جوابات تلاش کریں', install: 'ایپ انسٹال کریں', close: 'بند کریں',
  getPremium: '👑 پریمیم لیں', premiumOn: '👑 پریمیم', managePremium: '👑 پریمیم کا انتظام',
  searchPh: 'کی ورڈ سے تلاش کریں', askPh: 'اپنا سوال لکھیں…', typeMore: 'کم از کم 2 حروف لکھیں۔',
  noResults: 'کچھ نہیں ملا۔ اپنا سوال چیٹ میں بھیجیں، وہ ایڈمن کو بھیج دیا جائے گا۔', premiumAnswer: 'پریمیم جواب',
  freePlan: 'فری پلان', premiumUntil: 'پریمیم · {date} تک', newChat: 'نئی چیٹ', prevChats: 'پرانی چیٹس',
  noChats: 'ابھی کوئی پرانی چیٹ نہیں ہے۔', logout: 'لاگ آؤٹ', logoutConfirm: 'لاگ آؤٹ کریں؟', language: 'زبان',
  today: 'آج', yesterday: 'کل',
  welcome: 'السلام علیکم! 👋 اپنا سوال کسی بھی زبان میں پوچھیں۔ محفوظ جوابات لنکس اور ڈاؤن لوڈز کے ساتھ فوراً نظر آئیں گے۔',
  fallback: 'معذرت! ابھی ہمارے پاس اس کا جواب نہیں ہے۔ آپ کا سوال ایڈمن کو بھیج دیا گیا ہے۔',
  locked: '🔒 یہ جواب صرف پریمیم ممبرز کے لیے ہے۔', preview: 'جھلک: {text}', getPremiumLock: 'پریمیم لیں',
  newReply: 'نیا جواب آیا ہے', netProblem: 'نیٹ ورک کا مسئلہ ہے۔ براہ کرم دوبارہ کوشش کریں۔',
  loadFail: 'چیٹ لوڈ نہیں ہو سکی۔ Firestore رولز چیک کریں۔', transFail: 'ترجمہ ابھی دستیاب نہیں ہے۔ اصل متن دکھایا جا رہا ہے۔',
  openApp: 'ایپ کھولیں', openWebsite: 'ویب سائٹ کھولیں', downloadApk: 'APK ڈاؤن لوڈ کریں',
  tabLogin: 'لاگ ان', tabSignup: 'سائن اپ', authSubLogin: 'اپنے سوال پوچھنے کے لیے لاگ ان کریں۔',
  authSubSignup: 'نیا اکاؤنٹ بنائیں۔ آپ کو اپنا ای میل تصدیق کرنا ہوگا۔',
  email: 'ای میل', password: 'پاس ورڈ', emailPh: 'you@gmail.com', passPh: 'کم از کم 6 حروف', show: 'دکھائیں', hide: 'چھپائیں',
  login: 'لاگ ان', create: 'اکاؤنٹ بنائیں', or: 'یا', google: 'Google کے ساتھ جاری رکھیں', forgot: 'پاس ورڈ بھول گئے؟',
  adminSees: 'آپ کی چیٹس اور اکاؤنٹ کی تفصیلات ایڈمن دیکھ سکتا ہے۔', wait: 'براہ کرم انتظار کریں…',
  eEmail: 'یہ ای میل ایڈریس درست نہیں ہے۔', eNoPass: 'اپنا پاس ورڈ لکھیں۔', eWeak: 'پاس ورڈ کم از کم 6 حروف کا ہونا چاہیے۔',
  eInUse: 'یہ ای میل پہلے سے رجسٹرڈ ہے۔ براہ کرم لاگ ان کریں۔', eCred: 'ای میل یا پاس ورڈ غلط ہے۔',
  eNoUser: 'اس ای میل کا اکاؤنٹ نہیں ملا۔ براہ کرم سائن اپ کریں۔', eMany: 'بہت زیادہ کوششیں ہو گئیں۔ کچھ دیر بعد دوبارہ کوشش کریں۔',
  eNet: 'اپنا انٹرنیٹ کنکشن چیک کریں۔', ePopup: 'Google سائن اِن بند ہو گیا۔', ePopupBlocked: 'پاپ اپ بلاک ہو گیا۔ پاپ اپ کی اجازت دے کر دوبارہ کوشش کریں۔',
  eDomain: 'یہ سائٹ Firebase میں مجاز ڈومین نہیں ہے۔', eMethod: 'یہ سائن اِن طریقہ Firebase میں فعال نہیں ہے۔',
  eGeneric: 'کچھ غلط ہو گیا۔', enterBoth: 'ای میل اور پاس ورڈ دونوں لکھیں۔',
  enterEmailFirst: 'پہلے اوپر اپنا ای میل لکھیں، پھر اسے دوبارہ دبائیں۔', resetSent: 'پاس ورڈ ری سیٹ لنک بھیج دیا گیا ہے۔ ان باکس یا اسپام فولڈر دیکھیں۔',
  verifyTitle: 'اپنا ای میل تصدیق کریں', verifySentTo: 'ہم نے یہاں تصدیقی لنک بھیجا ہے:',
  verifyHint: 'اپنا ای میل کھولیں، لنک پر ٹیپ کریں، پھر یہاں واپس آئیں۔ ای میل نہ ملے تو اسپام فولڈر دیکھیں۔',
  iVerified: 'میں نے تصدیق کر لی', resend: 'ای میل دوبارہ بھیجیں', resendIn: 'دوبارہ بھیجیں ({n} سیکنڈ)', diffEmail: 'دوسرے ای میل سے لاگ ان کریں',
  verifySent: 'تصدیقی ای میل بھیج دی گئی ہے۔', verifyFirst: 'براہ کرم پہلے اس ای میل کی تصدیق کریں۔',
  notVerifiedYet: 'ابھی تصدیق نہیں ہوئی۔ ای میل میں دیے گئے لنک پر ٹیپ کریں، پھر یہ بٹن دوبارہ دبائیں۔', sentAgain: 'ای میل دوبارہ بھیج دی گئی۔ اسپام فولڈر بھی دیکھیں۔',
  premium: 'پریمیم', premActive: '✅ پریمیم فعال ہے ({plan})، {date} تک۔ مزید وقت بڑھانے کے لیے نیچے رینیو کریں۔',
  premIntro: 'پریمیم جوابات ان لاک کریں۔ UPI سے ادائیگی کریں، ایڈمن آپ کا پلان فعال کر دے گا۔',
  premUnavailable: 'پریمیم ابھی دستیاب نہیں ہے۔ براہ کرم بعد میں دیکھیں۔', monthly: 'ماہانہ', yearly: 'سالانہ',
  days30: '30 دن', days365: '365 دن', step1: 'مرحلہ 1: UPI سے ₹{price} ادا کریں', openUpi: 'UPI ایپ کھولیں اور ₹{price} ادا کریں', upiId: 'UPI آئی ڈی',
  copy: 'کاپی', copied: 'UPI آئی ڈی کاپی ہو گئی', copyFail: 'کاپی نہیں ہو سکی۔ براہ کرم خود کاپی کریں۔',
  payExact: 'بالکل ₹{price} ہی ادا کریں۔ ادائیگی کے بعد اپنی UPI ایپ سے UTR / ٹرانزیکشن آئی ڈی کاپی کریں۔',
  step2: 'مرحلہ 2: اپنی ادائیگی کی تفصیلات لکھیں', utrLabel: 'UPI ٹرانزیکشن آئی ڈی (UTR)', utrPh: '12 ہندسوں کا UTR / ریفرنس نمبر',
  nameLabel: 'آپ کا نام', namePh: 'پورا نام', mobileLabel: 'موبائل نمبر (اختیاری)', mobilePh: '10 ہندسوں کا موبائل نمبر',
  submitPay: 'ادائیگی کی تفصیلات بھیجیں', startsAfter: 'ایڈمن کے ادائیگی کی تصدیق کرنے کے بعد پریمیم شروع ہوگا۔',
  myRequests: 'میری ادائیگی کی درخواستیں', noRequests: 'ابھی کوئی ادائیگی کی درخواست نہیں ہے۔', pending: 'زیر التوا', approved: 'منظور', rejected: 'مسترد',
  reasonLbl: 'وجہ: {text}', errUtr: 'درست UTR / ٹرانزیکشن آئی ڈی لکھیں (صرف حروف اور ہندسے)۔', errName: 'براہ کرم اپنا نام لکھیں۔',
  errMobile: 'درست موبائل نمبر لکھیں یا خالی چھوڑ دیں۔', errPlan: 'یہ پلان دستیاب نہیں ہے۔',
  utrDup: 'یہ UTR پہلے ہی بھیجا جا چکا ہے، یا تفصیلات درست نہیں ہیں۔', submitFail: 'بھیجا نہیں جا سکا۔ براہ کرم دوبارہ کوشش کریں۔',
  paySubmitted: 'ادائیگی کی تفصیلات بھیج دی گئیں۔ ایڈمن جلد تصدیق کرے گا۔', premActivated: 'پریمیم فعال ہو گیا! 🎉',
};

const STATIC = { en: EN, hi: HI, ur: UR };
let lang = 'en';
let dyn = {};

export const getLang = () => lang;
export const hasStaticUi = (c) => !!STATIC[c];

export function t(key, vars) {
  let s = STATIC[lang]?.[key] ?? dyn[key] ?? EN[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

/** Fill the UI for a language that has no hand-written dictionary (uses the translation service, cached). */
async function loadDynamic(code, onProgress) {
  try {
    dyn = JSON.parse(localStorage.getItem('ui2-' + code) || '{}');
  } catch {
    dyn = {};
  }
  onProgress?.();
  const keys = Object.keys(EN).filter((k) => !EN[k].includes('{') && !dyn[k]);
  let i = 0;
  let done = 0;
  const worker = async () => {
    while (i < keys.length && lang === code) {
      const k = keys[i++];
      try {
        dyn[k] = await translateText(EN[k], 'en', code);
      } catch {
        i = keys.length; // service unavailable: stop, keep English for the rest
        return;
      }
      if (++done % 8 === 0) onProgress?.();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  try {
    localStorage.setItem('ui2-' + code, JSON.stringify(dyn));
  } catch {}
  onProgress?.();
}

export async function setLanguage(code, onProgress) {
  if (!LANGS.some((l) => l.code === code)) code = 'en';
  lang = code;
  dyn = {};
  localStorage.setItem('ar-lang', code);
  document.documentElement.lang = code;
  document.documentElement.dir = isRTL(code) ? 'rtl' : 'ltr';
  onProgress?.();
  if (!STATIC[code]) await loadDynamic(code, onProgress);
}

export const savedLanguage = () => {
  const c = localStorage.getItem('ar-lang');
  return LANGS.some((l) => l.code === c) ? c : 'en';
};

/** Translate every element that has data-i18n / data-i18n-ph / data-i18n-title / data-i18n-aria. */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => el.setAttribute('placeholder', t(el.dataset.i18nPh)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(el.dataset.i18nTitle)));
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
}
