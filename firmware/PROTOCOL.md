# Fulcrum serial protocol

USB serial at 115200 baud, one ASCII command per line (newline-terminated). The Gym speaks this;
you can too, from the Gym's Serial log box or any serial terminal.

## Commands (computer → robot)

| Command | Meaning | Reply |
|---|---|---|
| `?` | hello | `HI Fulcrum <fw> spec=<n> brain=<name or -> cal=<0/1> gyro=<0 none, 1 MPU-6050, 2 QMI8658> mode=<n> think=<µs>` |
| `M <n>` | mode: 0 rest, 1 brain, 2 PID, 3 knob tilts the beam, 4 hold, 5 calibrate | `EV mode <n>` |
| `C` | calibrate (same as `M 5`) | calibration lines, below |
| `G <mm>` | set the target, millimeters from the sensor; `G -1` gives it back to the knob | `OK G` |
| `U <milli>` | in hold mode, tilt command −1000..1000 (±7°) | `OK U` |
| `W <µs>` | in hold mode, raw servo pulse | `OK W` |
| `T <0/1>` | telemetry off/on | `OK T` |
| `BB <len>` | begin a brain upload of `<len>` bytes | `BR` (or `BERR size`) |
| `BD <offset> <hex>` | brain bytes at an offset (24 bytes per line is what the Gym sends) | `BA <offset>` (or `BERR …`) |
| `BE` | finish: checks the brain's CRC-32 and shape | `BOK <name>` or `BERR crc` |
| `BF` | restore the starter brain | `BOK starter` |
| `P <kp> <ki> <kd>` | PID gains, each ×1000 | `OK P` |
| `L <cdeg>` | level trim, hundredths of a degree | `OK L` |
| `K <usPerDeg×100> [usLevel]` | servo map without the gyro | `OK K` |
| `S` | print settings | `CFG …` and `CFGT …` |
| `R` | reset settings to defaults | `OK R` |
| `A <0/1>` | start balancing at power-up | `OK A` |
| `Q <0/1>` | mute | `OK Q` |
| `D <view> [rot]` | LED matrix view 0 face, 1 neurons, 2 track; rotation 0–3, +4 mirrors | `OK D` |
| `Y [ms]` | beep | `OK Y` |
| `X` | all LEDs on for a second | `OK X` |

## Telemetry (robot → computer, 25 per second)

`T <ms> <mode> <raw_mm> <x_mm> <v_mm/s> <target_mm> <u×1000> <I×1e5> <angle×100> <servo_µs> <knob> <tick_µs> <flags>`

- `raw_mm`: the sonar reading (−1 for no echo); `x_mm`, `v_mm/s`: the tracker's estimate of the ball.
- `u`: the tilt command (±1 = ±7°); `I`: the integral of the miss, in meter-seconds.
- `angle`: the beam angle from the gyro (after calibration), else the commanded angle.
- `flags` bits: 1 reading used, 2 tracker re-locked, 4 gyro found, 8 brain loaded, 16 target follows the knob,
  32 ball settled, 64 calibrated, 128 ball hiding in the sonar's blind spot.

Other lines: `IR <hex>` (remote button), `EV settled`, `EV knob`, `EV mode <n>`.

## Calibration lines

`CS gyro|nogyro` start · `CA <tenths of a degree>` total swing seen by the gyro · `CE` gyro saw no motion ·
`CPD <µs> <cdeg>` / `CPU <µs> <cdeg>` sweep points (down, then up) · `CB <mm> <sign>` ball test ·
`CL <trim cdeg> <samples>` auto-level · `CD <ok>` done · `CR <lo cdeg> <hi cdeg>` how far the beam can tilt.

## Brain format (544 bytes, little-endian)

| Offset | Bytes | Field |
|---|---|---|
| 0 | 2 | magic `F` `B` |
| 2 | 1 | format version (1) |
| 3 | 1 | spec version (must match the firmware) |
| 4 | 4 | layer sizes: 6, 16, 16, 1 |
| 8 | 12 | name (ASCII, zero padded) |
| 20 | 4 | created (Unix seconds) |
| 24 | 4 | exam score (float) |
| 28 | … | per layer: float scale, int8 weights (out × in, row-major), float biases |
| end − 4 | 4 | CRC-32 of everything before it |

Stored in EEPROM at byte 128. Settings and calibration live in bytes 0–127.
