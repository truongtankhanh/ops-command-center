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
6. **When an asset looks stale.** Freshness is decided per point (ADR-0019), but the twin greys a whole asset
   (brief § Freshness). Which points make the asset stale (any, all, or its headline points) is open; decide in V2-08.
