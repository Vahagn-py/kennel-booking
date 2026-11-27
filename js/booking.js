(function () {
  "use strict";

  var CFG = window.ZH_BOOKING_CONFIG || {};
  var STORAGE_KEY = "zh-bookings-v1";
  var SETTINGS_KEY = "zh-booking-settings-v1";
  var NOTIFY_KEY = "zh-booking-notifs-v1";
  var DELETED_KEY = "zh-deleted-ids-v1";
  var ADMIN_SESSION_KEY = "zh-booking-admin";
  var ADMIN_PIN = String(CFG.pin != null ? CFG.pin : "000000");
  var STAFF_WHATSAPP = String(CFG.staffWhatsApp || "").replace(/\D/g, "");
  var HOTEL_NAME = String(CFG.hotelName || "Kennel Booking");
  var HOTEL_PLACE = String(CFG.place || "");
  var HOTEL_PHONE = String(CFG.phoneDisplay || "");
  var STAFF_ONLY = document.body && document.body.getAttribute("data-staff-only") === "1";

  function hotelLine() {
    return [HOTEL_NAME, HOTEL_PLACE, HOTEL_PHONE].filter(Boolean).join(" · ");
  }

  var MONTH_NAMES = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
  ];

  var DEFAULT_FOOD_OPTIONS = [
    { id: "food-std", name: "Стандарт", price: 1000 },
    { id: "food-premium", name: "Премиум", price: 1500 },
    { id: "food-sensitive", name: "Чувствительное пищеварение", price: 1800 }
  ];

  var DEFAULT_SETTINGS = {
    priceSmall: 5000,
    priceMedium: 6000,
    priceLarge: 7000,
    priceGiant: 8000,
    foodFee: 1000,
    aggressionFee: 2000,
    aggressionFeeSmall: 1000,
    aggressionFeeLarge: 2000,
    vetCallFee: 15000,
    depositAmount: 10000,
    discountDays: 14,
    discountPerDay: 1000,
    foodOptions: DEFAULT_FOOD_OPTIONS.slice()
  };

  var SIZE_META = {
    small: { labelKey: "bk.sizeSmall", kennels: "small", priceKey: "priceSmall" },
    medium: { labelKey: "bk.sizeMedium", kennels: "both", priceKey: "priceMedium" },
    large: { labelKey: "bk.sizeLarge", kennels: "large", priceKey: "priceLarge" },
    giant: { labelKey: "bk.sizeGiant", kennels: "large", priceKey: "priceGiant" }
  };

  var KENNELS = [];
  for (var s = 1; s <= 10; s++) KENNELS.push({ id: "S" + s, type: "small", label: "S" + s });
  for (var l = 1; l <= 9; l++) KENNELS.push({ id: "L" + l, type: "large", label: "L" + l });

  var state = {
    size: null,
    kennelId: null,
    bookings: [],
    notifications: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    syncLock: false,
    boardFocusKennel: null,
    isAdmin: false,
    listQuery: "",
    listStatus: "all",
    miniCalYear: null,
    miniCalMonth: null,
    checkinCalYear: null,
    checkinCalMonth: null,
    petPhotoData: "",
    foodOptionId: "",
    draftVetVisits: [],
    lastSavedId: null
  };

  var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function t(key, fallback) {
    if (window.ZH && typeof window.ZH.t === "function") {
      var value = window.ZH.t(key);
      if (value && value !== key) return value;
    }
    return fallback != null ? fallback : key;
  }

  function parseISO(dateStr) {
    if (!dateStr) return null;
    var parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function formatISO(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function formatDMY(iso) {
    var d = parseISO(iso);
    if (!d) return "";
    return String(d.getDate()).padStart(2, "0") + "." +
      String(d.getMonth() + 1).padStart(2, "0") + "." +
      d.getFullYear();
  }

  function parseDMY(text) {
    if (!text) return "";
    var clean = String(text).trim().replace(/[\/\-]/g, ".");
    var m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return "";
    var day = Number(m[1]);
    var month = Number(m[2]);
    var year = Number(m[3]);
    if (month < 1 || month > 12) return "";
    var max = daysInMonth(year, month - 1);
    if (day < 1 || day > max) return "";
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  function maskDMYInput(raw) {
    var digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return digits.slice(0, 2) + "." + digits.slice(2);
    return digits.slice(0, 2) + "." + digits.slice(2, 4) + "." + digits.slice(4);
  }

  function addDays(date, n) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }

  function daysBetween(inStr, outStr) {
    var a = parseISO(inStr);
    var b = parseISO(outStr);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function overlaps(aIn, aOut, bIn, bOut) {
    return aIn < bOut && aOut > bIn;
  }

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeSettings(raw) {
    var settings = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    if (!Array.isArray(settings.foodOptions) || !settings.foodOptions.length) {
      settings.foodOptions = DEFAULT_FOOD_OPTIONS.map(function (f) { return Object.assign({}, f); });
    }
    if (settings.aggressionFeeSmall == null) {
      settings.aggressionFeeSmall = settings.aggressionFee <= 1000 ? settings.aggressionFee : 1000;
    }
    if (settings.aggressionFeeLarge == null) {
      settings.aggressionFeeLarge = settings.aggressionFee || 2000;
    }
    if (settings.discountPerDay == null) settings.discountPerDay = 1000;
    if (settings.discountPercent != null && Number(settings.discountDays) === 7) settings.discountDays = 14;
    if (settings.discountDays == null) settings.discountDays = 14;
    delete settings.predatorFee;
    delete settings.discountPercent;
    return settings;
  }

  function aggressionFeeForSize(size) {
    if (size === "large" || size === "giant") {
      return Number(state.settings.aggressionFeeLarge) || 2000;
    }
    return Number(state.settings.aggressionFeeSmall) || 1000;
  }

  var LEGACY_REQUEST_STATUSES = {
    request: 1,
    in_progress: 1,
    ready: 1,
    done: 1,
    rejected: 1
  };

  function isLegacyRequestStatus(status) {
    return !!LEGACY_REQUEST_STATUSES[status];
  }

  function loadState() {
    state.bookings = loadJSON(STORAGE_KEY, []).filter(function (b) {
      return b && !isLegacyRequestStatus(b.status);
    });
    state.settings = normalizeSettings(loadJSON(SETTINGS_KEY, {}));
    state.notifications = loadJSON(NOTIFY_KEY, []);
  }

  function foodOptions() {
    return state.settings.foodOptions || DEFAULT_FOOD_OPTIONS;
  }

  function selectedFood() {
    var list = foodOptions();
    if (!state.foodOptionId) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.foodOptionId) return list[i];
    }
    return null;
  }

  function vetVisitsTotal(visits) {
    return (visits || []).reduce(function (sum, v) {
      return sum + (Number(v.serviceFee) || 0) + (Number(v.medicinePrice) || 0);
    }, 0);
  }

  function vetTypeLabel(type) {
    return ({
      exam: t("bk.vetExam", "Осмотр"),
      injection: t("bk.vetInjection", "Укол"),
      medicine: t("bk.vetMedicine", "Лекарство")
    })[type] || type;
  }

  function saveBookings() {
    saveJSON(STORAGE_KEY, state.bookings);
  }

  function saveSettings() {
    saveJSON(SETTINGS_KEY, state.settings);
  }

  function saveNotifications() {
    saveJSON(NOTIFY_KEY, state.notifications.slice(0, 120));
  }

  function pushNotification(item) {
    state.notifications.unshift({
      id: uid(),
      at: new Date().toISOString(),
      read: false,
      type: item.type || "info",
      title: item.title || "",
      body: item.body || "",
      bookingId: item.bookingId || null
    });
    saveNotifications();
    updateNotifUi();
  }

  function unreadNotifCount() {
    return state.notifications.filter(function (n) { return !n.read; }).length;
  }

  function phoneDigits(phone) {
    return normalizePhone(phone).replace(/\D/g, "");
  }

  function openWhatsApp(phoneOrDigits, text) {
    var digits = String(phoneOrDigits || "").replace(/\D/g, "");
    if (!digits) return;
    window.open("https://wa.me/" + digits + "?text=" + encodeURIComponent(text), "_blank");
  }

  function approvalMessage(booking) {
    return [
      t("bk.approveHello", "Здравствуйте! Бронь подтверждена."),
      "",
      t("bk.petName", "Кличка") + ": " + (booking.petName || "—"),
      t("bk.kennel", "Вольер") + ": " + (booking.kennelId || "—"),
      t("bk.checkin", "Заезд") + ": " + formatDMY(booking.dateIn),
      t("bk.checkout", "Выезд") + ": " + formatDMY(booking.dateOut),
      "",
      t("bk.approveWait", "Этот вольер будет ждать вашу собаку в эти дни."),
      t("bk.approveDeposit", "Предоплата за бронь") + ": " + money(state.settings.depositAmount || 10000) + ". " +
        t("bk.depositHint", "не возвращается при неявке"),
      "",
      hotelLine()
    ].join("\n");
  }

  function isAdminSession() {
    try {
      return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setAdminSession(on) {
    try {
      if (on) sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      else sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch (e) {}
    state.isAdmin = !!on;
    document.body.classList.toggle("mode-admin", !!on);
    document.body.classList.toggle("mode-public", !on);
  }

  function basePriceForSize(size) {
    var meta = SIZE_META[size];
    if (!meta) return 0;
    return Number(state.settings[meta.priceKey]) || 0;
  }

  function sizeLabel(size) {
    var meta = SIZE_META[size];
    if (!meta) return size || "";
    return t(meta.labelKey, ({
      small: "Маленькая", medium: "Средняя", large: "Большая", giant: "Гигант"
    })[size]);
  }

  function eligibleKennels(size) {
    var mode = SIZE_META[size] && SIZE_META[size].kennels;
    if (mode === "small") return KENNELS.filter(function (k) { return k.type === "small"; });
    if (mode === "large") return KENNELS.filter(function (k) { return k.type === "large"; });
    if (mode === "both") {
      return KENNELS.filter(function (k) { return k.type === "small"; })
        .concat(KENNELS.filter(function (k) { return k.type === "large"; }));
    }
    return [];
  }

  function activeBookings() {
    return state.bookings.filter(function (b) {
      return b.status !== "cancelled" && !isLegacyRequestStatus(b.status);
    });
  }

  function isKennelFree(kennelId, dateIn, dateOut, ignoreId) {
    return !activeBookings().some(function (b) {
      if (ignoreId && b.id === ignoreId) return false;
      if (b.kennelId !== kennelId) return false;
      return overlaps(dateIn, dateOut, b.dateIn, b.dateOut);
    });
  }

  function freeKennels(size, dateIn, dateOut, ignoreId) {
    return eligibleKennels(size).filter(function (k) {
      return isKennelFree(k.id, dateIn, dateOut, ignoreId);
    });
  }

  function kennelBusyOnDay(kennelId, dayStr) {
    var next = formatISO(addDays(parseISO(dayStr), 1));
    return !isKennelFree(kennelId, dayStr, next);
  }

  function bookingsOnDay(kennelId, dayStr) {
    var next = formatISO(addDays(parseISO(dayStr), 1));
    return activeBookings().filter(function (b) {
      return b.kennelId === kennelId && overlaps(dayStr, next, b.dateIn, b.dateOut);
    });
  }

  function busyDaysInMonth(kennelId, year, monthIndex) {
    var total = daysInMonth(year, monthIndex);
    var busy = 0;
    for (var d = 1; d <= total; d++) {
      var dayStr = year + "-" + String(monthIndex + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      if (kennelBusyOnDay(kennelId, dayStr)) busy += 1;
    }
    return { busy: busy, total: total };
  }

  function fillSelect(sel, items, selected) {
    sel.innerHTML = "";
    items.forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = String(item.value);
      opt.textContent = item.label;
      if (String(item.value) === String(selected)) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function fillDaySelect(sel, year, monthIndex, selectedDay) {
    var max = daysInMonth(year, monthIndex);
    var day = Math.min(Number(selectedDay) || 1, max);
    var items = [];
    for (var d = 1; d <= max; d++) items.push({ value: d, label: String(d) });
    fillSelect(sel, items, day);
  }

  function fillMonthSelect(sel, selectedMonth) {
    fillSelect(sel, MONTH_NAMES.map(function (name, idx) {
      return { value: idx + 1, label: name };
    }), selectedMonth);
  }

  function fillYearSelect(sel, selectedYear) {
    var now = new Date().getFullYear();
    var items = [];
    for (var y = now - 1; y <= now + 5; y++) items.push({ value: y, label: String(y) });
    fillSelect(sel, items, selectedYear);
  }

  function readDmy(prefix) {
    var y = Number($("#" + prefix + "Year").value);
    var m = Number($("#" + prefix + "Month").value);
    var d = Number($("#" + prefix + "Day").value);
    if (!y || !m || !d) return "";
    var max = daysInMonth(y, m - 1);
    if (d > max) d = max;
    return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }

  function writeDmy(prefix, iso) {
    var date = parseISO(iso) || new Date();
    fillYearSelect($("#" + prefix + "Year"), date.getFullYear());
    fillMonthSelect($("#" + prefix + "Month"), date.getMonth() + 1);
    fillDaySelect($("#" + prefix + "Day"), date.getFullYear(), date.getMonth(), date.getDate());
  }

  function syncHiddenDatesFromDmy() {
    $("#dateIn").value = readDmy("in");
    $("#dateOut").value = readDmy("out");
  }

  function syncOutFromNights(opts) {
    var dateIn = readDmy("in");
    var raw = ($("#nights").value || "").trim();
    var force = opts && opts.force;
    if (!dateIn) return false;
    if (raw === "" && !force) return false;
    var nights = Number(raw);
    if (!isFinite(nights) || nights < 1) {
      if (!force) return false;
      nights = 1;
    }
    nights = Math.floor(nights);
    state.syncLock = true;
    $("#nights").value = String(nights);
    var out = formatISO(addDays(parseISO(dateIn), nights));
    writeDmy("out", out);
    $("#dateIn").value = dateIn;
    $("#dateOut").value = out;
    state.syncLock = false;
    return true;
  }

  function syncNightsFromOut() {
    var dateIn = readDmy("in");
    var dateOut = readDmy("out");
    if (!dateIn || !dateOut) return;
    var nights = daysBetween(dateIn, dateOut);
    if (nights < 1) {
      nights = 1;
      dateOut = formatISO(addDays(parseISO(dateIn), 1));
      writeDmy("out", dateOut);
    }
    state.syncLock = true;
    $("#nights").value = String(nights);
    $("#dateIn").value = dateIn;
    $("#dateOut").value = dateOut;
    state.syncLock = false;
  }

  function onInDateChanged() {
    if (state.syncLock) return;
    var y = Number($("#inYear").value);
    var m = Number($("#inMonth").value);
    var d = Number($("#inDay").value);
    fillDaySelect($("#inDay"), y, m - 1, d);
    syncOutFromNights();
    updateAvailability();
    updatePrice();
    renderKennelMiniCal();
  }

  function onOutDateChanged() {
    if (state.syncLock) return;
    var y = Number($("#outYear").value);
    var m = Number($("#outMonth").value);
    var d = Number($("#outDay").value);
    fillDaySelect($("#outDay"), y, m - 1, d);
    syncNightsFromOut();
    updateAvailability();
    updatePrice();
    renderKennelMiniCal();
  }

  function normalizePhone(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    var digits = raw.replace(/[^\d+]/g, "");
    if (digits.indexOf("+") === 0) digits = "+" + digits.slice(1).replace(/\D/g, "");
    else digits = digits.replace(/\D/g, "");
    if (digits.indexOf("374") === 0) digits = "+" + digits;
    if (digits.indexOf("0") === 0 && digits.length === 9) digits = "+374" + digits.slice(1);
    return digits;
  }

  function formatPhoneDisplay(value) {
    var n = normalizePhone(value);
    var m = n.match(/^\+374(\d{2})(\d{3})(\d{3})$/);
    if (!m) return String(value || "").trim();
    return "+374 " + m[1] + " " + m[2] + " " + m[3];
  }

  function isValidArmPhone(value) {
    return /^\+374\d{8}$/.test(normalizePhone(value));
  }

  function findNearestWindows(size, nights, fromDate, limit) {
    limit = limit || 8;
    nights = Math.max(1, nights | 0);
    var start = fromDate ? parseISO(fromDate) : new Date();
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var results = [];
    var seen = {};
    for (var offset = 0; offset < 60 && results.length < limit; offset++) {
      var inDate = addDays(start, offset);
      var outDate = addDays(inDate, nights);
      var inStr = formatISO(inDate);
      var outStr = formatISO(outDate);
      var free = freeKennels(size, inStr, outStr);
      if (!free.length) continue;
      free.forEach(function (k) {
        var key = inStr + "|" + k.id;
        if (seen[key]) return;
        seen[key] = true;
        results.push({
          dateIn: inStr,
          dateOut: outStr,
          nights: nights,
          kennelId: k.id,
          kennelLabel: k.label
        });
      });
    }
    return results.slice(0, limit);
  }

  function buildSuggestions(size, dateIn, dateOut) {
    var nights = daysBetween(dateIn, dateOut);
    if (nights < 1) return [];
    var suggestions = [];
    var earlyIn = formatISO(addDays(parseISO(dateIn), -1));
    var earlyOut = formatISO(addDays(parseISO(dateOut), -1));
    var lateIn = formatISO(addDays(parseISO(dateIn), 1));
    var lateOut = formatISO(addDays(parseISO(dateOut), 1));

    var earlyFree = freeKennels(size, earlyIn, earlyOut);
    if (earlyFree.length) {
      suggestions.push({
        title: t("bk.suggestEarlier", "Приехать на 1 день раньше"),
        detail: formatDMY(earlyIn) + " → " + formatDMY(earlyOut) + " · " + earlyFree.map(function (k) { return k.label; }).join(", "),
        dateIn: earlyIn,
        dateOut: earlyOut,
        kennelId: earlyFree[0].id
      });
    }

    var lateFree = freeKennels(size, lateIn, lateOut);
    if (lateFree.length) {
      suggestions.push({
        title: t("bk.suggestLater", "Начать на 1 день позже"),
        detail: formatDMY(lateIn) + " → " + formatDMY(lateOut) + " · " + lateFree.map(function (k) { return k.label; }).join(", "),
        dateIn: lateIn,
        dateOut: lateOut,
        kennelId: lateFree[0].id
      });
    }

    findNearestWindows(size, nights, dateIn, 4).forEach(function (w) {
      if (w.dateIn === dateIn && w.dateOut === dateOut) return;
      suggestions.push({
        title: t("bk.suggestNearest", "Ближайшее окно") + " · " + w.kennelLabel,
        detail: formatDMY(w.dateIn) + " → " + formatDMY(w.dateOut) + " · " + w.nights + " " + t("bk.nightsShort", "сут."),
        dateIn: w.dateIn,
        dateOut: w.dateOut,
        kennelId: w.kennelId
      });
    });
    return suggestions;
  }

  function calcPrice(opts) {
    var nights = daysBetween(opts.dateIn, opts.dateOut);
    var base = basePriceForSize(opts.size);
    var foodPerDay = Number(opts.foodPrice) || 0;
    var foodName = opts.foodName || "";
    var aggr = opts.aggressive ? aggressionFeeForSize(opts.size) : 0;
    var vetTotal = vetVisitsTotal(opts.vetVisits);
    var perDay = base + foodPerDay + aggr;
    var stay = perDay * Math.max(0, nights);
    var subtotal = stay + vetTotal;
    var fromDay = Number(state.settings.discountDays) || 14;
    var discountPerDay = Number(state.settings.discountPerDay) || 1000;
    // From day N inclusive: each such night gets fixed discount (not %)
    var discountNights = nights >= fromDay ? (nights - fromDay + 1) : 0;
    var discount = discountNights * discountPerDay;
    return {
      nights: nights,
      base: base,
      food: foodPerDay,
      foodName: foodName,
      foodTotal: foodPerDay * Math.max(0, nights),
      aggression: aggr,
      vetVisits: vetTotal,
      vetCount: (opts.vetVisits || []).length,
      perDay: perDay,
      stay: stay,
      subtotal: subtotal,
      discountFromDay: fromDay,
      discountPerDay: discountPerDay,
      discountNights: discountNights,
      discount: discount,
      total: Math.max(0, subtotal - discount),
      deposit: Number(state.settings.depositAmount) || 10000
    };
  }

  function uid() {
    return "b-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function money(n) {
    return new Intl.NumberFormat("ru-RU").format(n) + " ֏";
  }

  function readPetAge() {
    var yearsRaw = ($("#petAgeYears") && $("#petAgeYears").value) || "";
    var monthsRaw = ($("#petAgeMonths") && $("#petAgeMonths").value) || "";
    var years = Number(yearsRaw);
    var months = Number(monthsRaw);
    if (!isFinite(years) || years < 0) years = 0;
    if (!isFinite(months) || months < 0) months = 0;
    years = Math.floor(years);
    months = Math.floor(months);
    if (months > 11) months = 11;
    return {
      years: years,
      months: months,
      totalMonths: years * 12 + months,
      filled: String(yearsRaw).trim() !== "" || String(monthsRaw).trim() !== ""
    };
  }

  function formatPetAge(years, months) {
    var y = Number(years) || 0;
    var m = Number(months) || 0;
    if (y <= 0 && m <= 0) return "";
    var parts = [];
    if (y > 0) parts.push(y + " " + t("bk.yearsShort", "г."));
    if (m > 0 || y <= 0) parts.push(m + " " + t("bk.monthsShort", "мес."));
    return parts.join(" ");
  }

  function petProfileLine(b) {
    if (!b) return "";
    var parts = [];
    if (b.breed) parts.push(t("bk.breed", "Порода") + ": " + b.breed);
    if (b.weight) parts.push(t("bk.weight", "Вес, кг") + ": " + b.weight);
    var age = b.ageLabel || formatPetAge(b.ageYears, b.ageMonths);
    if (age) parts.push(t("bk.age", "Возраст") + ": " + age);
    return parts.join(" · ");
  }

  function vaccinationsValid(iso) {
    if (!iso) return false;
    var d = parseISO(iso);
    if (!d) return false;
    return d >= addDays(new Date(), -183);
  }

  function readVaxISO() {
    return parseDMY($("#vaxDate").value);
  }

  function currentFoodSelection() {
    var food = selectedFood();
    if (!food) return { id: "", name: "", price: 0 };
    return { id: food.id, name: food.name, price: Number(food.price) || 0 };
  }

  function applyDates(dateIn, dateOut) {
    state.syncLock = true;
    writeDmy("in", dateIn);
    writeDmy("out", dateOut);
    $("#dateIn").value = dateIn;
    $("#dateOut").value = dateOut;
    $("#nights").value = String(Math.max(1, daysBetween(dateIn, dateOut)));
    state.syncLock = false;
  }

  function clearFieldErrors() {
    document.querySelectorAll(".is-invalid").forEach(function (el) {
      el.classList.remove("is-invalid");
    });
    document.querySelectorAll(".field-error").forEach(function (el) {
      el.classList.add("hidden");
      el.textContent = "";
    });
  }

  function markInvalid(selector, errId, message) {
    var nodes = typeof selector === "string" ? document.querySelectorAll(selector) : [selector];
    nodes.forEach(function (el) {
      if (el) el.classList.add("is-invalid");
    });
    var err = $("#" + errId);
    if (err) {
      err.textContent = message;
      err.classList.remove("hidden");
    }
  }

  function renderSizeCards() {
    var root = $("#sizeGrid");
    root.innerHTML = "";
    Object.keys(SIZE_META).forEach(function (key) {
      var meta = SIZE_META[key];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "size-card" + (state.size === key ? " is-active" : "");
      btn.dataset.size = key;
      var kennelHint =
        meta.kennels === "small" ? t("bk.onlyS", "только S") :
        meta.kennels === "large" ? t("bk.onlyL", "только L") : t("bk.sandL", "S и L");
      btn.innerHTML =
        "<strong>" + sizeLabel(key) + "</strong>" +
        (state.isAdmin ? "<span>" + kennelHint + "</span><em>" + money(basePriceForSize(key)) + "</em>" : "");
      btn.addEventListener("click", function () {
        state.size = key;
        state.kennelId = null;
        clearFieldErrors();
        renderSizeCards();
        syncFeeLabels();
        updateAvailability();
        updatePrice();
        renderKennelMiniCal();
      });
      root.appendChild(btn);
    });
  }

  function renderKennels(freeIds) {
    var root = $("#kennelGrid");
    if (!root) return;
    root.innerHTML = "";
    if (!state.size) {
      root.innerHTML = "<p class=\"booking-hint kennel-empty-hint\">" + t("bk.pickSizeFirst", "Сначала выберите размер") + "</p>";
      return;
    }
    eligibleKennels(state.size).forEach(function (k) {
      var free = freeIds.indexOf(k.id) !== -1;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kennel-btn " + (free ? "is-free" : "is-busy");
      if (state.kennelId === k.id) btn.classList.add("is-active");
      btn.disabled = !free;
      btn.innerHTML = "<span>" + k.label + "</span><small>" +
        (k.type === "small" ? t("bk.smallKennel", "малый") : t("bk.largeKennel", "большой")) +
        "</small>";
      btn.addEventListener("click", function () {
        if (!free) return;
        state.kennelId = k.id;
        var focus = parseISO($("#dateIn").value) || new Date();
        state.miniCalYear = focus.getFullYear();
        state.miniCalMonth = focus.getMonth();
        clearFieldErrors();
        renderKennels(freeIds);
        updatePrice();
        renderKennelMiniCal();
      });
      root.appendChild(btn);
    });
  }

  function ensureMiniCalMonth() {
    var now = new Date();
    if (state.miniCalYear == null || state.miniCalMonth == null) {
      state.miniCalYear = now.getFullYear();
      state.miniCalMonth = now.getMonth();
    }
  }

  function shiftMiniCal(delta) {
    ensureMiniCalMonth();
    var d = new Date(state.miniCalYear, state.miniCalMonth + delta, 1);
    state.miniCalYear = d.getFullYear();
    state.miniCalMonth = d.getMonth();
    renderKennelMiniCal();
  }

  function renderKennelMiniCal() {
    var root = $("#kennelCalMini");
    if (!root || !state.isAdmin) return;
    if (!state.kennelId) {
      root.innerHTML = "<p class=\"booking-hint\">" + t("bk.kennelPickHint", "Выберите вольер — здесь появится календарь занятости.") + "</p>";
      return;
    }

    ensureMiniCalMonth();
    var year = state.miniCalYear;
    var month = state.miniCalMonth;
    var dateIn = $("#dateIn").value;
    var dateOut = $("#dateOut").value;
    var today = formatISO(new Date());
    var totalDays = daysInMonth(year, month);
    // Monday-first: JS getDay() Sun=0 → shift
    var firstDow = (new Date(year, month, 1).getDay() + 6) % 7;

    root.innerHTML = "";
    var cal = document.createElement("div");
    cal.className = "zh-cal kennel-month-cal";

    var head = document.createElement("div");
    head.className = "zh-cal-head";
    head.innerHTML =
      "<button type=\"button\" class=\"btn btn-line btn-sm zh-cal-nav\" data-cal-shift=\"-1\" aria-label=\"Prev\">←</button>" +
      "<div class=\"zh-cal-title-static\">" + t("bk.kennel", "Вольер") + " " + state.kennelId + " · " + MONTH_NAMES[month] + " " + year + "</div>" +
      "<button type=\"button\" class=\"btn btn-line btn-sm zh-cal-nav\" data-cal-shift=\"1\" aria-label=\"Next\">→</button>";
    cal.appendChild(head);

    var legend = document.createElement("div");
    legend.className = "kennel-cal-legend";
    legend.innerHTML =
      "<span><i class=\"leg free\"></i> " + t("bk.free", "свободно") + "</span>" +
      "<span><i class=\"leg busy\"></i> " + t("bk.busy", "занято") + "</span>" +
      "<span><i class=\"leg pick\"></i> " + t("bk.picked", "выбранные даты") + "</span>";
    cal.appendChild(legend);

    var grid = document.createElement("div");
    grid.className = "zh-cal-grid days";
    WEEKDAYS.forEach(function (wd) {
      var el = document.createElement("div");
      el.className = "zh-cal-weekday";
      el.textContent = wd;
      grid.appendChild(el);
    });

    for (var i = 0; i < firstDow; i++) {
      var empty = document.createElement("div");
      empty.className = "zh-cal-cell empty";
      grid.appendChild(empty);
    }

    for (var day = 1; day <= totalDays; day++) {
      var dayStr = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var busy = kennelBusyOnDay(state.kennelId, dayStr);
      var cell = document.createElement("button");
      cell.type = "button";
      var cls = ["zh-cal-cell", "day", busy ? "is-busy" : "is-free"];
      if (dayStr === today) cls.push("is-today");
      if (dateIn && dateOut && dayStr >= dateIn && dayStr < dateOut) cls.push("is-range");
      cell.className = cls.join(" ");
      cell.textContent = String(day);
      cell.title = formatDMY(dayStr) + " · " + (busy ? t("bk.busy", "занято") : t("bk.free", "свободно"));
      cell.addEventListener("click", function (iso, isBusy) {
        return function () {
          if (isBusy) return;
          var nights = Math.max(1, Number($("#nights").value) || 1);
          applyDates(iso, formatISO(addDays(parseISO(iso), nights)));
          updateAvailability();
          updatePrice();
          renderKennelMiniCal();
        };
      }(dayStr, busy));
      grid.appendChild(cell);
    }

    cal.appendChild(grid);
    root.appendChild(cal);

    head.querySelectorAll("[data-cal-shift]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        shiftMiniCal(Number(btn.getAttribute("data-cal-shift")));
      });
    });
  }

  function renderSuggestions(list) {
    var root = $("#suggestList");
    var wrap = $("#suggestWrap");
    if (!root || !wrap) return;
    root.innerHTML = "";
    if (!list.length) {
      wrap.classList.add("hidden");
      return;
    }
    wrap.classList.remove("hidden");
    list.forEach(function (s) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggest-btn";
      btn.innerHTML = "<strong>" + s.title + "</strong><span>" + s.detail + "</span>";
      btn.addEventListener("click", function () {
        applyDates(s.dateIn, s.dateOut);
        state.kennelId = s.kennelId;
        updateAvailability();
        updatePrice();
        renderKennelMiniCal();
      });
      root.appendChild(btn);
    });
  }

  function updatePublicAvailability() {
    var box = $("#publicAvail");
    if (!box || state.isAdmin) return;
    syncHiddenDatesFromDmy();
    var dateIn = $("#dateIn").value;
    var dateOut = $("#dateOut").value;
    var nights = daysBetween(dateIn, dateOut);
    if (!state.size || !dateIn || !dateOut || nights < 1) {
      box.classList.add("hidden");
      return;
    }
    var free = freeKennels(state.size, dateIn, dateOut);
    var smallFree = free.filter(function (k) { return k.type === "small"; }).length;
    var largeFree = free.filter(function (k) { return k.type === "large"; }).length;
    box.classList.remove("hidden");
    if (!free.length) {
      box.className = "alert alert-error";
      box.textContent = t("bk.publicFull", "На эти даты свободных мест нет. Выберите другие даты или напишите нам.");
      return;
    }
    box.className = free.length <= 2 ? "alert alert-warn" : "alert alert-ok";
    box.textContent = t("bk.publicFree", "Свободно на ваши даты") + ": " +
      free.length + " (" +
      t("bk.smallKennel", "малый") + " " + smallFree + " · " +
      t("bk.largeKennel", "большой") + " " + largeFree + ")" +
      (free.length <= 2 ? " · " + t("bk.publicFew", "мест мало") : "");
  }

  function updateAvailability() {
    syncHiddenDatesFromDmy();
    var dateIn = $("#dateIn").value;
    var dateOut = $("#dateOut").value;
    var msg = $("#availMsg");
    var nights = daysBetween(dateIn, dateOut);

    if (!state.isAdmin) {
      updatePublicAvailability();
      return;
    }

    if (!state.size) {
      renderKennels([]);
      renderSuggestions([]);
      if (msg) {
        msg.className = "alert alert-warn";
        msg.textContent = t("bk.errSize", "Выберите размер собаки.");
        msg.classList.remove("hidden");
      }
      return;
    }

    if (!dateIn || !dateOut || nights < 1) {
      renderKennels([]);
      renderSuggestions([]);
      if (msg) {
        msg.className = "alert alert-warn";
        msg.textContent = t("bk.errDates", "Укажите заезд и число суток.");
        msg.classList.remove("hidden");
      }
      return;
    }

    var free = freeKennels(state.size, dateIn, dateOut);
    var freeIds = free.map(function (k) { return k.id; });
    if (state.kennelId && freeIds.indexOf(state.kennelId) === -1) {
      state.kennelId = free.length ? free[0].id : null;
    } else if (!state.kennelId && free.length) {
      state.kennelId = free[0].id;
    }
    renderKennels(freeIds);
    renderKennelMiniCal();

    if (!msg) return;
    if (free.length) {
      msg.className = "alert alert-ok";
      msg.textContent = t("bk.freeCount", "Свободно") + ": " + free.length + ". " +
        t("bk.selected", "Выбран") + " " + (state.kennelId || "—") + ".";
      msg.classList.remove("hidden");
      renderSuggestions([]);
    } else {
      msg.className = "alert alert-error";
      msg.textContent = t("bk.noFree", "На эти даты свободно нет. Ниже варианты раньше / позже.");
      msg.classList.remove("hidden");
      renderSuggestions(buildSuggestions(state.size, dateIn, dateOut));
    }
  }

  function updatePrice() {
    syncHiddenDatesFromDmy();
    var box = $("#priceBox");
    var dateIn = $("#dateIn").value;
    var dateOut = $("#dateOut").value;
    var food = currentFoodSelection();
    if (!state.isAdmin) {
      if (!state.size || !dateIn || !dateOut || daysBetween(dateIn, dateOut) < 1) {
        box.innerHTML = "<h3>" + t("bk.bookingSummary", "Бронь") + "</h3><p>" + t("bk.pickSizeDates", "Выберите размер и даты.") + "</p>";
        return;
      }
      var nightsPub = daysBetween(dateIn, dateOut);
      box.innerHTML =
        "<h3>" + t("bk.bookingSummary", "Бронь") + "</h3>" +
        "<div class=\"price-row\"><span>" + t("bk.size", "Размер") + "</span><span>" + sizeLabel(state.size) + "</span></div>" +
        "<div class=\"price-row\"><span>" + t("bk.nights", "Суток") + "</span><span>" + nightsPub + "</span></div>" +
        "<div class=\"price-row\"><span>" + t("bk.hotelFood", "Корм") + "</span><span>" + (food.name || t("bk.foodOwn", "Свой корм")) + "</span></div>" +
        "<p class=\"price-note\">" + t("bk.priceByPhone", "Стоимость подтвердим по телефону.") + "</p>";
      return;
    }
    if (!state.size || !dateIn || !dateOut || daysBetween(dateIn, dateOut) < 1) {
      box.innerHTML = "<h3>" + t("bk.total", "Итог") + "</h3><p>" + t("bk.pickSizeDates", "Выберите размер и даты.") + "</p>";
      return;
    }
    syncFeeLabels();
    var price = calcPrice({
      size: state.size,
      dateIn: dateIn,
      dateOut: dateOut,
      foodPrice: food.price,
      foodName: food.name,
      aggressive: $("#aggressive") && $("#aggressive").checked,
      vetVisits: state.draftVetVisits
    });
    var html =
      "<h3>" + t("bk.total", "Итог") + "</h3>" +
      "<div class=\"price-row\"><span>" + price.nights + " " + t("bk.nightsShort", "сут.") + " × " + money(price.perDay) + "</span><span>" + money(price.stay) + "</span></div>" +
      "<div class=\"price-row\"><span>" + t("bk.base", "База") + "</span><span>" + money(price.base) + "/" + t("bk.nightsShort", "сут.") + "</span></div>";
    if (price.food) html += "<div class=\"price-row\"><span>" + t("bk.hotelFood", "Корм") + (price.foodName ? " · " + price.foodName : "") + "</span><span>+" + money(price.food) + "/" + t("bk.nightsShort", "сут.") + "</span></div>";
    if (price.aggression) html += "<div class=\"price-row\"><span>" + t("bk.aggression", "Агрессия") + "</span><span>+" + money(price.aggression) + "/" + t("bk.nightsShort", "сут.") + "</span></div>";
    if (price.vetVisits) html += "<div class=\"price-row\"><span>" + t("bk.vetLog", "Вызовы ветврача") + " ×" + price.vetCount + "</span><span>+" + money(price.vetVisits) + "</span></div>";
    if (price.discount) {
      html += "<div class=\"price-row\"><span>" + t("bk.discount", "Скидка") + " " +
        money(price.discountPerDay) + " × " + price.discountNights + " " + t("bk.nightsShort", "сут.") +
        " (" + t("bk.discountFrom", "с") + " " + price.discountFromDay + ")" +
        "</span><span>−" + money(price.discount) + "</span></div>";
    }
    html += "<div class=\"price-row total\"><span>" + t("bk.due", "К оплате") + "</span><span>" + money(price.total) + "</span></div>";
    html += "<div class=\"price-row\"><span>" + t("bk.depositAmount", "Предоплата") + "</span><span>" + money(price.deposit) + "</span></div>";
    box.innerHTML = html;
  }

  function renderFoodOptions() {
    var targets = ["publicFoodOptions", "adminFoodOptions"];
    targets.forEach(function (id) {
      var root = $("#" + id);
      if (!root) return;
      root.innerHTML = "";
      var none = document.createElement("button");
      none.type = "button";
      none.className = "option-card" + (!state.foodOptionId ? " is-active" : "");
      var showPrice = state.isAdmin || id === "adminFoodOptions";
      none.innerHTML = "<strong>" + t("bk.foodOwn", "Свой корм") + "</strong>" +
        (showPrice ? "<span>0 ֏</span>" : "<span>" + t("bk.foodOwnHint", "привезу сам") + "</span>");
      none.addEventListener("click", function () {
        state.foodOptionId = "";
        renderFoodOptions();
        updatePrice();
      });
      root.appendChild(none);
      foodOptions().forEach(function (food) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "option-card" + (state.foodOptionId === food.id ? " is-active" : "");
        btn.innerHTML = "<strong>" + food.name + "</strong>" +
          (showPrice
            ? "<span>" + money(food.price) + "/" + t("bk.nightsShort", "сут.") + "</span>"
            : "<span>" + t("bk.foodHotelHint", "корм гостиницы") + "</span>");
        btn.addEventListener("click", function () {
          state.foodOptionId = food.id;
          renderFoodOptions();
          updatePrice();
        });
        root.appendChild(btn);
      });
    });
  }

  function renderDraftVetVisits() {
    var root = $("#vetVisitsList");
    if (!root) return;
    if (!state.draftVetVisits.length) {
      root.innerHTML = "<p class=\"booking-hint\">" + t("bk.noVetVisits", "Пока нет вызовов.") + "</p>";
      return;
    }
    root.innerHTML = "";
    state.draftVetVisits.forEach(function (v, idx) {
      var row = document.createElement("article");
      row.className = "service-item";
      row.innerHTML =
        "<div><strong>" + vetTypeLabel(v.type) + "</strong> · " + formatDMY(v.date) +
        "<div class=\"meta\">" + money((Number(v.serviceFee) || 0) + (Number(v.medicinePrice) || 0)) +
        (v.medicineName ? " · " + v.medicineName : "") +
        (v.note ? " · " + v.note : "") + "</div></div>" +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-del=\"" + idx + "\">" + t("bk.actDelete", "Удалить") + "</button>";
      row.querySelector("[data-del]").addEventListener("click", function () {
        state.draftVetVisits.splice(idx, 1);
        renderDraftVetVisits();
        updatePrice();
      });
      root.appendChild(row);
    });
  }

  function renderFoodCatalogEditor() {
    var root = $("#foodCatalogEditor");
    if (!root) return;
    root.innerHTML = "";
    foodOptions().forEach(function (food, idx) {
      var row = document.createElement("div");
      row.className = "food-edit-row";
      row.innerHTML =
        "<input type=\"text\" data-f=\"name\" value=\"" + String(food.name || "").replace(/"/g, "&quot;") + "\" placeholder=\"" + t("bk.foodName", "Название корма") + "\">" +
        "<input type=\"number\" min=\"0\" data-f=\"price\" value=\"" + (Number(food.price) || 0) + "\">" +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-del=\"1\">✕</button>";
      row.querySelector("[data-f='name']").addEventListener("input", function () { food.name = this.value; });
      row.querySelector("[data-f='price']").addEventListener("input", function () { food.price = Number(this.value) || 0; });
      row.querySelector("[data-del]").addEventListener("click", function () {
        state.settings.foodOptions.splice(idx, 1);
        renderFoodCatalogEditor();
        renderFoodOptions();
        updatePrice();
      });
      root.appendChild(row);
    });
  }

  function statusLabel(status) {
    return ({
      pending: t("bk.statusPending", "ожидает"),
      checkedin: t("bk.statusIn", "заселён"),
      checkedout: t("bk.statusOut", "выехал"),
      cancelled: t("bk.statusCancel", "отменён")
    })[status] || status;
  }

  function suggestedKennelsFor(booking) {
    if (!booking || !booking.size || !booking.dateIn || !booking.dateOut) return [];
    return freeKennels(booking.size, booking.dateIn, booking.dateOut);
  }

  function filteredBookingList() {
    var q = (state.listQuery || "").trim().toLowerCase();
    var status = state.listStatus || "all";
    return state.bookings.filter(function (b) {
      if (status !== "all" && b.status !== status) return false;
      if (!q) return true;
      var hay = [
        b.petName || "",
        b.ownerName || "",
        b.ownerPhone || "",
        b.kennelId || "",
        b.notes || ""
      ].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    }).slice().sort(function (a, b) {
      return a.dateIn < b.dateIn ? 1 : a.dateIn > b.dateIn ? -1 : 0;
    });
  }

  function fillFormFromBooking(booking) {
    state.size = booking.size;
    applyDates(booking.dateIn, booking.dateOut);
    $("#petName").value = booking.petName || "";
    if ($("#breed")) $("#breed").value = booking.breed || "";
    if ($("#weight")) $("#weight").value = booking.weight || "";
    if ($("#petAgeYears")) $("#petAgeYears").value = booking.ageYears != null ? String(booking.ageYears) : "";
    if ($("#petAgeMonths")) $("#petAgeMonths").value = booking.ageMonths != null ? String(booking.ageMonths) : "";
    $("#ownerName").value = booking.ownerName || "";
    $("#ownerPhone").value = booking.ownerPhone || "";
    $("#notes").value = booking.notes || "";
    if ($("#aggressive")) $("#aggressive").checked = !!booking.aggressive;
    if ($("#grooming")) $("#grooming").checked = !!booking.grooming;
    if ($("#cameraShown")) $("#cameraShown").checked = !!booking.cameraShown;
    if ($("#depositPaid")) $("#depositPaid").checked = !!booking.depositPaid;
    state.foodOptionId = booking.foodOptionId || "";
    state.draftVetVisits = Array.isArray(booking.vetVisits) ? booking.vetVisits.slice() : [];
    state.petPhotoData = booking.petPhoto || "";
    showAdminPhoto(booking.petPhoto || "");
    renderFoodOptions();
    renderDraftVetVisits();
    var free = suggestedKennelsFor(booking);
    state.kennelId = booking.kennelId || (free[0] && free[0].id) || null;
    var focus = parseISO(booking.dateIn) || new Date();
    state.miniCalYear = focus.getFullYear();
    state.miniCalMonth = focus.getMonth();
    renderSizeCards();
    syncFeeLabels();
    updateAvailability();
    updatePrice();
    renderKennelMiniCal();
    formMessage(
      t("bk.bookingLoaded", "Бронь в форме") + ": " + (booking.petName || "") +
      (state.kennelId ? " · " + state.kennelId : ""),
      state.kennelId ? "ok" : "warn"
    );
    try { $("#petName").scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  }

  function deletedIdList() {
    return loadJSON(DELETED_KEY, []);
  }

  function rememberDeletedId(id) {
    if (!id) return;
    var list = deletedIdList();
    if (list.indexOf(id) === -1) list.push(id);
    saveJSON(DELETED_KEY, list.slice(-500));
  }

  function showAdminPhoto(dataUrl) {
    var el = $("#adminPhotoPreview");
    if (!el) return;
    if (dataUrl) {
      el.classList.remove("muted");
      el.innerHTML = "<img src=\"" + dataUrl + "\" alt=\"\">";
    } else {
      el.classList.add("muted");
      el.textContent = t("bk.noPhoto", "Нет фото");
    }
  }

  function compressImageFile(file, done) {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) {
      done("");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 720;
        var w = img.width;
        var h = img.height;
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        done(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = function () { done(""); };
      img.src = reader.result;
    };
    reader.onerror = function () { done(""); };
    reader.readAsDataURL(file);
  }

  function renderBookings() {
    var root = $("#bookingList");
    if (!root || !state.isAdmin) return;
    var list = filteredBookingList();
    if (!state.bookings.length) {
      root.innerHTML = "<p class=\"booking-hint\">" + t("bk.noBookings", "Пока нет броней.") + "</p>";
      return;
    }
    if (!list.length) {
      root.innerHTML = "<p class=\"booking-hint\">" + t("bk.noMatches", "Ничего не найдено.") + "</p>";
      return;
    }
    root.innerHTML = "";
    list.forEach(function (b) {
      var card = document.createElement("article");
      card.className = "booking-card";
      var titleRight = b.kennelId || "—";
      card.innerHTML =
        "<header><strong>" + (b.petName || t("bk.noPet", "Без клички")) + " · " + titleRight + "</strong>" +
        "<span class=\"status-pill is-" + b.status + "\">" + statusLabel(b.status) + "</span></header>" +
        "<div class=\"meta\">" + formatDMY(b.dateIn) + " → " + formatDMY(b.dateOut) + " · " + money(b.total || 0) + "</div>" +
        "<div class=\"meta\">" + (b.ownerName ? b.ownerName + " · " : "") + (b.ownerPhone || t("bk.noPhone", "без телефона")) + "</div>" +
        "<div class=\"card-actions\">" +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-act=\"form\">" + t("bk.toForm", "В форму") + "</button>" +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-act=\"checkedin\">" + t("bk.actIn", "Заселить") + "</button>" +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-act=\"checkedout\">" + t("bk.actOut", "Выезд") + "</button>" +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-act=\"cancelled\">" + t("bk.actCancel", "Отменить") + "</button>" +
        ((b.status === "checkedin" || b.status === "pending")
          ? "<button type=\"button\" class=\"btn btn-line btn-sm\" data-act=\"vet\">" + t("bk.addVet", "Добавить вызов") + "</button>" +
            "<button type=\"button\" class=\"btn btn-line btn-sm\" data-act=\"doc\">" + t("bk.print", "Печать") + "</button>"
          : "") +
        (b.ownerPhone
          ? "<button type=\"button\" class=\"btn btn-line btn-sm\" data-act=\"wa\">WhatsApp</button>"
          : "") +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-act=\"delete\">" + t("bk.actDelete", "Удалить") + "</button>" +
        "</div>";
      card.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var act = btn.getAttribute("data-act");
          if (act === "delete") {
            if (!window.confirm(t("bk.confirmDelete", "Удалить эту бронь без возможности восстановления?"))) return;
            rememberDeletedId(b.id);
            state.bookings = state.bookings.filter(function (x) { return x.id !== b.id; });
          } else if (act === "form") {
            fillFormFromBooking(b);
            return;
          } else if (act === "wa") {
            openWhatsApp(b.ownerPhone, t("bk.waAsk", "Здравствуйте! Это Kennel Booking по вашей брони на") + " " + (b.petName || "") + ".");
            return;
          } else if (act === "vet") {
            openVetDialog(b.id);
            return;
          } else if (act === "doc") {
            state.lastSavedId = b.id;
            showShareActions(true);
            printBookingDoc(b);
            return;
          } else {
            b.status = act;
          }
          saveBookings();
          renderBookings();
          updateAvailability();
          renderKennelMiniCal();
          if ($("#boardDialog") && $("#boardDialog").open) renderBoard();
        });
      });
      root.appendChild(card);
    });
  }

  function filteredKennels() {
    var filter = $("#boardFilter").value;
    var kennels = KENNELS.filter(function (k) {
      if (filter === "small") return k.type === "small";
      if (filter === "large") return k.type === "large";
      return true;
    });
    if (state.boardFocusKennel) {
      kennels = kennels.filter(function (k) { return k.id === state.boardFocusKennel; });
    }
    return kennels;
  }

  function syncBoardPeriodInput() {
    var view = $("#boardView").value || "month";
    var input = $("#boardPeriod");
    var label = $("#boardPeriodLabel");
    var now = new Date();
    var current = input.value;

    if (view === "day") {
      label.textContent = t("bk.viewDay", "День");
      input.type = "date";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(current)) input.value = formatISO(now);
    } else if (view === "year") {
      label.textContent = t("bk.viewYear", "Год");
      input.type = "number";
      input.min = "2020";
      input.max = "2100";
      input.step = "1";
      if (!/^\d{4}$/.test(current)) {
        var y = current && current.slice(0, 4);
        input.value = /^\d{4}$/.test(y) ? y : String(now.getFullYear());
      }
    } else {
      label.textContent = t("bk.viewMonth", "Месяц");
      input.type = "month";
      if (!/^\d{4}-\d{2}$/.test(current)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(current)) input.value = current.slice(0, 7);
        else if (/^\d{4}$/.test(current)) input.value = current + "-" + String(now.getMonth() + 1).padStart(2, "0");
        else input.value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      }
    }
  }

  function selectKennelFromBoard(id) {
    state.kennelId = id;
    var kennel = KENNELS.find(function (x) { return x.id === id; });
    if (kennel) {
      if (kennel.type === "small" && state.size !== "medium") state.size = "small";
      if (kennel.type === "large" && state.size !== "medium" && state.size !== "large" && state.size !== "giant") {
        state.size = "large";
      }
    }
    renderSizeCards();
    updateAvailability();
    updatePrice();
    renderKennelMiniCal();
    state.boardFocusKennel = id;
    renderBoard();
  }

  function renderBoardDay(kennels, dayStr) {
    var body = $("#boardBody");
    $("#boardTitle").textContent = state.boardFocusKennel
      ? t("bk.viewDay", "День") + " · " + state.boardFocusKennel
      : t("bk.occupancy", "Занятость вольеров") + " · " + formatDMY(dayStr);

    var html = "<div class=\"board-nav-row\">" +
      "<button type=\"button\" class=\"btn btn-line btn-sm\" data-shift=\"-1\">← " + t("bk.yesterday", "Вчера") + "</button>" +
      "<button type=\"button\" class=\"btn btn-line btn-sm\" data-shift=\"1\">" + t("bk.tomorrow", "Завтра") + " →</button>" +
      (state.boardFocusKennel ? "<button type=\"button\" class=\"btn btn-line btn-sm\" data-clear-focus=\"1\">" + t("bk.allKennels", "Все вольеры") + "</button>" : "") +
      "</div><div class=\"day-board\">";

    kennels.forEach(function (k) {
      var list = bookingsOnDay(k.id, dayStr);
      var busy = list.length > 0;
      var detail = busy
        ? list.map(function (b) {
            return (b.petName || t("bk.noPet", "Без клички")) + " · " + formatDMY(b.dateIn) + "→" + formatDMY(b.dateOut) + " · " + statusLabel(b.status);
          }).join("; ")
        : t("bk.free", "свободно");
      html += "<article class=\"day-board-card " + (busy ? "is-busy" : "is-free") + "\">" +
        "<strong><button type=\"button\" class=\"board-row-btn\" data-kennel=\"" + k.id + "\">" + k.label + "</button></strong>" +
        "<div class=\"meta\">" + detail + "</div>" +
        "<span class=\"status-pill " + (busy ? "is-cancelled" : "is-checkedin") + "\">" + (busy ? t("bk.busy", "занято") : t("bk.free", "свободно")) + "</span>" +
        "</article>";
    });
    html += "</div>";
    body.innerHTML = html;

    body.querySelectorAll("[data-kennel]").forEach(function (btn) {
      btn.addEventListener("click", function () { selectKennelFromBoard(btn.getAttribute("data-kennel")); });
    });
    body.querySelectorAll("[data-shift]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $("#boardPeriod").value = formatISO(addDays(parseISO(dayStr), Number(btn.getAttribute("data-shift"))));
        renderBoard();
      });
    });
    var clear = body.querySelector("[data-clear-focus]");
    if (clear) clear.addEventListener("click", function () { state.boardFocusKennel = null; renderBoard(); });
  }

  function renderBoardMonth(kennels, year, month) {
    var body = $("#boardBody");
    var totalDays = daysInMonth(year, month);
    var dateIn = $("#dateIn").value;
    var dateOut = $("#dateOut").value;
    var today = formatISO(new Date());
    $("#boardTitle").textContent = state.boardFocusKennel
      ? t("bk.viewMonth", "Месяц") + " · " + state.boardFocusKennel
      : t("bk.occupancy", "Занятость вольеров") + " · " + String(month + 1).padStart(2, "0") + "." + year;

    var html = state.boardFocusKennel
      ? "<div class=\"board-nav-row\"><button type=\"button\" class=\"btn btn-line btn-sm\" data-clear-focus=\"1\">" + t("bk.allKennels", "Все вольеры") + "</button></div>"
      : "";
    html += "<table class=\"board-table\"><thead><tr><th>№</th>";
    for (var d = 1; d <= totalDays; d++) html += "<th>" + d + "</th>";
    html += "</tr></thead><tbody>";
    kennels.forEach(function (k) {
      html += "<tr><td><button type=\"button\" class=\"board-row-btn\" data-kennel=\"" + k.id + "\">" + k.label + "</button></td>";
      for (var day = 1; day <= totalDays; day++) {
        var dayStr = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
        var cls = ["board-cell", kennelBusyOnDay(k.id, dayStr) ? "busy" : "free"];
        if (dayStr === today) cls.push("today");
        if (dateIn && dateOut && dayStr >= dateIn && dayStr < dateOut) cls.push("range");
        html += "<td class=\"" + cls.join(" ") + "\" title=\"" + formatDMY(dayStr) + "\" data-day=\"" + dayStr + "\"></td>";
      }
      html += "</tr>";
    });
    html += "</tbody></table>";
    body.innerHTML = html;

    body.querySelectorAll("[data-kennel]").forEach(function (btn) {
      btn.addEventListener("click", function () { selectKennelFromBoard(btn.getAttribute("data-kennel")); });
    });
    body.querySelectorAll("[data-day]").forEach(function (cell) {
      cell.style.cursor = "pointer";
      cell.addEventListener("click", function () {
        $("#boardView").value = "day";
        syncBoardPeriodInput();
        $("#boardPeriod").value = cell.getAttribute("data-day");
        renderBoard();
      });
    });
    var clear = body.querySelector("[data-clear-focus]");
    if (clear) clear.addEventListener("click", function () { state.boardFocusKennel = null; renderBoard(); });
  }

  function renderBoardYear(kennels, year) {
    var body = $("#boardBody");
    var monthNames = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
    $("#boardTitle").textContent = state.boardFocusKennel
      ? t("bk.viewYear", "Год") + " · " + state.boardFocusKennel + " · " + year
      : t("bk.occupancy", "Занятость вольеров") + " · " + year;

    var html = state.boardFocusKennel
      ? "<div class=\"board-nav-row\"><button type=\"button\" class=\"btn btn-line btn-sm\" data-clear-focus=\"1\">" + t("bk.allKennels", "Все вольеры") + "</button></div>"
      : "";
    html += "<table class=\"board-table\"><thead><tr><th>№</th>";
    monthNames.forEach(function (name, idx) {
      html += "<th><button type=\"button\" class=\"board-row-btn\" data-month=\"" + (idx + 1) + "\">" + name + "</button></th>";
    });
    html += "</tr></thead><tbody>";
    kennels.forEach(function (k) {
      html += "<tr><td><button type=\"button\" class=\"board-row-btn\" data-kennel=\"" + k.id + "\">" + k.label + "</button></td>";
      for (var m = 0; m < 12; m++) {
        var stats = busyDaysInMonth(k.id, year, m);
        var ratio = stats.total ? stats.busy / stats.total : 0;
        var bg = ratio === 0 ? "#eef6ef" : "rgb(" + Math.round(238 + ratio * 14) + "," + Math.round(238 - ratio * 70) + "," + Math.round(238 - ratio * 70) + ")";
        html += "<td class=\"board-cell\" title=\"" + monthNames[m] + ": " + stats.busy + "/" + stats.total + "\" data-month=\"" + (m + 1) + "\">" +
          "<span class=\"year-heat\" style=\"background:" + bg + "\">" + (stats.busy || "") + "</span></td>";
      }
      html += "</tr>";
    });
    html += "</tbody></table>";
    body.innerHTML = html;

    body.querySelectorAll("[data-kennel]").forEach(function (btn) {
      btn.addEventListener("click", function () { selectKennelFromBoard(btn.getAttribute("data-kennel")); });
    });
    body.querySelectorAll("[data-month]").forEach(function (el) {
      el.style.cursor = "pointer";
      el.addEventListener("click", function () {
        $("#boardView").value = "month";
        syncBoardPeriodInput();
        $("#boardPeriod").value = year + "-" + String(el.getAttribute("data-month")).padStart(2, "0");
        renderBoard();
      });
    });
    var clear = body.querySelector("[data-clear-focus]");
    if (clear) clear.addEventListener("click", function () { state.boardFocusKennel = null; renderBoard(); });
  }

  function renderBoard() {
    if (!state.isAdmin) return;
    syncBoardPeriodInput();
    var view = $("#boardView").value || "month";
    var period = $("#boardPeriod").value;
    var kennels = filteredKennels();

    if (view === "day") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) {
        period = formatISO(new Date());
        $("#boardPeriod").value = period;
      }
      renderBoardDay(kennels, period);
      return;
    }
    if (view === "year") {
      var year = Number(period) || new Date().getFullYear();
      $("#boardPeriod").value = String(year);
      renderBoardYear(kennels, year);
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      var now = new Date();
      period = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      $("#boardPeriod").value = period;
    }
    var parts = period.split("-");
    renderBoardMonth(kennels, Number(parts[0]), Number(parts[1]) - 1);
  }

  function openBoard(focusKennel) {
    if (!state.isAdmin) return;
    state.boardFocusKennel = focusKennel || null;
    var dlg = $("#boardDialog");
    if (!$("#boardView").value) $("#boardView").value = "month";
    syncBoardPeriodInput();
    renderBoard();
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
  }

  function syncFeeLabels() {
    var aggr = $("#aggrFeeLabel");
    if (aggr) {
      aggr.textContent = "+" + money(aggressionFeeForSize(state.size || "small")) + "/" + t("bk.nightsShort", "сут.");
    }
  }

  function fillSettingsForm() {
    if (!$("#priceSmall")) return;
    $("#priceSmall").value = state.settings.priceSmall;
    $("#priceMedium").value = state.settings.priceMedium;
    $("#priceLarge").value = state.settings.priceLarge;
    $("#priceGiant").value = state.settings.priceGiant;
    if ($("#aggressionFeeSmall")) $("#aggressionFeeSmall").value = state.settings.aggressionFeeSmall;
    if ($("#aggressionFeeLarge")) $("#aggressionFeeLarge").value = state.settings.aggressionFeeLarge;
    if ($("#vetCallFee")) $("#vetCallFee").value = state.settings.vetCallFee || 0;
    if ($("#depositAmount")) $("#depositAmount").value = state.settings.depositAmount || 10000;
    $("#discountDays").value = state.settings.discountDays;
    if ($("#discountPerDay")) $("#discountPerDay").value = state.settings.discountPerDay;
    syncFeeLabels();
    renderFoodCatalogEditor();
    renderFoodOptions();
  }

  function readSettingsForm() {
    state.settings.priceSmall = Number($("#priceSmall").value) || 0;
    state.settings.priceMedium = Number($("#priceMedium").value) || 0;
    state.settings.priceLarge = Number($("#priceLarge").value) || 0;
    state.settings.priceGiant = Number($("#priceGiant").value) || 0;
    state.settings.aggressionFeeSmall = Number($("#aggressionFeeSmall") && $("#aggressionFeeSmall").value) || 1000;
    state.settings.aggressionFeeLarge = Number($("#aggressionFeeLarge") && $("#aggressionFeeLarge").value) || 2000;
    state.settings.aggressionFee = state.settings.aggressionFeeLarge;
    state.settings.vetCallFee = Number($("#vetCallFee") && $("#vetCallFee").value) || 0;
    state.settings.depositAmount = Number($("#depositAmount") && $("#depositAmount").value) || 10000;
    state.settings.discountDays = Number($("#discountDays").value) || 14;
    state.settings.discountPerDay = Number($("#discountPerDay") && $("#discountPerDay").value) || 1000;
    if (!state.settings.foodOptions.length) {
      state.settings.foodOptions = DEFAULT_FOOD_OPTIONS.map(function (f) { return Object.assign({}, f); });
    }
    saveSettings();
    syncFeeLabels();
    renderFoodCatalogEditor();
    renderFoodOptions();
    renderSizeCards();
    updatePrice();
  }

  function showShareActions(on) {
    var el = $("#shareActions");
    if (!el) return;
    el.classList.toggle("hidden", !on);
  }

  function findBooking(id) {
    return state.bookings.find(function (b) { return b.id === id; }) || null;
  }

  function bookingDocumentHtml(b) {
    var visits = b.vetVisits || [];
    var visitsHtml = visits.length
      ? visits.map(function (v) {
          return "<li>" + formatDMY(v.date) + " · " + vetTypeLabel(v.type) + " · " +
            money((Number(v.serviceFee) || 0) + (Number(v.medicinePrice) || 0)) +
            (v.medicineName ? " · " + v.medicineName : "") +
            (v.note ? " · " + v.note : "") + "</li>";
        }).join("")
      : "<li>—</li>";
    return "<!DOCTYPE html><html><head><meta charset='utf-8'><title>" + HOTEL_NAME + " — " + (b.petName || "") + "</title>" +
      "<style>body{font-family:Georgia,serif;padding:24px;color:#1c3329}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}.muted{color:#666}</style></head><body>" +
      "<h1>" + HOTEL_NAME + "</h1><p class='muted'>" + hotelLine() + "</p>" +
      "<h2>" + t("bk.docTitle", "Бронь") + ": " + (b.petName || "") + "</h2>" +
      "<table>" +
      "<tr><th>" + t("bk.kennel", "Вольер") + "</th><td>" + (b.kennelId || "—") + "</td></tr>" +
      "<tr><th>" + t("bk.size", "Размер") + "</th><td>" + sizeLabel(b.size) + "</td></tr>" +
      "<tr><th>" + t("bk.checkin", "Заезд") + "</th><td>" + formatDMY(b.dateIn) + "</td></tr>" +
      "<tr><th>" + t("bk.checkout", "Выезд") + "</th><td>" + formatDMY(b.dateOut) + "</td></tr>" +
      "<tr><th>" + t("bk.ownerName", "Хозяин") + "</th><td>" + (b.ownerName || "—") + "</td></tr>" +
      "<tr><th>" + t("bk.phone", "Телефон") + "</th><td>" + (b.ownerPhone || "—") + "</td></tr>" +
      "<tr><th>" + t("bk.hotelFood", "Корм") + "</th><td>" + (b.foodName || t("bk.foodOwn", "Свой корм")) + "</td></tr>" +
      (b.aggressive ? "<tr><th>" + t("bk.aggression", "Агрессия") + "</th><td>+" + money(aggressionFeeForSize(b.size)) + "/" + t("bk.nightsShort", "сут.") + "</td></tr>" : "") +
      "<tr><th>" + t("bk.depositAmount", "Предоплата") + "</th><td>" + (b.depositPaid ? money(state.settings.depositAmount || 10000) : "—") + "</td></tr>" +
      "<tr><th>" + t("bk.due", "К оплате") + "</th><td><strong>" + money(b.total || 0) + "</strong></td></tr>" +
      "</table>" +
      "<h3>" + t("bk.vetLog", "Вызовы ветврача") + "</h3><ul>" + visitsHtml + "</ul>" +
      (b.notes ? "<p><strong>" + t("bk.notes", "Заметки") + ":</strong> " + b.notes + "</p>" : "") +
      "</body></html>";
  }

  function printBookingDoc(b) {
    if (!b) b = findBooking(state.lastSavedId);
    if (!b) return formMessage(t("bk.noDoc", "Сначала сохраните бронь."), "warn");
    var frame = $("#printFrame");
    var doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(bookingDocumentHtml(b));
    doc.close();
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  function downloadBookingDoc(b) {
    if (!b) b = findBooking(state.lastSavedId);
    if (!b) return formMessage(t("bk.noDoc", "Сначала сохраните бронь."), "warn");
    var blob = new Blob([bookingDocumentHtml(b)], { type: "text/html;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "booking-" + (b.petName || "doc") + "-" + (b.dateIn || "") + ".html";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function shareBookingDoc(b) {
    if (!b) b = findBooking(state.lastSavedId);
    if (!b) return formMessage(t("bk.noDoc", "Сначала сохраните бронь."), "warn");
    var text = [
      HOTEL_NAME + " — " + (b.petName || ""),
      t("bk.kennel", "Вольер") + ": " + (b.kennelId || "—"),
      formatDMY(b.dateIn) + " → " + formatDMY(b.dateOut),
      (b.ownerName || "") + " · " + (b.ownerPhone || ""),
      t("bk.due", "К оплате") + ": " + money(b.total || 0)
    ].join("\n");
    var waTarget = b.ownerPhone || STAFF_WHATSAPP;
    if (navigator.share) {
      navigator.share({ title: HOTEL_NAME, text: text }).catch(function () {
        if (waTarget) openWhatsApp(waTarget, text);
      });
    } else if (waTarget) {
      openWhatsApp(waTarget, text);
    }
  }

  function isVetFormDirty() {
    var type = $("#vetVisitType").value;
    var note = ($("#vetVisitNote").value || "").trim();
    var medName = ($("#vetMedicineName").value || "").trim();
    var medPrice = Number($("#vetMedicinePrice").value) || 0;
    var fee = Number($("#vetServiceFee").value) || 0;
    var defaultFee = Number(state.settings.vetCallFee) || 15000;
    var today = formatDMY(formatISO(new Date()));
    var dateVal = ($("#vetVisitDate").value || "").trim();
    if (type !== "exam") return true;
    if (note) return true;
    if (medName || medPrice) return true;
    if (fee !== defaultFee) return true;
    if (dateVal && dateVal !== today) return true;
    return false;
  }

  function showVetDirtyConfirm(show) {
    var box = $("#vetDirtyConfirm");
    var actions = $("#vetMainActions");
    if (box) box.classList.toggle("hidden", !show);
    if (actions) actions.classList.toggle("hidden", !!show);
  }

  function closeVetDialog(force) {
    var dlg = $("#vetDialog");
    if (!force && isVetFormDirty()) {
      showVetDirtyConfirm(true);
      return false;
    }
    showVetDirtyConfirm(false);
    if (dlg && typeof dlg.close === "function") dlg.close();
    else if (dlg) dlg.removeAttribute("open");
    return true;
  }

  function openVetDialog(bookingId) {
    $("#vetTargetBookingId").value = bookingId || "";
    $("#vetDialogTitle").textContent = bookingId
      ? t("bk.addVetToStay", "Добавить вызов к броне")
      : t("bk.addVet", "Добавить вызов");
    $("#vetVisitDate").value = formatDMY(formatISO(new Date()));
    $("#vetVisitType").value = "exam";
    $("#vetServiceFee").value = String(state.settings.vetCallFee || 15000);
    $("#vetMedicineName").value = "";
    $("#vetMedicinePrice").value = "0";
    $("#vetVisitNote").value = "";
    $("#vetMedicineFields").classList.add("hidden");
    showVetDirtyConfirm(false);
    var dlg = $("#vetDialog");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
  }

  function guardDialogClose(dialog, isDirty, onAsk) {
    if (!dialog) return;
    dialog.addEventListener("cancel", function (event) {
      if (!isDirty()) return;
      event.preventDefault();
      onAsk();
    });
    dialog.addEventListener("click", function (event) {
      if (event.target !== dialog) return;
      if (!isDirty()) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
        return;
      }
      onAsk();
    });
  }

  function saveVetVisitFromDialog() {
    var type = $("#vetVisitType").value;
    var dateIso = parseDMY($("#vetVisitDate").value) || formatISO(new Date());
    var visit = {
      id: uid(),
      date: dateIso,
      type: type,
      serviceFee: Number($("#vetServiceFee").value) || 0,
      medicineName: type === "medicine" ? ($("#vetMedicineName").value || "").trim() : "",
      medicinePrice: type === "medicine" ? (Number($("#vetMedicinePrice").value) || 0) : 0,
      note: ($("#vetVisitNote").value || "").trim()
    };
    var bookingId = $("#vetTargetBookingId").value;
    if (bookingId) {
      var b = findBooking(bookingId);
      if (!b) return;
      if (!Array.isArray(b.vetVisits)) b.vetVisits = [];
      b.vetVisits.push(visit);
      var foodPrice = Number(b.foodPrice) || 0;
      var price = calcPrice({
        size: b.size,
        dateIn: b.dateIn,
        dateOut: b.dateOut,
        foodPrice: foodPrice,
        foodName: b.foodName || "",
        aggressive: !!b.aggressive,
        vetVisits: b.vetVisits
      });
      b.total = price.total;
      b.priceBreakdown = price;
      saveBookings();
      renderBookings();
      formMessage(t("bk.vetAdded", "Вызов добавлен к броне.") + " " + money(visit.serviceFee + visit.medicinePrice), "ok");
    } else {
      state.draftVetVisits.push(visit);
      renderDraftVetVisits();
      updatePrice();
    }
  }

  function ensureReminderNotifications() {
    var tomorrow = formatISO(addDays(new Date(), 1));
    var todayKey = formatISO(new Date());
    activeBookings().forEach(function (b) {
      if (b.dateIn === tomorrow) {
        var keyIn = "remind-in-" + b.id + "-" + todayKey;
        if (!state.notifications.some(function (n) { return n.dedupe === keyIn; })) {
          state.notifications.unshift({
            id: uid(),
            at: new Date().toISOString(),
            read: false,
            type: "remind_in",
            dedupe: keyIn,
            title: t("bk.remindIn", "Завтра заезд"),
            body: (b.petName || "") + " · " + (b.kennelId || "") + " · " + (b.ownerPhone || ""),
            bookingId: b.id
          });
        }
      }
      if (b.dateOut === tomorrow) {
        var keyOut = "remind-out-" + b.id + "-" + todayKey;
        if (!state.notifications.some(function (n) { return n.dedupe === keyOut; })) {
          state.notifications.unshift({
            id: uid(),
            at: new Date().toISOString(),
            read: false,
            type: "remind_out",
            dedupe: keyOut,
            title: t("bk.remindOut", "Завтра выезд"),
            body: (b.petName || "") + " · " + (b.kennelId || "") + " · " + (b.ownerPhone || ""),
            bookingId: b.id
          });
        }
      }
    });
    saveNotifications();
  }

  function updateNotifUi() {
    var unread = unreadNotifCount();
    var notifEl = $("#notifCount");
    if (notifEl) {
      if (unread > 0 && state.isAdmin) {
        notifEl.textContent = String(unread);
        notifEl.classList.remove("hidden");
      } else {
        notifEl.classList.add("hidden");
      }
    }
  }

  function deleteNotificationById(id) {
    state.notifications = state.notifications.filter(function (n) { return n.id !== id; });
    saveNotifications();
    renderNotifList();
    updateNotifUi();
  }

  function clearAllNotifications() {
    if (!state.notifications.length) return;
    if (!window.confirm(t("bk.confirmClearNotifs", "Удалить все оповещения?"))) return;
    state.notifications = [];
    saveNotifications();
    renderNotifList();
    updateNotifUi();
    formMessage(t("bk.notifsCleared", "Оповещения удалены."), "ok");
  }

  function renderNotifList() {
    var root = $("#notifList");
    if (!root) return;
    ensureReminderNotifications();
    updateNotifUi();
    if (!state.notifications.length) {
      root.innerHTML = "<p class=\"booking-hint\">" + t("bk.noNotifs", "Пока нет оповещений.") + "</p>";
      return;
    }
    root.innerHTML = "";

    state.notifications.forEach(function (n) {
      var card = document.createElement("article");
      card.className = "notif-item" + (n.read ? "" : " is-unread");
      var linked = n.bookingId ? findBooking(n.bookingId) : null;
      var profile = linked ? petProfileLine(linked) : "";
      card.innerHTML =
        "<header><strong>" + n.title + "</strong>" +
        "<span class=\"meta\">" + formatDMY(n.at.slice(0, 10)) + "</span></header>" +
        "<div class=\"meta\">" + (n.body || "") + "</div>" +
        (profile ? "<div class=\"meta\">" + profile + "</div>" : "") +
        "<div class=\"card-actions\">" +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-del-notif=\"1\">" + t("bk.actDelete", "Удалить") + "</button>" +
        "</div>";
      card.querySelector("[data-del-notif]").addEventListener("click", function () {
        deleteNotificationById(n.id);
      });
      root.appendChild(card);
    });
  }

  function openNotifDialog() {
    var dlg = $("#notifDialog");
    renderNotifList();
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
  }

  function historyListItems() {
    var q = (($("#historySearch") && $("#historySearch").value) || "").trim().toLowerCase();
    var status = ($("#historyStatusFilter") && $("#historyStatusFilter").value) || "all";
    return state.bookings.filter(function (b) {
      if (status !== "all" && b.status !== status) return false;
      if (!q) return true;
      var hay = [
        b.petName || "",
        b.ownerName || "",
        b.ownerPhone || "",
        b.kennelId || "",
        b.breed || "",
        b.notes || "",
        b.status || ""
      ].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    }).slice().sort(function (a, b) {
      var aa = a.createdAt || a.dateIn || "";
      var bb = b.createdAt || b.dateIn || "";
      return aa < bb ? 1 : aa > bb ? -1 : 0;
    });
  }

  function renderHistoryList() {
    var root = $("#historyList");
    if (!root || !state.isAdmin) return;
    var list = historyListItems();
    if (!list.length) {
      root.innerHTML = "<p class=\"booking-hint\">" + t("bk.noHistory", "История пока пуста.") + "</p>";
      return;
    }
    root.innerHTML = "";
    list.forEach(function (b) {
      var card = document.createElement("article");
      card.className = "booking-card";
      card.innerHTML =
        "<header><strong>" + (b.petName || t("bk.noPet", "Без клички")) +
        (b.kennelId ? " · " + b.kennelId : "") + "</strong>" +
        "<span class=\"status-pill is-" + b.status + "\">" + statusLabel(b.status) + "</span></header>" +
        "<div class=\"meta\">" + formatDMY(b.dateIn) + " → " + formatDMY(b.dateOut) +
        " · " + money(b.total || 0) +
        (b.source ? " · " + b.source : "") + "</div>" +
        "<div class=\"meta\">" + (b.ownerName ? b.ownerName + " · " : "") + (b.ownerPhone || t("bk.noPhone", "без телефона")) + "</div>" +
        (petProfileLine(b) ? "<div class=\"meta\">" + petProfileLine(b) + "</div>" : "") +
        (b.notes ? "<div class=\"meta\">" + b.notes + "</div>" : "") +
        "<div class=\"card-actions\">" +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-hist=\"form\">" + t("bk.toForm", "В форму") + "</button>" +
        (b.ownerPhone ? "<button type=\"button\" class=\"btn btn-line btn-sm\" data-hist=\"wa\">WhatsApp</button>" : "") +
        "<button type=\"button\" class=\"btn btn-line btn-sm\" data-hist=\"delete\">" + t("bk.actDelete", "Удалить") + "</button>" +
        "</div>";
      card.querySelectorAll("[data-hist]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var act = btn.getAttribute("data-hist");
          if (act === "form") {
            fillFormFromBooking(b);
            var dlg = $("#historyDialog");
            if (dlg && dlg.open && typeof dlg.close === "function") dlg.close();
          } else if (act === "wa") {
            openWhatsApp(b.ownerPhone, t("bk.waAsk", "Здравствуйте! Это Kennel Booking по вашей брони на") + " " + (b.petName || "") + ".");
          } else if (act === "delete") {
            if (!window.confirm(t("bk.confirmDelete", "Удалить эту бронь без возможности восстановления?"))) return;
            rememberDeletedId(b.id);
            state.bookings = state.bookings.filter(function (x) { return x.id !== b.id; });
            saveBookings();
            renderHistoryList();
            renderBookings();
            updateNotifUi();
          }
        });
      });
      root.appendChild(card);
    });
  }

  function openHistoryDialog() {
    if (!state.isAdmin) return;
    var dlg = $("#historyDialog");
    if ($("#historySearch")) $("#historySearch").value = "";
    if ($("#historyStatusFilter")) $("#historyStatusFilter").value = "all";
    renderHistoryList();
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
  }

  function formMessage(text, type) {
    var el = $("#formMsg");
    el.className = "alert alert-" + (type || "warn");
    el.textContent = text;
    el.classList.remove("hidden");
  }

  function validateCommonFields() {
    clearFieldErrors();
    syncHiddenDatesFromDmy();
    var dateIn = $("#dateIn").value;
    var dateOut = $("#dateOut").value;
    var nights = daysBetween(dateIn, dateOut);
    var ok = true;
    var firstMsg = "";

    if (!state.size) {
      markInvalid("#sizeGrid", "errSize", t("bk.errSize", "Выберите размер собаки."));
      ok = false;
      firstMsg = firstMsg || t("bk.errSize", "Выберите размер собаки.");
    }

    if (!dateIn || !dateOut || nights < 1) {
      markInvalid("[data-field='dateIn'], [data-field='nights']", "errDates", t("bk.errDates", "Укажите заезд и число суток."));
      $("#nights").classList.add("is-invalid");
      ok = false;
      firstMsg = firstMsg || t("bk.errDates", "Укажите заезд и число суток.");
    }

    var petName = $("#petName").value.trim();
    var ownerName = $("#ownerName").value.trim();
    var phone = $("#ownerPhone").value.trim();

    if (!petName) {
      markInvalid("[data-field='petName']", "errGuest", t("bk.errPet", "Укажите кличку собаки."));
      $("#petName").classList.add("is-invalid");
      ok = false;
      firstMsg = firstMsg || t("bk.errPet", "Укажите кличку собаки.");
    }
    if (!ownerName) {
      markInvalid("[data-field='ownerName']", "errGuest", t("bk.errOwner", "Укажите имя хозяина."));
      $("#ownerName").classList.add("is-invalid");
      ok = false;
      firstMsg = firstMsg || t("bk.errOwner", "Укажите имя хозяина.");
    }
    if (!phone || !isValidArmPhone(phone)) {
      markInvalid("[data-field='ownerPhone']", "errGuest", t("bk.errPhone", "Телефон в формате +374 XX XXX XXX."));
      $("#ownerPhone").classList.add("is-invalid");
      ok = false;
      firstMsg = firstMsg || t("bk.errPhone", "Телефон в формате +374 XX XXX XXX.");
    } else {
      $("#ownerPhone").value = formatPhoneDisplay(phone);
    }

    return { ok: ok, message: firstMsg, dateIn: dateIn, dateOut: dateOut, nights: nights, petName: petName, ownerName: ownerName, phone: formatPhoneDisplay(phone) };
  }

  function validateAndSave() {
    if (!state.isAdmin) return;
    var common = validateCommonFields();
    if (!common.ok) return formMessage(common.message, "error");

    var age = readPetAge();
    if (!age.filled) {
      markInvalid("[data-field='petAge']", "errGuest", t("bk.errAge", "Укажите возраст собаки."));
      return formMessage(t("bk.errAge", "Укажите возраст собаки."), "error");
    }
    if (age.totalMonths < 6) {
      markInvalid("[data-field='petAge']", "errGuest", t("bk.errTooYoung", "Не принимаем младше 6 месяцев."));
      return formMessage(
        t("bk.errTooYoungFull", "К сожалению, не можем принять собаку младше 6 месяцев, а также без прививок и без ветпаспорта."),
        "error"
      );
    }

    if (!state.kennelId) {
      markInvalid("#kennelGrid", "errKennel", t("bk.errKennel", "Выберите свободный вольер."));
      return formMessage(t("bk.errKennel", "Выберите свободный вольер."), "error");
    }
    if (!isKennelFree(state.kennelId, common.dateIn, common.dateOut)) {
      return formMessage(t("bk.errKennelBusy", "Этот вольер уже занят."), "error");
    }

    var food = currentFoodSelection();
    var price = calcPrice({
      size: state.size,
      dateIn: common.dateIn,
      dateOut: common.dateOut,
      foodPrice: food.price,
      foodName: food.name,
      aggressive: $("#aggressive").checked,
      vetVisits: state.draftVetVisits
    });

    var booking = {
      id: uid(),
      createdAt: new Date().toISOString(),
      status: "pending",
      size: state.size,
      kennelId: state.kennelId,
      dateIn: common.dateIn,
      dateOut: common.dateOut,
      nights: price.nights,
      petName: common.petName,
      breed: $("#breed").value.trim(),
      weight: $("#weight").value.trim(),
      ageYears: age.years,
      ageMonths: age.months,
      ageLabel: formatPetAge(age.years, age.months),
      ownerName: common.ownerName,
      ownerPhone: common.phone,
      foodOptionId: food.id,
      foodName: food.name,
      foodPrice: food.price,
      hotelFood: !!food.id,
      aggressive: $("#aggressive").checked,
      vetVisits: state.draftVetVisits.slice(),
      grooming: $("#grooming").checked,
      cameraShown: $("#cameraShown").checked,
      depositPaid: $("#depositPaid").checked,
      notes: $("#notes").value.trim(),
      petPhoto: state.petPhotoData || "",
      total: price.total,
      priceBreakdown: price
    };
    state.bookings.push(booking);
    saveBookings();
    state.lastSavedId = booking.id;
    renderBookings();
    showShareActions(true);
    formMessage(t("bk.saved", "Бронь сохранена") + ": " + state.kennelId + ", " + money(price.total) + ".", "ok");
    $("#petName").value = "";
    $("#breed").value = "";
    $("#weight").value = "";
    if ($("#petAgeYears")) $("#petAgeYears").value = "";
    if ($("#petAgeMonths")) $("#petAgeMonths").value = "";
    $("#ownerName").value = "";
    $("#ownerPhone").value = "";
    $("#notes").value = "";
    $("#grooming").checked = false;
    $("#cameraShown").checked = false;
    $("#depositPaid").checked = false;
    if ($("#aggressive")) $("#aggressive").checked = false;
    state.kennelId = null;
    state.petPhotoData = "";
    state.draftVetVisits = [];
    state.foodOptionId = "";
    showAdminPhoto("");
    renderFoodOptions();
    renderDraftVetVisits();
    syncFeeLabels();
    updateAvailability();
    updatePrice();
    renderKennelMiniCal();
  }

  function exportBookings() {
    var blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      bookings: state.bookings,
      notifications: state.notifications
    }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bookings-" + formatISO(new Date()) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importBookings(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (Array.isArray(data)) state.bookings = data;
        else {
          if (Array.isArray(data.bookings)) state.bookings = data.bookings;
          if (data.settings) state.settings = normalizeSettings(data.settings);
          if (Array.isArray(data.notifications)) state.notifications = data.notifications;
        }
        state.bookings = (state.bookings || []).filter(function (b) {
          return b && !isLegacyRequestStatus(b.status);
        });
        saveBookings();
        saveSettings();
        saveNotifications();
        fillSettingsForm();
        renderSizeCards();
        renderBookings();
        updateAvailability();
        updatePrice();
        formMessage(t("bk.imported", "База загружена") + ": " + state.bookings.length + ".", "ok");
      } catch (e) {
        formMessage(t("bk.importFail", "Не удалось прочитать файл."), "error");
      }
    };
    reader.readAsText(file);
  }

  function showNearest() {
    if (!state.size) return formMessage(t("bk.errSize", "Выберите размер собаки."), "error");
    var nights = Math.max(1, Number($("#nights").value) || 1);
    var from = $("#dateIn").value || formatISO(new Date());
    var windows = findNearestWindows(state.size, nights, from, 8);
    if (!windows.length) {
      renderSuggestions([]);
      return formMessage(t("bk.noWindows", "За 60 дней свободных окон не найдено."), "error");
    }
    renderSuggestions(windows.map(function (w) {
      return {
        title: t("bk.free", "свободно") + " · " + w.kennelLabel,
        detail: formatDMY(w.dateIn) + " → " + formatDMY(w.dateOut) + " · " + w.nights + " " + t("bk.nightsShort", "сут."),
        dateIn: w.dateIn,
        dateOut: w.dateOut,
        kennelId: w.kennelId
      };
    }));
    formMessage(t("bk.windowsFound", "Найдено окон") + ": " + windows.length + ".", "ok");
  }

  function initDates() {
    var today = formatISO(new Date());
    applyDates(today, formatISO(addDays(new Date(), 1)));
  }

  function openPinDialog() {
    var dlg = $("#pinDialog");
    $("#pinError").classList.add("hidden");
    $("#pinInput").value = "";
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
    setTimeout(function () { $("#pinInput").focus(); }, 50);
  }

  function enterAdmin() {
    loadState();
    setAdminSession(true);
    fillSettingsForm();
    ensureReminderNotifications();
    renderSizeCards();
    renderFoodOptions();
    renderDraftVetVisits();
    renderBookings();
    updateNotifUi();
    updateAvailability();
    updatePrice();
    renderKennelMiniCal();
    if (window.ZH && typeof window.ZH.apply === "function") window.ZH.apply(window.ZH.current());
    formMessage(t("bk.adminOn", "Режим персонала включён."), "ok");
    if (unreadNotifCount()) openNotifDialog();
  }

  function leaveAdmin() {
    var dlg = $("#boardDialog");
    if (dlg && dlg.open && typeof dlg.close === "function") dlg.close();
    var nd = $("#notifDialog");
    if (nd && nd.open && typeof nd.close === "function") nd.close();
    var hd = $("#historyDialog");
    if (hd && hd.open && typeof hd.close === "function") hd.close();
    setAdminSession(false);
    state.kennelId = null;
    updateNotifUi();
    renderSizeCards();
    updatePrice();
    if (!STAFF_ONLY) updatePublicAvailability();
    if (window.ZH && typeof window.ZH.apply === "function") window.ZH.apply(window.ZH.current());
    formMessage(t("bk.adminOff", "Вы вышли из режима персонала."), "ok");
    if (STAFF_ONLY) openPinDialog();
  }

  function refreshUiLanguage() {
    renderSizeCards();
    renderFoodOptions();
    renderDraftVetVisits();
    updateAvailability();
    updatePrice();
    renderKennelMiniCal();
    if (state.isAdmin) renderBookings();
  }

  function bind() {
    ["inDay", "inMonth", "inYear"].forEach(function (id) {
      $("#" + id).addEventListener("change", onInDateChanged);
    });
    ["outDay", "outMonth", "outYear"].forEach(function (id) {
      $("#" + id).addEventListener("change", onOutDateChanged);
    });
    $("#nights").addEventListener("input", function () {
      if (state.syncLock) return;
      if (!syncOutFromNights()) return;
      updateAvailability();
      updatePrice();
      renderKennelMiniCal();
    });
    $("#nights").addEventListener("blur", function () {
      if (state.syncLock) return;
      syncOutFromNights({ force: true });
      updateAvailability();
      updatePrice();
      renderKennelMiniCal();
    });
    var aggressive = $("#aggressive");
    if (aggressive) aggressive.addEventListener("change", updatePrice);
    $("#saveBooking").addEventListener("click", validateAndSave);
    $("#findNearest").addEventListener("click", showNearest);
    $("#saveSettings").addEventListener("click", function () {
      readSettingsForm();
      formMessage(t("bk.pricesSaved", "Цены сохранены."), "ok");
    });
    if ($("#addFoodOption")) {
      $("#addFoodOption").addEventListener("click", function () {
        state.settings.foodOptions.push({ id: "food-" + Date.now().toString(36), name: "", price: 1000 });
        renderFoodCatalogEditor();
      });
    }
    $("#exportBtn").addEventListener("click", exportBookings);
    $("#importBtn").addEventListener("click", function () { $("#importFile").click(); });
    $("#importFile").addEventListener("change", function () {
      if (this.files && this.files[0]) importBookings(this.files[0]);
      this.value = "";
    });
    $("#openBoardBtn").addEventListener("click", function () { openBoard(null); });
    $("#openKennelCalBtn").addEventListener("click", function () {
      if (!state.kennelId) return formMessage(t("bk.errKennel", "Выберите свободный вольер."), "warn");
      openBoard(state.kennelId);
    });
    $("#boardFilter").addEventListener("change", renderBoard);
    $("#boardView").addEventListener("change", function () {
      syncBoardPeriodInput();
      renderBoard();
    });
    $("#boardPeriod").addEventListener("change", renderBoard);
    $("#boardPeriod").addEventListener("input", function () {
      if ($("#boardView").value === "year") renderBoard();
    });

    $("#bookingSearch").addEventListener("input", function () {
      state.listQuery = this.value;
      renderBookings();
    });
    $("#bookingStatusFilter").addEventListener("change", function () {
      state.listStatus = this.value;
      renderBookings();
    });

    $("#ownerPhone").addEventListener("blur", function () {
      if (isValidArmPhone(this.value)) this.value = formatPhoneDisplay(this.value);
    });

    function onPetPhotoPicked(input) {
      var file = input.files && input.files[0];
      compressImageFile(file, function (dataUrl) {
        state.petPhotoData = dataUrl || "";
        var preview = $("#petPhotoPreview");
        if (!preview) return;
        if (dataUrl) {
          preview.classList.remove("hidden");
          preview.innerHTML = "<img src=\"" + dataUrl + "\" alt=\"\">";
        } else {
          preview.classList.add("hidden");
          preview.innerHTML = "";
        }
      });
      input.value = "";
    }
    var petPhoto = $("#petPhoto");
    if (petPhoto) petPhoto.addEventListener("change", function () { onPetPhotoPicked(this); });
    var petPhotoCamera = $("#petPhotoCamera");
    if (petPhotoCamera) petPhotoCamera.addEventListener("change", function () { onPetPhotoPicked(this); });
    if ($("#petPhotoGalleryBtn") && petPhoto) {
      $("#petPhotoGalleryBtn").addEventListener("click", function () { petPhoto.click(); });
    }
    if ($("#petPhotoCameraBtn") && petPhotoCamera) {
      $("#petPhotoCameraBtn").addEventListener("click", function () { petPhotoCamera.click(); });
    }

    if ($("#addVetVisitBtn")) {
      $("#addVetVisitBtn").addEventListener("click", function () { openVetDialog(""); });
    }
    if ($("#vetVisitType")) {
      $("#vetVisitType").addEventListener("change", function () {
        $("#vetMedicineFields").classList.toggle("hidden", this.value !== "medicine");
      });
    }
    if ($("#vetVisitDate")) {
      $("#vetVisitDate").addEventListener("input", function () {
        this.value = maskDMYInput(this.value);
      });
      $("#vetVisitDate").addEventListener("blur", function () {
        var iso = parseDMY(this.value);
        if (iso) this.value = formatDMY(iso);
      });
    }
    if ($("#vetForm")) {
      $("#vetForm").addEventListener("submit", function (event) {
        var submitter = event.submitter;
        var value = submitter ? submitter.value : "ok";
        if (value === "cancel") {
          event.preventDefault();
          closeVetDialog(false);
          return;
        }
        event.preventDefault();
        saveVetVisitFromDialog();
        closeVetDialog(true);
      });
    }
    if ($("#vetDirtyDiscard")) {
      $("#vetDirtyDiscard").addEventListener("click", function () { closeVetDialog(true); });
    }
    if ($("#vetDirtyKeep")) {
      $("#vetDirtyKeep").addEventListener("click", function () { showVetDirtyConfirm(false); });
    }
    guardDialogClose($("#vetDialog"), isVetFormDirty, function () { showVetDirtyConfirm(true); });
    guardDialogClose($("#pinDialog"), function () {
      return !!(($("#pinInput").value || "").trim());
    }, function () {
      var toast = $("#dirtyToast");
      if (!toast) {
        $("#pinDialog").close();
        return;
      }
      toast.classList.remove("hidden");
      toast.dataset.target = "pin";
    });
    guardDialogClose($("#notifDialog"), function () { return false; }, function () {});
    guardDialogClose($("#boardDialog"), function () { return false; }, function () {});

    if ($("#dirtyToastDiscard")) {
      $("#dirtyToastDiscard").addEventListener("click", function () {
        var toast = $("#dirtyToast");
        toast.classList.add("hidden");
        if (toast.dataset.target === "pin") $("#pinDialog").close();
        toast.dataset.target = "";
      });
    }
    if ($("#dirtyToastKeep")) {
      $("#dirtyToastKeep").addEventListener("click", function () {
        $("#dirtyToast").classList.add("hidden");
        $("#dirtyToast").dataset.target = "";
      });
    }
    if ($("#printBookingBtn")) $("#printBookingBtn").addEventListener("click", function () { printBookingDoc(); });
    if ($("#downloadBookingBtn")) $("#downloadBookingBtn").addEventListener("click", function () { downloadBookingDoc(); });
    if ($("#shareBookingBtn")) $("#shareBookingBtn").addEventListener("click", function () { shareBookingDoc(); });

    if ($("#staffLoginBtn")) $("#staffLoginBtn").addEventListener("click", openPinDialog);
    if ($("#staffLogoutBtn")) $("#staffLogoutBtn").addEventListener("click", leaveAdmin);
    if ($("#staffLoginNavBtn")) {
      $("#staffLoginNavBtn").addEventListener("click", function () {
        var nav = document.querySelector("[data-nav]");
        var toggle = document.querySelector("[data-nav-toggle]");
        if (nav) nav.classList.remove("is-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
        openPinDialog();
      });
    }
    if ($("#staffLogoutNavBtn")) {
      $("#staffLogoutNavBtn").addEventListener("click", function () {
        var nav = document.querySelector("[data-nav]");
        var toggle = document.querySelector("[data-nav-toggle]");
        if (nav) nav.classList.remove("is-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
        leaveAdmin();
      });
    }
    if (STAFF_ONLY && $("#pinDialog")) {
      $("#pinDialog").addEventListener("cancel", function (event) {
        event.preventDefault();
      });
    }
    if ($("#notifBtn")) $("#notifBtn").addEventListener("click", openNotifDialog);
    if ($("#markNotifRead")) {
      $("#markNotifRead").addEventListener("click", function () {
        state.notifications.forEach(function (n) { n.read = true; });
        saveNotifications();
        renderNotifList();
        updateNotifUi();
      });
    }
    if ($("#clearNotifsBtn")) $("#clearNotifsBtn").addEventListener("click", clearAllNotifications);
    if ($("#openHistoryBtn")) $("#openHistoryBtn").addEventListener("click", openHistoryDialog);
    if ($("#historySearch")) $("#historySearch").addEventListener("input", renderHistoryList);
    if ($("#historyStatusFilter")) $("#historyStatusFilter").addEventListener("change", renderHistoryList);
    if ($("#historyDialog")) guardDialogClose($("#historyDialog"), function () { return false; }, function () {});

    $("#pinForm").addEventListener("submit", function (event) {
      var submitter = event.submitter;
      var value = submitter ? submitter.value : "ok";
      if (value === "cancel") return;
      event.preventDefault();
      var pin = ($("#pinInput").value || "").trim();
      if (pin !== ADMIN_PIN) {
        $("#pinError").textContent = t("bk.pinWrong", "Неверный PIN.");
        $("#pinError").classList.remove("hidden");
        $("#pinInput").classList.add("is-invalid");
        return;
      }
      $("#pinDialog").close();
      enterAdmin();
    });

    document.querySelectorAll("[data-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTimeout(refreshUiLanguage, 0);
      });
    });

    // Same-browser sync across tabs
    window.addEventListener("storage", function (event) {
      if (event.key !== STORAGE_KEY && event.key !== NOTIFY_KEY) return;
      loadState();
      if (state.isAdmin) {
        ensureReminderNotifications();
        renderBookings();
        updateNotifUi();
        updateAvailability();
        renderKennelMiniCal();
      }
    });

    setInterval(function () {
      if (!state.isAdmin) return;
      var prev = state.bookings.length;
      loadState();
      if (state.bookings.length !== prev) {
        renderBookings();
        updateNotifUi();
        updateAvailability();
      }
    }, 8000);
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadState();
    setAdminSession(isAdminSession());
    initDates();
    fillSettingsForm();
    renderSizeCards();
    renderFoodOptions();
    renderDraftVetVisits();
    if (state.isAdmin) {
      ensureReminderNotifications();
      renderBookings();
      updateNotifUi();
    }
    bind();
    updateAvailability();
    updatePrice();
    renderKennelMiniCal();
    if (window.ZH && typeof window.ZH.apply === "function") window.ZH.apply(window.ZH.current());
    if (STAFF_ONLY && !state.isAdmin) openPinDialog();
  });
})();
