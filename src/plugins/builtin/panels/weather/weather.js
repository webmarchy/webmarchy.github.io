/**
 * Weather defaults — the plugin's own shipped config (persisted user
 * overrides live in the `weather.*` Settings namespace). `unit` empty
 * means auto: the report's country, then the browser locale, decide
 * (see WeatherModel.shouldUseImperial).
 */
const WEATHER_CONFIG = Object.freeze({
    refreshMinutes: 15,
    unit: '',
})

/**
 * Weather plugin — the condition-glyph bar widget and its detail panel,
 * mirroring upstream `omarchy.weather` (`shell/plugins/panels/weather/`,
 * kind `bar-widget`; BarWidget.qml owns the bar pill, Panel.qml the
 * popup — both live here since the panel is anchored to, and summoned
 * from, the pill).
 *
 * Same two data sources as upstream, fetched with `fetch` instead of
 * curl (all three endpoints answer CORS-open, `file://` included):
 * wttr.in `?format=j1` detects the location from the IP address and
 * carries the fallback forecast; Open-Meteo answers far faster for
 * known coordinates and bundles current conditions with the 3-day
 * forecast, so it fills the hero and bar icon (day/night aware) while
 * wttr is in flight. Both keep last-good data visible on failure and
 * retry up to three times per refresh cycle. The bar pill stays hidden
 * until a first report lands, exactly as upstream gates on `label`.
 *
 * The panel: hero icon + temperature beside the location and
 * FEELS / WIND / HUMID read-outs, a divider, then the next three days.
 * Clicking the location (or Enter while open) swaps it for a search
 * field backed by Open-Meteo geocoding — debounced suggestions,
 * ArrowUp/Down to pick, Enter commits (persisting name + coordinates),
 * an empty commit or the ✕ returns to IP auto-detect; a spinner holds
 * the editor open until the new location's first report confirms the
 * save. Left-click the pill toggles the panel, middle-click refreshes.
 * Upstream's right-click (a desktop notification of the current
 * status) waits for a notifications plugin.
 *
 * Owns the `omarchy:weather-toggle` action event (the analog of
 * `omarchy-shell shell toggle omarchy.weather`) and the `weather.*`
 * settings namespace (`weather.location` — the weather.json analog —
 * plus the `weather.unit` / `weather.refreshMinutes` overrides read
 * against `WEATHER_CONFIG`). Registers as `omarchy.weather` in
 * {@link BAR_WIDGETS}.
 * @extends {Component}
 */
class WeatherBarWidget extends Component {
    static template = `
        <div class="weather">
            <button type="button" class="weather-bar-widget bar-status-button" hidden data-ref="button"
                    aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="weather-panel" hidden data-ref="panel"
                 role="dialog" aria-label="Weather">
                <div class="weather-hero">
                    <div class="weather-hero-left">
                        <span class="weather-hero-icon" data-ref="heroIcon"></span>
                        <span class="weather-hero-temp" data-ref="heroTemp"></span>
                        <span class="weather-hero-unit" data-ref="heroUnit"></span>
                    </div>
                    <div class="weather-hero-right">
                        <button type="button" class="weather-location" data-ref="locationRow"
                                title="Set location">
                            <span class="weather-location-marker" data-ref="locationMarker"></span>
                            <span class="weather-location-name" data-ref="locationName"></span>
                        </button>
                        <div class="weather-location-edit" hidden data-ref="locationEdit">
                            <input class="weather-input" data-ref="locationField"
                                   placeholder="Search city" autocomplete="off">
                            <button type="button" class="weather-location-clear" data-ref="clearButton"
                                    title="Auto-detect location"></button>
                        </div>
                        <div class="weather-stats" data-ref="stats">
                            <div class="weather-stat">
                                <span class="weather-stat-label">FEELS</span>
                                <span class="weather-stat-value" data-ref="feels"></span>
                            </div>
                            <div class="weather-stat">
                                <span class="weather-stat-label">WIND</span>
                                <span class="weather-stat-value" data-ref="wind"></span>
                            </div>
                            <div class="weather-stat">
                                <span class="weather-stat-label">HUMID</span>
                                <span class="weather-stat-value" data-ref="humidity"></span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="weather-suggestions" hidden data-ref="suggestions"></div>
                <div class="weather-fetching" data-ref="fetching"></div>
                <div class="weather-separator" hidden data-ref="divider"></div>
                <div class="weather-forecast" hidden data-ref="forecast"></div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const button = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="button"]'))
        const panel = $(root, '[data-ref="panel"]')
        const heroIcon = $(root, '[data-ref="heroIcon"]')
        const heroTemp = $(root, '[data-ref="heroTemp"]')
        const heroUnit = $(root, '[data-ref="heroUnit"]')
        const locationRow = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="locationRow"]'))
        const locationName = $(root, '[data-ref="locationName"]')
        const locationEdit = $(root, '[data-ref="locationEdit"]')
        const locationField = /** @type {HTMLInputElement} */ ($(root, '[data-ref="locationField"]'))
        const clearButton = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="clearButton"]'))
        const stats = $(root, '[data-ref="stats"]')
        const feels = $(root, '[data-ref="feels"]')
        const wind = $(root, '[data-ref="wind"]')
        const humidity = $(root, '[data-ref="humidity"]')
        const suggestionsHost = $(root, '[data-ref="suggestions"]')
        const fetching = $(root, '[data-ref="fetching"]')
        const divider = $(root, '[data-ref="divider"]')
        const forecast = $(root, '[data-ref="forecast"]')

        // Nerd Font map marker (upstream's nf-fa-map_marker), set here
        // rather than in the template so the file survives any non-UTF-8
        // round trip. The hero ellipsis matches upstream's placeholder.
        $(root, '[data-ref="locationMarker"]').textContent = '\uf041'
        fetching.textContent = 'Fetching forecast…'

        // ---- State, mirroring Panel.qml's properties. Reports are kept
        //      on failure so stale data stays visible, like upstream.
        /** @type {any} */ let report = null
        /** @type {any} */ let dailyForecastReport = null
        let configured = WeatherModel.normalizeLocation(Settings.get('weather.location', null))
        let label = ''
        let forecastRetries = 0
        let dailyForecastRetries = 0
        let forecastBusy = false
        let dailyBusy = false
        let forecastRetryTimer = 0
        let dailyRetryTimer = 0
        let editingLocation = false
        let savingLocation = false
        /** @type {{name: string, description: string, latitude: number, longitude: number}[]} */
        let suggestions = []
        let suggestionIndex = 0
        let geocodeTimer = 0
        let geocodeSeq = 0
        // Bumped when the location changes so in-flight responses for
        // the old query are dropped — the analog of upstream killing its
        // curl Processes on onLocationQueryChanged.
        let fetchSeq = 0

        const opened = () => !panel.hidden

        // ---- Derived read-outs (Panel.qml's readonly properties) ------

        function hasConfiguredCoordinates() {
            return configured.latitude !== null && configured.longitude !== null
        }

        function locationQuery() {
            return WeatherModel.wttrLocationQuery(configured.name, configured.latitude, configured.longitude)
        }

        // wttr's current conditions when available; Open-Meteo's fill in
        // while wttr is in flight — and win outright for configured
        // coordinates, where they answer for the exact spot.
        function currentCondition() {
            const openMeteo = WeatherModel.openMeteoCurrentCondition(dailyForecastReport)
            if (hasConfiguredCoordinates() && openMeteo) return openMeteo
            const wttr = report && report.current_condition && report.current_condition[0]
            return wttr || openMeteo
        }

        function areaInfo() {
            return (report && report.nearest_area && report.nearest_area[0]) || null
        }

        function reportCountry() {
            const area = areaInfo()
            return area && area.country && area.country[0] ? area.country[0].value : ''
        }

        function useImperial() {
            return WeatherModel.shouldUseImperial(
                Settings.get('weather.unit', WEATHER_CONFIG.unit), navigator.language, reportCountry())
        }

        // Upstream also asks wttr.in `?format=%l` for a faster detected
        // name, but wttr content-negotiates on User-Agent and serves
        // browsers its HTML page for that endpoint (UA is a forbidden
        // fetch header, so there is no way to ask for the plain form) —
        // the j1 report's nearest_area is the browser's only source.
        function reportLocation() {
            const area = areaInfo()
            return configured.name
                || (area && area.areaName && area.areaName[0] ? area.areaName[0].value : '')
        }

        function forecastDays() {
            return WeatherModel.buildForecastDays(
                report, dailyForecastReport, WeatherModel.todayString(new Date()))
        }

        // ---- Fetching. fetch stands in for upstream's curl Processes;
        //      the timeout mirrors curl's --max-time.

        /** @param {string} url @param {number} timeoutMs */
        function fetchText(url, timeoutMs) {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeoutMs)
            return fetch(url, { signal: controller.signal })
                .then(response => {
                    if (!response.ok) throw new Error(String(response.status))
                    return response.text()
                })
                .finally(() => clearTimeout(timer))
        }

        function refresh() {
            // Each full refresh cycle gets a fresh retry budget, so an
            // earlier exhausted round (e.g. a network blip) doesn't
            // starve retries for the rest of the session.
            forecastRetries = 0
            dailyForecastRetries = 0
            fetchForecast()
            // With stored coordinates this fetches Open-Meteo right away
            // — no need to wait for the slow wttr response. Without them
            // it's a no-op until wttr reports the detected area.
            refreshDailyForecast(null)
        }

        function fetchForecast() {
            if (forecastBusy) return
            forecastBusy = true
            const seq = fetchSeq
            fetchText('https://wttr.in/' + locationQuery() + '?format=j1', 10000)
                .then(raw => {
                    if (seq !== fetchSeq) return
                    const parsed = JSON.parse(raw)
                    report = parsed
                    // wttr's icon only fills an empty initial state —
                    // never replaces a day/night-aware Open-Meteo one.
                    if (!hasConfiguredCoordinates()) {
                        label = WeatherModel.provisionalCurrentIcon(
                            parsed.current_condition && parsed.current_condition[0], label)
                    }
                    forecastRetries = 0
                    if (WeatherModel.weatherResponseCompletesSave(hasConfiguredCoordinates(), 'wttr'))
                        finishSavingLocation()
                    // Stored coordinates already drove the fast Open-Meteo
                    // fetch from refresh(); only auto-detect needs the
                    // area wttr reported.
                    if (configured.latitude === null) refreshDailyForecast(parsed)
                    render()
                })
                .catch(() => {
                    // Keep last-good report visible, but try again shortly.
                    if (seq === fetchSeq) scheduleForecastRetry()
                })
                .finally(() => { forecastBusy = false })
        }

        /** @param {any} sourceReport */
        function refreshDailyForecast(sourceReport) {
            if (dailyBusy) return
            let lat = configured.latitude
            let lon = configured.longitude
            if (lat === null || lon === null) {
                const area = (sourceReport && sourceReport.nearest_area && sourceReport.nearest_area[0]) || areaInfo()
                if (!area) return
                lat = parseFloat(String(area.latitude || ''))
                lon = parseFloat(String(area.longitude || ''))
            }
            if (isNaN(lat) || isNaN(lon)) return

            const url = 'https://api.open-meteo.com/v1/forecast'
                + '?latitude=' + encodeURIComponent(String(lat))
                + '&longitude=' + encodeURIComponent(String(lon))
                + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
                + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day'
                + '&forecast_days=4'
                + '&timezone=auto'
            dailyBusy = true
            const seq = fetchSeq
            fetchText(url, 5000)
                .then(raw => {
                    if (seq !== fetchSeq) return
                    const parsed = JSON.parse(raw)
                    dailyForecastReport = parsed
                    label = WeatherModel.currentIcon(
                        WeatherModel.openMeteoCurrentCondition(parsed), label)
                    dailyForecastRetries = 0
                    if (WeatherModel.weatherResponseCompletesSave(hasConfiguredCoordinates(), 'open-meteo'))
                        finishSavingLocation()
                    render()
                })
                .catch(() => {
                    if (seq === fetchSeq) scheduleDailyForecastRetry()
                })
                .finally(() => { dailyBusy = false })
        }

        // wttr.in can be slow or flaky, especially for a location it
        // hasn't cached yet. Retry a few times before leaving it to the
        // refresh timer.
        function scheduleForecastRetry() {
            if (forecastRetries >= 3) return
            forecastRetries++
            clearTimeout(forecastRetryTimer)
            forecastRetryTimer = setTimeout(() => fetchForecast(), 2500)
        }

        // With configured coordinates this fetch is the only thing that
        // updates the bar icon, so a dropped response must retry rather
        // than wait out the refresh timer with a stale icon.
        function scheduleDailyForecastRetry() {
            if (dailyForecastRetries >= 3) return
            dailyForecastRetries++
            clearTimeout(dailyRetryTimer)
            dailyRetryTimer = setTimeout(() => refreshDailyForecast(null), 2500)
        }

        // ---- Location editing. Clicking the location label swaps it
        //      for a search field; picking a geocoded suggestion
        //      persists name + coordinates. An empty commit returns to
        //      auto-detect.

        function startEditingLocation() {
            editingLocation = true
            savingLocation = false
            suggestions = []
            suggestionIndex = 0
            render()
            locationField.value = configured.name
            locationField.select()
            locationField.focus()
        }

        function cancelEditingLocation() {
            editingLocation = false
            savingLocation = false
            suggestions = []
            clearTimeout(geocodeTimer)
            render()
        }

        function commitLocation() {
            const location = WeatherModel.locationCommit(
                locationField.value, suggestions, suggestionIndex)
            if (location.name === '') {
                clearLocation()
                return
            }
            applyLocation(location)
        }

        /**
         * Persist and refetch. The editor stays up with a spinner until
         * the new location's confirming response lands
         * (finishSavingLocation), so stale data is never presented under
         * the newly configured location label.
         * @param {{name: string, latitude: number | null, longitude: number | null}} location
         */
        function applyLocation(location) {
            savingLocation = true
            configured = WeatherModel.normalizeLocation(location)
            Settings.set('weather.location', configured)
            restartFetches()
            render()
        }

        function clearLocation() {
            configured = WeatherModel.normalizeLocation(null)
            Settings.set('weather.location', null)
            cancelEditingLocation()
            restartFetches()
        }

        function finishSavingLocation() {
            if (savingLocation) cancelEditingLocation()
        }

        // The analog of upstream cancelling its running Processes when
        // the location query changes: in-flight responses are orphaned
        // by the sequence bump, then everything refetches.
        function restartFetches() {
            fetchSeq++
            forecastBusy = false
            dailyBusy = false
            clearTimeout(forecastRetryTimer)
            clearTimeout(dailyRetryTimer)
            refresh()
        }

        // Debounced geocoding; a response for anything but the latest
        // query (or after the editor closed) is dropped.
        function requestGeocode() {
            const query = locationField.value.trim()
            const seq = ++geocodeSeq
            if (query.length < 2) {
                suggestions = []
                render()
                return
            }
            fetchText('https://geocoding-api.open-meteo.com/v1/search?name='
                + encodeURIComponent(query) + '&count=5&language=en&format=json', 5000)
                .then(raw => {
                    if (seq !== geocodeSeq || !editingLocation) return
                    suggestions = WeatherModel.parseGeocodingResults(raw)
                    suggestionIndex = 0
                    render()
                })
                .catch(() => {})
        }

        // ---- Panel ----------------------------------------------------

        function open() {
            panel.hidden = false
            button.setAttribute('aria-expanded', 'true')
            // Opening re-reads the world, like upstream's show path
            // (location file reload + refresh).
            configured = WeatherModel.normalizeLocation(Settings.get('weather.location', null))
            refresh()
            render()
        }

        function close() {
            // Dismissing mid-edit would otherwise leave the search field
            // up, waiting behind a closed popup for the next open.
            if (editingLocation) cancelEditingLocation()
            panel.hidden = true
            button.setAttribute('aria-expanded', 'false')
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        // ---- Rendering ------------------------------------------------

        function render() {
            button.textContent = label
            // The pill only appears once a report has landed, exactly as
            // upstream gates the widget on a non-empty label.
            button.hidden = label === ''

            const current = currentCondition()
            const imperial = useImperial()

            heroIcon.textContent = label || '—'
            heroTemp.textContent = current
                ? String(imperial ? current.temp_F : current.temp_C) : '—'
            heroUnit.textContent = current ? '°' + (imperial ? 'F' : 'C') : ''

            const location = reportLocation()
            locationRow.hidden = editingLocation || location === ''
            locationName.textContent = location.toUpperCase()
            locationEdit.hidden = !editingLocation
            locationField.disabled = savingLocation
            // ✕ clears back to auto-detect; while a committed location
            // loads, the same compact affordance becomes a spinner.
            clearButton.textContent = savingLocation ? '\u{F0996}' : '✕'
            clearButton.classList.toggle('weather-saving', savingLocation)
            clearButton.disabled = savingLocation

            stats.hidden = !current
            feels.textContent = current
                ? WeatherModel.formatTemp(imperial ? current.FeelsLikeF : current.FeelsLikeC, imperial) : ''
            wind.textContent = current
                ? (imperial ? current.windspeedMiles + ' mph' : current.windspeedKmph + ' km/h') : ''
            humidity.textContent = current ? current.humidity + '%' : ''

            fetching.hidden = !!current

            renderSuggestions()
            renderForecast(imperial)
        }

        function renderSuggestions() {
            suggestionsHost.hidden =
                !(editingLocation && !savingLocation && suggestions.length > 0)
            suggestionsHost.textContent = ''
            if (suggestionsHost.hidden) return

            suggestions.forEach((suggestion, index) => {
                const row = document.createElement('button')
                row.type = 'button'
                row.className = 'weather-suggestion'
                if (index === suggestionIndex) row.classList.add('weather-suggestion-selected')

                const name = document.createElement('span')
                name.className = 'weather-suggestion-name'
                name.textContent = suggestion.name
                row.appendChild(name)
                if (suggestion.description) {
                    const region = document.createElement('span')
                    region.className = 'weather-suggestion-region'
                    region.textContent = suggestion.description
                    row.appendChild(region)
                }

                row.addEventListener('mouseenter', () => {
                    // Guarded: render() rebuilds the rows, and an
                    // unconditional re-render from the row now under the
                    // pointer would loop.
                    if (suggestionIndex === index) return
                    suggestionIndex = index
                    render()
                })
                // mousedown would move focus off the search field before
                // the click lands.
                row.addEventListener('mousedown', event => event.preventDefault())
                row.addEventListener('click', () => applyLocation(suggestion))
                suggestionsHost.appendChild(row)
            })
        }

        /** @param {boolean} imperial */
        function renderForecast(imperial) {
            const days = forecastDays()
            divider.hidden = days.length === 0
            forecast.hidden = days.length === 0
            forecast.textContent = ''

            for (const day of days) {
                const cell = document.createElement('div')
                cell.className = 'weather-day'

                const icon = document.createElement('span')
                icon.className = 'weather-day-icon'
                icon.textContent = WeatherModel.dayIcon(day)
                cell.appendChild(icon)

                const info = document.createElement('div')
                info.className = 'weather-day-info'
                const name = document.createElement('span')
                name.className = 'weather-day-name'
                name.textContent = WeatherModel.dayName(day.date).toUpperCase()
                info.appendChild(name)

                const temps = document.createElement('div')
                temps.className = 'weather-day-temps'
                const max = document.createElement('span')
                max.className = 'weather-day-max'
                max.textContent = WeatherModel.bareTempForDay(day, 'max', imperial)
                const min = document.createElement('span')
                min.className = 'weather-day-min'
                min.textContent = WeatherModel.bareTempForDay(day, 'min', imperial)
                temps.appendChild(max)
                temps.appendChild(min)
                info.appendChild(temps)
                cell.appendChild(info)

                forecast.appendChild(cell)
            }
        }

        // ---- Wiring ---------------------------------------------------

        button.addEventListener('click', () => {
            button.blur()
            toggle()
        })
        // Middle-click refreshes, as upstream. Upstream's right-click
        // notification has no notifications plugin to land on yet.
        button.addEventListener('auxclick', event => {
            if (event.button === 1) refresh()
        })

        locationRow.addEventListener('click', () => startEditingLocation())
        clearButton.addEventListener('click', () => clearLocation())

        locationField.addEventListener('input', () => {
            if (!editingLocation || savingLocation) return
            clearTimeout(geocodeTimer)
            geocodeTimer = setTimeout(() => requestGeocode(), 300)
        })
        locationField.addEventListener('keydown', event => {
            event.stopPropagation()
            if (event.key === 'Escape') cancelEditingLocation()
            else if (event.key === 'ArrowDown') {
                if (suggestionIndex < suggestions.length - 1) {
                    suggestionIndex++
                    render()
                }
            } else if (event.key === 'ArrowUp') {
                if (suggestionIndex > 0) {
                    suggestionIndex--
                    render()
                }
            } else if (event.key === 'Enter') commitLocation()
            else return
            event.preventDefault()
        })

        dismissOnOutsideClick(opened, close,
            target => panel.contains(target) || button.contains(target))

        document.addEventListener('keydown', event => {
            if (!opened() || editingLocation) return
            // A fullscreen surface above the panel owns the keyboard.
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }

            if (event.key === 'Escape') close()
            // Upstream's PanelKeyCatcher: Return opens the location editor.
            else if (event.key === 'Enter') startEditingLocation()
            else return
            event.preventDefault()
            event.stopPropagation()
        })

        document.addEventListener('omarchy:weather-toggle', () => toggle())

        // Auto-refresh, upstream's triggeredOnStart repeat timer.
        const refreshMinutes = Math.max(1, parseInt(String(
            Settings.get('weather.refreshMinutes', WEATHER_CONFIG.refreshMinutes)), 10)
            || WEATHER_CONFIG.refreshMinutes)
        setInterval(() => refresh(), refreshMinutes * 60 * 1000)

        render()
        refresh()
    }
}

BAR_WIDGETS['omarchy.weather'] = WeatherBarWidget
