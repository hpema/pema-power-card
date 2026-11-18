/*
 * Pema Power Card — a simple, family-friendly Home Assistant power card.
 * Solar / battery / grid (Eskom) / home / hot water flow, an overnight battery chart until tomorrow's sun,
 * load-shedding prep and prepaid electricity units.
 *
 * Plain JavaScript web component, no build step. MIT licence.
 * https://github.com/hpema/pema-power-card
 */
(() => {
  const VERSION = "0.3.3";
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
      set("bat", soc == null ? "–" : Math.round(soc) + "%", kw(charge) + " kW", charge > IDLE_W ? "charging" : charge < -IDLE_W ? "discharging" : "idle",
          charge > IDLE_W ? cssv("--ppc-battery") : charge < -IDLE_W ? cssv("--ppc-water") : null);
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
      if (fresh && charge > IDLE_W) {
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
      $("soc").textContent = soc == null ? "Battery" : `Battery ${Math.round(soc)}%`;
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
