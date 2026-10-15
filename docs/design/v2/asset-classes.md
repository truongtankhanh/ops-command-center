# Console V2 — equipment classes and telemetry points

Status: **decided** 2026-10-09 (V2-00.5) by the tech lead, confirmed with the operations lead and the facilities
lead. The catalogue that [ADR-0018](../../adr/0018-assets-and-telemetry-as-domain-data.md) defines as tables: the
V2.0 asset classes, and for each class its `telemetry_point` rows and, for modelled classes, the parts bound to them
([ADR-0020](../../adr/0020-digital-twin-rendering-and-model-pipeline.md) `extras.bind`). V2-05 seeds these rows;
V2-13 commissions the models from them. The starting threshold rules (V2-00.6) follow the points.

Classes come from the mockups' catalogue. Ranges and intervals are set for typical campus equipment; the readings in
the mockups are illustrative sample data (brief § Notes), not limits.

## Classes

Two classes are modelled in V2.0, as drawn in frames 03 and 08. Every other class has `model_key` null and is drawn
as a neutral box from `footprint_m` (frame 15) until it gets a model; its readings, states and incidents work the
same.

| Class                 | `code`              | Model                   | `footprint_m` (W × D × H) | Demo assets            | Headline 1 · 2                        |
| --------------------- | ------------------- | ----------------------- | ------------------------- | ---------------------- | ------------------------------------- |
| Cooling tower         | `cooling_tower`     | `cooling_tower.glb`     | 4.0 × 4.0 × 5.0           | CT-01, CT-02           | `fanSpeedRpm` · `motorTempC`          |
| Standby generator     | `standby_generator` | `standby_generator.glb` | 6.0 × 2.5 × 3.0           | GEN-01                 | `fuelLevelPct` · `starterBatteryV`    |
| UPS                   | `ups`               | box                     | 2.0 × 1.0 × 2.0           | UPS-01                 | `loadPct` · `autonomyMin`             |
| UPS battery bank      | `ups_battery`       | box                     | 3.0 × 0.8 × 2.0           | BAT-01                 | `chargePct` · `roomTempC`             |
| Precision cooling     | `precision_cooling` | box                     | 1.8 × 0.9 × 2.0           | CRAC-01, CRAC-02       | `supplyAirTempC` · `returnAirTempC`   |
| Transformer           | `transformer`       | box                     | 2.5 × 2.0 × 2.5           | TR-01                  | `loadPct` · `windingTempC`            |
| Switchgear            | `switchgear`        | box                     | 6.0 × 1.0 × 2.3           | SWG-01                 | `busVoltageKv` · `currentA`           |
| Chiller               | `chiller`           | box                     | 6.0 × 2.0 × 2.5           | CH-01                  | `chilledWaterSupplyTempC` · `running` |
| Air handler           | `air_handler`       | box                     | 4.0 × 2.0 × 2.0           | AHU-C1, AHU-L1, AHU-H1 | `indoorTempC` · `supplyAirTempC`      |
| Booster pump          | `booster_pump`      | box                     | 1.2 × 0.8 × 1.2           | PMP-S1                 | `dischargePressureBar` · `running`    |
| Lift                  | `lift`              | box                     | 2.0 × 2.0 × 3.0           | LFT-A2, LFT-B1, LFT-H1 | `carFloor` · `inService`              |
| Barrier arm           | `barrier_arm`       | box                     | 4.0 × 0.4 × 1.2           | BAR-01, BAR-02         | `armPosition`                         |
| Fume hood             | `fume_hood`         | box                     | 1.8 × 0.9 × 2.4           | FH-L1                  | `faceVelocityMs` · `sashOpenPct`      |
| Gas detector          | `gas_detector`      | box                     | 1.4 × 1.4 × 1.4           | GAS-L1                 | `gasPpm`                              |
| Leak sensor           | `leak_sensor`       | box                     | 1.4 × 1.4 × 1.4           | LKS-B3                 | `leakDetected` · `batteryPct`         |
| Indoor climate sensor | `indoor_climate`    | box                     | 1.4 × 1.4 × 1.4           | nine, see Demo assets  | `indoorTempC` · `humidityPct`         |

- Footprints are typical outside dimensions. Sensors and detectors use a 1.4 m cube, as frame 15 draws the leak
  sensor, so they stay visible at campus scale.
- **Indoor climate sensor** is the one class the mockups do not list as an asset: frame 13's heat overlay colours
  every building by indoor temperature, and air handlers exist in only three of its twelve buildings. Air handlers
  and this class share the key `indoorTempC`, so the overlay reads one key.
- **Demo assets:** 22 equipment assets, plus one indoor climate sensor per building that has no air handler (nine).
  The Assets lists of the frames show all 31 (BAT-01, CRAC-01 and CRAC-02 under the Data Center). The nine sensor
  codes are final (V2-05.1): `ICS-` plus the building's zone-code suffix after `BLD-` (`ICS-DC`, `ICS-LAB`, …), as
  frame 02 draws them. The table is in [§ Demo assets](#demo-assets).
- The Model column is the **logical** file name. ADR-0020 stores `model_key` as a content-hashed
  `<class>.<hash>.glb`, which exists only after V2-13: `model_key` is `null` for every class in V2-05, and V2-13 sets
  it for the two modelled ones (a seed top-up), so the catalogue never points at a missing file.

## Demo assets

Decided 2026-10-12 (V2-05.1) by the tech lead. Codes and names are frame 02's Assets list; positions are frame 14 (the
2D plan) and `mockups/TwinScene.dc.html` (3D); a value that is not read off a frame says `unverified`. V2-05.5 seeds
this table and V2-13 commissions the models against it.

- **Position.** `East` and `North` are metres from the campus centre, east and north positive: the axes of `ZONES`
  in `apps/api/src/database/seed/campus.ts` (TwinScene's y is south-positive, so north is −y). Where frame 14 and
  TwinScene differ, the 3D anchor is used; they differ by at most 2 m.
- **Elevation** is the base of the asset above ground, in metres. The Data Center roof is 14, its building height;
  floors are 4 m apart, so level _n_ is 4 (_n_ − 1).
- **Heading.** `heading_deg` is the direction the model's front (+Z in glTF) faces, clockwise from true north; the
  footprint's width runs east–west at 0. Nothing in the design is rotated, so every demo asset is 0.
- **Zone.** An asset stands in, or within 5 m of, its zone's rectangle. `GEN-01` is 3 m east of `BLD-DC`: frame 02
  groups it under Data Center and the east yard belongs to no zone.
- **Running and standby.** The console derives the state; the API sends none. Standby when the class's `running`
  point is `false` (`cooling_tower`, `standby_generator`, `precision_cooling`, `chiller`, `air_handler`,
  `booster_pump`) or `armPosition` is `down` (`barrier_arm`); every other class is always Running. Fault comes from
  an open incident and No data from freshness.
  - Settled in V2-09.1, without changing the decision: the 1 Hz overview carries headline points only, and
    `running` is a headline point of `chiller` and `booster_pump` alone, so the overview also carries the class's
    state point (V2-09.2). The precedence of the four states and the worked examples are in
    [§ Console presentation](#console-presentation).

| Code         | Name                  | Class               | Zone         | East  | North  | `elevation_m` | `heading_deg` | Basis                                  |
| ------------ | --------------------- | ------------------- | ------------ | ----- | ------ | ------------- | ------------- | -------------------------------------- |
| `CT-01`      | Cooling tower 1       | `cooling_tower`     | `BLD-DC`     | 161   | 48     | 14            | 0             | frame 14 = TwinScene anchor; roof      |
| `CT-02`      | Cooling tower 2       | `cooling_tower`     | `BLD-DC`     | 174   | 48     | 14            | 0             | frame 14 = TwinScene anchor; roof      |
| `GEN-01`     | Standby generator     | `standby_generator` | `BLD-DC`     | 208   | 46.5   | 0             | 0             | TwinScene anchor; 3 m outside the zone |
| `UPS-01`     | UPS room              | `ups`               | `BLD-DC`     | 164.5 | 29.7   | 0             | 0             | TwinScene anchor                       |
| `BAT-01`     | UPS batteries         | `ups_battery`       | `BLD-DC`     | 179.5 | 29.7   | 0             | 0             | TwinScene box centre                   |
| `CRAC-01`    | Precision cooling 1   | `precision_cooling` | `BLD-DC`     | 190   | 50.2   | 0             | 0             | TwinScene anchor                       |
| `CRAC-02`    | Precision cooling 2   | `precision_cooling` | `BLD-DC`     | 190   | 42.25  | 0             | 0             | TwinScene box centre                   |
| `TR-01`      | Main transformer      | `transformer`       | `UTL-PLANT`  | 94    | 216    | 0             | 0             | frame 14; elevation `unverified`       |
| `SWG-01`     | Main switchgear       | `switchgear`        | `UTL-PLANT`  | 46    | 215    | 0             | 0             | frame 14; elevation `unverified`       |
| `CH-01`      | Chiller 1             | `chiller`           | `UTL-PLANT`  | 30    | 200    | 0             | 0             | frame 14; elevation `unverified`       |
| `AHU-C1`     | Air handler           | `air_handler`       | `BLD-CLINIC` | 183   | −240   | 0             | 0             | frame 14; elevation `unverified`       |
| `AHU-L1`     | Air handler, level 1  | `air_handler`       | `BLD-LIB`    | 40    | 120    | 0             | 0             | frame 14; level 1                      |
| `AHU-H1`     | Air handler, roof     | `air_handler`       | `BLD-HUB`    | −130  | 60     | 24            | 0             | frame 14; roof (Innovation Hub height) |
| `PMP-S1`     | Booster pump          | `booster_pump`      | `BLD-STU`    | 110   | −95    | 0             | 0             | frame 14; elevation `unverified`       |
| `LFT-A2`     | Lift 2                | `lift`              | `BLD-DORA`   | 60    | −172   | 0             | 0             | frame 14; shaft base                   |
| `LFT-B1`     | Lift 1                | `lift`              | `BLD-DORB`   | 152   | −170   | 0             | 0             | TwinScene anchor; shaft 0–20           |
| `LFT-H1`     | Passenger lift        | `lift`              | `BLD-HUB`    | −100  | 45     | 0             | 0             | frame 14; shaft base                   |
| `BAR-01`     | Barrier arm, inbound  | `barrier_arm`       | `GATE-MAIN`  | 8     | −252   | 0             | 0             | frame 14                               |
| `BAR-02`     | Barrier arm, service  | `barrier_arm`       | `GATE-EAST`  | 216   | −55    | 0             | 0             | frame 14                               |
| `FH-L1`      | Fume hoods, level 2   | `fume_hood`         | `BLD-LAB`    | 150   | 205    | 4             | 0             | frame 14; level 2                      |
| `GAS-L1`     | Gas detector          | `gas_detector`      | `BLD-LAB`    | 192   | 200    | 0             | 0             | frame 14; elevation `unverified`       |
| `LKS-B3`     | Leak sensor, level 3  | `leak_sensor`       | `BLD-DORB`   | 204   | −193   | 8             | 0             | TwinScene anchor; level 3              |
| `ICS-DC`     | Indoor climate sensor | `indoor_climate`    | `BLD-DC`     | 175   | 40     | 0             | 0             | zone centre; `unverified`              |
| `ICS-LHA`    | Indoor climate sensor | `indoor_climate`    | `BLD-LHA`    | −60   | −110   | 0             | 0             | zone centre; `unverified`              |
| `ICS-STU`    | Indoor climate sensor | `indoor_climate`    | `BLD-STU`    | 110   | −95    | 0             | 0             | zone centre; `unverified`              |
| `ICS-LAB`    | Indoor climate sensor | `indoor_climate`    | `BLD-LAB`    | 170   | 212    | 0             | 0             | zone centre; `unverified`              |
| `ICS-DORA`   | Indoor climate sensor | `indoor_climate`    | `BLD-DORA`   | 80    | −181.5 | 0             | 0             | zone centre; `unverified`              |
| `ICS-DORB`   | Indoor climate sensor | `indoor_climate`    | `BLD-DORB`   | 178.5 | −181.5 | 0             | 0             | zone centre; `unverified`              |
| `ICS-SPORTS` | Indoor climate sensor | `indoor_climate`    | `BLD-SPORTS` | −40   | 207    | 0             | 0             | zone centre; `unverified`              |
| `ICS-ADMIN`  | Indoor climate sensor | `indoor_climate`    | `BLD-ADMIN`  | −226  | −14    | 0             | 0             | zone centre; `unverified`              |
| `ICS-SEC`    | Indoor climate sensor | `indoor_climate`    | `BLD-SEC`    | 42    | −251.5 | 0             | 0             | zone centre; `unverified`              |

`PMP-S1` (frame 14) and `ICS-STU` (the zone's centre) land on the same point, `(110, −95)`: the pump is a 1.2 m box
in a 72 × 50 m building, and the sensor's position is a proposal, so neither is moved.

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

## Threshold rules

Decided 2026-10-09 (V2-00.6) by the tech lead, confirmed with the operations lead. Starting `telemetry_rule` rows for
V2.0, one or more per class or an explicit "no rule in V2.0". V2-05 seeds them as class rules with the catalogue, and
V2-07 evaluates them; no asset has an override at start. Rules raise only `facilities` or `environment` types
([ADR-0021](../../adr/0021-incident-categories-zone-uses-and-technician-role.md)).

- **Owner:** operations owns the values, per class, with per-asset overrides. Until an editing API exists, a change
  is a migration or a reviewed database write (ADR-0018).
- **Booleans** compare as 1 (true) and 0 (false): "true" is `above 0.5`, "false" is `below 0.5`, and `clear` equals
  `limit`. Enum points have no rules in V2.0.
- **Review** every value after the first week of real data; values that are too tight flood the feed.

| Class               | `name`                    | `key`                     | `comparator` | `limit` | `clear` | `for_s` | `severity` | `incident_type`   |
| ------------------- | ------------------------- | ------------------------- | ------------ | ------- | ------- | ------- | ---------- | ----------------- |
| `cooling_tower`     | Motor over-temperature    | `motorTempC`              | above        | 85      | 80      | 60      | critical   | `equipment_fault` |
| `cooling_tower`     | High vibration            | `vibrationMms`            | above        | 7.1     | 5.0     | 120     | high       | `equipment_fault` |
| `cooling_tower`     | Motor overcurrent         | `motorCurrentA`           | above        | 24      | 22      | 60      | high       | `equipment_fault` |
| `standby_generator` | Low fuel                  | `fuelLevelPct`            | below        | 25      | 30      | 300     | high       | `equipment_fault` |
| `standby_generator` | Low starter battery       | `starterBatteryV`         | below        | 24.0    | 25.0    | 300     | high       | `equipment_fault` |
| `standby_generator` | Coolant too cold to start | `coolantTempC`            | below        | 30      | 35      | 600     | medium     | `equipment_fault` |
| `ups`               | UPS overload              | `loadPct`                 | above        | 90      | 80      | 300     | high       | `equipment_fault` |
| `ups`               | Low battery autonomy      | `autonomyMin`             | below        | 10      | 15      | 30      | critical   | `equipment_fault` |
| `ups_battery`       | Battery room too warm     | `roomTempC`               | above        | 30      | 27      | 600     | medium     | `hvac_fault`      |
| `precision_cooling` | High supply air           | `supplyAirTempC`          | above        | 27      | 25      | 300     | high       | `hvac_fault`      |
| `transformer`       | Transformer overload      | `loadPct`                 | above        | 100     | 90      | 600     | high       | `equipment_fault` |
| `transformer`       | Winding over-temperature  | `windingTempC`            | above        | 120     | 110     | 300     | high       | `equipment_fault` |
| `switchgear`        | Bus undervoltage          | `busVoltageKv`            | below        | 19.8    | 20.9    | 10      | critical   | `power_outage`    |
| `chiller`           | High chilled water supply | `chilledWaterSupplyTempC` | above        | 10      | 8       | 600     | high       | `hvac_fault`      |
| `air_handler`       | Zone too warm             | `indoorTempC`             | above        | 27      | 25      | 900     | medium     | `hvac_fault`      |
| `booster_pump`      | Low discharge pressure    | `dischargePressureBar`    | below        | 2.0     | 2.5     | 120     | medium     | `equipment_fault` |
| `lift`              | Lift out of service       | `inService`               | below        | 0.5     | 0.5     | 300     | medium     | `equipment_fault` |
| `barrier_arm`       | Barrier fault             | `faultActive`             | above        | 0.5     | 0.5     | 30      | low        | `equipment_fault` |
| `fume_hood`         | Low face velocity         | `faceVelocityMs`          | below        | 0.4     | 0.45    | 60      | high       | `hvac_fault`      |
| `gas_detector`      | Gas detector fault        | `sensorFault`             | above        | 0.5     | 0.5     | 60      | medium     | `equipment_fault` |
| `leak_sensor`       | Water leak                | `leakDetected`            | above        | 0.5     | 0.5     | 10      | medium     | `water_leak`      |
| `leak_sensor`       | Leak sensor battery low   | `batteryPct`              | below        | 20      | 25      | 3600    | low        | `equipment_fault` |
| `indoor_climate`    | No rule in V2.0           |                           |              |         |         |         |            |                   |

- The cooling tower's motor rule is the one drawn in frames 04 and 10; the generator's fuel and battery limits and
  the leak sensor's battery limit are the ones its inspector shows (frames 08, 15).
- **One detector per outage.** Only the switchgear raises `power_outage` (22 kV nominal, alarm at −10 %, clear at
  −5 %). The generator and UPS see the same outage; rules on them would open two more incidents for one event.
- **Lift entrapment** has no rule: the points cannot tell a stuck car with people inside from a car out of service.
  Entrapments stay reported by people or the lift's own alarm.
- **Gas concentration** has no rule: a gas alarm is a `gas_leak`, in the `fire_safety` category, which telemetry
  rules may not raise (ADR-0021). The gas detection panel keeps its own alarm path; only the detector's fault is
  watched here (open question 4, decided).
- **Indoor climate** feeds the heat overlay only; comfort alerts would flood the feed.

## Console presentation

Decided 2026-10-14 (V2-09.1) by the tech lead: every proposal of the task is accepted as written. This is how the
Assets list and the inspector turn the catalogue above into words, rows and an order. Frames 02, 03, 08 and 15 draw
more than the data of Phase 2 supports; where they disagree with this section, this section wins and the brief's
[Frames to revise](brief.md#frames-to-revise-after-phase-0) table says so. A rule marked `unverified` is a
clarification the task did not spell out.

### State of an asset

One word per asset, the first match of:

| #   | State                 | When                                                                                 |
| --- | --------------------- | ------------------------------------------------------------------------------------ |
| 1   | **Fault**             | an unresolved incident whose `assetId` is the asset                                  |
| 2   | **No data** / Offline | the asset is stale, or its device's last will fired (ADR-0019, § Freshness; V2-08.1) |
| 3   | **Standby**           | the class's state point says so: `running` is `false`, or `armPosition` is `down`    |
| 4   | **Running**           | anything else                                                                        |

- **A fault is never hidden by a stale reading.** An asset with an open incident reads Fault even when it is also
  stale; its values stay drawn as stale. The Assets tab's `Faults` tab holds the faults, and its `No data` tab holds
  No data and Offline.
- **The state point** of a class is `running` for `cooling_tower`, `standby_generator`, `precision_cooling`,
  `chiller`, `air_handler` and `booster_pump`, and `armPosition` for `barrier_arm`. The other classes (`ups`,
  `ups_battery`, `transformer`, `switchgear`, `lift`, `fume_hood`, `gas_detector`, `leak_sensor`, `indoor_climate`)
  have none and are Running whenever rules 1 and 2 do not match.
- **Where it comes from.** The overview carries the state point of every asset, whatever its headline rank (V2-09.2,
  additive): four classes (`cooling_tower`, `standby_generator`, `precision_cooling`, `air_handler`; eight demo
  assets) gain one boolean each. The console derives the state as above; the API sends none. Where the class has a
  state point and its value is absent (an API from before V2-09.2, or no reading yet) the list draws **no state
  word**: it never says Running for an asset it does not know. Rejected: showing the state only for the inspected
  asset (the list would be wrong for all the rest), and an API-computed `state` (contradicts "the API sends no
  state").

Worked examples, from the demo catalogue:

| Asset  | Facts                                                                          | State       | Reads in the list                |
| ------ | ------------------------------------------------------------------------------ | ----------- | -------------------------------- |
| CT-02  | no incident, fresh, `running` is `false`                                       | **Standby** | "CT-02 · Standby · 0 rpm" (02)   |
| GEN-01 | frame: no incident, `running` `false`, 86 % fuel                               | **Standby** | "86 % fuel" (02)                 |
| GEN-01 | with an open "Low fuel" incident, and its reading older than 180 s             | **Fault**   | the fault, values drawn stale    |
| LKS-B3 | the "Water leak" incident is open (`leakDetected` true, "Wet"); no state point | **Fault**   | "Fault · INC-000108", "Wet" (15) |

The second GEN-01 row is a hypothetical (the mock scenario scripts breaches of `CT-01` and `LKS-B3` only); it shows
rule 1 over rule 2, because the generator's threshold is 3 × 60 s (§ open question 6). Without the incident LKS-B3
would read Running: a leak sensor has no state point.

### Parts of an asset

A code-owned table, `lib/assetParts.ts` in the console, for the two modelled classes only: the part's role, its label
and the point it is bound to, taken from the Bound part columns above. **It is temporary**: V2-14 removes it when the
model's `extras` supply the bindings (ADR-0020), and a class without a model has **no Parts section** (frame 15).
A label is the node name in sentence case; where frames 03 and 08 spell a part otherwise, the table's word stands
(settled in V2-09.9: frame 08 draws `Battery` and `Main breaker`, the table says "Starter battery" and "Breaker").

| Class               | Node (role)    | Label           | Point             | Motion |
| ------------------- | -------------- | --------------- | ----------------- | ------ |
| `cooling_tower`     | `FanBlade`     | Fan blade       | `fanSpeedRpm`     | spin   |
| `cooling_tower`     | `FanMotor`     | Fan motor       | `motorTempC`      | tint   |
| `cooling_tower`     | `Pump`         | Pump            | `pumpFlowM3h`     | tint   |
| `cooling_tower`     | `Valve`        | Valve           | `valveOpenPct`    | turn   |
| `cooling_tower`     | `Switch`       | Switch          | `switchState`     | turn   |
| `standby_generator` | `FuelTank`     | Fuel tank       | `fuelLevelPct`    | tint   |
| `standby_generator` | `Battery`      | Starter battery | `starterBatteryV` | tint   |
| `standby_generator` | `Engine`       | Engine          | `coolantTempC`    | tint   |
| `standby_generator` | `RadiatorFan`  | Radiator        | `engineSpeedRpm`  | spin   |
| `standby_generator` | `Alternator`   | Alternator      | `alternatorKw`    | tint   |
| `standby_generator` | `Breaker`      | Breaker         | `breakerClosed`   | turn   |
| `standby_generator` | `ControlPanel` | Control panel   | `controlMode`     | tint   |

"Radiator" is frame 08's word, not the node name's; "Starter battery" names what the point is, as `starterBatteryV`
does.

Settled 2026-10-15 (V2-09.9) by the tech lead: every proposal of the analysis is accepted as written.

- **Static parts are rows.** The ones a frame draws are listed with the table's bound parts, in the frames' order,
  and read "static": `Casing`, `FanStack` and `ControlPanel` on the cooling tower, `Enclosure` on the generator
  (frame 08's "see-through" describes the 3D view, which the inspector does not have). `Pipe` and `Riser` of the
  brief's tree are in no frame and have no row. A part another part sits under (`FanStack`, `ControlPanel`) is
  drawn open, with the children one level in: `FanBlade` under `FanStack`, `Switch` under `ControlPanel` on the
  tower and `Breaker` under `ControlPanel` on the generator.
- **A part shows its one bound reading**, written as a readings row writes it ("1,420 rpm", "41 °C", "86 %",
  "Auto", "Open"), "—" while it has none, and "last 1,420 rpm" while the asset is not live. Not built, because
  there is no single bound reading behind them: frame 08's "stopped · 41 °C" and "fan stopped", frame 03's
  "71 °C · 18.6 A", "64 % open" and "On · Auto".
- **Rows are read, not chosen.** A row is a `treeitem` and not a button until V2-15 makes parts selectable; the
  list has one tab stop and the arrow keys, Home and End move through it.
- **The section is keyed on the class being in this table**, not on the class's model: `model_key` is `null` for
  every class until V2-13, so the table says which classes are modelled. A class that is in no table and has a model
  gets neither the section nor the "No 3D model" note.

### Reading rows

- **Order.** The headline points (rank 1, 2), then the points a rule watches (in catalogue order), then the rest
  behind a disclosure labelled "All points (n)", `n` being the number of rows inside it. The set point
  (`fanSetpointRpm`) is one more row, not a sub-line of the fan speed.
- **The line under a label** is the rule on that point: `above` → "Limit {limit} {unit}", `below` →
  "Low at {limit} {unit}" (frame 08). A point with no rule has no line. A boolean point has no line either
  (`unverified`): its rule's 0.5 is an encoding (ADR-0018), not a number an operator reads.
- **Not built, because there is no data:** "Rated 22 A" and the generator's capacity "2,150 of 2,500 L" (a rating and
  a capacity are asset facts, out of the catalogue); "ΔT 5.1 °C" and the merged "Water in / out" row (the two points
  are two rows); "Since 15:17" under a leak (the age of a reading is shown instead, V2-08.1); frame 15's "Replace
  below 20 %" (wording, not data: the line reads "Low at 20 %").
- **Worked example, `CT-01`:** Fan speed, Motor temperature ("Limit 85 °C"); Vibration ("Limit 7.1 mm/s"), Motor
  current ("Limit 24 A"); then "All points (8)": Fan set point, Water in, Water out, Pump flow, Valve opening, Control
  switch, Running, Run hours.

### Words for values

A table by point `key`, in `lib/readingLabels.ts`; any other boolean reads "Yes" / "No", and any other enum value in
sentence case. A value this table does not know is drawn as it came (types, kinds and values can arrive from a newer
API first). A follow-up may move the words into the catalogue (a column and a migration) if a site needs its own.

| `key`           | Value                    | Word                        |
| --------------- | ------------------------ | --------------------------- |
| `leakDetected`  | `true` · `false`         | Wet · Dry                   |
| `inService`     | `true` · `false`         | In service · Out of service |
| `running`       | `true` · `false`         | Running · Stopped           |
| `armPosition`   | `up` · `down` · `moving` | Up · Down · Moving          |
| `carFloor`      | _n_                      | Floor _n_                   |
| `breakerClosed` | `true` · `false`         | Closed · Open               |

### Place line

The line under an asset's name is "{zone name}", then, for an asset in a `building` zone (`unverified`: roof and
level are building terms): "roof" when `elevationM` equals the zone's `heightM`, else "level _n_" when `elevationM`
is a multiple of 4, with _n_ = `elevationM` / 4 + 1 (floors are 4 m apart, § Demo assets). Nothing else is invented:
"east yard" and "riser cupboard" are not data. A zone with no `heightM` has no roof.

| Asset    | `elevation_m` | Zone `heightM` | Line                  |
| -------- | ------------- | -------------- | --------------------- |
| `CT-01`  | 14            | 14             | Data Center · roof    |
| `AHU-H1` | 24            | 24             | Innovation Hub · roof |
| `FH-L1`  | 4             | 16             | Science Lab · level 2 |
| `LKS-B3` | 8             | 20             | Dormitory B · level 3 |
| `AHU-L1` | 0             | 18             | Library · level 1     |
| `BAR-01` | 0             | none (a gate)  | Main Gate             |

### Order, filter and search

- **Order.** Groups by zone name A–Z (`localeCompare`), assets by `code` within a group. Frame 02's order (Data
  Center, Utility Plant, Dormitory B, Dormitory A, …) is curated, not data. The 31 demo assets fall in 15 groups: Admin
  Building, Data Center, Dormitory A, Dormitory B, East Gate, Health Clinic, Innovation Hub, Lecture Hall A, Library,
  Main Gate, Science Lab, Security office, Sports Hall, Student Center, Utility Plant.
- **Zone filter.** A group header is a button that sets the filter chip ("Data Center only"), cleared by its ×. The
  building level of V2-15 sets the same filter; there is no zone click on the map in this phase.
- **Search** matches the asset's name, code and zone name, folding case and accents as `searchTerms` does for
  incidents.

### List words

Settled 2026-10-15 (V2-09.6) by the tech lead: every proposal of the analysis is accepted as written. What a row of
the Assets list and its notice say, where the sections above give the state and the order but not the words. All of it
is in `lib/assetList.ts`.

- **A row** reads the asset's name, its **first headline reading** (`values` over the overview's `headline`, "—" when
  there is none), then the state and the code. The state word is the one of § State of an asset, with what makes it
  exact:

  | State     | Reads in the list    | When there is no age or code to give |
  | --------- | -------------------- | ------------------------------------ |
  | Fault     | "Fault · INC-000108" | "Fault"                              |
  | No data   | "No data · 1 min"    | "No data" (no entry for the asset)   |
  | Offline   | "Offline · 3 min"    | "Offline"                            |
  | Standby   | "Standby"            |                                      |
  | Running   | "Running"            |                                      |
  | (unknown) | no word and no glyph |                                      |

  The age is the reading's, on the API's clock, in the list's coarse form (`12 s`, `1 min`, `1 h`). A stale or offline
  asset's value is dimmed, **also under a fault**: the incident is never hidden by a stale reading, and its values
  are still drawn as stale.

- **Staleness is the asset's own.** Nothing forces every row to No data while telemetry is paused: a row turns No
  data when its own threshold has passed (open question 6). The notice, not the rows, says at once that
  nothing is live.
- **The notice** above the list, with a `Clock` glyph: "Readings as of {HH:MM:SS} — not updating" while the API's
  source is paused or the console's own socket is down, the time being the newest `receivedAt` of the overview
  (the API's clock; with none, the pause time the API gave, or the time the socket was lost); "No readings:
  telemetry is unavailable" on an API without `/telemetry`. Nothing while connecting or live.
- **Zones.** The group of assets whose zone this console does not have is **"Other zones"**, listed last, and has no
  zone to filter by, so its header is text. While a zone chip is on, the one group's header is text too: the chip is
  the control.
- **A class this build does not know** draws the unknown glyph and its raw class code (`mystery_pump`) after the
  state; its value is whatever its own headline point gives, and "—" when there is none.
- **Empty tabs** say why: "No assets have a fault.", "No assets are without data.", `No assets match "{query}".`,
  "No assets in {zone name}." (and "…in {zone} have a fault." / "…are without data." when a tab is chosen too).

### Inspector words

Settled 2026-10-15 (V2-09.8) by the tech lead: every proposal of the analysis is accepted as written. What the
inspector sheet says, where the sections above give the rows and the state but not the words. The pure part is
`lib/assetInspector.ts`.

- **The head** reads "{code} · {class name}", the name, then three badges: the state pill, the place line and the
  incident badge. The pill is the state of § State of an asset with no age: "Fault", "Running", "Standby",
  "No data since 15:41" and "Offline since 15:41" (the time of the last reading, `HH:MM`, with the date when it is
  not the API's day), and nothing for an asset the console cannot judge. The incident badge is "No open incidents"
  or "Fault · INC-000108", and is not said while the incident list is loading. A class-specific word such as
  `controlMode` is **not** appended to the pill: it is an ordinary row ("Control mode", "Auto").
- **Readings.** The eyebrow is "Live readings" with "Updated 0.4 s ago" beside it while the asset is live, and
  "Last readings" with "1 min 12 s old" when it is stale or offline. The age is the asset's own, never a point's: the
  API sends a key only when its value changes, so a steady key's age would read "old" on a healthy device.
  A stale asset also dims every value, stops every sparkline at its last reading, and says "Charts stop at the
  last reading; the gap is the outage."
- **Rows** are § Reading rows: headline points, points a rule watches, then the rest behind "All points (n)". A
  number or a boolean point draws a sparkline of the last 15 minutes (a boolean steps and has no limit line); an
  enum point draws its value only. A point with no reading yet reads "—" and draws no sparkline. A value past its
  rule's limit is drawn in the rule's severity, and a visually hidden "over its limit" says it too.
- **A live series is extended to now.** The API sends changed keys only, so a steady key's newest point can be
  minutes old; the inspector adds its latest value at the server's time while live, and does not when stale.
- **States of the sheet.** Loading draws skeleton rows shaped like the head; an asset that no longer exists reads
  "This asset no longer exists."; a rate limit and a failed load are the incident detail's.

Settled 2026-10-15 (V2-09.9), the three blocks below the readings:

- **Parts** are § Parts of an asset: the modelled classes only, below the readings.
- **The incident section** lists the asset's unresolved incidents as the feed draws them, most severe first, and is
  titled "Incident raised by this asset" ("Incidents raised …" for several). Nothing resolved is listed, and with
  none open there is no section (the head's "No open incidents" says it). It is not drawn while the incident list
  loads. "Open INC-000108" sits under the first row, in the section, and names the incident the head names;
  opening an incident closes the inspector, and the incident sheet's own footer decides what the user may do.
- **The no-model note** is for a class that is in no part table and has no model: a "No 3D model" chip in the head
  and an "In the twin" section: "This asset class has no model yet, so it is drawn as a 1.4 × 1.4 × 1.4 m neutral
  box at its position. Its readings, states and incident work exactly as for modelled assets." The size is the
  class's footprint, width × depth × height.

## Open questions

1. ~~**Running and standby.** The mockups show assets as Running or Standby, but ADR-0018 does not say where that
   state comes from. Proposal: from the class's `running` point where it has one (`armPosition` `down` for barrier
   arms), otherwise always Running; Fault comes from an open incident and "No data" from freshness. Decide in V2-05.~~
   **Decided 2026-10-12 (V2-05.1):** the proposal. The console derives the state and the API sends none; see
   § Demo assets.
2. **Gas detector's gas.** `gasPpm` assumes one gas per detector, named on the asset. If a detector reads several
   gases, the class needs one key per gas. Confirm with the lab safety lead before V2-05.
   **Deferred 2026-10-12 (V2-05.1):** V2-05 seeds one gas per detector, named on the asset ("Gas detector", as frame
   02). The gas of `GAS-L1` is for the lab safety lead to name; date not set. Nothing in V2-05 – V2-07 reads `gasPpm`
   (no rule), so this blocks nothing.
3. ~~**Switch motion.** The brief's model tree draws `Switch` as "flip X ±35°", but ADR-0020's motions are `spin`,
   `turn`, `slide` and `tint`. This list uses `turn` over [-35, 35]; V2-00.10 aligns the brief.~~
   **Closed 2026-10-09 (V2-00.10):** the brief now draws `Switch` as `turn X ±35°`.
4. ~~**Telemetry and fire safety.** A gas detector over its limit is a fire-safety event, handled by operators, but
   ADR-0021 lets telemetry rules raise only `facilities` and `environment` types. Allowing `gas_leak` for telemetry
   would change ADR-0021; decide in V2-00.8. Until then, gas concentration raises no incident from the console.~~
   **Decided 2026-10-09 (V2-00.8):** no. Gas alarms stay with the gas detection panel; telemetry never raises a
   `fire_safety` type, so `gas_detector` keeps only its fault rule.
5. **Booleans and enums in bindings.** The worker posts one `Float32Array` of targets (ADR-0020), but `switchState`
   (`enum`) and `breakerClosed` (`boolean`) drive `turn` parts. Neither ADR says how such a value becomes a number
   (for example 0 / 1, and an enum's index in `enum_values`, mapped onto `range`). Decide in V2-14.
6. ~~**When an asset looks stale.** Freshness is decided per point (ADR-0019), but the twin greys a whole asset
   (brief § Freshness). Which points make the asset stale (any, all, or its headline points) is open; decide in V2-08.~~
   **Decided 2026-10-14 (V2-08.1)** by the tech lead:
   - **An asset is stale** when the age of its latest reading is at least **3 × the shortest `expectedIntervalS`
     among its headline points** (rank 1 and 2), with a **floor of 5 s**. The overview carries one `receivedAt` per
     asset and headline values only, so that is the only freshness an unwatched asset has; the headline points are the
     ones a device sends most often. A watched asset also gets a per-point age from its frames, shown beside each
     reading.
   - **Age is measured on the server's clock** (`overview.at` plus the monotonic time since that overview arrived),
     never on the browser's, so a skewed laptop cannot grey the campus.
   - **`online: false`** (the device's last will) is `Offline`, same look as stale, labelled "Offline since HH:MM"
     where stale says "No data since HH:MM".
   - Worked examples, from the points above:

     | Asset                      | Headline intervals (s) | 3 × shortest | Threshold |
     | -------------------------- | ---------------------- | ------------ | --------- |
     | Cooling tower (CT-01)      | 1, 5                   | 3 s          | **5 s**   |
     | Lift (LFT-B1)              | 2, 30                  | 6 s          | 6 s       |
     | UPS (UPS-01)               | 5, 30                  | 15 s         | 15 s      |
     | Gas detector (GAS-L1)      | 5                      | 15 s         | 15 s      |
     | Indoor climate (ICS-DC)    | 60, 60                 | 180 s        | 180 s     |
     | Standby generator (GEN-01) | 60, 60                 | 180 s        | 180 s     |
     | Leak sensor (LKS-B3)       | 300, 3600              | 900 s        | 900 s     |

     The leak sensor is why the slowest headline is not used: `batteryPct` reports hourly and would keep a dead sensor
     "live" for three hours.
