# Console V2 — equipment classes and telemetry points

Status: **decided** 2026-10-09 (V2-00.5) by the tech lead, confirmed with the operations lead and the facilities
lead. The catalogue that [ADR-0018](../../adr/0018-assets-and-telemetry-as-domain-data.md) defines as tables: the
V2.0 asset classes, and for each class its `telemetry_point` rows and, for modelled classes, the parts bound to them
([ADR-0020](../../adr/0020-digital-twin-rendering-and-model-pipeline.md) `extras.bind`). V2-05 seeds these rows;
V2-13 commissions the models from them. Threshold rules are not here (V2-00.6).

Classes come from the mockups' catalogue. Ranges and intervals are set for typical campus equipment; the readings in
the mockups are illustrative sample data (brief § Notes), not limits.

## Classes

Two classes are modelled in V2.0, as drawn in frames 03 and 08. Every other class has `model_key` null and is drawn
as a neutral box from `footprint_m` (frame 15) until it gets a model; its readings, states and incidents work the
same.

| Class                 | `code`              | Model                   | `footprint_m` (W × D × H) | Demo assets                | Headline 1 · 2                        |
| --------------------- | ------------------- | ----------------------- | ------------------------- | -------------------------- | ------------------------------------- |
| Cooling tower         | `cooling_tower`     | `cooling_tower.glb`     | 4.0 × 4.0 × 5.0           | CT-01, CT-02               | `fanSpeedRpm` · `motorTempC`          |
| Standby generator     | `standby_generator` | `standby_generator.glb` | 6.0 × 2.5 × 3.0           | GEN-01                     | `fuelLevelPct` · `starterBatteryV`    |
| UPS                   | `ups`               | box                     | 2.0 × 1.0 × 2.0           | UPS-01                     | `loadPct` · `autonomyMin`             |
| UPS battery bank      | `ups_battery`       | box                     | 3.0 × 0.8 × 2.0           | BAT-01                     | `chargePct` · `roomTempC`             |
| Precision cooling     | `precision_cooling` | box                     | 1.8 × 0.9 × 2.0           | CRAC-01, CRAC-02           | `supplyAirTempC` · `returnAirTempC`   |
| Transformer           | `transformer`       | box                     | 2.5 × 2.0 × 2.5           | TR-01                      | `loadPct` · `windingTempC`            |
| Switchgear            | `switchgear`        | box                     | 6.0 × 1.0 × 2.3           | SWG-01                     | `busVoltageKv` · `currentA`           |
| Chiller               | `chiller`           | box                     | 6.0 × 2.0 × 2.5           | CH-01                      | `chilledWaterSupplyTempC` · `running` |
| Air handler           | `air_handler`       | box                     | 4.0 × 2.0 × 2.0           | AHU-C1, AHU-L1, AHU-H1     | `indoorTempC` · `supplyAirTempC`      |
| Booster pump          | `booster_pump`      | box                     | 1.2 × 0.8 × 1.2           | PMP-S1                     | `dischargePressureBar` · `running`    |
| Lift                  | `lift`              | box                     | 2.0 × 2.0 × 3.0           | LFT-A2, LFT-B1, LFT-H1     | `carFloor` · `inService`              |
| Barrier arm           | `barrier_arm`       | box                     | 4.0 × 0.4 × 1.2           | BAR-01, BAR-02             | `armPosition`                         |
| Fume hood             | `fume_hood`         | box                     | 1.8 × 0.9 × 2.4           | FH-L1                      | `faceVelocityMs` · `sashOpenPct`      |
| Gas detector          | `gas_detector`      | box                     | 1.4 × 1.4 × 1.4           | GAS-L1                     | `gasPpm`                              |
| Leak sensor           | `leak_sensor`       | box                     | 1.4 × 1.4 × 1.4           | LKS-B3                     | `leakDetected` · `batteryPct`         |
| Indoor climate sensor | `indoor_climate`    | box                     | 1.4 × 1.4 × 1.4           | one per building, see note | `indoorTempC` · `humidityPct`         |

- Footprints are typical outside dimensions. Sensors and detectors use a 1.4 m cube, as frame 15 draws the leak
  sensor, so they stay visible at campus scale.
- **Indoor climate sensor** is the one class the mockups do not list as an asset: frame 13's heat overlay colours
  every building by indoor temperature, and air handlers exist in only three of its twelve buildings. Air handlers
  and this class share the key `indoorTempC`, so the overlay reads one key.
- **Demo assets:** 22 equipment assets, plus one indoor climate sensor per building that has no air handler. The
  Assets lists show 19; BAT-01, CRAC-01 and CRAC-02 appear inside the Data Center in frame 12.

## Telemetry points

Columns follow `telemetry_point` (ADR-0018). "none" means the column is null. `kind: enum` lists its `enum_values`
in the range column. "Interval" is `expected_interval_s`: a reading is stale after three intervals (ADR-0019).
Devices that report on change (leaks, positions) still send a heartbeat at that interval.

### Cooling tower (`cooling_tower`, modelled)

| `key`            | `label`           | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline | Bound part                        |
| ---------------- | ----------------- | ------ | ------- | ----------------------------- | ------------ | -------- | --------------------------------- |
| `fanSpeedRpm`    | Fan speed         | rpm    | number  | 0–1800                        | 1            | 1        | `FanBlade` · spin · y · [0, 1800] |
| `motorTempC`     | Motor temperature | °C     | number  | -20–150                       | 5            | 2        | `FanMotor` · tint                 |
| `motorCurrentA`  | Motor current     | A      | number  | 0–60                          | 5            | none     | none                              |
| `vibrationMms`   | Vibration         | mm/s   | number  | 0–50                          | 5            | none     | none                              |
| `fanSetpointRpm` | Fan set point     | rpm    | number  | 0–1800                        | 30           | none     | none                              |
| `waterInTempC`   | Water in          | °C     | number  | 0–60                          | 10           | none     | none                              |
| `waterOutTempC`  | Water out         | °C     | number  | 0–60                          | 10           | none     | none                              |
| `pumpFlowM3h`    | Pump flow         | m³/h   | number  | 0–200                         | 5            | none     | `Pump` · tint                     |
| `valveOpenPct`   | Valve opening     | %      | number  | 0–100                         | 5            | none     | `Valve` · turn · x · [0, 90]      |
| `switchState`    | Control switch    | none   | enum    | `off`, `auto`, `hand`         | 30           | none     | `Switch` · turn · x · [-35, 35]   |
| `running`        | Running           | none   | boolean | none                          | 10           | none     | none                              |
| `runHoursH`      | Run hours         | h      | number  | ≥ 0, no maximum               | 3600         | none     | none                              |

Static parts: `Casing`, `FanStack`, `Pipe`, `Riser`, `ControlPanel` (brief § Model contract).

### Standby generator (`standby_generator`, modelled)

| `key`             | `label`             | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline | Bound part                           |
| ----------------- | ------------------- | ------ | ------- | ----------------------------- | ------------ | -------- | ------------------------------------ |
| `fuelLevelPct`    | Fuel level          | %      | number  | 0–100                         | 60           | 1        | `FuelTank` · tint                    |
| `starterBatteryV` | Starter battery     | V      | number  | 0–32                          | 60           | 2        | `Battery` · tint                     |
| `coolantTempC`    | Coolant temperature | °C     | number  | -20–130                       | 10           | none     | `Engine` · tint                      |
| `engineSpeedRpm`  | Engine speed        | rpm    | number  | 0–1800                        | 2            | none     | `RadiatorFan` · spin · y · [0, 1800] |
| `alternatorKw`    | Alternator output   | kW     | number  | 0–2000                        | 5            | none     | `Alternator` · tint                  |
| `mainsVoltageV`   | Mains supply        | V      | number  | 0–500                         | 10           | none     | none                                 |
| `transferSource`  | Transfer switch     | none   | enum    | `mains`, `generator`          | 5            | none     | none                                 |
| `breakerClosed`   | Main breaker        | none   | boolean | none                          | 5            | none     | `Breaker` · turn · x · [0, 35]       |
| `controlMode`     | Control panel       | none   | enum    | `off`, `manual`, `auto`       | 30           | none     | `ControlPanel` · tint                |
| `running`         | Running             | none   | boolean | none                          | 5            | none     | none                                 |

Static part: `Enclosure` (drawn see-through, frame 08). Tank capacity (2,500 L in frame 08) and the breaker rating
(1,600 A) are asset facts, not readings; they are out of V2.0's catalogue.

### UPS (`ups`)

| `key`            | `label`        | `unit` | `kind` | Range (`min`–`max` or values) | Interval (s) | Headline |
| ---------------- | -------------- | ------ | ------ | ----------------------------- | ------------ | -------- |
| `loadPct`        | Load           | %      | number | 0–150                         | 5            | 1        |
| `autonomyMin`    | Autonomy       | min    | number | 0–600                         | 30           | 2        |
| `powerSource`    | Power source   | none   | enum   | `mains`, `battery`, `bypass`  | 5            | none     |
| `inputVoltageV`  | Input voltage  | V      | number | 0–500                         | 10           | none     |
| `outputVoltageV` | Output voltage | V      | number | 0–500                         | 10           | none     |

### UPS battery bank (`ups_battery`)

| `key`        | `label`          | `unit` | `kind` | Range (`min`–`max` or values)   | Interval (s) | Headline |
| ------------ | ---------------- | ------ | ------ | ------------------------------- | ------------ | -------- |
| `chargePct`  | Charge           | %      | number | 0–100                           | 60           | 1        |
| `roomTempC`  | Room temperature | °C     | number | -10–60                          | 60           | 2        |
| `chargeMode` | Charge mode      | none   | enum   | `float`, `boost`, `discharging` | 30           | none     |

### Precision cooling (`precision_cooling`)

| `key`            | `label`         | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| ---------------- | --------------- | ------ | ------- | ----------------------------- | ------------ | -------- |
| `supplyAirTempC` | Supply air      | °C     | number  | 0–40                          | 10           | 1        |
| `returnAirTempC` | Return air      | °C     | number  | 0–50                          | 10           | 2        |
| `humidityPct`    | Return humidity | %      | number  | 0–100                         | 30           | none     |
| `running`        | Running         | none   | boolean | none                          | 10           | none     |

### Transformer (`transformer`)

| `key`          | `label`             | `unit` | `kind` | Range (`min`–`max` or values) | Interval (s) | Headline |
| -------------- | ------------------- | ------ | ------ | ----------------------------- | ------------ | -------- |
| `loadPct`      | Load                | %      | number | 0–150                         | 10           | 1        |
| `windingTempC` | Winding temperature | °C     | number | 0–200                         | 30           | 2        |
| `oilTempC`     | Oil temperature     | °C     | number | 0–150                         | 30           | none     |

### Switchgear (`switchgear`)

| `key`           | `label`      | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| --------------- | ------------ | ------ | ------- | ----------------------------- | ------------ | -------- |
| `busVoltageKv`  | Bus voltage  | kV     | number  | 0–40                          | 10           | 1        |
| `currentA`      | Current      | A      | number  | 0–3000                        | 10           | 2        |
| `activePowerKw` | Active power | kW     | number  | 0–20000                       | 10           | none     |
| `incomerClosed` | Incomer      | none   | boolean | none                          | 5            | none     |

### Chiller (`chiller`)

| `key`                     | `label`              | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| ------------------------- | -------------------- | ------ | ------- | ----------------------------- | ------------ | -------- |
| `chilledWaterSupplyTempC` | Chilled water supply | °C     | number  | 0–20                          | 10           | 1        |
| `running`                 | Running              | none   | boolean | none                          | 10           | 2        |
| `chilledWaterReturnTempC` | Chilled water return | °C     | number  | 0–25                          | 10           | none     |
| `loadPct`                 | Load                 | %      | number  | 0–100                         | 30           | none     |

### Air handler (`air_handler`)

| `key`            | `label`          | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| ---------------- | ---------------- | ------ | ------- | ----------------------------- | ------------ | -------- |
| `indoorTempC`    | Zone temperature | °C     | number  | 0–45                          | 30           | 1        |
| `supplyAirTempC` | Supply air       | °C     | number  | 0–40                          | 30           | 2        |
| `fanSpeedPct`    | Fan speed        | %      | number  | 0–100                         | 10           | none     |
| `running`        | Running          | none   | boolean | none                          | 10           | none     |

### Booster pump (`booster_pump`)

| `key`                  | `label`            | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| ---------------------- | ------------------ | ------ | ------- | ----------------------------- | ------------ | -------- |
| `dischargePressureBar` | Discharge pressure | bar    | number  | 0–16                          | 5            | 1        |
| `running`              | Running            | none   | boolean | none                          | 5            | 2        |

### Lift (`lift`)

| `key`       | `label`    | `unit` | `kind`  | Range (`min`–`max` or values)          | Interval (s) | Headline |
| ----------- | ---------- | ------ | ------- | -------------------------------------- | ------------ | -------- |
| `carFloor`  | Car at     | none   | number  | -5–60                                  | 2            | 1        |
| `inService` | In service | none   | boolean | none                                   | 30           | 2        |
| `direction` | Direction  | none   | enum    | `up`, `down`, `idle`                   | 2            | none     |
| `doorState` | Doors      | none   | enum    | `closed`, `opening`, `open`, `closing` | 2            | none     |

### Barrier arm (`barrier_arm`)

| `key`         | `label` | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| ------------- | ------- | ------ | ------- | ----------------------------- | ------------ | -------- |
| `armPosition` | Arm     | none   | enum    | `up`, `down`, `moving`        | 5            | 1        |
| `faultActive` | Fault   | none   | boolean | none                          | 30           | none     |

### Fume hood (`fume_hood`)

| `key`            | `label`       | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| ---------------- | ------------- | ------ | ------- | ----------------------------- | ------------ | -------- |
| `faceVelocityMs` | Face velocity | m/s    | number  | 0–2                           | 5            | 1        |
| `sashOpenPct`    | Sash opening  | %      | number  | 0–100                         | 10           | 2        |
| `flowAlarm`      | Flow alarm    | none   | boolean | none                          | 5            | none     |

### Gas detector (`gas_detector`)

| `key`         | `label`           | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| ------------- | ----------------- | ------ | ------- | ----------------------------- | ------------ | -------- |
| `gasPpm`      | Gas concentration | ppm    | number  | 0–1000                        | 5            | 1        |
| `sensorFault` | Sensor fault      | none   | boolean | none                          | 60           | none     |

### Leak sensor (`leak_sensor`)

| `key`          | `label` | `unit` | `kind`  | Range (`min`–`max` or values) | Interval (s) | Headline |
| -------------- | ------- | ------ | ------- | ----------------------------- | ------------ | -------- |
| `leakDetected` | Leak    | none   | boolean | none                          | 300          | 1        |
| `batteryPct`   | Battery | %      | number  | 0–100                         | 3600         | 2        |

### Indoor climate sensor (`indoor_climate`)

| `key`         | `label`     | `unit` | `kind` | Range (`min`–`max` or values) | Interval (s) | Headline |
| ------------- | ----------- | ------ | ------ | ----------------------------- | ------------ | -------- |
| `indoorTempC` | Temperature | °C     | number | 0–45                          | 60           | 1        |
| `humidityPct` | Humidity    | %      | number | 0–100                         | 60           | 2        |

## Open questions

1. **Running and standby.** The mockups show assets as Running or Standby, but ADR-0018 does not say where that
   state comes from. Proposal: from the class's `running` point where it has one (`armPosition` `down` for barrier
   arms), otherwise always Running; Fault comes from an open incident and "No data" from freshness. Decide in V2-05.
2. **Gas detector's gas.** `gasPpm` assumes one gas per detector, named on the asset. If a detector reads several
   gases, the class needs one key per gas. Confirm with the lab safety lead before V2-05.
3. **Switch motion.** The brief's model tree draws `Switch` as "flip X ±35°", but ADR-0020's motions are `spin`,
   `turn`, `slide` and `tint`. This list uses `turn` over [-35, 35]; V2-00.10 aligns the brief.
