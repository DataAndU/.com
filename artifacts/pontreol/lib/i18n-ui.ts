// Words used on the main screens (Explore, navigation, Inbox, Profile).
// Keyed by name (not position) so adding/removing words can't shift others.
// Machine-drafted: have a native speaker review before big campaigns.
export const UI_EN = {
  explore: "Explore",
  post: "Post",
  postAvailability: "Post availability",
  inbox: "Inbox",
  profile: "Profile",
  whatNeed: "What do you need?",
  now: "Now",
  today: "Today",
  nearby: "Nearby",
  map: "Map",
  list: "List",
  availableNow: "Available now",
  askTimes: "Ask for times",
  view: "View",
  results: "results",
  nothingHere: "Nothing available here",
  tryAnother: "Try another time or search a larger area.",
  expandArea: "Expand area",
  anyTime: "Any time",
  typeArea: "Type your area or city",
  nearYou: "Near you · change area",
  chats: "Chats",
  bookings: "Bookings",
  alerts: "Alerts",
  myBookings: "My bookings",
  myListings: "My listings",
  plans: "Plans & payments",
  safety: "Safety & Disclaimer",
  tagline: "Find what’s available, where and when.",
};

export type UiKey = keyof typeof UI_EN;
type UiDict = Partial<Record<UiKey, string>>;

export const UI: Record<string, UiDict> = {
  en: UI_EN,
  hi: { explore: "खोजें", post: "पोस्ट", postAvailability: "उपलब्धता पोस्ट करें", inbox: "इनबॉक्स", profile: "प्रोफ़ाइल", whatNeed: "आपको क्या चाहिए?", now: "अभी", today: "आज", nearby: "पास में", map: "नक्शा", list: "सूची", availableNow: "अभी उपलब्ध", askTimes: "समय पूछें", view: "देखें", results: "नतीजे", nothingHere: "यहाँ अभी कुछ उपलब्ध नहीं", tryAnother: "कोई और समय चुनें या बड़ा इलाका खोजें।", expandArea: "इलाका बढ़ाएँ", anyTime: "कभी भी", typeArea: "अपना इलाका या शहर लिखें", nearYou: "आपके पास · इलाका बदलें", chats: "चैट", bookings: "बुकिंग", alerts: "सूचनाएँ", myBookings: "मेरी बुकिंग", myListings: "मेरी लिस्टिंग", plans: "प्लान और भुगतान", safety: "सुरक्षा और अस्वीकरण", tagline: "क्या, कहाँ और कब उपलब्ध है, खोजें।" },
  bn: { explore: "খুঁজুন", post: "পোস্ট", postAvailability: "প্রাপ্যতা পোস্ট করুন", inbox: "ইনবক্স", profile: "প্রোফাইল", whatNeed: "আপনার কী দরকার?", now: "এখন", today: "আজ", nearby: "কাছাকাছি", map: "মানচিত্র", list: "তালিকা", availableNow: "এখন পাওয়া যাচ্ছে", askTimes: "সময় জিজ্ঞেস করুন", view: "দেখুন", results: "ফলাফল", nothingHere: "এখানে এখন কিছু পাওয়া যাচ্ছে না", tryAnother: "অন্য সময় বা বড় এলাকায় খুঁজুন।", expandArea: "এলাকা বাড়ান", anyTime: "যেকোনো সময়", typeArea: "আপনার এলাকা বা শহর লিখুন", nearYou: "আপনার কাছে · এলাকা বদলান", chats: "চ্যাট", bookings: "বুকিং", alerts: "বিজ্ঞপ্তি", myBookings: "আমার বুকিং", myListings: "আমার তালিকা", plans: "প্ল্যান ও পেমেন্ট", safety: "নিরাপত্তা ও দাবিত্যাগ", tagline: "কী, কোথায়, কখন পাওয়া যায় খুঁজুন।" },
  te: { explore: "అన్వేషించండి", post: "పోస్ట్", postAvailability: "అందుబాటును పోస్ట్ చేయండి", inbox: "ఇన్‌బాక్స్", profile: "ప్రొఫైల్", whatNeed: "మీకు ఏమి కావాలి?", now: "ఇప్పుడు", today: "ఈరోజు", nearby: "దగ్గరలో", map: "మ్యాప్", list: "జాబితా", availableNow: "ఇప్పుడు అందుబాటులో", askTimes: "సమయం అడగండి", view: "చూడండి", results: "ఫలితాలు", nothingHere: "ఇక్కడ ఇప్పుడు ఏదీ అందుబాటులో లేదు", tryAnother: "వేరే సమయం లేదా పెద్ద ప్రాంతంలో వెతకండి.", expandArea: "ప్రాంతం పెంచండి", anyTime: "ఎప్పుడైనా", typeArea: "మీ ప్రాంతం లేదా నగరం టైప్ చేయండి", nearYou: "మీ దగ్గర · ప్రాంతం మార్చండి", chats: "చాట్‌లు", bookings: "బుకింగ్‌లు", alerts: "హెచ్చరికలు", myBookings: "నా బుకింగ్‌లు", myListings: "నా లిస్టింగ్‌లు", plans: "ప్లాన్‌లు & చెల్లింపులు", safety: "భద్రత & నిరాకరణ", tagline: "ఏది, ఎక్కడ, ఎప్పుడు అందుబాటులో ఉందో కనుగొనండి." },
  mr: { explore: "शोधा", post: "पोस्ट", postAvailability: "उपलब्धता पोस्ट करा", inbox: "इनबॉक्स", profile: "प्रोफाइल", whatNeed: "तुम्हाला काय हवे आहे?", now: "आत्ता", today: "आज", nearby: "जवळपास", map: "नकाशा", list: "यादी", availableNow: "आत्ता उपलब्ध", askTimes: "वेळ विचारा", view: "पहा", results: "निकाल", nothingHere: "इथे आत्ता काही उपलब्ध नाही", tryAnother: "दुसरी वेळ निवडा किंवा मोठा परिसर शोधा.", expandArea: "परिसर वाढवा", anyTime: "कधीही", typeArea: "तुमचा परिसर किंवा शहर लिहा", nearYou: "तुमच्या जवळ · परिसर बदला", chats: "चॅट", bookings: "बुकिंग", alerts: "सूचना", myBookings: "माझी बुकिंग", myListings: "माझ्या लिस्टिंग", plans: "प्लॅन आणि पेमेंट", safety: "सुरक्षा आणि अस्वीकरण", tagline: "काय, कुठे आणि केव्हा उपलब्ध आहे ते शोधा." },
  ta: { explore: "தேடு", post: "பதிவிடு", postAvailability: "கிடைப்பதை பதிவிடு", inbox: "இன்பாக்ஸ்", profile: "சுயவிவரம்", whatNeed: "உங்களுக்கு என்ன வேண்டும்?", now: "இப்போது", today: "இன்று", nearby: "அருகில்", map: "வரைபடம்", list: "பட்டியல்", availableNow: "இப்போது கிடைக்கும்", askTimes: "நேரத்தைக் கேளுங்கள்", view: "பார்", results: "முடிவுகள்", nothingHere: "இங்கே இப்போது எதுவும் கிடைக்கவில்லை", tryAnother: "வேறு நேரம் அல்லது பெரிய பகுதியில் தேடுங்கள்.", expandArea: "பகுதியை விரிவாக்கு", anyTime: "எப்போது வேண்டுமானாலும்", typeArea: "உங்கள் பகுதி அல்லது நகரத்தை உள்ளிடுங்கள்", nearYou: "உங்கள் அருகில் · பகுதியை மாற்று", chats: "அரட்டைகள்", bookings: "முன்பதிவுகள்", alerts: "அறிவிப்புகள்", myBookings: "எனது முன்பதிவுகள்", myListings: "எனது பட்டியல்கள்", plans: "திட்டங்கள் & கட்டணங்கள்", safety: "பாதுகாப்பு & மறுப்பு", tagline: "எது, எங்கே, எப்போது கிடைக்கும் என்று கண்டறியுங்கள்." },
  ur: { explore: "تلاش", post: "پوسٹ", postAvailability: "دستیابی پوسٹ کریں", inbox: "ان باکس", profile: "پروفائل", whatNeed: "آپ کو کیا چاہیے؟", now: "ابھی", today: "آج", nearby: "قریب", map: "نقشہ", list: "فہرست", availableNow: "ابھی دستیاب", askTimes: "وقت پوچھیں", view: "دیکھیں", results: "نتائج", nothingHere: "یہاں ابھی کچھ دستیاب نہیں", tryAnother: "کوئی اور وقت یا بڑا علاقہ تلاش کریں۔", expandArea: "علاقہ بڑھائیں", anyTime: "کسی بھی وقت", typeArea: "اپنا علاقہ یا شہر لکھیں", nearYou: "آپ کے قریب · علاقہ بدلیں", chats: "چیٹ", bookings: "بکنگ", alerts: "اطلاعات", myBookings: "میری بکنگ", myListings: "میری لسٹنگز", plans: "پلان اور ادائیگی", safety: "حفاظت اور دستبرداری", tagline: "کیا، کہاں اور کب دستیاب ہے، تلاش کریں۔" },
  gu: { explore: "શોધો", post: "પોસ્ટ", postAvailability: "ઉપલબ્ધતા પોસ્ટ કરો", inbox: "ઇનબોક્સ", profile: "પ્રોફાઇલ", whatNeed: "તમારે શું જોઈએ છે?", now: "હમણાં", today: "આજે", nearby: "નજીકમાં", map: "નકશો", list: "યાદી", availableNow: "હમણાં ઉપલબ્ધ", askTimes: "સમય પૂછો", view: "જુઓ", results: "પરિણામો", nothingHere: "અહીં હમણાં કંઈ ઉપલબ્ધ નથી", tryAnother: "બીજો સમય અથવા મોટો વિસ્તાર શોધો.", expandArea: "વિસ્તાર વધારો", anyTime: "ગમે ત્યારે", typeArea: "તમારો વિસ્તાર અથવા શહેર લખો", nearYou: "તમારી નજીક · વિસ્તાર બદલો", chats: "ચેટ", bookings: "બુકિંગ", alerts: "સૂચનાઓ", myBookings: "મારી બુકિંગ", myListings: "મારી લિસ્ટિંગ", plans: "પ્લાન અને ચુકવણી", safety: "સલામતી અને અસ્વીકરણ", tagline: "શું, ક્યાં અને ક્યારે ઉપલબ્ધ છે તે શોધો." },
  kn: { explore: "ಅನ್ವೇಷಿಸಿ", post: "ಪೋಸ್ಟ್", postAvailability: "ಲಭ್ಯತೆ ಪೋಸ್ಟ್ ಮಾಡಿ", inbox: "ಇನ್‌ಬಾಕ್ಸ್", profile: "ಪ್ರೊಫೈಲ್", whatNeed: "ನಿಮಗೆ ಏನು ಬೇಕು?", now: "ಈಗ", today: "ಇಂದು", nearby: "ಹತ್ತಿರ", map: "ನಕ್ಷೆ", list: "ಪಟ್ಟಿ", availableNow: "ಈಗ ಲಭ್ಯ", askTimes: "ಸಮಯ ಕೇಳಿ", view: "ನೋಡಿ", results: "ಫಲಿತಾಂಶಗಳು", nothingHere: "ಇಲ್ಲಿ ಈಗ ಏನೂ ಲಭ್ಯವಿಲ್ಲ", tryAnother: "ಬೇರೆ ಸಮಯ ಅಥವಾ ದೊಡ್ಡ ಪ್ರದೇಶದಲ್ಲಿ ಹುಡುಕಿ.", expandArea: "ಪ್ರದೇಶ ಹೆಚ್ಚಿಸಿ", anyTime: "ಯಾವಾಗ ಬೇಕಾದರೂ", typeArea: "ನಿಮ್ಮ ಪ್ರದೇಶ ಅಥವಾ ನಗರ ಟೈಪ್ ಮಾಡಿ", nearYou: "ನಿಮ್ಮ ಹತ್ತಿರ · ಪ್ರದೇಶ ಬದಲಿಸಿ", chats: "ಚಾಟ್‌ಗಳು", bookings: "ಬುಕಿಂಗ್‌ಗಳು", alerts: "ಎಚ್ಚರಿಕೆಗಳು", myBookings: "ನನ್ನ ಬುಕಿಂಗ್‌ಗಳು", myListings: "ನನ್ನ ಪಟ್ಟಿಗಳು", plans: "ಯೋಜನೆಗಳು & ಪಾವತಿಗಳು", safety: "ಸುರಕ್ಷತೆ & ಹಕ್ಕು ನಿರಾಕರಣೆ", tagline: "ಏನು, ಎಲ್ಲಿ, ಯಾವಾಗ ಲಭ್ಯ ಎಂದು ಹುಡುಕಿ." },
  ml: { explore: "തിരയുക", post: "പോസ്റ്റ്", postAvailability: "ലഭ്യത പോസ്റ്റ് ചെയ്യുക", inbox: "ഇൻബോക്സ്", profile: "പ്രൊഫൈൽ", whatNeed: "നിങ്ങൾക്ക് എന്താണ് വേണ്ടത്?", now: "ഇപ്പോൾ", today: "ഇന്ന്", nearby: "സമീപത്ത്", map: "മാപ്പ്", list: "ലിസ്റ്റ്", availableNow: "ഇപ്പോൾ ലഭ്യം", askTimes: "സമയം ചോദിക്കുക", view: "കാണുക", results: "ഫലങ്ങൾ", nothingHere: "ഇവിടെ ഇപ്പോൾ ഒന്നും ലഭ്യമല്ല", tryAnother: "മറ്റൊരു സമയമോ വലിയ പ്രദേശമോ തിരയുക.", expandArea: "പ്രദേശം വലുതാക്കുക", anyTime: "എപ്പോൾ വേണമെങ്കിലും", typeArea: "നിങ്ങളുടെ പ്രദേശമോ നഗരമോ ടൈപ്പ് ചെയ്യുക", nearYou: "നിങ്ങളുടെ അടുത്ത് · പ്രദേശം മാറ്റുക", chats: "ചാറ്റുകൾ", bookings: "ബുക്കിംഗുകൾ", alerts: "അറിയിപ്പുകൾ", myBookings: "എന്റെ ബുക്കിംഗുകൾ", myListings: "എന്റെ ലിസ്റ്റിംഗുകൾ", plans: "പ്ലാനുകളും പേയ്‌മെന്റുകളും", safety: "സുരക്ഷയും നിരാകരണവും", tagline: "എന്ത്, എവിടെ, എപ്പോൾ ലഭ്യമാണെന്ന് കണ്ടെത്തുക." },
  pa: { explore: "ਖੋਜੋ", post: "ਪੋਸਟ", postAvailability: "ਉਪਲਬਧਤਾ ਪੋਸਟ ਕਰੋ", inbox: "ਇਨਬਾਕਸ", profile: "ਪ੍ਰੋਫਾਈਲ", whatNeed: "ਤੁਹਾਨੂੰ ਕੀ ਚਾਹੀਦਾ ਹੈ?", now: "ਹੁਣ", today: "ਅੱਜ", nearby: "ਨੇੜੇ", map: "ਨਕਸ਼ਾ", list: "ਸੂਚੀ", availableNow: "ਹੁਣ ਉਪਲਬਧ", askTimes: "ਸਮਾਂ ਪੁੱਛੋ", view: "ਵੇਖੋ", results: "ਨਤੀਜੇ", nothingHere: "ਇੱਥੇ ਹੁਣ ਕੁਝ ਉਪਲਬਧ ਨਹੀਂ", tryAnother: "ਕੋਈ ਹੋਰ ਸਮਾਂ ਜਾਂ ਵੱਡਾ ਇਲਾਕਾ ਖੋਜੋ।", expandArea: "ਇਲਾਕਾ ਵਧਾਓ", anyTime: "ਕਦੇ ਵੀ", typeArea: "ਆਪਣਾ ਇਲਾਕਾ ਜਾਂ ਸ਼ਹਿਰ ਲਿਖੋ", nearYou: "ਤੁਹਾਡੇ ਨੇੜੇ · ਇਲਾਕਾ ਬਦਲੋ", chats: "ਚੈਟ", bookings: "ਬੁਕਿੰਗ", alerts: "ਸੂਚਨਾਵਾਂ", myBookings: "ਮੇਰੀਆਂ ਬੁਕਿੰਗਾਂ", myListings: "ਮੇਰੀਆਂ ਲਿਸਟਿੰਗਾਂ", plans: "ਪਲਾਨ ਅਤੇ ਭੁਗਤਾਨ", safety: "ਸੁਰੱਖਿਆ ਅਤੇ ਬੇਦਾਅਵਾ", tagline: "ਕੀ, ਕਿੱਥੇ ਅਤੇ ਕਦੋਂ ਉਪਲਬਧ ਹੈ, ਲੱਭੋ।" },
  or: { explore: "ଖୋଜନ୍ତୁ", post: "ପୋଷ୍ଟ", inbox: "ଇନବକ୍ସ", profile: "ପ୍ରୋଫାଇଲ", whatNeed: "ଆପଣଙ୍କୁ କଣ ଦରକାର?", now: "ଏବେ", today: "ଆଜି", nearby: "ପାଖରେ", map: "ମାନଚିତ୍ର", list: "ତାଲିକା", availableNow: "ଏବେ ଉପଲବ୍ଧ", view: "ଦେଖନ୍ତୁ", chats: "ଚାଟ", bookings: "ବୁକିଂ", alerts: "ବିଜ୍ଞପ୍ତି", myBookings: "ମୋ ବୁକିଂ", myListings: "ମୋ ତାଲିକା" },
  ne: { explore: "खोज्नुहोस्", post: "पोस्ट", inbox: "इनबक्स", profile: "प्रोफाइल", whatNeed: "तपाईंलाई के चाहिन्छ?", now: "अहिले", today: "आज", nearby: "नजिकै", map: "नक्सा", list: "सूची", availableNow: "अहिले उपलब्ध", view: "हेर्नुहोस्", chats: "च्याट", bookings: "बुकिङ", alerts: "सूचनाहरू", myBookings: "मेरा बुकिङ", myListings: "मेरा सूचीहरू" },
};
