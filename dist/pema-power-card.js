/*
 * Pema Power Card — a simple, family-friendly Home Assistant power card.
 * Solar / battery / grid (Eskom) / home / hot water flow, an overnight battery chart until tomorrow's sun,
 * load-shedding prep and prepaid electricity units.
 *
 * Plain JavaScript web component, no build step. MIT licence.
 * https://github.com/hpema/pema-power-card
 */
(() => {
  const VERSION = "0.4.0";
  const OUTER_R = 39;                           // source-mix ring just outside the node ring (R = 33)
  const RING_LEN = 2 * Math.PI * OUTER_R;
  const GAP = 4;                                // gap between segments, in px along the ring
  const SRC = { solar: "--ppc-pv", grid: "--ppc-grid", battery: "--ppc-battery" };
  // Battery power below this is noise (idle). Above it the battery is charging/discharging, however slowly.
  const IDLE_W = 20;
  // Flow dots only from this size, so a slow trickle doesn't look like the battery is running the house.
  const DOTS_W = 150;
  const NS = "http://www.w3.org/2000/svg";

  // ---------------------------------------------------------------- icons (24x24) ----
  const ICON = {
    pv: '<path d="M3 15l2-8h14l2 8H3z M7 7l-1 8 M12 7v8 M17 7l1 8 M4 11h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 19h6M12 15v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    grid: '<path d="M12 3l-5 18M12 3l5 18M8.5 10h7M7.4 14h9.2M5 6h14M6 21h12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    bat: '<rect x="3" y="7" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M21 10v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M11.5 8.5l-2.5 4h3l-2 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    home: '<path d="M4 11l8-7 8 7v9H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    water: '<rect x="6" y="3" width="12" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8c-1.6 2.2-2.4 3.4-2.4 4.6a2.4 2.4 0 0 0 4.8 0c0-1.2-.8-2.4-2.4-4.6z" fill="currentColor"/>',
    inv: '<rect x="5" y="3" width="14" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12.8 6.5l-3 5h3.2l-2.6 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>',
    sun: '<circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z" fill="currentColor"/>',
    rain: '<path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 8a3.5 3.5 0 0 0 1 7z" fill="currentColor"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  };
  const WEATHER_ICON = { sunny: "sun", "clear-night": "moon", partlycloudy: "cloud", cloudy: "cloud", fog: "cloud",
                         rainy: "rain", pouring: "rain", lightning: "rain", "lightning-rainy": "rain", hail: "rain",
                         snowy: "cloud", windy: "cloud", "windy-variant": "cloud", exceptional: "cloud" };

  // ------------------------------------------------------------ flow geometry (360 x 356) ----
  // Bottom nodes sit at y=282; their two label lines end near y=345, so the viewBox must reach ~356
  // or the labels spill onto the battery panel below (v0.1.2 bug).
  const R = 33;
  const INV = { x: 180, y: 166 };
  const NODES = {
    pv:    { x: 62,  y: 50,  color: "--ppc-pv",      icon: "pv",    name: "Solar" },
    grid:  { x: 298, y: 50,  color: "--ppc-grid",    icon: "grid",  name: "Eskom" },
    bat:   { x: 62,  y: 282, color: "--ppc-battery", icon: "bat",   name: "Battery" },
    home:  { x: 298, y: 166, color: "--ppc-home",    icon: "home",  name: "Home" },
    water: { x: 298, y: 282, color: "--ppc-water",   icon: "water", name: "Hot water" },
  };
  const WIRES = {   // drawn node -> inverter; a flow 'into the inverter' follows the path, 'out of' runs it backwards
    pv:    "M95,50 C150,50 172,90 176,134",
    grid:  "M265,50 C210,50 188,90 184,134",
    bat:   "M95,282 C150,282 172,242 176,198",
    home:  "M265,166 L210,166",
    water: "M265,282 C210,282 188,242 184,198",
  };

  const STYLE = `
    :host {
      --ppc-pv: #e0a800; --ppc-grid: #1fa5c9; --ppc-off: #d93a3a; --ppc-battery: #1e9e62; --ppc-home: #8b4fd1;
      --ppc-water: #e2632a; --ppc-inverter: #c98a00;
      --ppc-fg: var(--primary-text-color, #212121); --ppc-muted: var(--secondary-text-color, #727272);
      --ppc-bg: var(--ha-card-background, var(--card-background-color, #fff));
      /* inner panels: a faint tint of the card itself. HA's --secondary-background-color is a strong grey in the
         light theme and made the panels look disabled (v0.1.3). */
      --ppc-soft: color-mix(in srgb, var(--ppc-fg) 4%, var(--ppc-bg));
      --ppc-line: var(--divider-color, #e3e6e5);
      --ppc-track: color-mix(in srgb, var(--ppc-muted) 30%, transparent);
      display: block;
    }
    [hidden] { display: none !important; }
    ha-card { padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 12px; font-variant-numeric: tabular-nums; color: var(--ppc-fg); }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .weather { display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: .95rem; }
    .weather svg { width: 20px; height: 20px; color: var(--ppc-pv); }
    .chip { display: inline-flex; align-items: center; gap: 6px; font-size: .8rem; font-weight: 500; border-radius: 999px; padding: 3px 10px; background: var(--ppc-soft); color: var(--ppc-muted); }
    .chip i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .chip.ok { color: var(--ppc-battery); }
    .chip.bad { color: var(--ppc-off); background: color-mix(in srgb, var(--ppc-off) 12%, var(--ppc-bg)); }

    svg.flow { width: 100%; height: auto; display: block; overflow: visible; }
    .wire { fill: none; stroke: var(--ppc-track); stroke-width: 2.5; stroke-linecap: round; }
    .wire.live { stroke-width: 3; }
    .ring { fill: var(--ppc-bg); stroke-width: 3; }
    .val { font: 700 15px var(--paper-font-body1_-_font-family, Roboto, sans-serif); fill: var(--ppc-fg); text-anchor: middle; }
    .unit { font: 500 10px Roboto, sans-serif; fill: var(--ppc-muted); text-anchor: middle; }
    .name { font: 500 10.5px Roboto, sans-serif; fill: var(--ppc-muted); text-anchor: middle; }
    .sub { font: 500 9.5px Roboto, sans-serif; text-anchor: middle; }
    .node { cursor: pointer; }
    .stale .val, .stale .unit { opacity: .4; }               /* live data stopped: values are old */
    .link { cursor: pointer; }
    .link text { font: 500 10px Roboto, sans-serif; text-anchor: middle; }
    .link .lk { fill: var(--ppc-muted); }
    .link .age { font-size: 10.5px; font-weight: 600; }
    .node:focus-visible { outline: none; }
    .node:focus-visible .ring { stroke-width: 5; }

    .panel { display: flex; flex-direction: column; gap: 6px; background: var(--ppc-soft); border-radius: 10px; padding: 10px 12px; }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .row b { font-size: .98rem; }
    .row small { color: var(--ppc-muted); font-size: .8rem; }
    .pills { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
    .pills i { height: 12px; border-radius: 4px; background: var(--ppc-track); }
    .pills i.on { background: var(--ppc-battery); }
    .pills.low i.on { background: var(--ppc-water); }
    .pills.crit i.on { background: var(--ppc-off); }

    .line { display: flex; gap: 6px; align-items: center; font-size: .84rem; }
    .line svg { width: 16px; height: 16px; flex: none; }
    .line b { color: var(--ppc-battery); font-weight: 600; }

    .night { display: flex; flex-direction: column; gap: 4px; }
    .nhead { font-size: .92rem; font-weight: 700; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    .nhead.ok { color: var(--ppc-battery); }
    .nhead.short { color: var(--ppc-off); }
    .nhead small { font-weight: 500; color: var(--ppc-muted); font-size: .78rem; }
    svg.chart { width: 100%; height: auto; display: block; overflow: visible; }
    .gridl { stroke: var(--ppc-line); stroke-width: 1; }
    .lvl { stroke-width: 1.5; stroke-dasharray: 5 4; }
    .axis { font: 500 9.5px Roboto, sans-serif; fill: var(--ppc-muted); }
    .lbl { font: 700 10px Roboto, sans-serif; }
    .batline { fill: none; stroke: var(--ppc-battery); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
    .sunline { fill: none; stroke: var(--ppc-pv); stroke-width: 3; stroke-linecap: round; }
    .sunmark { stroke: var(--ppc-pv); stroke-width: 1.5; stroke-dasharray: 2 3; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .74rem; color: var(--ppc-muted); }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend i { display: inline-block; width: 16px; height: 0; border-top: 2px dashed; }
    .legend i.lg-low { border-color: var(--ppc-water); } .legend i.lg-cut { border-color: var(--ppc-off); }
    .legend i.lg-sun { border-top: 3px solid var(--ppc-pv); }

    .prep { display: flex; flex-direction: column; gap: 8px; border-radius: 10px; padding: 10px 12px;
            background: color-mix(in srgb, var(--ppc-off) 8%, var(--ppc-soft)); border: 1px solid color-mix(in srgb, var(--ppc-off) 30%, var(--ppc-line)); }
    .prep .row { align-items: center; }
    .ptitle { display: flex; flex-direction: column; gap: 1px; }
    .kicker { font-size: .7rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--ppc-off); }
    .prep p { margin: 0; font-size: .8rem; color: var(--ppc-muted); }
    .switch { position: relative; width: 44px; height: 26px; flex: none; border-radius: 999px; border: 0; padding: 0; cursor: pointer; background: var(--ppc-track); }
    .switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--ppc-bg); transition: left .15s; }
    .switch[aria-checked="true"] { background: var(--ppc-battery); }
    .switch[aria-checked="true"]::after { left: 21px; }
    .step { display: flex; align-items: center; gap: 6px; }
    .step span { font-size: .84rem; color: var(--ppc-muted); }
    .step button { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--ppc-line); background: var(--ppc-bg); color: var(--ppc-fg); font: 700 1rem Roboto, sans-serif; cursor: pointer; }
    .step button:disabled { opacity: .4; cursor: default; }
    .step b { min-width: 3.2em; text-align: center; font-size: 1rem; }

    .units { font-size: 1.35rem; font-weight: 700; }
    .units small { font-size: .8rem; font-weight: 500; color: var(--ppc-muted); margin-left: 3px; }
    .ppbar { position: relative; height: 10px; border-radius: 6px; background: var(--ppc-track); overflow: hidden; }
    .ppbar i { position: absolute; inset: 0 auto 0 0; background: var(--ppc-grid); border-radius: 6px; }
    .ppbar.low i { background: var(--ppc-water); }
    .ppbar u { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--ppc-water); }
    .eta { font-size: .86rem; }
    .eta .low { color: var(--ppc-water); font-weight: 700; }
    .eta small { color: var(--ppc-muted); }
    form.add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0; }
    form.add label { font-size: .8rem; color: var(--ppc-muted); }
    form.add input { width: 7.5em; font: 500 .95rem Roboto, sans-serif; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--ppc-line); background: var(--ppc-bg); color: var(--ppc-fg); }
    .btn { font: 500 .88rem Roboto, sans-serif; border-radius: 8px; border: 1px solid transparent; padding: 7px 12px; cursor: pointer; background: var(--ppc-grid); color: #fff; }
    .btn.ghost { background: transparent; color: var(--ppc-fg); border-color: var(--ppc-line); }
    .msg { font-size: .82rem; }
    .msg.ok { color: var(--ppc-battery); } .msg.err { color: var(--ppc-off); }
    .switch:focus-visible, .step button:focus-visible, .btn:focus-visible, form.add input:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
    .warn { font-size: .85rem; color: var(--ppc-off); }
    .touhead { font-size: .9rem; font-weight: 600; }
    .touhead small { display: block; font-weight: 500; color: var(--ppc-muted); font-size: .78rem; margin-top: 2px; }
    .touchart .slot { fill: color-mix(in srgb, var(--ppc-battery) 22%, transparent); }
    .touchart .slot.now { fill: color-mix(in srgb, var(--ppc-battery) 38%, transparent); }
    .touchart .step { fill: none; stroke: var(--ppc-battery); stroke-width: 2.5; stroke-linejoin: round; }
    .touchart .pct { font: 700 10px Roboto, sans-serif; fill: var(--ppc-fg); text-anchor: middle;
                     paint-order: stroke; stroke: var(--ppc-soft); stroke-width: 3px; stroke-linejoin: round; }  /* legible over the line */
    .touchart .chg { fill: var(--ppc-grid); }
    .touchart .nowline { stroke: var(--ppc-fg); stroke-width: 1.2; stroke-dasharray: 3 3; }
    .legend i.lg-floor { border-top: 6px solid color-mix(in srgb, var(--ppc-battery) 40%, transparent); }
    .legend i.lg-chg { border-top: 4px solid var(--ppc-grid); }
    .legend i.lg-soc { border-top: 2px solid var(--ppc-fg); }
    .touchart .socline { fill: none; stroke: var(--ppc-fg); stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; opacity: .9; }
    @media (prefers-reduced-motion: reduce) { .dot { display: none; } .switch::after { transition: none; } }
  `;

  // ------------------------------------------------------------------------ helpers ----
  const kw = w => (Math.abs(w) / 1000).toFixed(Math.abs(w) >= 10000 ? 1 : 2);
  const cssv = v => `var(${v})`;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  class PemaPowerCard extends HTMLElement {
    static getStubConfig() {
      return { grid_present: "binary_sensor.grid", power: { solar: "", grid: "", battery: "", home: "" }, battery: { soc: "" } };
    }
    getCardSize() { return 9; }
    getGridOptions() { return { columns: 12, min_columns: 6 }; }

    setConfig(config) {
      if (!config || !config.power || !config.battery || !config.battery.soc)
        throw new Error("pema-power-card: 'power' (solar, grid, battery, home) and 'battery.soc' are required");
      this._config = {
        battery_discharge_positive: true, ...config,
        battery: { capacity_kwh: 10, low: 15, cutoff: 5, ...config.battery },
      };
      this._built = false;
      this._lastSig = "";
      if (this._hass) this._render();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first) this._startFeeds();
      const sig = this._signature();
      if (sig === this._lastSig) return;          // nothing we show changed
      this._lastSig = sig;
      this._render();
    }

    connectedCallback() {
      this._tick = setInterval(() => { this._lastSig = ""; if (this._hass) this._render(); }, 30_000);  // clock/age text
      if (this._hass) this._startFeeds();
    }
    disconnectedCallback() {
      clearInterval(this._tick); clearInterval(this._fcTimer); clearInterval(this._socTimer);
      if (this._wxUnsub) { this._wxUnsub.then(u => u && u()).catch(() => {}); this._wxUnsub = null; }
      this._feedsStarted = false;
    }

    // ------------------------------------------------------------- data access ----
    _st(id) { return id && this._hass ? this._hass.states[id] : undefined; }
    _num(id) {
      if (typeof id === "number") return id;
      const s = this._st(id);
      if (!s) return null;
      const v = parseFloat(s.state);
      return Number.isFinite(v) ? v : null;
    }
    _on(id) { const s = this._st(id); return s ? (s.state === "on" ? true : s.state === "off" ? false : null) : null; }
    _signature() {
      const c = this._config, ids = [c.grid_present, c.inverter_status, c.fault, c.weather, ...Object.values(c.link || {}),
        ...Object.values(c.power || {}),
        ...Object.values(c.battery || {}), ...Object.values(c.hot_water || {}), ...Object.values(c.load_shedding || {}),
        ...Object.values(c.prepaid || {}), ...this._touIds()].filter(x => typeof x === "string" && x.includes("."));
      return ids.map(id => { const s = this._st(id); return s ? s.state + "|" + s.last_changed : "-"; }).join(";");
    }

    _touIds() {
      const T = this._config?.tou; if (!T) return [];
      const progs = T.programs || [1, 2, 3, 4, 5, 6].map(i => ({ time: `select.${T.prefix}_prog${i}_time`,
        capacity: `number.${T.prefix}_prog${i}_capacity`, charge: `select.${T.prefix}_prog${i}_charge` }));
      return [T.use_timer, T.clock, ...progs.flatMap(p => [p.time, p.capacity, p.charge])];
    }

    _startFeeds() {
      if (this._feedsStarted || !this._hass || !this.isConnected) return;
      this._feedsStarted = true;
      const c = this._config;
      if (c.solar_forecast !== false) {
        // fetching and drawing are separate: a drawing problem must not throw the forecast away
        const load = () => this._hass.callWS({ type: "energy/solar_forecast" })
          .then(r => { this._forecast = r; }, () => { this._forecast = null; })
          .then(() => { this._lastSig = ""; try { this._render(); } catch (e) { console.warn("pema-power-card:", e); } });
        load(); this._fcTimer = setInterval(load, 30 * 60_000);
      }
      // battery % since local midnight, for the battery-plan chart (refreshed every 5 minutes)
      if (c.tou && c.battery?.soc) {
        const loadSoc = () => {
          const tzParts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: this._tz() }).formatToParts(new Date());
          const hrs = +tzParts.find(p => p.type === "hour").value % 24 + +tzParts.find(p => p.type === "minute").value / 60;
          const start = new Date(Date.now() - hrs * 3600e3 - 60e3);
          return this._hass.callWS({ type: "history/history_during_period", start_time: start.toISOString(), entity_ids: [c.battery.soc],
                                     minimal_response: true, no_attributes: true, significant_changes_only: false })
            .then(r => { this._socHist = (r[c.battery.soc] || []).map(p => ({ t: (p.lu ?? p.lc) * 1000, v: parseFloat(p.s) }))
                                                                      .filter(p => Number.isFinite(p.v) && Number.isFinite(p.t)); },
                  () => { this._socHist = null; })
            .then(() => { this._lastSig = ""; try { this._render(); } catch (e) { console.warn("pema-power-card:", e); } });
        };
        loadSoc(); this._socTimer = setInterval(loadSoc, 5 * 60_000);
      }
      if (c.weather && this._hass.connection) {
        this._wxUnsub = this._hass.connection.subscribeMessage(
          m => { this._wx = (m.forecast || [])[0]; this._lastSig = ""; try { this._render(); } catch (e) { console.warn("pema-power-card:", e); } },
          { type: "weather/subscribe_forecast", forecast_type: "daily", entity_id: c.weather }).catch(() => null);
      }
    }

    _tz() { return this._hass?.config?.time_zone; }
    _clock(hoursAhead) {
      const d = new Date(Date.now() + hoursAhead * 3600e3);
      const opts = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: this._tz() };
      const t = d.toLocaleTimeString("en-GB", opts);
      return hoursAhead >= 20 ? d.toLocaleDateString("en-GB", { weekday: "short", timeZone: this._tz() }) + " " + t : t;
    }
    _dur(h) {
      if (h >= 48) return `${Math.round(h / 24)} days`;
      const m = Math.round(h * 60);
      return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
    }

    // ----------------------------------------------------------------- build ----
    _build() {
      const root = this.shadowRoot || this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${STYLE}</style>
        <ha-card>
          <div class="top">
            <div class="weather" id="wx" hidden><svg viewBox="0 0 24 24" aria-hidden="true" id="wxi"></svg><span id="wxt"></span></div>
            <div class="chip" id="chip"><i></i><span></span></div>
          </div>
          <svg class="flow" viewBox="0 0 360 362" role="img" aria-label="Power flow" id="flow"></svg>
          <div class="panel">
            <div class="row"><b id="soc"></b><small id="bstate"></small></div>
            <div class="pills" id="pills">${"<i></i>".repeat(10)}</div>
            <div class="line" id="oneline" hidden><svg viewBox="0 0 24 24" aria-hidden="true"></svg><span></span></div>
            <div class="night" id="night" hidden>
              <div class="nhead" id="nhead"></div>
              <svg class="chart" viewBox="0 0 320 132" role="img" aria-label="Battery until tomorrow's sun" id="chart"></svg>
              <div class="legend"><span><i class="lg-low"></i><span id="lglow">15% low</span></span><span><i class="lg-cut"></i><span id="lgcut">5% cutoff</span></span><span><i class="lg-sun"></i>sun takes over</span></div>
            </div>
          </div>
          <div class="prep" id="prep" hidden>
            <div class="row"><div class="ptitle"><small class="kicker" id="pkick"></small><b>Prep: hold battery charge</b></div>
              <button class="switch" role="switch" aria-checked="false" id="psw" aria-label="Load-shedding prep"></button></div>
            <div class="row"><div class="step"><span>Keep battery at least</span>
              <button type="button" id="pdn" aria-label="Lower">−</button><b id="ptgt"></b><button type="button" id="pup" aria-label="Raise">+</button></div></div>
            <p id="ptxt"></p>
          </div>
          <div class="panel" id="pp" hidden>
            <div class="row"><span class="units" id="units"></span><small>Prepaid electricity</small></div>
            <div class="ppbar" id="ppbar"><i></i><u></u></div>
            <div class="eta" id="eta"></div>
            <form class="add" id="addf" novalidate>
              <label for="buy">Units bought</label>
              <input id="buy" type="number" inputmode="decimal" min="0.1" step="0.1" placeholder="e.g. 465.1">
              <button class="btn" type="submit" id="addb">Add</button>
              <button class="btn ghost" type="button" id="cancel" hidden>Cancel</button>
            </form>
            <div class="msg" id="msg" role="status"></div>
          </div>
          <div class="panel" id="tou" hidden>
            <div class="touhead" id="touhead"></div>
            <svg class="chart touchart" viewBox="0 0 320 128" role="img" aria-label="Battery plan for the day" id="touchart"></svg>
            <div class="legend"><span><i class="lg-soc"></i>battery today</span><span><i class="lg-floor"></i>battery kept at least</span><span><i class="lg-chg"></i>Eskom may charge the battery</span></div>
          </div>
        </ha-card>`;
      const $ = id => root.getElementById(id);
      this._$ = $;

      // flow svg
      const svg = $("flow");
      const el = (tag, a, parent) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); (parent || svg).appendChild(e); return e; };
      this._el = el;
      this._wires = {}; this._dots = {}; this._dotKey = {};
      for (const k in WIRES) { this._wires[k] = el("path", { d: WIRES[k], class: "wire", id: `w-${k}` }); this._dots[k] = el("g", {}); }
      const ig = el("g", { class: "node", tabindex: "0", role: "button", "aria-label": "Inverter" });
      el("rect", { x: INV.x - 30, y: INV.y - 30, width: 60, height: 60, rx: 16, class: "ring", stroke: cssv("--ppc-inverter") }, ig);
      const iic = el("svg", { x: INV.x - 13, y: INV.y - 18, width: 26, height: 26, viewBox: "0 0 24 24", style: `color:${cssv("--ppc-inverter")}` }, ig);
      iic.innerHTML = ICON.inv;
      this._invText = el("text", { x: INV.x, y: INV.y + 21, class: "sub", fill: cssv("--ppc-battery") }, ig);
      this._bindMoreInfo(ig, () => (this._hasFault && this._config.fault) || this._config.inverter_status);

      // connection chain under the inverter, in the free space between the bottom circles:
      //   ● Pi B → ● Inverter     /     data 1 min ago
      const lg = el("g", { class: "link", tabindex: "0", role: "button", "aria-label": "Inverter connection" });
      const chainY = 304;
      this._lkDots = {
        bridge:   el("circle", { cx: 128, cy: chainY - 3.5, r: 4 }, lg),
        inverter: el("circle", { cx: 186, cy: chainY - 3.5, r: 4 }, lg),
      };
      this._lkLabels = {
        bridge:   el("text", { x: 152, y: chainY, class: "lk" }, lg),
        inverter: el("text", { x: 214, y: chainY, class: "lk" }, lg),
      };
      el("text", { x: 171, y: chainY, class: "lk" }, lg).textContent = "→";
      this._lkAge = el("text", { x: 180, y: chainY + 18, class: "age" }, lg);
      this._bindMoreInfo(lg, () => this._config.link?.last_data || this._config.link?.live);
      this._linkG = lg;
      this._nodes = {};
      const moreInfoFor = { pv: () => this._config.power.solar, grid: () => this._config.grid_present || this._config.power.grid,
                            bat: () => this._config.battery.soc, home: () => this._config.power.home,
                            water: () => this._config.hot_water && (this._config.hot_water.temperature || this._config.hot_water.switch) };
      for (const k in NODES) {
        const n = NODES[k];
        const g = el("g", { class: "node", tabindex: "0", role: "button", "aria-label": n.name });
        const ring = el("circle", { cx: n.x, cy: n.y, r: R, class: "ring", stroke: cssv(n.color) }, g);
        // outer source-mix ring (home + battery): one arc per source, the node's own ring keeps its colour
        const arcs = {};
        if (k === "home" || k === "bat") for (const s of Object.keys(SRC)) {
          arcs[s] = el("circle", { cx: n.x, cy: n.y, r: OUTER_R, fill: "none", "stroke-width": 4, "stroke-linecap": "round",
                                   stroke: cssv(SRC[s]), transform: `rotate(-90 ${n.x} ${n.y})`,
                                   "stroke-dasharray": `0 ${RING_LEN}` }, g);
        }
        const ic = el("svg", { x: n.x - 10, y: n.y - 25, width: 20, height: 20, viewBox: "0 0 24 24", style: `color:${cssv(n.color)}` }, g);
        ic.innerHTML = ICON[n.icon];
        const val = el("text", { x: n.x, y: n.y + 9, class: "val" }, g);
        const unit = el("text", { x: n.x, y: n.y + 21, class: "unit" }, g);
        // labels: below the outer source ring where a node (or its row partner) has one; tight to the ring otherwise.
        // Top row (solar, Eskom) never has a source ring; Hot water stays level with Battery in the bottom row.
        const lr = k === "pv" || k === "grid" ? R : OUTER_R;
        const name = el("text", { x: n.x, y: n.y + lr + 15, class: "name" }, g); name.textContent = n.name;
        const sub = el("text", { x: n.x, y: n.y + lr + 27, class: "sub" }, g);
        this._bindMoreInfo(g, moreInfoFor[k]);
        this._nodes[k] = { g, ring, ic, val, unit, sub, arcs };
      }

      // controls
      $("psw").addEventListener("click", () => {
        const id = this._config.load_shedding?.prep; if (!id) return;
        this._hass.callService("input_boolean", "toggle", { entity_id: id });
      });
      const stepTarget = dir => {
        const id = this._config.load_shedding?.prep_target, s = this._st(id); if (!s) return;
        const a = s.attributes, step = a.step || 5, v = clamp(parseFloat(s.state) + dir * step, a.min ?? 0, a.max ?? 100);
        this._hass.callService(id.split(".")[0], "set_value", { entity_id: id, value: v });
      };
      $("pdn").addEventListener("click", () => stepTarget(-1));
      $("pup").addEventListener("click", () => stepTarget(1));

      // prepaid top-up: set the units, then press the button that runs the existing top-up automation
      let pending = null;
      const reset = () => { pending = null; $("addb").textContent = "Add"; $("cancel").hidden = true; $("buy").disabled = false; };
      $("addf").addEventListener("submit", async e => {
        e.preventDefault();
        const pc = this._config.prepaid || {}, msg = $("msg");
        if (pending === null) {
          const s = this._st(pc.topup_units), max = s?.attributes?.max ?? 5000, v = parseFloat($("buy").value);
          if (!(v > 0 && v <= max)) { msg.className = "msg err"; msg.textContent = `Enter the units from your token slip (up to ${max}).`; return; }
          pending = v; $("buy").disabled = true; $("cancel").hidden = false;
          $("addb").textContent = `Confirm: add ${v} units`; msg.className = "msg"; msg.textContent = "";
          return;
        }
        try {
          await this._hass.callService(pc.topup_units.split(".")[0], "set_value", { entity_id: pc.topup_units, value: pending });
          await this._hass.callService(pc.topup_button.split(".")[0], "press", { entity_id: pc.topup_button });
          msg.className = "msg ok"; msg.textContent = `Added ${pending} units.`;
          $("buy").value = "";
        } catch (err) {
          msg.className = "msg err"; msg.textContent = `Could not add the units: ${err.message || err}`;
        }
        reset();
      });
      $("cancel").addEventListener("click", () => { reset(); $("msg").textContent = ""; });

      this._built = true;
    }

    _bindMoreInfo(g, idFn) {
      const open = () => {
        const entityId = idFn && idFn(); if (!entityId) return;
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
      };
      g.addEventListener("click", open);
      g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    }

    _flow(k, watts, reverse, colorVar) {
      const live = Math.abs(watts) >= 20, w = this._wires[k];
      const kwv = Math.abs(watts) / 1000;
      const count = !live ? 0 : kwv > 3 ? 3 : kwv > 0.8 ? 2 : 1;
      const dur = Math.max(0.9, 3.2 - Math.log2(1 + kwv)).toFixed(1);
      const key = live ? `${reverse}|${count}|${dur}|${colorVar}` : "off";
      w.setAttribute("class", "wire" + (live ? " live" : ""));
      w.style.stroke = live ? `color-mix(in srgb, ${cssv(colorVar)} 55%, var(--ppc-track))` : "";
      if (this._dotKey[k] === key) return;            // keep running animations smooth
      this._dotKey[k] = key;
      const g = this._dots[k]; g.innerHTML = "";
      for (let i = 0; i < count; i++) {
        const c = this._el("circle", { r: 3.6, class: "dot", fill: cssv(colorVar) }, g);
        const a = this._el("animateMotion", { dur: dur + "s", repeatCount: "indefinite", begin: (-(dur / count) * i).toFixed(2) + "s",
                                              calcMode: "linear", keyPoints: reverse ? "1;0" : "0;1", keyTimes: "0;1" }, c);
        this._el("mpath", { href: `#w-${k}` }, a);
      }
    }

    // ----------------------------------------------------------------- render ----
    _render() {
      if (!this._config || !this._hass) return;
      if (!this._built) this._build();
      const $ = this._$, c = this._config, P = c.power, B = c.battery;

      // --- values
      const solar = this._num(P.solar) ?? 0;
      const gridW = this._num(P.grid) ?? 0;                                   // + buying, - selling
      const batRaw = this._num(P.battery) ?? 0;
      const charge = c.battery_discharge_positive ? -batRaw : batRaw;          // + charging, - discharging
      const home = this._num(P.home) ?? 0;
      const soc = this._num(B.soc);
      const capWh = (this._num(B.capacity_kwh) ?? 10) * 1000;
      const low = this._num(B.low) ?? 15, cutoff = this._num(B.cutoff) ?? 5;
      const gridOn = c.grid_present ? this._on(c.grid_present) : true;       // true / false / null (unknown)
      const HW = c.hot_water || {};
      const temp = this._num(HW.temperature);
      const waterOn = HW.switch ? this._on(HW.switch) === true : false;
      const waterW = HW.power ? (this._num(HW.power) ?? 0) : 0;

      // --- header
      const wx = this._st(c.weather);
      $("wx").hidden = !wx;
      if (wx) {
        $("wxi").innerHTML = ICON[WEATHER_ICON[wx.state] || "cloud"];
        const hi = this._wx?.temperature, lo = this._wx?.templow, unit = wx.attributes.temperature_unit || "°C";
        $("wxt").textContent = hi != null && lo != null ? `${Math.round(lo)}° / ${Math.round(hi)}${unit}`
                                                        : `${Math.round(wx.attributes.temperature)}${unit}`;
      }
      const chip = $("chip"), gp = this._st(c.grid_present);
      if (gridOn === true) { chip.className = "chip ok"; chip.querySelector("span").textContent = "Eskom on"; }
      else if (gridOn === false) {
        const offH = (Date.now() - new Date(gp.last_changed)) / 3600e3;
        chip.className = "chip bad";
        chip.querySelector("span").textContent = `Eskom off · ${this._dur(offH)} (since ${new Date(gp.last_changed).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: this._tz() })})`;
      } else { chip.className = "chip"; chip.querySelector("span").textContent = "Eskom: checking…"; }

      // --- nodes
      const N = this._nodes;
      const set = (k, v, u, sub, subColor) => { N[k].val.textContent = v; N[k].unit.textContent = u; N[k].sub.textContent = sub || ""; N[k].sub.setAttribute("fill", subColor || cssv("--ppc-muted")); };
      set("pv", kw(solar), "kW", solar > 20 ? "producing" : "no sun");
      if (gridOn === false) {
        N.grid.ring.setAttribute("stroke", cssv("--ppc-off")); N.grid.ic.style.color = cssv("--ppc-off");
        set("grid", "OFF", "", "no power", cssv("--ppc-off"));
      } else {
        N.grid.ring.setAttribute("stroke", cssv("--ppc-grid")); N.grid.ic.style.color = cssv("--ppc-grid");
        set("grid", kw(gridW), "kW", gridOn === null ? "checking…" : gridW > 20 ? "buying" : gridW < -20 ? "selling" : "connected", cssv("--ppc-grid"));
      }
      // A full battery trickles a few watts to stay topped up — call that 'full', not 'charging'.
      const isFull = soc != null && soc >= 99 && Math.abs(charge) < DOTS_W;
      set("bat", soc == null ? "–" : Math.round(soc) + "%", kw(charge) + " kW",
          isFull ? "full" : charge > IDLE_W ? "charging" : charge < -IDLE_W ? "discharging" : "idle",
          isFull ? cssv("--ppc-battery") : charge > IDLE_W ? cssv("--ppc-battery") : charge < -IDLE_W ? cssv("--ppc-water") : null);
      set("home", kw(home), "kW", "in use");
      N.water.g.style.display = HW.temperature || HW.switch ? "" : "none";
      this._wires.water.style.display = N.water.g.style.display;
      set("water", temp == null ? "–" : Math.round(temp) + "°C", waterOn && waterW > 20 ? kw(waterW) + " kW" : "",
          HW.switch ? (waterOn ? "heating" : "off") : "", waterOn ? cssv("--ppc-water") : null);
      // --- inverter status + connection chain (Home Assistant → bridge Pi → inverter) and data age
      const LK = c.link || {};
      const live = LK.live ? this._on(LK.live) : null;                       // true / false / null
      this._liveOk = live;
      { const ld = LK.last_data ? Date.parse(this._st(LK.last_data)?.state) : NaN; this._lastDataMs = Number.isFinite(ld) ? ld : null; }
      const fault = (this._st(c.fault)?.state || "").trim();
      const hasFault = fault && !["unknown", "unavailable", "none", "ok", "0"].includes(fault.toLowerCase());
      this._hasFault = !!hasFault;
      const st = this._st(c.inverter_status)?.state;
      let invText, invColor;
      if (live === false) { invText = "No data"; invColor = "--ppc-off"; }
      else if (hasFault) { invText = "Fault"; invColor = "--ppc-off"; }
      else if (!st || st === "unknown" || st === "unavailable") { invText = c.inverter_status ? "checking…" : ""; invColor = "--ppc-muted"; }
      else if (st === "ok") { invText = "Normal"; invColor = "--ppc-battery"; }
      else { invText = st; invColor = "--ppc-off"; }
      this._invText.textContent = invText;
      this._invText.setAttribute("fill", cssv(invColor));
      this.shadowRoot.getElementById("flow").classList.toggle("stale", live === false);

      const dot = (key, id, label) => {
        const v = id ? this._on(id) : undefined;
        const show = id !== undefined && id !== null && id !== "";
        this._lkDots[key].style.display = show ? "" : "none";
        this._lkLabels[key].style.display = show ? "" : "none";
        if (!show) return;
        this._lkDots[key].setAttribute("fill", cssv(v === true ? "--ppc-battery" : v === false ? "--ppc-off" : "--ppc-muted"));
        this._lkLabels[key].textContent = label;
      };
      dot("bridge", LK.bridge, LK.bridge_name || "Pi B");
      dot("inverter", LK.inverter, "Inverter");
      const last = LK.last_data ? this._st(LK.last_data)?.state : null;
      const lastMs = last ? Date.parse(last) : NaN;
      if (Number.isFinite(lastMs)) {
        const mins = Math.max(0, (Date.now() - lastMs) / 60e3);
        const txt = mins < 1 ? "data just now" : mins < 120 ? `data ${Math.round(mins)} min ago` : `no data for ${this._dur(mins / 60)}`;
        this._lkAge.textContent = mins >= 10 && !txt.startsWith("no data") ? `no data for ${Math.round(mins)} min` : txt;
        this._lkAge.setAttribute("fill", cssv(mins >= 10 ? "--ppc-off" : mins >= 2 ? "--ppc-water" : "--ppc-muted"));
      } else this._lkAge.textContent = "";
      this._linkG.style.display = LK.bridge || LK.inverter || LK.last_data ? "" : "none";

      // --- where is the power coming from? (home ring and, while charging, battery ring)
      // Sources right now: solar, Eskom (buying) and battery (discharging). Home gets each in proportion.
      // Battery charging: solar left over after the house counts first, Eskom covers the rest.
      const fresh = this._liveOk !== false;
      const srcW = { solar: Math.max(solar, 0), grid: gridOn === false ? 0 : Math.max(gridW, 0), battery: Math.max(-charge, 0) };
      if (charge >= -IDLE_W) srcW.battery = 0;                                // not discharging (or noise): no battery share
      const total = srcW.solar + srcW.grid + srcW.battery;
      const homeMix = fresh && total > 20 && home > 20 ? srcW : null;
      let batMix = null;
      // only real charging gets a 'where from' ring; a trickle (top-up at 100 %, measurement noise) would
      // split a few watts into a misleading 'solar + Eskom'
      if (fresh && charge > DOTS_W && !(soc != null && soc >= 99)) {
        const fromSolar = Math.min(charge, Math.max(0, solar - home - (waterOn ? waterW : 0)));
        batMix = { solar: fromSolar, grid: Math.max(0, charge - fromSolar), battery: 0 };
      }
      const paint = (k, mix, fallbackSub) => {
        const arcs = N[k].arcs, sum = mix ? mix.solar + mix.grid + mix.battery : 0;
        const parts = Object.keys(SRC).filter(s => sum > 0 && mix[s] / sum >= 0.03).length;   // ignore slivers < 3 %
        let start = 0;
        for (const s of Object.keys(SRC)) {
          let frac = sum > 0 ? mix[s] / sum : 0;
          if (frac < 0.03) frac = 0;
          // a lone source fills the ring; several get a small gap each (round caps add ~4 px, so subtract it)
          const len = frac === 0 ? 0 : parts === 1 ? RING_LEN : Math.max(0.5, frac * RING_LEN - GAP - 4);
          arcs[s].setAttribute("stroke-dasharray", `${len.toFixed(1)} ${RING_LEN.toFixed(1)}`);
          arcs[s].setAttribute("stroke-dashoffset", (-(start * RING_LEN + (parts > 1 ? (GAP + 4) / 2 : 0))).toFixed(1));
          arcs[s].style.display = frac === 0 ? "none" : "";
          start += frac;
        }
        if (!mix || sum <= 0) return fallbackSub;
        const names = { solar: "solar", grid: "Eskom", battery: "battery" };
        const used = Object.keys(SRC).filter(s => mix[s] / sum >= 0.1).sort((a, b) => mix[b] - mix[a]);
        return used.length === 1 ? `from ${names[used[0]]}` : used.map(s => names[s]).join(" + ");
      };
      const homeSub = paint("home", homeMix, "in use");
      N.home.sub.textContent = homeSub;
      N.home.sub.setAttribute("fill", homeMix ? cssv(SRC[Object.keys(SRC).sort((a, b) => homeMix[b] - homeMix[a])[0]]) : cssv("--ppc-muted"));
      const batSub = paint("bat", batMix, null);
      if (batSub) { N.bat.sub.textContent = `charging · ${batSub.replace(/^from /, "")}`; }

      // no live data: every wire goes still — moving dots would suggest the old numbers are current
      const moving = this._liveOk !== false;
      this._flow("pv", moving ? solar : 0, false, "--ppc-pv");
      this._flow("grid", moving && gridOn !== false ? gridW : 0, gridW < 0, "--ppc-grid");
      this._flow("bat", moving && Math.abs(charge) >= DOTS_W ? charge : 0, charge > 0, "--ppc-battery");   // trickle = still wire
      this._flow("home", moving ? home : 0, true, "--ppc-home");
      this._flow("water", moving && waterOn ? waterW : 0, true, "--ppc-water");

      // --- battery panel
      const pills = $("pills");
      pills.className = "pills" + (soc != null && soc < 20 ? " crit" : soc != null && soc < 40 ? " low" : "");
      [...pills.children].forEach((p, i) => p.classList.toggle("on", soc != null && i < Math.round(soc / 10)));
      // percentage plus the energy it represents, e.g. "Battery 78% · 7.8 of 10 kWh"
      const capKwh = capWh / 1000, fmtK = v => (Math.round(v * 10) / 10).toString();
      $("soc").innerHTML = soc == null ? "Battery"
        : `Battery ${Math.round(soc)}% <small style="font-weight:500;color:var(--ppc-muted);font-size:.82rem">· ${fmtK(soc / 100 * capKwh)} of ${fmtK(capKwh)} kWh</small>`;
      if (charge > IDLE_W && soc != null) {
        $("bstate").textContent = soc >= 99 ? "full" : `charging · full in ${this._dur((100 - soc) / 100 * capWh / charge)}`;
      } else $("bstate").textContent = charge < -IDLE_W ? `using ${kw(-charge)} kW` : soc != null && soc >= 99 ? "full" : "idle";
      $("lglow").textContent = `${low}% low`; $("lgcut").textContent = `${cutoff}% cutoff`;

      const houseW = Math.max(home + (waterOn ? waterW : 0), 50);
      const night = $("night"), one = $("oneline");
      if (this._liveOk === false) {                       // stale data: say so instead of forecasting from old numbers
        night.hidden = true; one.hidden = false;
        const lastTxt = this._lastDataMs ? new Date(this._lastDataMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: this._tz() }) : "";
        one.querySelector("svg").innerHTML = ICON.inv; one.querySelector("svg").style.color = cssv("--ppc-off");
        one.querySelector("span").innerHTML = `<b style="color:var(--ppc-off)">No live data${lastTxt ? " since " + lastTxt : ""}</b> · numbers may be out of date`;
      }
      // Overnight chart whenever the battery is discharging (or Eskom is off).
      // The drain rate matters: with Eskom on, the battery only loses what it actually delivers (often a trickle while
      // Eskom carries the house); with Eskom off it carries the whole house, so use the house-load average.
      const onBattery = soc != null && (gridOn === false || charge < -IDLE_W);
      if (this._liveOk === false) { /* handled above */ }
      else if (!onBattery) {                             // one plain line, no chart
        night.hidden = true; one.hidden = false;
        const solarCovers = solar >= houseW;
        one.querySelector("svg").innerHTML = solarCovers ? ICON.sun : ICON.grid;
        one.querySelector("svg").style.color = solarCovers ? cssv("--ppc-pv") : cssv("--ppc-grid");
        one.querySelector("span").innerHTML = solarCovers ? "<b>Solar is powering the house now</b>"
          : gridOn === false ? "<b>Running on battery</b>"
          : `<b>Eskom is powering the house${charge > IDLE_W ? " and charging the battery" : ""}</b>`;
      } else {
        one.hidden = true; night.hidden = false;
        const avg = this._num(c.battery.night_load);
        const drainW = gridOn === false ? Math.max(avg ?? houseW, -charge, 50) : Math.max(-charge, IDLE_W);
        this._renderNight(soc, low, cutoff, capWh, drainW, Math.max(avg ?? houseW, 50));
      }

      // --- load-shedding prep: when 'in effect' is on, or the grid is actually off
      const L = c.load_shedding || {};
      const showPrep = !!L.prep && (this._on(L.in_effect) === true || gridOn === false);
      $("prep").hidden = !showPrep;
      if (showPrep) {
        const on = this._on(L.prep) === true, ts = this._st(L.prep_target);
        const tgt = ts ? Math.round(parseFloat(ts.state)) : null;
        $("pkick").textContent = gridOn === false ? "Load-shedding" : "Load-shedding announced";
        $("psw").setAttribute("aria-checked", String(on));
        $("ptgt").textContent = tgt == null ? "–" : tgt + "%";
        $("pdn").disabled = !ts || parseFloat(ts.state) <= (ts.attributes.min ?? 0);
        $("pup").disabled = !ts || parseFloat(ts.state) >= (ts.attributes.max ?? 100);
        $("ptxt").textContent = on
          ? `On: between outages Eskom keeps the battery at ${tgt}% or more, so each outage starts with at least that much.`
          : `Off: the battery follows the normal daily settings. Turn on to keep at least ${tgt}% ready for outages.`;
      }

      // --- prepaid
      const PP = c.prepaid || {};
      const units = this._num(PP.units), alert = this._num(PP.alert_level) ?? 0, perDay = this._num(PP.per_day);
      $("pp").hidden = units == null;
      if (units != null) {
        const isLow = units <= alert;
        $("units").innerHTML = `${units.toFixed(1)}<small>units left</small>`;
        const max = Math.max(units, alert * 2, 100), bar = $("ppbar");
        bar.className = "ppbar" + (isLow ? " low" : "");
        bar.querySelector("i").style.width = clamp(units / max * 100, 0, 100).toFixed(1) + "%";
        bar.querySelector("u").style.left = clamp(alert / max * 100, 0, 100).toFixed(1) + "%";
        bar.querySelector("u").hidden = !alert;
        // Two clearly named numbers, matching the Solar dashboard tiles:
        //   'Low-units alert' = days until the balance reaches the alert level; 'Runs out' = days until 0.
        let eta = "";
        const date = d => new Date(Date.now() + d * 864e5).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: this._tz() });
        if (perDay > 0) {
          const toEmpty = units / perDay, toAlert = (units - alert) / perDay;
          eta = isLow
            ? `<span class="low">Below the low-units alert (${alert}).</span> Runs out in about <b>${Math.round(toEmpty)} days</b>, around ${date(toEmpty)}.`
            : `Low-units alert (${alert}) in about <b>${Math.round(toAlert)} days</b>, around ${date(toAlert)}.<br>` +
              `Runs out in about <b>${Math.round(toEmpty)} days</b>, around ${date(toEmpty)}.`;
          eta += ` <small>Using ${perDay.toFixed(1)} units a day.</small>`;
        } else if (isLow) eta = `<span class="low">Below the low-units alert (${alert}).</span>`;
        $("eta").innerHTML = eta;
        $("addf").hidden = !(PP.topup_units && PP.topup_button);
      }

      // --- time-of-use plan (read-only picture of the inverter's daily battery levels)
      // optional panels must never break the rest of the card
      try { this._renderTou(soc, gridOn, low, charge); }
      catch (e) { $("tou").hidden = true; console.warn("pema-power-card: battery plan not shown:", e); }
    }

    // ---------------------------------------------------- time-of-use plan (read-only) ----
    _touPrograms(shiftH = 0) {
      // tou: { prefix: "ss" } -> select.ss_prog1_time, number.ss_prog1_capacity, select.ss_prog1_charge ... (Sunsynk add-on)
      // or tou: { programs: [{ time, capacity, charge }, ...] } with explicit entity ids
      const T = this._config.tou || {};
      const list = T.programs || [1, 2, 3, 4, 5, 6].map(i => ({
        time: `select.${T.prefix}_prog${i}_time`, capacity: `number.${T.prefix}_prog${i}_capacity`, charge: `select.${T.prefix}_prog${i}_charge`,
      }));
      const out = [];
      for (const p of list) {
        const t = this._st(p.time)?.state, cap = this._num(p.capacity);
        const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
        if (!m || cap == null) return null;
        const chg = (this._st(p.charge)?.state || "").toLowerCase();
        // shiftH moves the inverter's slot times onto real time (inverter clock behind -> slots start later)
        const start = (((+m[1] + (+m[2]) / 60 + shiftH) % 24) + 24) % 24;
        out.push({ start, label: t, cap, grid: chg.includes("grid") && !chg.startsWith("no") });
      }
      out.sort((a, b) => a.start - b.start);
      return out.map((p, i) => ({ ...p, end: i + 1 < out.length ? out[i + 1].start : out[0].start + 24 }));
    }

    _renderTou(soc, gridOn, low, charge) {
      const $ = this._$, T = this._config.tou;
      const box = $("tou");
      if (!T) { box.hidden = true; return; }
      const timerOn = T.use_timer ? this._on(T.use_timer) : true;
      // local wall-clock hours (Home Assistant's time zone) for a moment in time
      const wallH = d => { const p = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: this._tz() }).formatToParts(d);
                           const g = t => +p.find(x => x.type === t).value; return g("hour") % 24 + g("minute") / 60 + g("second") / 3600; };
      const realH = wallH(new Date());
      // The inverter switches slots by ITS OWN clock. If we can read it (tou.clock, e.g. text.ss_date_time),
      // work out how far it is off and move the slot times onto REAL time (when the inverter will actually switch).
      // The chart, 'now' and all wording then stay in real time, like every other clock in the house.
      const nowH = realH;
      let driftMin = 0, drift = 0;
      const ck = this._st(T.clock);
      const m = ck && /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(ck.state);
      if (m) {
        const invAtSample = +m[1] + +m[2] / 60 + (+(m[3] || 0)) / 3600;
        const sampleAt = new Date(ck.last_updated || ck.last_changed);
        if (!Number.isNaN(sampleAt.getTime())) {
          drift = invAtSample - wallH(sampleAt);                              // hours, inverter minus real
          drift = ((drift + 12) % 24 + 24) % 24 - 12;                         // wrap to -12..12
          driftMin = Math.round(drift * 60);
        }
      }
      const clockOff = Math.abs(driftMin) >= 5;
      // inverter behind by d (drift = -d) -> each slot starts d later in real time
      const progs = this._touPrograms(clockOff ? -drift : 0);
      box.hidden = !progs;
      if (!progs) return;
      const inSlot = h => p => (h >= p.start && h < p.end) || (h + 24 >= p.start && h + 24 < p.end);
      const cur = progs.find(inSlot(nowH)) || progs[progs.length - 1];
      const hh = h => h === 24 ? "24:00"
        : String(Math.floor(((h % 24) + 24) % 24)).padStart(2, "0") + ":" + String(Math.round((h % 1) * 60)).padStart(2, "0");

      // headline in plain words
      const head = $("touhead");
      if (timerOn === false) head.innerHTML = `Battery plan: timer is off <small>The inverter is not following a daily plan.</small>`;
      else if (gridOn === false) head.innerHTML = `Eskom is off: the battery runs the house <small>The daily levels below apply again when Eskom is back. In an outage the battery is used down to ${low}%.</small>`;
      else head.innerHTML = `Now (${hh(cur.start)}–${hh(cur.end)}): the battery is used down to ${cur.cap}%, then Eskom takes over` +
        // second line describes what is MEASURED right now, not what the plan implies
        `<small>${charge > DOTS_W ? `Right now the battery is charging${cur.grid ? " (Eskom may charge it in this slot)" : ""}.`
               : charge < -DOTS_W ? "Right now the battery is helping to run the house."
               : `Right now Eskom is carrying the house and the battery is being held${soc != null ? ` at ${Math.round(soc)}%` : ""}.`}</small>`;
      if (clockOff) {
        const by = Math.abs(driftMin) >= 90 ? this._dur(Math.abs(driftMin) / 60) : `${Math.abs(driftMin)} min`;
        head.innerHTML += `<small style="color:var(--ppc-water);font-weight:600">⚠ Inverter clock is ${by} ${driftMin < 0 ? "behind" : "ahead"}, ` +
          `so its slots switch ${by} ${driftMin < 0 ? "late" : "early"} (times shown are real time).</small>`;
      }

      // 24 h step chart
      const svg = $("touchart"); svg.innerHTML = "";
      const W = 320, L = 26, Rr = 8, T0 = 14, B = 100, X = h => L + (h / 24) * (W - L - Rr), Y = p => B - (p / 100) * (B - T0);
      const add = (tag, a, txt) => { const e = this._el(tag, a, svg); if (txt != null) e.textContent = txt; return e; };
      [0, 50, 100].forEach(p => { add("line", { x1: L, x2: W - Rr, y1: Y(p), y2: Y(p), class: "gridl" });
                                  add("text", { x: L - 4, y: Y(p) + 3, class: "axis", "text-anchor": "end" }, p + "%"); });
      // slots split at midnight so each piece sits on the 0-24 axis
      const pieces = [];
      for (const p of progs) {
        if (p.end <= 24) pieces.push({ ...p, a: p.start, b: p.end });
        else { pieces.push({ ...p, a: p.start, b: 24 }); pieces.push({ ...p, a: 0, b: p.end - 24 }); }
      }
      pieces.sort((x, y) => x.a - y.a);
      let d = "";
      for (const s of pieces) {
        const isNow = s === pieces.find(q => nowH >= q.a && nowH < q.b);
        add("rect", { x: X(s.a), y: Y(s.cap), width: Math.max(0, X(s.b) - X(s.a)), height: B - Y(s.cap), class: "slot" + (isNow ? " now" : "") });
        if (s.grid) add("rect", { x: X(s.a) + 1, y: B + 3, width: Math.max(0, X(s.b) - X(s.a) - 2), height: 5, rx: 2, class: "chg" });
        if (X(s.b) - X(s.a) > 22) add("text", { x: (X(s.a) + X(s.b)) / 2, y: Y(s.cap) - 4, class: "pct" }, s.cap + "%");
        d += `${d ? "L" : "M"}${X(s.a).toFixed(1)},${Y(s.cap).toFixed(1)} L${X(s.b).toFixed(1)},${Y(s.cap).toFixed(1)} `;
      }
      add("path", { d, class: "step" });
      // x axis: slot boundaries (HH:MM when shifted off the hour), plus 0 / 24 at the ends if not too close
      const bounds = progs.map(p => p.start % 24);
      const ticks = [...new Set([...bounds, ...[0, 24].filter(e => bounds.every(b => Math.abs(b - e) > 1.6))])].sort((a, b) => a - b);
      ticks.forEach(h => add("text", { x: X(h), y: B + 20, class: "axis", "text-anchor": h === 0 ? "start" : h === 24 ? "end" : "middle" },
                             h % 1 ? hh(h) : hh(h).slice(0, 2)));
      // battery % so far today (real time, midnight -> now), ending at the live value
      if (this._socHist && this._socHist.length) {
        const msPerH = 3600e3, midnight = Date.now() - nowH * msPerH;
        const pts = this._socHist.filter(p => p.t >= midnight - 60e3).map(p => [Math.max(0, (p.t - midnight) / msPerH), p.v]);
        if (soc != null) pts.push([nowH, soc]);
        if (pts.length > 1) {
          // step-after: a value holds until the next reading
          let dd = `M${X(pts[0][0]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
          for (let i = 1; i < pts.length; i++) dd += ` L${X(pts[i][0]).toFixed(1)},${Y(pts[i - 1][1]).toFixed(1)} L${X(pts[i][0]).toFixed(1)},${Y(pts[i][1]).toFixed(1)}`;
          add("path", { d: dd, class: "socline" });
        }
      }
      // now marker + battery dot
      add("line", { x1: X(nowH), x2: X(nowH), y1: T0 - 6, y2: B, class: "nowline" });
      add("text", { x: X(nowH), y: T0 - 8, class: "axis", "text-anchor": nowH > 21 ? "end" : nowH < 3 ? "start" : "middle" }, "now");
      if (soc != null && this._liveOk !== false)
        add("circle", { cx: X(nowH), cy: Y(soc), r: 4.5, fill: cssv("--ppc-battery"), stroke: cssv("--ppc-bg"), "stroke-width": 2 });
    }

    // ------------------------------------------------- overnight battery chart ----
    _sunTakeover(houseW) {
      // first forecast hour from now whose solar covers the house load
      if (!this._forecast) return null;
      const pts = [];
      for (const entry of Object.values(this._forecast)) {
        for (const [iso, wh] of Object.entries(entry.wh_hours || {})) {
          const t = new Date(iso).getTime();
          const i = pts.findIndex(p => p.t === t);
          if (i >= 0) pts[i].wh += wh; else pts.push({ t, wh });
        }
      }
      pts.sort((a, b) => a.t - b.t);
      const now = Date.now();
      const idx = pts.findIndex(p => p.t > now && p.wh >= houseW);
      if (idx < 0) return null;
      return { t: pts[idx].t, after: pts.slice(idx, idx + 2) };
    }

    _renderNight(soc, low, cutoff, capWh, drainW, houseW) {
      const $ = this._$;
      const pctPerH = drainW / capWh * 100;                       // drainW: what the battery actually has to supply
      const h15 = (soc - low) / pctPerH, hCut = (soc - cutoff) / pctPerH;
      const sun = this._sunTakeover(houseW);                       // houseW: what solar must cover to take over
      const head = $("nhead"), chart = $("chart");
      chart.innerHTML = "";
      if (!sun) {                                                 // no forecast: still show the two times
        head.className = "nhead" + (h15 < 4 ? " short" : "");
        head.innerHTML = `Battery reaches ${low}% at ${this._clock(Math.max(0, h15))} <small>cutoff at ${this._clock(Math.max(0, hCut))} · no solar forecast</small>`;
      }
      const hSun = sun ? (sun.t - Date.now()) / 3600e3 : Math.max(hCut + 1, 6);
      const socAtSun = Math.max(cutoff, soc - pctPerH * hSun);
      const socEnd = sun ? Math.min(100, socAtSun + Math.max(8, sun.after.reduce((a, p) => a + Math.max(0, p.wh - houseW), 0) / capWh * 100)) : socAtSun;
      const sunLabel = sun ? new Date(sun.t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: this._tz() }) : "";

      const W = 320, H = 132, L = 26, Rr = 12, T = 10, Bt = 108, hEnd = hSun + (sun ? 2 : 0.5);
      const X = h => L + (h / hEnd) * (W - L - Rr), Y = p => Bt - (p / 100) * (Bt - T);
      const add = (tag, a, txt) => { const e = this._el(tag, a, chart); if (txt != null) e.textContent = txt; return e; };
      [0, 50, 100].forEach(p => { add("line", { x1: L, x2: W - Rr, y1: Y(p), y2: Y(p), class: "gridl" }); add("text", { x: L - 4, y: Y(p) + 3, class: "axis", "text-anchor": "end" }, p + "%"); });
      add("line", { x1: L, x2: W - Rr, y1: Y(low), y2: Y(low), class: "lvl", stroke: cssv("--ppc-water") });
      add("line", { x1: L, x2: W - Rr, y1: Y(cutoff), y2: Y(cutoff), class: "lvl", stroke: cssv("--ppc-off") });
      const pts = [[0, soc]];
      if (hCut < hSun) pts.push([hCut, cutoff], [hSun, cutoff]); else pts.push([hSun, socAtSun]);
      const d = pts.map(([h, p], i) => `${i ? "L" : "M"}${X(h).toFixed(1)},${Y(p).toFixed(1)}`).join(" ");
      const defs = add("defs", {}), lg = this._el("linearGradient", { id: "ppcg", x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      this._el("stop", { offset: "0", "stop-color": cssv("--ppc-battery"), "stop-opacity": ".28" }, lg);
      this._el("stop", { offset: "1", "stop-color": cssv("--ppc-battery"), "stop-opacity": "0" }, lg);
      add("path", { d: `${d} L${X(hSun).toFixed(1)},${Bt} L${X(0)},${Bt} Z`, fill: "url(#ppcg)" });
      add("path", { d, class: "batline" });
      if (sun) {
        add("line", { x1: X(hSun), x2: X(hSun), y1: T, y2: Bt, class: "sunmark" });
        add("path", { d: `M${X(hSun).toFixed(1)},${Y(socAtSun).toFixed(1)} L${X(hEnd).toFixed(1)},${Y(socEnd).toFixed(1)}`, class: "sunline" });
        const si = add("svg", { x: X(hSun) - 9, y: T - 2, width: 18, height: 18, viewBox: "0 0 24 24", style: `color:${cssv("--ppc-pv")}` });
        si.innerHTML = ICON.sun;
        // battery % at sunrise: the answer to "what will we have when the sun comes up?"
        const sunColor = socAtSun <= cutoff + 0.5 ? "--ppc-off" : socAtSun < low ? "--ppc-water" : "--ppc-battery";
        add("circle", { cx: X(hSun), cy: Y(socAtSun), r: 5, fill: cssv(sunColor), stroke: cssv("--ppc-bg"), "stroke-width": 2 });
        // label sits beside the sun icon at the top — never on the level lines or the 15 % / cutoff time labels
        add("text", { x: X(hSun) - 14, y: T + 11, class: "lbl", "text-anchor": "end", fill: cssv(sunColor),
                      style: "paint-order:stroke;stroke:var(--ppc-soft);stroke-width:3px" }, `${Math.round(socAtSun)}% at sunrise`);
      }
      const mark = (h, p, colorVar, text, below) => {
        add("circle", { cx: X(h), cy: Y(p), r: 4.5, fill: cssv(colorVar), stroke: cssv("--ppc-bg"), "stroke-width": 2 });
        add("text", { x: X(h), y: Y(p) + (below ? 16 : -8), class: "lbl", "text-anchor": "middle", fill: cssv(colorVar) }, text);
      };
      if (h15 > 0 && h15 < hSun) mark(h15, low, "--ppc-water", this._clock(h15), false);
      if (hCut > 0 && hCut < hSun) mark(hCut, cutoff, "--ppc-off", this._clock(hCut), true);
      add("circle", { cx: X(0), cy: Y(soc), r: 4.5, fill: cssv("--ppc-battery"), stroke: cssv("--ppc-bg"), "stroke-width": 2 });
      add("text", { x: X(0), y: H - 4, class: "axis", "text-anchor": "start" }, "Now");
      if (sun) add("text", { x: X(hSun), y: H - 4, class: "axis", "text-anchor": "middle", fill: cssv("--ppc-pv") }, `Sun ${sunLabel}`);

      if (sun) {
        if (h15 >= hSun) {
          head.className = "nhead ok";
          head.innerHTML = `✓ Battery lasts until the sun <small>about ${Math.round(socAtSun)}% left at ${esc(sunLabel)} · ${low}% in ${this._dur(h15)} at this rate</small>`;
        } else {
          head.className = "nhead short";
          head.innerHTML = `Battery reaches ${low}% at ${this._clock(Math.max(0, h15))} <small>sun from about ${esc(sunLabel)}${hCut < hSun ? `, cutoff at ${this._clock(Math.max(0, hCut))}` : ""}</small>`;
        }
      }
    }
  }

  if (!customElements.get("pema-power-card")) customElements.define("pema-power-card", PemaPowerCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(c => c.type === "pema-power-card"))
    window.customCards.push({ type: "pema-power-card", name: "Pema Power Card", preview: false,
      description: "Family-friendly solar, battery, Eskom, load-shedding and prepaid card.",
      documentationURL: "https://github.com/hpema/pema-power-card" });
  console.info(`%c PEMA-POWER-CARD %c ${VERSION} `, "background:#1e9e62;color:#fff;border-radius:3px 0 0 3px", "background:#333;color:#fff;border-radius:0 3px 3px 0");
})();

/*
 * Pema Energy Card — same file, second card. One card, three views (show: today | tomorrow | usage):
 *   today    — sun made today vs the forecast, weather and cloud per hour, hours the battery was full
 *   tomorrow — tomorrow's sun forecast, battery at sunrise, when it will be full, best hours for heavy appliances
 *   usage    — where the house's power came from today (sun / battery / Eskom), hour by hour, spare sun, Eskom per day
 */
(() => {
  const VERSION = "0.4.0";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (x, d = 1) => (+x).toFixed(d);
  const hh = h => String(Math.floor(h + 1e-6) % 24).padStart(2, "0") + ":" + String(Math.round((h % 1) * 60) % 60).padStart(2, "0");
  const H = 3600e3, STEP_H = 5 / 60;          // 5-minute statistics

  // One fetch per data set, shared by every card on the page (the three views ask for the same things).
  const CACHE = new Map();
  function cached(key, ttlMs, fn) {
    const c = CACHE.get(key);
    if (c && Date.now() - c.at < ttlMs) return c.p;
    const p = fn().catch(e => { CACHE.delete(key); throw e; });
    CACHE.set(key, { at: Date.now(), p });
    return p;
  }

  const STYLE = `
    :host { --pec-pv:#e0a800; --pec-grid:#1fa5c9; --pec-bat:#1e9e62; --pec-off:#d93a3a;
      --pec-fg: var(--primary-text-color,#212121); --pec-muted: var(--secondary-text-color,#727272);
      --pec-bg: var(--ha-card-background, var(--card-background-color,#fff));
      --pec-soft: color-mix(in srgb, var(--pec-fg) 4%, var(--pec-bg)); --pec-line: var(--divider-color,#e3e6e5);
      --pec-cloud: color-mix(in srgb, var(--pec-muted) 75%, #6f8aa6); display:block; }
    ha-card { padding:14px 14px 16px; color:var(--pec-fg); font-variant-numeric:tabular-nums; }
    h2 { margin:0 0 2px; font-size:1.05rem; font-weight:600; } .sub { color:var(--pec-muted); font-size:.82rem; margin-bottom:10px; }
    .big { font-size:1.6rem; font-weight:650; letter-spacing:-.3px; } .unit { font-size:.85rem; font-weight:500; color:var(--pec-muted); margin-left:4px; }
    .row { display:flex; justify-content:space-between; align-items:flex-end; gap:8px; }
    .bar { display:flex; height:12px; border-radius:6px; overflow:hidden; background:var(--pec-soft); gap:2px; margin:8px 0 6px; } .bar>div { height:100%; }
    .leg { display:flex; flex-wrap:wrap; gap:4px 14px; font-size:.78rem; color:var(--pec-muted); }
    .leg i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
    .leg i.dash { height:0; border-top:2px dashed var(--pec-pv); border-radius:0; width:14px; vertical-align:3px; }
    .leg i.line { height:0; border-top:2px solid var(--pec-pv); border-radius:0; width:14px; vertical-align:3px; }
    .panel { background:var(--pec-soft); border-radius:10px; padding:10px 12px; margin-top:12px; font-size:.86rem; display:flex; gap:10px; align-items:flex-start; }
    .panel svg { width:20px; flex:none; margin-top:1px; } .panel b { font-weight:600; }
    svg { display:block; width:100%; height:auto; overflow:visible; } svg text { fill:var(--pec-muted); font-size:10.5px; font-family:inherit; }
    .split { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; }
    .split > div { background:var(--pec-soft); border-radius:10px; padding:8px 10px; } .split .k { font-size:.76rem; color:var(--pec-muted); } .split .v { font-size:1.1rem; font-weight:600; }
    .note { font-size:.76rem; color:var(--pec-muted); margin-top:8px; } .h3 { margin:16px 0 4px; font-weight:600; font-size:.86rem; }
    .msg { color:var(--pec-muted); font-size:.86rem; padding:8px 0; }`;

  // tiny drawn weather icons
  function icon(cond, x, y, s = 18) {
    const c = s / 2, k = s / 20;
    const sun = `<circle cx="${x + c}" cy="${y + c}" r="${s * .22}" fill="var(--pec-pv)"/>` + [0, 45, 90, 135, 180, 225, 270, 315].map(a => {
      const r = a * Math.PI / 180;
      return `<line x1="${x + c + Math.cos(r) * s * .32}" y1="${y + c + Math.sin(r) * s * .32}" x2="${x + c + Math.cos(r) * s * .45}" y2="${y + c + Math.sin(r) * s * .45}" stroke="var(--pec-pv)" stroke-width="1.6" stroke-linecap="round"/>`;
    }).join("");
    const cloud = (dx, dy, kk) => `<path transform="translate(${x + dx},${y + dy}) scale(${kk})" d="M4 14h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1.5A3.3 3.3 0 0 0 4 14z" fill="var(--pec-cloud)" stroke="var(--pec-bg)" stroke-width="1.2"/>`;
    if (cond === "sunny") return sun;
    if (cond === "clear-night") return `<path transform="translate(${x},${y}) scale(${k})" d="M13 3a7.5 7.5 0 1 0 5 12.5A6 6 0 0 1 13 3z" fill="var(--pec-cloud)"/>`;
    if (cond === "partlycloudy") return `<g transform="translate(${-s * .15},${-s * .15})">${sun}</g>` + cloud(s * .1, s * .25, k * .85);
    if (["rainy", "pouring", "lightning-rainy", "lightning", "hail"].includes(cond))
      return cloud(0, 0, k) + [5, 10, 15].map(dx => `<line x1="${x + dx * k}" y1="${y + 16 * k}" x2="${x + dx * k - 1.5}" y2="${y + 20 * k}" stroke="var(--pec-grid)" stroke-width="1.6" stroke-linecap="round"/>`).join("");
    return cloud(0, s * .05, k);
  }
  const iconSvg = (c, s) => `<svg viewBox="0 0 ${s} ${s}">${icon(c, 0, 0, s)}</svg>`;
  const LABEL = { sunny: "Sunny", partlycloudy: "Partly cloudy", cloudy: "Cloudy", rainy: "Rain", pouring: "Heavy rain",
    "lightning-rainy": "Thunderstorms", lightning: "Thunderstorms", fog: "Fog", windy: "Windy", "clear-night": "Clear" };

  class PemaEnergyCard extends HTMLElement {
    static getStubConfig() { return { show: "usage", power: { solar: "", grid: "", battery: "", home: "" }, battery: { soc: "" } }; }
    getCardSize() { return 8; }
    getGridOptions() { return { columns: 12, min_columns: 6 }; }
    setConfig(config) {
      if (!config || !config.power || !config.battery?.soc) throw new Error("pema-energy-card: 'power' and 'battery.soc' are required");
      if (!["today", "tomorrow", "usage"].includes(config.show || "usage")) throw new Error("pema-energy-card: show must be today, tomorrow or usage");
      this._config = { show: "usage", battery_discharge_positive: true, forecast_scale: 1, ...config,
        battery: { capacity_kwh: 10, low: 15, ...config.battery }, forecast: { ...(config.forecast || {}) } };
      this._render();
    }
    set hass(h) {
      const first = !this._hass; this._hass = h;
      if (first) this._load();
      const sig = this._ids().map(id => h.states[id]?.state).join("|");
      if (sig !== this._sig) { this._sig = sig; this._render(); }
    }
    connectedCallback() {
      this._timer = setInterval(() => this._load(), 5 * 60e3);
      if (this._hass && !this._data) this._load();
    }
    disconnectedCallback() {
      clearInterval(this._timer);
      for (const u of this._unsubs || []) u.then(f => f && f()).catch(() => {});
      this._unsubs = null;
    }
    _ids() { const c = this._config || {}; return [c.solar_today, c.forecast.today, c.forecast.today_remaining, c.forecast.tomorrow].filter(Boolean); }
    _num(id) { const v = parseFloat(this._hass?.states[id]?.state); return Number.isFinite(v) ? v : null; }
    _numOr(v, d) { if (typeof v === "number") return v; const n = this._num(v); return n ?? d; }

    // fixed offset of the house's time zone (no daylight saving in South Africa; good enough elsewhere for a day view)
    _offset() {
      const tz = this._hass?.config?.time_zone, now = new Date();
      try {
        const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit",
          day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now).map(x => [x.type, x.value]));
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(now.getTime() / 1000) * 1000;
      } catch (e) { return -now.getTimezoneOffset() * 60e3; }
    }

    _load() {
      const hass = this._hass, c = this._config;
      if (!hass || !c || this._loading) return;
      this._loading = true;
      const off = this._offset(), now = Date.now(), mid = now - ((now + off) % (24 * H));
      const P = c.power, ids = [P.solar, P.home, P.grid, P.battery, c.battery.soc];
      const stat = (ids, start, period, types) => hass.callWS({ type: "recorder/statistics_during_period", start_time: new Date(start).toISOString(),
        statistic_ids: ids, period, types });
      const day = Math.floor((now + off) / (24 * H)), slot = Math.floor(now / (5 * 60e3));
      const jobs = {
        fine: cached(`fine:${ids}:${slot}`, 4 * 60e3, () => stat(ids, mid - 24 * H, "5minute", ["mean"])),
        fc: cached("fc:" + Math.floor(now / (15 * 60e3)), 15 * 60e3, () => hass.callWS({ type: "energy/solar_forecast" })),
      };
      if (c.show === "tomorrow") jobs.prof = cached(`prof:${P.home}:${day}`, 6 * H, () => stat([P.home], mid - 7 * 24 * H, "hour", ["mean"]));
      if (c.show === "usage" && c.grid_import_total)
        jobs.days = cached(`days:${c.grid_import_total}:${slot}`, 4 * 60e3, () => stat([c.grid_import_total], mid - 6 * 24 * H, "day", ["change"]));
      if (c.show === "today" && c.weather)
        jobs.wxHist = cached(`wxh:${c.weather}:${slot}`, 4 * 60e3, () => hass.callWS({ type: "history/history_during_period", start_time: new Date(mid).toISOString(),
          entity_ids: [c.weather], minimal_response: false, no_attributes: false, significant_changes_only: false }));
      const keys = Object.keys(jobs);
      Promise.allSettled(keys.map(k => jobs[k])).then(rs => {
        const d = { now, mid, off };
        rs.forEach((r, i) => { d[keys[i]] = r.status === "fulfilled" ? r.value : null; if (r.status === "rejected") console.warn("pema-energy-card:", keys[i], r.reason); });
        this._data = d; this._loading = false; this._render();
      });
      // hourly (and for tomorrow, daily) weather forecast: a live subscription, started once
      if (c.weather && hass.connection && !this._unsubs && c.show !== "usage") {
        this._unsubs = [];
        const sub = (type, cb) => this._unsubs.push(hass.connection.subscribeMessage(m => { cb(m.forecast || []); this._render(); },
          { type: "weather/subscribe_forecast", forecast_type: type, entity_id: c.weather }).catch(() => null));
        sub("hourly", f => { this._wxH = f; });
        if (c.show === "tomorrow") sub("daily", f => { this._wxD = f; });
      }
    }

    _render() {
      if (!this._config) return;
      const root = this.shadowRoot || this.attachShadow({ mode: "open" });
      if (!root.firstChild) root.innerHTML = `<style>${STYLE}</style><ha-card></ha-card>`;
      const card = root.querySelector("ha-card");
      const d = this._data;
      if (!this._hass || !d || !d.fine) { card.innerHTML = `<div class="msg">Loading…</div>`; return; }
      try { card.innerHTML = this["_" + this._config.show](d); }
      catch (e) { console.warn("pema-energy-card:", e); card.innerHTML = `<div class="msg">Could not draw this card (${esc(e.message)}).</div>`; }
    }

    // ------------------------------------------------------------------ shared helpers ----
    _series(d) {
      const P = this._config.power, f = d.fine || {};
      const S = (id, sign = 1) => (f[id] || []).map(r => [r.start, sign * (r.mean ?? 0)]);
      const b = S(P.battery, this._config.battery_discharge_positive ? 1 : -1);
      return { pv: S(P.solar), load: S(P.home), grid: S(P.grid), bat: b, soc: S(this._config.battery.soc) };
    }
    _fc(d) {
      const r = d.fc || {}, id = this._config.forecast.config_entry, e = id ? r[id] : Object.values(r)[0], m = new Map();
      for (const [k, v] of Object.entries(e?.wh_hours || {})) m.set(new Date(k).getTime(), v);
      return t0 => m.get(t0) || 0;
    }
    _hour(d, ms) { const x = new Date(ms + d.off); return x.getUTCHours() + x.getUTCMinutes() / 60; }
    _dayName(d, ms) { return new Date(ms + d.off).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
    _cap() { return this._numOr(this._config.battery.capacity_kwh, 10); }
    _condAt(d, t) {
      // t = start of the hour. Forecast hours are keyed by their start; recorded weather is read at half past.
      const fh = (this._wxH || []).find(w => Math.abs(new Date(w.datetime).getTime() - t) < 60e3);
      if (t + H / 2 > d.now && fh) return [fh.condition, fh.cloud_coverage];
      let c = null, cc = null;
      for (const p of (d.wxHist?.[this._config.weather] || [])) {
        const ts = (p.lu ?? p.lc) * 1000; if (ts > t + H / 2) break;
        c = p.s; cc = p.a?.cloud_coverage ?? cc;
      }
      if (c === null && fh) return [fh.condition, fh.cloud_coverage];
      return [c, cc];
    }
    _chartFrame(svg, X, Y, x0, x1, ymax, h0, h1, yBot) {
      const step = ymax > 6000 ? 2000 : ymax > 3000 ? 1000 : 500;
      for (let w = 0; w <= ymax; w += step)
        svg.push(`<line x1="${x0}" x2="${x1}" y1="${Y(w)}" y2="${Y(w)}" stroke="var(--pec-line)"/><text x="${x0 - 5}" y="${Y(w) + 3}" text-anchor="end">${w ? w / 1000 + "kW" : "0"}</text>`);
      for (let h = h0; h <= h1; h += 2) svg.push(`<text x="${X(h)}" y="${yBot + 14}" text-anchor="middle">${String(h).padStart(2, "0")}</text>`);
    }
    _wxStrip(d, svg, X, h0, h1, dayStart) {
      for (let h = h0; h < h1; h++) {
        const [c, cc] = this._condAt(d, dayStart + h * H); if (c === null) continue;
        svg.push(`<rect x="${X(h) + 1}" y="22" width="${X(h + 1) - X(h) - 2}" height="7" rx="2" fill="var(--pec-cloud)" opacity="${.1 + (cc || 0) / 100 * .8}"><title>${hh(h)} · ${esc(LABEL[c] || c)} · cloud ${Math.round(cc || 0)}%</title></rect>`);
        if ((h - h0) % 2 === 1) svg.push(icon(c, (X(h) + X(h + 1)) / 2 - 9, 0, 18));
      }
    }

    // ------------------------------------------------------------------ today ----
    _today(d) {
      const c = this._config, s = this._series(d), fcAt = this._fc(d), nowH = this._hour(d, d.now);
      const made = this._num(c.solar_today) ?? s.pv.filter(r => r[0] >= d.mid).reduce((a, r) => a + r[1] * STEP_H / 1000, 0);
      const rem = this._num(c.forecast.today_remaining) ?? 0;
      const W = 360, x0 = 34, x1 = W - 6, h0 = 5, h1 = 19, X = h => x0 + (h - h0) / (h1 - h0) * (x1 - x0);
      const today = s.pv.filter(r => r[0] >= d.mid);
      const fcT = []; for (let h = h0; h < h1; h++) fcT.push([h, fcAt(d.mid + h * H)]);
      const ymax = Math.max(1000, ...today.map(r => r[1]), ...fcT.map(r => r[1])) * 1.08, yTop = 38, Hc = 150, yBot = yTop + Hc, Y = w => yBot - w / ymax * Hc;
      const full = []; let st = null;
      for (const [t, v] of s.soc.filter(r => r[0] >= d.mid)) {
        const h = this._hour(d, t) + STEP_H; if (h < h0 || h > h1) continue;
        if (v >= 98 && st === null) st = h - STEP_H; if (v < 98 && st !== null) { full.push([st, h - STEP_H]); st = null; }
      }
      if (st !== null) full.push([st, Math.min(nowH, h1)]);
      const svg = [`<svg viewBox="0 0 ${W} ${yBot + 20}" role="img" aria-label="Solar power made today and the forecast">`];
      this._wxStrip(d, svg, X, h0, h1, d.mid);
      this._chartFrame(svg, X, Y, x0, x1, ymax, h0, h1, yBot);
      for (const [a, b] of full) if (b - a > .2)
        svg.push(`<rect x="${X(a)}" y="${yTop}" width="${X(b) - X(a)}" height="${Hc}" fill="var(--pec-bat)" opacity=".10"/>` +
          (b - a > 2.5 ? `<text x="${(X(a) + X(b)) / 2}" y="${yTop + 12}" text-anchor="middle" style="fill:var(--pec-bat)">battery full · panels held back</text>` : ""));
      const fp = fcT.map(([h, v]) => [X(h + .5), Y(v)]);
      svg.push(`<path d="M${[[X(h0), Y(0)], ...fp, [X(h1), Y(0)]].map(p => p.join(",")).join("L")}" fill="none" stroke="var(--pec-pv)" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>`);
      const gp = today.map(r => [this._hour(d, r[0]) + STEP_H / 2, r[1]]).filter(([h]) => h >= h0 && h <= h1).map(([h, v]) => [X(h), Y(v)]);
      if (gp.length) svg.push(`<path d="M${gp[0][0]},${yBot}L${gp.map(p => p.join(",")).join("L")}L${gp[gp.length - 1][0]},${yBot}Z" fill="var(--pec-pv)" opacity=".22"/><path d="M${gp.map(p => p.join(",")).join("L")}" fill="none" stroke="var(--pec-pv)" stroke-width="2" stroke-linejoin="round"/>`);
      svg.push(`<line x1="${x0}" x2="${x1}" y1="${yBot}" y2="${yBot}" stroke="var(--pec-muted)" opacity=".5"/>`);
      if (nowH >= h0 && nowH <= h1) svg.push(`<line x1="${X(nowH)}" x2="${X(nowH)}" y1="${yTop}" y2="${yBot}" stroke="var(--pec-off)" stroke-dasharray="2 3" stroke-width="1.5"/><text x="${X(nowH)}" y="${yTop - 3}" text-anchor="middle" style="fill:var(--pec-off)">now</text>`);
      svg.push("</svg>");
      const fullH = full.reduce((a, [x, y]) => a + y - x, 0), done = nowH >= h1 || rem <= .05;
      return `<h2>${esc(c.title || "Sun today")}</h2><div class="sub">${c.location ? esc(c.location) + " · " : ""}${this._dayName(d, d.now)}</div>
        <div class="row"><div><span class="big">${fmt(made)}</span><span class="unit">kWh made</span></div><div style="text-align:right">${done ? `<span class="unit">sun is down</span>` : `<span class="big" style="color:var(--pec-muted)">${fmt(rem)}</span><span class="unit">kWh still to come</span>`}</div></div>
        <div class="bar"><div style="width:${made / (made + rem || 1) * 100}%;background:var(--pec-pv)"></div>${rem > .05 ? `<div style="flex:1;background:repeating-linear-gradient(135deg,transparent 0 4px,color-mix(in srgb,var(--pec-pv) 40%,transparent) 4px 6px)"></div>` : ""}</div>
        ${svg.join("")}
        <div class="leg" style="margin-top:6px"><span><i class="line"></i>made</span><span><i class="dash"></i>forecast</span><span><i style="background:var(--pec-bat);opacity:.35"></i>battery full</span><span><i style="background:var(--pec-cloud);opacity:.6"></i>cloud (darker = more)</span></div>
        ${fullH > .5 ? `<div class="panel">${iconSvg("sunny", 20)}<div>The battery was full for <b>about ${fmt(fullH, 0)} hour${Math.round(fullH) === 1 ? "" : "s"}</b>, so the panels were held back. The gap between the lines in the green band is free sun nobody used.</div></div>` : ""}`;
    }

    // ------------------------------------------------------------------ tomorrow ----
    _tomorrow(d) {
      const c = this._config, s = this._series(d), fcAt = this._fc(d), cap = this._cap(), low = this._numOr(c.battery.low, 15);
      const tm = d.mid + 24 * H, W = 360, x0 = 34, x1 = W - 6, h0 = 5, h1 = 19, X = h => x0 + (h - h0) / (h1 - h0) * (x1 - x0), yTop = 38, Hc = 110, yBot = yTop + Hc;
      const fc = []; for (let h = 0; h < 24; h++) fc.push([h, fcAt(tm + h * H)]);
      const tot = this._num(c.forecast.tomorrow) ?? fc.reduce((a, r) => a + r[1], 0) / 1000;
      // typical house use per hour of the day (last 7 days)
      const lp = new Array(24).fill(0), ln = new Array(24).fill(0);
      for (const r of (d.prof?.[c.power.home] || [])) { const h = Math.floor(this._hour(d, r.start)); if (r.mean != null) { lp[h] += r.mean; ln[h]++; } }
      if (!ln.some(Boolean)) for (const [t, v] of s.load) { const h = Math.floor(this._hour(d, t)); lp[h] += v; ln[h]++; }
      const lavg = lp.map((x, i) => ln[i] ? x / ln[i] : 600);
      const scale = c.forecast_scale || 1, socNow = s.soc.length ? s.soc[s.soc.length - 1][1] : 50;
      let e = this._numOr(c.battery.soc, socNow) / 100 * cap;
      for (let h = Math.ceil(this._hour(d, d.now)); h < 24; h++) e = Math.max(cap * low / 100, e - lavg[h] / 1000);
      let fullAt = null, sunrise = null, socRise = null;
      for (let h = 0; h < 24; h++) {
        const p = fc[h][1] * scale, l = lavg[h];
        if (sunrise === null && p >= l) { sunrise = h; socRise = e / cap * 100; }
        e = Math.min(cap, Math.max(cap * low / 100, e + (p - l) / 1000));
        if (fullAt === null && e >= cap * .99 && p > 0) fullAt = h + 1;
      }
      const after = fc.filter(([h]) => fullAt !== null && h >= fullAt);
      const spare = after.reduce((a, [h, p]) => a + Math.max(0, p * scale - lavg[h]), 0) / 1000;
      const good = after.filter(([h, p]) => p * scale - lavg[h] > 1500).map(r => r[0]);
      const ymax = Math.max(1000, ...fc.map(r => r[1])) * 1.1, Y = w => yBot - w / ymax * Hc;
      const svg = [`<svg viewBox="0 0 ${W} ${yBot + 20}" role="img" aria-label="Tomorrow's solar forecast">`];
      this._wxStrip(d, svg, X, h0, h1, tm);
      this._chartFrame(svg, X, Y, x0, x1, ymax, h0, h1, yBot);
      if (good.length) { const a = good[0], b = good[good.length - 1] + 1;
        svg.push(`<rect x="${X(a)}" y="${yTop}" width="${X(b) - X(a)}" height="${Hc}" fill="var(--pec-bat)" opacity=".10"/><text x="${(X(a) + X(b)) / 2}" y="${yTop + 12}" text-anchor="middle" style="fill:var(--pec-bat)">sun to spare</text>`); }
      const pts = fc.filter(([h]) => h >= h0 && h < h1).map(([h, v]) => [X(h + .5), Y(v)]);
      svg.push(`<path d="M${X(h0)},${yBot}L${pts.map(p => p.join(",")).join("L")}L${X(h1)},${yBot}Z" fill="var(--pec-pv)" opacity=".13"/><path d="M${pts.map(p => p.join(",")).join("L")}" fill="none" stroke="var(--pec-pv)" stroke-width="2" stroke-dasharray="5 4"/>`);
      svg.push(`<line x1="${x0}" x2="${x1}" y1="${yBot}" y2="${yBot}" stroke="var(--pec-muted)" opacity=".5"/></svg>`);
      const tmDate = new Date(tm + d.off).getUTCDate();
      const wd = (this._wxD || []).find(w => new Date(new Date(w.datetime).getTime() + d.off).getUTCDate() === tmDate);
      const wline = wd ? ` · ${esc(LABEL[wd.condition] || wd.condition)}${wd.templow != null ? `, ${Math.round(wd.templow)}–${Math.round(wd.temperature)}°C` : `, up to ${Math.round(wd.temperature)}°C`}` : "";
      return `<h2>${esc(c.title || "Sun tomorrow")}</h2><div class="sub">${this._dayName(d, tm)}${wline}</div>
        <div class="row"><div><span class="big">≈ ${fmt(tot, 0)}</span><span class="unit">kWh expected</span></div>${wd ? `<div style="width:34px">${iconSvg(wd.condition, 26)}</div>` : ""}</div>
        ${svg.join("")}
        <div class="leg" style="margin-top:4px"><span><i class="dash"></i>forecast</span><span><i style="background:var(--pec-bat);opacity:.35"></i>battery full, sun to spare</span><span><i style="background:var(--pec-cloud);opacity:.6"></i>cloud</span></div>
        <div class="split"><div><div class="k">Battery at sunrise</div><div class="v">${socRise != null ? Math.round(socRise) + "%" : "–"}${sunrise != null ? ` <span class="unit">${hh(sunrise)}</span>` : ""}</div></div>
          <div><div class="k">Battery full by</div><div class="v">${fullAt !== null ? hh(fullAt) : "not tomorrow"}</div></div></div>
        <div class="panel">${iconSvg("sunny", 20)}<div>${good.length ? `Best time for washing, the dishwasher and the pool pump: <b>${hh(good[0])}–${hh(good[good.length - 1] + 1)}</b>. About <b>${fmt(spare, 0)} kWh</b> of sun will be spare once the battery is full.` : `Not much spare sun tomorrow; the battery needs most of it. Run heavy appliances around midday if you can.`}</div></div>
        <div class="note">Forecast from Forecast.Solar, using the last 7 days of house use.</div>`;
    }

    // ------------------------------------------------------------------ usage ----
    _usage(d) {
      const c = this._config, s = this._series(d), fcAt = this._fc(d), cap = this._cap(), scale = c.forecast_scale || 1;
      // Every 5 minutes: the house takes sun first, then battery, then Eskom (how the inverter works).
      // The battery remembers what share of the energy in it came from the sun, so battery power counts as sun or Eskom.
      let mix = .5;
      const hrs = [...Array(24)].map(() => ({ sun: 0, bat: 0, grid: 0, spare: 0, load: 0 }));
      const D = { sun: 0, bat: 0, batSun: 0, grid: 0, gridAll: 0, load: 0, gridChg: 0, spare: 0 };
      const at = (arr, i) => (arr[i] || [0, 0])[1], k = STEP_H / 1000;
      for (let i = 0; i < s.pv.length; i++) {
        const t = s.pv[i][0], p = Math.max(0, s.pv[i][1]), L = Math.max(0, at(s.load, i)), g = at(s.grid, i), b = at(s.bat, i), soc = at(s.soc, i);
        const gi = Math.max(g, 0), bd = Math.max(b, 0), bc = Math.max(-b, 0);
        const sh = Math.min(p, L); let r = L - sh; const bh = Math.min(bd, r); r -= bh; const gh = Math.max(r, 0);
        const sc = Math.min(Math.max(p - sh, 0), bc), gc = bc - sc, stored = Math.max(soc, 5) / 100 * cap;
        if (bc > 0) mix = (mix * stored + sc * k) / (stored + bc * k);
        if (t < d.mid) continue;
        const Hh = hrs[Math.floor(this._hour(d, t))];
        const spare = soc >= 98 ? Math.max(0, scale * fcAt(t - (t % H)) - p) * k : 0;
        Hh.sun += sh * k; Hh.bat += bh * k; Hh.grid += gi * k; Hh.load += L * k; Hh.spare += spare;
        D.sun += sh * k; D.bat += bh * k; D.batSun += bh * mix * k; D.grid += gh * k; D.gridAll += gi * k; D.load += L * k; D.gridChg += gc * k; D.spare += spare;
      }
      const fromSun = D.sun + D.batSun, eskom = D.gridAll, pct = fromSun / (fromSun + eskom || 1) * 100;
      const eskHouse = Math.max(0, eskom - D.gridChg), tot = D.sun + D.bat + eskHouse, segW = v => (v / (tot || 1) * 100).toFixed(1) + "%";
      const W = 360, x0 = 24, x1 = W - 6, yTop = 18, Hc = 120, yBot = yTop + Hc, bw = (x1 - x0) / 24, X = h => x0 + h * bw;
      const ymax = Math.max(1, ...hrs.map(x => x.sun + x.bat + x.grid + x.spare)) * 1.05, Y = v => v / ymax * Hc;
      const svg = [`<svg viewBox="0 0 ${W} ${yBot + 20}" role="img" aria-label="Where the house's power came from, hour by hour">`];
      const vstep = ymax > 6 ? 2 : 1;
      for (let v = 0; v <= ymax; v += vstep) svg.push(`<line x1="${x0}" x2="${x1}" y1="${yBot - Y(v)}" y2="${yBot - Y(v)}" stroke="var(--pec-line)"/><text x="${x0 - 5}" y="${yBot - Y(v) + 3}" text-anchor="end">${v}</text>`);
      hrs.forEach((x, h) => {
        let y = yBot;
        const seg = (v, col) => { if (v < .005) return ""; const hg = Y(v); y -= hg; return `<rect x="${X(h) + 1.5}" y="${y + 1}" width="${bw - 3}" height="${Math.max(hg - 1, 1)}" rx="1.5" fill="var(--pec-${col})"/>`; };
        const tip = `${hh(h)}–${hh(h + 1)}: used ${fmt(x.load, 2)} kWh · sun ${fmt(x.sun, 2)} · battery ${fmt(x.bat, 2)} · Eskom ${fmt(x.grid, 2)}${x.spare > .05 ? ` · spare sun ${fmt(x.spare, 1)}` : ""}`;
        svg.push(`<g><title>${tip}</title>${seg(x.grid, "grid")}${seg(x.bat, "bat")}${seg(x.sun, "pv")}`);
        if (x.spare > .05) svg.push(`<rect x="${X(h) + 1.5}" y="${y - Y(x.spare)}" width="${bw - 3}" height="${Math.max(Y(x.spare) - 1, 1)}" rx="1.5" fill="none" stroke="var(--pec-pv)" stroke-dasharray="2 2"/>`);
        svg.push("</g>");
      });
      for (let h = 0; h <= 24; h += 3) svg.push(`<text x="${X(h)}" y="${yBot + 14}" text-anchor="middle">${String(h % 24).padStart(2, "0")}</text>`);
      svg.push(`<text x="${x0 - 5}" y="${yTop - 10}" text-anchor="end">kWh</text>`);
      const nowH = this._hour(d, d.now);
      svg.push(`<line x1="${X(nowH)}" x2="${X(nowH)}" y1="${yTop}" y2="${yBot}" stroke="var(--pec-off)" stroke-dasharray="2 3" stroke-width="1.5"/><line x1="${x0}" x2="${x1}" y1="${yBot}" y2="${yBot}" stroke="var(--pec-muted)" opacity=".5"/></svg>`);
      // Eskom units per day (meter counter)
      let week = "";
      const gi = (d.days?.[c.grid_import_total] || []).map(r => [r.start, r.change ?? 0]);
      if (gi.length) {
        const gmax = Math.max(1, ...gi.map(r => r[1])), bw7 = (W - 20) / gi.length, w7 = [`<svg viewBox="0 0 ${W} 72" role="img" aria-label="Eskom units per day">`];
        gi.forEach(([t, v], i) => {
          const hg = v / gmax * 38, x = 10 + i * bw7, last = i === gi.length - 1;
          w7.push(`<g><title>${this._dayName(d, t)}: ${fmt(v)} kWh from Eskom</title><rect x="${x + bw7 * .24}" y="${52 - hg}" width="${bw7 * .52}" height="${Math.max(hg, 1.5)}" rx="3" fill="var(--pec-grid)" opacity="${last ? 1 : .5}"/>` +
            `<text x="${x + bw7 / 2}" y="${47 - hg}" text-anchor="middle" style="fill:var(--pec-fg)">${fmt(v)}</text><text x="${x + bw7 / 2}" y="66" text-anchor="middle">${last ? "Today" : new Date(t + d.off).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</text></g>`);
        });
        w7.push("</svg>");
        const prev = gi.slice(0, -1), avg = prev.reduce((a, r) => a + r[1], 0) / Math.max(1, prev.length);
        week = `<div class="h3">Eskom units per day</div><div class="note" style="margin:0 0 4px">Lower is better${prev.length ? ` · the ${prev.length} days before today averaged ${fmt(avg)} kWh` : ""}</div>${w7.join("")}`;
      }
      const eve = hrs.slice(17).reduce((a, x) => a + x.grid, 0), batGrid = Math.max(0, D.bat - D.batSun), standby = eskom - D.grid - D.gridChg;
      return `<h2>${esc(c.title || "Where the house's power came from")}</h2><div class="sub">Today so far · the house used ${fmt(D.load)} kWh</div>
        <div class="row"><div><span class="big">${Math.round(pct)}%</span><span class="unit">from the sun</span></div><div style="text-align:right"><span class="big">${fmt(eskom)}</span><span class="unit">kWh from Eskom</span></div></div>
        <div class="bar" style="height:16px"><div style="width:${segW(D.sun)};background:var(--pec-pv)" title="Sun, used straight away"></div><div style="width:${segW(D.batSun)};background:var(--pec-bat)" title="Battery, filled by the sun"></div>${batGrid > .05 ? `<div style="width:${segW(batGrid)};background:repeating-linear-gradient(135deg,var(--pec-bat) 0 4px,var(--pec-grid) 4px 7px)" title="Battery, filled by Eskom"></div>` : ""}<div style="flex:1;background:var(--pec-grid)" title="Eskom"></div></div>
        <div class="leg"><span><i style="background:var(--pec-pv)"></i>Sun ${fmt(D.sun)}</span><span><i style="background:var(--pec-bat)"></i>Battery ${fmt(D.bat)}</span><span><i style="background:var(--pec-grid)"></i>Eskom ${fmt(eskHouse)}</span></div>
        <div class="note">${D.bat > .1 ? `The battery's ${fmt(D.bat)} kWh was ${Math.round(D.batSun / D.bat * 100)}% sun stored earlier, so it counts as sun.` : ""}${D.gridChg > .2 ? ` Eskom also put ${fmt(D.gridChg)} kWh into the battery.` : ""}${standby > .2 ? ` About ${fmt(standby)} kWh of the Eskom units is the inverter's own small draw.` : ""}</div>
        <div class="h3">Hour by hour</div>${svg.join("")}
        <div class="leg"><span><i style="background:var(--pec-pv)"></i>sun</span><span><i style="background:var(--pec-bat)"></i>battery</span><span><i style="background:var(--pec-grid)"></i>Eskom</span><span><i style="border:1.5px dashed var(--pec-pv);background:none"></i>spare sun, not used</span></div>
        <div class="panel">${iconSvg("sunny", 20)}<div>${D.spare > 1 ? `About <b>${fmt(D.spare, 0)} kWh</b> of sun went unused today (dashed boxes). Washing, the dishwasher, ironing or the pool pump in those hours cost nothing.` : `The sun was used well today.`}${eve > .5 ? ` Most Eskom units went in the evening: ${fmt(eve)} kWh after 17:00.` : ""}</div></div>
        ${week}`;
    }
  }

  if (!customElements.get("pema-energy-card")) customElements.define("pema-energy-card", PemaEnergyCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(c => c.type === "pema-energy-card"))
    window.customCards.push({ type: "pema-energy-card", name: "Pema Energy Card", preview: false,
      description: "Sun today, sun tomorrow, and where the house's power came from.", documentationURL: "https://github.com/hpema/pema-power-card" });
})();
