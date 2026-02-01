(function () {
  'use strict';

  // ------------ CONFIG ------------
  const apiKey = '14eae742e9a0756609a6a79ba9b21d79';
  const geoCacheKey = 'geoCache_v1';
  const unitKey = 'unit';
  const langKey = 'lang';
  const themeKey = 'theme';
  const modeKey = 'mode';
  const apiBase = 'https://api.openweathermap.org';
  const UI = { CELSIUS: 'metric', FAHRENHEIT: 'imperial' };

  const supportedLangs = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
    { code: 'es', name: 'Español' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'ru', name: 'Русский' },
    { code: 'zh_cn', name: '中文' },
    { code: 'ar', name: 'العربية' },
    { code: 'ja', name: '日本語' },
    { code: 'pt', name: 'Português' },
    { code: 'tr', name: 'Türkçe' }
  ];

  // ------------ STATE ------------
  let displayUnit = localStorage.getItem(unitKey) || UI.CELSIUS;
  let lang = localStorage.getItem(langKey) || 'en';
  let theme = localStorage.getItem(themeKey) || 'theme-default';
  let mode = localStorage.getItem(modeKey) || 'light';
  let currentLat = null;
  let currentLon = null;
  let geoCache = JSON.parse(localStorage.getItem(geoCacheKey) || '{}');
  let serverData = null;
  let hourlyChart = null;
  let dailyChart = null;

  // ------------ DOM ELEMENTS ------------
  const $ = window.jQuery;
  const el = {
    cityInput: $("#city"),
    langInput: $("#language"),
    themeSelect: $("#theme-picker"),
    goBtn: $("#goBtn"),
    locBtn: $("#locBtn"),
    tempToggleBtn: $("#tempToggleBtn"),
    modeToggleBtn: $("#modeToggleBtn"),
    weatherInfo: $("#weather-info"),
    hourlyForecast: $("#hourly-forecast"),
    weeklyForecast: $("#weekly-forecast"),
    speechBtn: $("#speechBtn") // speech recognition
  };

  // ------------ UTILITIES ------------
  function cToF(c) { return (c * 9 / 5 + 32); }
  function mpsToMph(ms) { return (ms * 2.2369362920544); }
  function fmtTemp(val) { if (!val && val !== 0) return 'N/A'; return displayUnit === UI.CELSIUS ? `${Math.round(val)}°C` : `${Math.round(cToF(val))}°F`; }
  function fmtWind(val) { if (!val && val !== 0) return 'N/A'; return displayUnit === UI.CELSIUS ? `${val.toFixed(1)} m/s` : `${mpsToMph(val).toFixed(1)} mph`; }
  function fmtTime(ts) { return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function getIconUrl(icon) { return `https://openweathermap.org/img/wn/${icon}@2x.png`; }
  async function fetchJSON(url) { const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }
  function saveGeoCache() { try { localStorage.setItem(geoCacheKey, JSON.stringify(geoCache)); } catch (e) { } }

  // ------------ AQI LABELS ------------
  function getAQILabel(aqi) {
    switch (aqi) {
      case 1: return { label: "Good", color: "aqi-good" };
      case 2: return { label: "Fair", color: "aqi-fair" };
      case 3: return { label: "Moderate", color: "aqi-moderate" };
      case 4: return { label: "Poor", color: "aqi-poor" };
      case 5: return { label: "Very Poor", color: "aqi-very-poor" };
      default: return { label: "Unknown", color: "aqi-unknown" };
    }
  }

  // ------------ THEME & MODE ------------
  function applyTheme(themeName) {
    document.body.classList.remove('theme-default','theme-blue','theme-green','theme-sunny');
    document.body.classList.add(themeName);
    localStorage.setItem(themeKey, themeName);
  }
  applyTheme(theme);
  el.themeSelect.on('change', () => { theme = el.themeSelect.val(); applyTheme(theme); });

  function applyMode(modeName) {
    document.body.classList.remove('light-mode','dark-mode');
    document.body.classList.add(modeName+'-mode');
    localStorage.setItem(modeKey, modeName);
  }
  applyMode(mode);
  el.modeToggleBtn.on('click', () => { mode = mode === 'light' ? 'dark' : 'light'; applyMode(mode); });

  // ------------ LANGUAGE PICKER ------------
  function applyLanguage() { el.langInput.val(lang); localStorage.setItem(langKey, lang); }
  applyLanguage();
  el.langInput.on('change', () => { lang = el.langInput.val(); applyLanguage(); if(currentLat && currentLon) updateWeather(currentLat, currentLon); });

  // ------------ CITY AUTOCOMPLETE ------------
  el.cityInput.autocomplete({
    source: async (request, response) => {
      try {
        const data = await fetchJSON(`${apiBase}/geo/1.0/direct?q=${encodeURIComponent(request.term)}&limit=5&appid=${apiKey}&lang=${lang}`);
        response(data.map(c => `${c.name}${c.state? ', '+c.state: ''}, ${c.country}`));
      } catch { response([]); }
    },
    minLength: 2,
    select: async (_, ui) => {
      const cityName = ui.item.value;
      const cached = geoCache[cityName];
      if (cached) return updateWeather(cached.lat, cached.lon);

      try {
        const data = await fetchJSON(`${apiBase}/geo/1.0/direct?q=${encodeURIComponent(cityName)}&limit=1&appid=${apiKey}&lang=${lang}`);
        if (data.length) {
          const { lat, lon } = data[0];
          geoCache[cityName] = { lat, lon };
          saveGeoCache();
          updateWeather(lat, lon);
        }
      } catch { }
    }
  });

  // ------------ WEATHER FETCH ------------
  async function fetchWeather(lat, lon) {
    const weatherURL = `${apiBase}/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=${lang}&exclude=minutely`;
    const aqiURL = `${apiBase}/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
    const [weather, aqi] = await Promise.all([fetchJSON(weatherURL), fetchJSON(aqiURL)]);
    return { weather, aqi };
  }

  // ------------ RENDER MAIN WEATHER ------------
  function renderMain(current, aqi) {
    const aqiValue = aqi?.list?.[0]?.main?.aqi;
    const aqiInfo = getAQILabel(aqiValue);

    el.weatherInfo.html(`
      <div class="card p-3 mb-3">
        <div class="d-flex align-items-center gap-3">
          <img src="${getIconUrl(current.weather[0].icon)}" alt="">
          <h5>${current.weather[0].description}</h5>
        </div>
        <p>Temperature: ${fmtTemp(current.temp)}</p>
        <p>Feels like: ${fmtTemp(current.feels_like)}</p>
        <p>Wind: ${fmtWind(current.wind_speed)}</p>
        <p>Humidity: ${current.humidity}%</p>
        <p>Pressure: ${current.pressure} hPa</p>
        <p>Visibility: ${current.visibility ? (current.visibility/1000).toFixed(1)+' km' : 'N/A'}</p>
        <p>UV Index: ${current.uvi?.toFixed(1) || 'N/A'}</p>
        <p>Dew point: ${fmtTemp(current.dew_point)}</p>
        <p>Air Quality:
          <span class="aqi-badge ${aqiInfo.color}">${aqiInfo.label} (${aqiValue ?? "N/A"})</span>
        </p>
        <p>Sunrise: ${fmtTime(current.sunrise)} | Sunset: ${fmtTime(current.sunset)}</p>
      </div>
    `);
  }

  // ------------ FORECASTS & CHARTS ------------
  function createForecastCard({ title, icon, temp, extra }) {
    const card = document.createElement('div');
    card.className = 'forecast-card';
    if (title) card.innerHTML += `<div>${title}</div>`;
    if (icon) card.innerHTML += `<img src="${getIconUrl(icon)}">`;
    if (temp) card.innerHTML += `<div>${temp}</div>`;
    if (extra) card.innerHTML += `<small>${extra}</small>`;
    return card;
  }

  async function renderForecasts(weather) {
    const hourlyNext24 = weather.hourly.slice(1, 25);
    const dailyNext7 = weather.daily.slice(1, 8);

    el.hourlyForecast.empty();
    hourlyNext24.forEach(h =>
      el.hourlyForecast.append(createForecastCard({
        title: new Date(h.dt * 1000).toLocaleTimeString([], { hour: '2-digit' }),
        icon: h.weather[0].icon,
        temp: fmtTemp(h.temp)
      }))
    );

    el.weeklyForecast.empty();
    dailyNext7.forEach(d =>
      el.weeklyForecast.append(createForecastCard({
        title: new Date(d.dt * 1000).toLocaleDateString([], { weekday: 'short' }),
        icon: d.weather[0].icon,
        temp: fmtTemp(d.temp.day),
        extra: `Min: ${fmtTemp(d.temp.min)} / Max: ${fmtTemp(d.temp.max)}`
      }))
    );

    await loadChartJS();

    const hourlyLabels = hourlyNext24.map(h => new Date(h.dt * 1000).getHours());
    const hourlyTemps = hourlyNext24.map(h => displayUnit === UI.CELSIUS ? h.temp : cToF(h.temp));
    const dailyLabels = dailyNext7.map(d => new Date(d.dt * 1000).toLocaleDateString([], { weekday: 'short' }));
    const dailyTemps = dailyNext7.map(d => displayUnit === UI.CELSIUS ? d.temp.day : cToF(d.temp.day));

    if (hourlyChart) hourlyChart.destroy();
    hourlyChart = new Chart(document.getElementById('hourlyChart').getContext('2d'), {
      type: 'line',
      data: { labels: hourlyLabels, datasets: [{ label: `Temp`, data: hourlyTemps, borderColor: '#ff7043', backgroundColor: 'rgba(255,112,67,0.2)', fill: true }] },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });

    if (dailyChart) dailyChart.destroy();
    dailyChart = new Chart(document.getElementById('dailyChart').getContext('2d'), {
      type: 'bar',
      data: { labels: dailyLabels, datasets: [{ label: `Temp`, data: dailyTemps, backgroundColor: 'rgba(54,162,235,0.5)', borderColor: '#36A2EB', borderWidth: 1 }] },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  async function loadChartJS() {
    if (window.Chart) return;
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = "https://cdn.jsdelivr.net/npm/chart.js";
      s.onload = res;
      s.onerror = rej;
      document.body.appendChild(s);
    });
  }

  // ------------ WEATHER ALERTS ------------
  function renderAlerts(alerts) {
    if (!alerts || !alerts.length) return;
    el.weatherInfo.prepend(
      `<div id="weather-alerts">
        <h5>Weather Alerts</h5>
        ${alerts.map(alert => `
          <div class="alert alert-warning mb-2">
            <strong>${alert.event}</strong><br>
            <small>${new Date(alert.start * 1000).toLocaleString()} - ${new Date(alert.end * 1000).toLocaleString()}</small><br>
            <span>${alert.description.replace(/\n/g, '<br>')}</span>
            ${alert.sender_name ? `<div><em>Source: ${alert.sender_name}</em></div>` : ''}
          </div>`).join('')}
      </div>`
    );
  }

  // ------------ UPDATE WEATHER ------------
  async function updateWeather(lat, lon) {
    currentLat = lat;
    currentLon = lon;
    try {
      serverData = await fetchWeather(lat, lon);
      renderMain(serverData.weather.current, serverData.aqi);
      if (serverData.weather.alerts && serverData.weather.alerts.length) renderAlerts(serverData.weather.alerts);
      await renderForecasts(serverData.weather);
    } catch (e) { console.error(e); }
  }

  // ------------ EVENT LISTENERS ------------
  el.goBtn.on('click', async () => {
    const city = el.cityInput.val();
    if (!city) return alert("Enter a city");

    const cached = geoCache[city];
    if (cached) return updateWeather(cached.lat, cached.lon);

    try {
      const data = await fetchJSON(`${apiBase}/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}&lang=${lang}`);
      if (data.length) {
        const { lat, lon } = data[0];
        geoCache[city] = { lat, lon };
        saveGeoCache();
        updateWeather(lat, lon);
      } else alert("City not found");
    } catch (e) { console.error(e); }
  });

  el.locBtn.on('click', () => {
    if (!navigator.geolocation) return alert("Geolocation not supported");
    navigator.geolocation.getCurrentPosition(
      pos => updateWeather(pos.coords.latitude, pos.coords.longitude),
      () => alert("Cannot get location")
    );
  });

  el.tempToggleBtn.on('click', () => {
    displayUnit = displayUnit === UI.CELSIUS ? UI.FAHRENHEIT : UI.CELSIUS;
    localStorage.setItem(unitKey, displayUnit);
    if (currentLat && currentLon) updateWeather(currentLat, currentLon);
  });

  // ------------ SPEECH RECOGNITION ------------
  (function initUnifiedSpeechRecognition() {
    if (!el.speechBtn.length) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      el.speechBtn.on("click", () => alert("Speech recognition not supported."));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    const speechLangMap = { en: "en-US", fr: "fr-FR", es: "es-ES", de: "de-DE", it: "it-IT", ru: "ru-RU", zh_cn: "zh-CN", ar: "ar-SA", ja: "ja-JP", pt: "pt-PT", tr: "tr-TR" };
    function updateRecognitionLang() { recognition.lang = speechLangMap[lang] || "en-US"; }
    updateRecognitionLang();
    el.langInput.on("change", () => { lang = el.langInput.val(); updateRecognitionLang(); });

    el.speechBtn.on("click", () => {
      try { el.speechBtn.text("🎧 Listening..."); el.speechBtn.prop("disabled", true); recognition.start(); }
      catch (err) { console.error(err); resetSpeechBtn(); }
    });

    recognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript.trim();
      if (spokenText) { el.cityInput.val(spokenText); el.goBtn.click(); }
    };

    recognition.onerror = (event) => { alert("Speech error: " + event.error); resetSpeechBtn(); }
    recognition.onend = resetSpeechBtn;
    function resetSpeechBtn() { el.speechBtn.text("🎤 Speak"); el.speechBtn.prop("disabled", false); }
  })();

  // ------------ INIT ------------
  window.WeatherApp = { updateWeather };
  function fetchWeatherData() { if(currentLat && currentLon) updateWeather(currentLat, currentLon); }
  setInterval(fetchWeatherData, 60000);

})();