# Pema Power Card

A simple, family-friendly power card for [Home Assistant](https://www.home-assistant.io/), built for South African homes with
a solar inverter, a battery and Eskom (or any grid supply that can switch off).

It answers the questions people at home actually ask:

- **Is Eskom on?** Based on the grid *voltage*, so "buying 0 kW" is never mistaken for an outage.
- **Is the data live?** A small connection line under the inverter (bridge → inverter) with "data 2 min ago".
  When data stops, the numbers fade and the card says so instead of showing old values as current.
- **Where is the power coming from right now?** Solar, battery, Eskom, home and hot water around the inverter, with
  moving dots showing the direction and size of each flow.
- **Will the battery last the night?** A small chart from now until tomorrow's sun (from a solar forecast), with the
  15% low level and the cutoff level drawn in, and one plain sentence on top.
- **Load-shedding:** when load-shedding is in effect (or the grid is off), a prep switch and a "keep battery at least"
  setting appear.
- **Prepaid electricity:** units left, how many days until the low-units alert, and a box to add units you bought.
- **Battery plan for the day:** a 24-hour picture of the inverter's time-of-use slots (battery kept at least N%,
  where Eskom may charge), a "now" marker and one sentence on what is happening right now. Read-only.

Parts that don't apply right now take no space, so the card stays short.

> **Status:** in development. The first release will be published here when it is ready.

## Installation (once released)

### Home Assistant Market Place / HACS

1. Open the Market Place (or HACS) → ⋮ → **Custom repositories**.
2. Add `https://github.com/hpema/pema-power-card` with category **Dashboard** (Lovelace / plugin).
3. Install **Pema Power Card** and reload the browser.

### Manual

Copy `dist/pema-power-card.js` to `/config/www/pema-power-card/` and add it as a dashboard resource
(`/local/pema-power-card/pema-power-card.js`, type *JavaScript module*).

## Configuration (planned)

Every value comes from an entity you choose, so the card works with any inverter integration.

```yaml
type: custom:pema-power-card
grid_present: binary_sensor.eskom_power        # on = grid available (voltage based)
inverter_status: sensor.inverter_state         # 'ok' shows as Normal
fault: sensor.inverter_fault                   # optional: non-empty = Fault
link:                                          # optional: connection chain shown under the inverter
  bridge: binary_sensor.inverter_bridge        # e.g. a Pi that talks RS485 to the inverter
  bridge_name: Pi B
  inverter: binary_sensor.inverter_responding
  live: binary_sensor.inverter_live            # off = numbers fade, wires stop, "No live data since …"
  last_data: sensor.inverter_last_data         # timestamp → "data 2 min ago"
weather: weather.home                          # min / max from the daily forecast
power:
  solar: sensor.inverter_pv_power              # W
  grid: sensor.inverter_grid_power             # W, + buying / - selling
  battery: sensor.inverter_battery_power       # W, + discharging / - charging
  home: sensor.inverter_load_power             # W
battery:
  soc: sensor.inverter_battery_soc             # %
  capacity_kwh: 10
  low: number.inverter_battery_low_capacity    # e.g. 15 %
  cutoff: number.inverter_battery_shutdown     # e.g. 5 %
solar_forecast: true                           # uses Home Assistant's Energy solar forecast
hot_water:
  temperature: sensor.geyser_temperature
  switch: switch.geyser                        # optional
  power: sensor.geyser_power                   # optional
load_shedding:
  in_effect: input_boolean.loadshedding_active
  prep: input_boolean.loadshedding_prep
  prep_target: input_number.loadshedding_prep_soc
tou:                                           # optional: read-only picture of the inverter's daily plan
  prefix: ss                                   # Sunsynk add-on: select.ss_prog1_time, number.ss_prog1_capacity,
                                               #   select.ss_prog1_charge ... prog6
  use_timer: switch.ss_use_timer
  # or list them yourself:
  # programs: [{ time: select.x, capacity: number.y, charge: select.z }, ...]
prepaid:
  units: sensor.prepaid_units
  alert_level: input_number.prepaid_low_threshold
  per_day: sensor.grid_import_per_day
  topup_units: input_number.prepaid_topup_units
  topup_button: input_button.prepaid_add_topup
```

## Licence

MIT
