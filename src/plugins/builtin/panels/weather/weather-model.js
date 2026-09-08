/**
 * Pure weather math and parsing for the weather widget and its panel —
 * a direct port of upstream `shell/plugins/panels/weather/Model.js`,
 * kept DOM-free for the same reason upstream keeps it Qt-free: wttr.in
 * and Open-Meteo response shaping, unit selection, and the weather-code
 * → Nerd Font glyph tables. Glyphs are written as escape sequences so
 * the file survives any non-UTF-8 round trip.
 *
 * Everything lives on the single `WeatherModel` namespace to keep the
 * shared global scope down to one name.
 */
const WeatherModel = {
    /**
     * The configured location as stored in the `weather.location`
     * setting — the analog of upstream's weather.json state file (owned
     * there by omarchy-weather-location). Missing, blank, or malformed
     * means the location is auto-detected from the IP address.
     * @param {*} value
     * @returns {{name: string, latitude: number | null, longitude: number | null}}
     */
    normalizeLocation(value) {
        const unset = { name: '', latitude: null, longitude: null }
        if (!value || typeof value !== 'object') return unset

        const latitude = parseFloat(String(value.latitude))
        const longitude = parseFloat(String(value.longitude))
        const hasCoordinates = !isNaN(latitude) && !isNaN(longitude)
        return {
            name: typeof value.name === 'string' ? value.name.trim() : '',
            latitude: hasCoordinates ? latitude : null,
            longitude: hasCoordinates ? longitude : null,
        }
    },

    /**
     * wttr.in path segment for a configured location: exact coordinates
     * when both are present, the URL-encoded name as a fallback (a
     * hand-edited setting may only carry a name), empty for IP
     * auto-detect.
     * @param {*} location @param {*} latitude @param {*} longitude
     */
    wttrLocationQuery(location, latitude, longitude) {
        const lat = parseFloat(String(latitude))
        const lon = parseFloat(String(longitude))
        if (!isNaN(lat) && !isNaN(lon)) return lat + ',' + lon

        const name = String(location || '').trim()
        return name === '' ? '' : encodeURIComponent(name)
    },

    /**
     * Open-Meteo geocoding response → suggestion rows for the location
     * picker.
     * @param {*} raw - Raw response text.
     * @returns {{name: string, description: string, latitude: number, longitude: number}[]}
     */
    parseGeocodingResults(raw) {
        try {
            const data = JSON.parse(String(raw || '{}'))
            const results = data.results
            if (!results || !results.length) return []

            const out = []
            for (const r of results) {
                if (!r || !r.name || r.latitude === undefined || r.longitude === undefined) continue
                const region = [r.admin1, r.country].filter(part => !!part).join(', ')
                out.push({
                    name: String(r.name),
                    description: region,
                    latitude: r.latitude,
                    longitude: r.longitude,
                })
            }
            return out
        } catch {
            return []
        }
    },

    /**
     * What committing the location editor means: the highlighted
     * suggestion when there is one, the typed name alone otherwise, and
     * a full clear for an empty field.
     * @param {*} text @param {*} suggestions @param {*} selectedIndex
     * @returns {{name: string, latitude: number | null, longitude: number | null}}
     */
    locationCommit(text, suggestions, selectedIndex) {
        const name = String(text || '').trim()
        if (name === '') return { name: '', latitude: null, longitude: null }

        const choices = suggestions || []
        const index = Math.max(0, Math.min(parseInt(String(selectedIndex), 10) || 0, choices.length - 1))
        const suggestion = choices[index]
        if (suggestion) return suggestion

        return { name, latitude: null, longitude: null }
    },

    /**
     * Local "yyyy-MM-dd" for today — the string forecast dates are
     * compared against (upstream formats it with Qt.formatDate).
     * @param {Date} date
     */
    todayString(date) {
        const pad = (/** @type {number} */ n) => (n < 10 ? '0' : '') + n
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    },

    /** @param {*} dateString @param {*} todayString */
    isFutureForecastDate(dateString, todayString) {
        if (!dateString) return false
        return String(dateString).slice(0, 10) > String(todayString || '')
    },

    /** @param {*} value */
    roundedTemp(value) {
        if (value === undefined || value === null || value === '') return ''
        const n = parseFloat(String(value))
        return isNaN(n) ? '' : String(Math.round(n))
    },

    /** @param {*} value */
    celsiusToFahrenheit(value) {
        if (value === undefined || value === null || value === '') return ''
        const n = parseFloat(String(value))
        return isNaN(n) ? '' : (n * 9 / 5) + 32
    },

    /** @param {*} value @param {*} useImperial */
    formatTemp(value, useImperial) {
        if (value === undefined || value === null || value === '') return ''
        return value + '°' + (useImperial ? 'F' : 'C')
    },

    /** @param {*} value */
    normalizedUnit(value) {
        return String(value || '').trim().toLowerCase()
    },

    /** @param {*} localeName */
    localeUsesImperial(localeName) {
        const name = String(localeName || '').replace('.', '_')
        return /^en[_-]US($|[_.-])/.test(name) || /^en[_-]LR($|[_.-])/.test(name) || /^my($|[_.-])/.test(name)
    },

    /**
     * @param {*} countryName
     * @returns {boolean | null} null when no country is known.
     */
    countryUsesImperial(countryName) {
        const country = String(countryName || '')
            .trim()
            .replace(/[._-]+/g, ' ')
            .toLowerCase()
        if (!country) return null
        if (country === 'us' || country === 'usa' || country === 'united states' || country === 'united states of america') return true
        if (country === 'liberia' || country === 'myanmar' || country === 'burma') return true
        return false
    },

    /**
     * Unit resolution, in upstream's order: an explicit override wins,
     * then the country the weather report is for, then the locale.
     * @param {*} unitOverride @param {*} localeName @param {*} countryName
     */
    shouldUseImperial(unitOverride, localeName, countryName) {
        const unit = this.normalizedUnit(unitOverride)
        if (unit === 'imperial') return true
        if (unit === 'metric') return false

        const countryPreference = this.countryUsesImperial(countryName)
        if (countryPreference !== null) return countryPreference

        return this.localeUsesImperial(localeName)
    },

    /** @param {*} dateString */
    dayName(dateString) {
        if (!dateString) return ''
        const d = new Date(dateString + 'T12:00:00')
        if (isNaN(d.getTime())) return ''
        return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]
    },

    /**
     * Open-Meteo daily forecast → up to three future days, normalized to
     * wttr's per-day field names so the panel can use either source.
     * @param {*} dailyForecastReport @param {*} todayString
     * @returns {any[]}
     */
    openMeteoForecastDays(dailyForecastReport, todayString) {
        const daily = dailyForecastReport && dailyForecastReport.daily ? dailyForecastReport.daily : null
        if (!daily || !daily.time) return []

        const result = []
        for (let i = 0; i < daily.time.length && result.length < 3; ++i) {
            const date = daily.time[i]
            if (!this.isFutureForecastDate(date, todayString)) continue

            const maxC = daily.temperature_2m_max ? daily.temperature_2m_max[i] : ''
            const minC = daily.temperature_2m_min ? daily.temperature_2m_min[i] : ''
            result.push({
                date,
                maxtempC: this.roundedTemp(maxC),
                mintempC: this.roundedTemp(minC),
                maxtempF: this.roundedTemp(this.celsiusToFahrenheit(maxC)),
                mintempF: this.roundedTemp(this.celsiusToFahrenheit(minC)),
                openMeteoWeatherCode: daily.weather_code ? daily.weather_code[i] : null,
            })
        }
        return result
    },

    /**
     * Open-Meteo bundles current conditions with the daily forecast
     * request and answers far faster than wttr.in. Normalize them to
     * wttr's current_condition shape so the panel can use either source
     * interchangeably. Open-Meteo reports metric (°C, km/h).
     * @param {*} dailyForecastReport
     */
    openMeteoCurrentCondition(dailyForecastReport) {
        const current = dailyForecastReport && dailyForecastReport.current ? dailyForecastReport.current : null
        if (!current || current.temperature_2m === undefined || current.temperature_2m === null) return null
        return {
            temp_C: this.roundedTemp(current.temperature_2m),
            temp_F: this.roundedTemp(this.celsiusToFahrenheit(current.temperature_2m)),
            FeelsLikeC: this.roundedTemp(current.apparent_temperature),
            FeelsLikeF: this.roundedTemp(this.celsiusToFahrenheit(current.apparent_temperature)),
            windspeedKmph: this.roundedTemp(current.wind_speed_10m),
            windspeedMiles: this.roundedTemp(current.wind_speed_10m * 0.621371),
            humidity: this.roundedTemp(current.relative_humidity_2m),
            openMeteoWeatherCode: current.weather_code,
            isDay: current.is_day,
        }
    },

    /** @param {*} current @param {*} fallback */
    currentIcon(current, fallback) {
        if (!current) return fallback || ''
        if (current.openMeteoWeatherCode !== undefined && current.openMeteoWeatherCode !== null)
            return this.iconForOpenMeteoCode(current.openMeteoWeatherCode, Number(current.isDay) === 0)
        if (current.weatherCode !== undefined && current.weatherCode !== null)
            return this.iconForCode(current.weatherCode, false)
        return fallback || ''
    },

    /**
     * wttr.in has no day/night flag. Use its icon only to fill an empty
     * initial state, never to replace a day/night-aware icon resolved by
     * Open-Meteo.
     * @param {*} current @param {*} resolvedIcon
     */
    provisionalCurrentIcon(current, resolvedIcon) {
        return resolvedIcon || this.currentIcon(current, '')
    },

    /**
     * Which response confirms a just-committed location: with stored
     * coordinates Open-Meteo answers for them directly; without,
     * only wttr resolves the name.
     * @param {*} hasConfiguredCoordinates @param {*} source
     */
    weatherResponseCompletesSave(hasConfiguredCoordinates, source) {
        return hasConfiguredCoordinates ? source === 'open-meteo' : source === 'wttr'
    },

    /** @param {*} report @param {*} todayString @returns {any[]} */
    wttrNextForecastDays(report, todayString) {
        const days = report && report.weather ? report.weather : []
        const result = []
        for (let i = 0; i < days.length && result.length < 3; ++i) {
            if (this.isFutureForecastDate(days[i].date, todayString)) result.push(days[i])
        }
        return result
    },

    /** @param {*} report @param {*} dailyForecastReport @param {*} todayString */
    buildForecastDays(report, dailyForecastReport, todayString) {
        const days = this.openMeteoForecastDays(dailyForecastReport, todayString)
        return days.length > 0 ? days : this.wttrNextForecastDays(report, todayString)
    },

    /**
     * Bare degree value (no unit letter), used in the forecast row.
     * @param {*} day @param {*} kind @param {*} useImperial
     */
    bareTempForDay(day, kind, useImperial) {
        if (!day) return ''
        const v = useImperial
            ? (kind === 'max' ? day.maxtempF : day.mintempF)
            : (kind === 'max' ? day.maxtempC : day.mintempC)
        if (v === undefined || v === null || v === '') return ''
        return v + '°'
    },

    /**
     * Representative icon for a forecast day: Open-Meteo's daily code
     * when present, else the wttr hourly entry nearest noon.
     * @param {*} day
     */
    dayIcon(day) {
        if (!day) return ''
        if (day.openMeteoWeatherCode !== undefined && day.openMeteoWeatherCode !== null)
            return this.iconForOpenMeteoCode(day.openMeteoWeatherCode)
        if (!day.hourly || day.hourly.length === 0) return ''

        let best = day.hourly[0]
        let bestDist = 9999
        for (const hour of day.hourly) {
            const t = parseInt(String(hour.time || '0'), 10)
            const dist = Math.abs(t - 1200)
            if (dist < bestDist) {
                bestDist = dist
                best = hour
            }
        }
        return this.iconForCode(best.weatherCode, false)
    },

    /**
     * WMO weather code (Open-Meteo) → the equivalent wttr.in code's
     * glyph.
     * @param {*} code @param {boolean} [night]
     */
    iconForOpenMeteoCode(code, night) {
        const c = parseInt(String(code || '0'), 10)
        if (c === 0) return this.iconForCode(113, night)
        if (c === 1 || c === 2) return this.iconForCode(116, night)
        if (c === 3) return this.iconForCode(119, night)
        if (c === 45 || c === 48) return this.iconForCode(143, night)
        if (c === 51 || c === 53 || c === 55 || c === 56 || c === 57 || c === 61) return this.iconForCode(266, night)
        if (c === 63 || c === 65 || c === 66 || c === 67 || c === 80 || c === 81 || c === 82) return this.iconForCode(308, night)
        if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) return this.iconForCode(338, night)
        if (c === 95 || c === 96 || c === 99) return this.iconForCode(389, night)
        return this.iconForCode(119, night)
    },

    /**
     * wttr.in weather code → Nerd Font weather glyph, day and night
     * variants — upstream mirrors omarchy-weather-icon's table.
     * @param {*} code @param {boolean} [night]
     */
    iconForCode(code, night) {
        const c = parseInt(String(code || '0'), 10)
        switch (c) {
            case 113: return night ? '\ue32b' : '\ue30d'
            case 116: return night ? '\ue32e' : '\ue302'
            case 119: case 122: return '\ue33d'
            case 143: case 248: case 260: return night ? '\ue346' : '\ue313'
            case 176: case 263: case 353: return night ? '\ue333' : '\ue308'
            case 179: case 227: case 230: case 323: case 326: case 368: return night ? '\ue327' : '\ue30a'
            case 182: case 185: case 281: case 284: case 311: case 314:
            case 317: case 320: case 350: case 362: case 365: case 374: case 377: return '\ue3ad'
            case 200: case 386: case 389: case 392: case 395: return '\ue31d'
            case 266: case 293: case 296: case 299: case 302: case 305: case 308: case 356: case 359: return '\ue318'
            case 329: case 332: case 335: case 338: case 371: return '\ue31a'
            default: return '\ue33d'
        }
    },
}
Object.freeze(WeatherModel)
