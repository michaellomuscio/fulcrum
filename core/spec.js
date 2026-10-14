// Fulcrum spec: the contract shared by the simulator (JS) and the robot (Arduino C++).
// tools/gen_spec.mjs turns this file into firmware/Fulcrum/spec.h, so the dream world and
// the real one always agree on units, timing, filters and the brain's inputs and outputs.
// All lengths are meters, angles radians unless a name says otherwise.

export const SPEC_VERSION = 1;
export const FIRMWARE_VERSION = '1.0';

// ---- timing ---------------------------------------------------------------------------
export const DT = 0.04;              // control period: 25 decisions per second
export const SUBSTEPS = 20;          // physics substeps per decision in the simulator (2 ms)

// ---- geometry (measured from the face of the ultrasonic sensor, along the track) -------
export const BALL_R = 0.020;         // ping-pong ball radius
export const TRACK_LEN = 0.42;       // sensor face to the far wall
export const X_MIN = 0.022;          // ball center when it touches the sensor plate
export const X_MAX = 0.400;          // ball center when it touches the far wall
export const PIVOT_X = 0.21;         // the skewer pivot sits under the middle of the track
export const TARGET_MIN = 0.10;      // knob and remote targets stay inside this window
export const TARGET_MAX = 0.32;

// ---- ultrasonic sensor (HC-SR04) -------------------------------------------------------
export const US_TO_M = 0.0001715;    // meters of distance per microsecond of echo (343 m/s, there and back)
export const ECHO_TIMEOUT_US = 5000; // give up after ~86 cm
export const READ_MIN = 0.015;       // readings outside this window are thrown away
export const READ_MAX = 0.60;

// ---- position filter (alpha-beta tracker, identical in sim and firmware) ---------------
export const F_ALPHA = 0.45;         // how much a new reading moves the position estimate
export const F_BETA = 0.10;          // how much it moves the velocity estimate
export const F_GATE = 0.06;          // readings this far from the prediction are treated as glitches
export const F_MAX_REJECT = 3;       // ...unless this many glitches arrive in a row (then re-lock)
export const F_V_DECAY = 0.90;       // velocity decay while coasting without a good reading
export const F_V_MAX = 1.5;
export const F_X_LO = 0.02;
export const F_X_HI = 0.42;
// the sonar's blind spot. The ball always blocks the view at least one ball-width short of the far
// wall, so a reading that reaches the wall means the ball is out of view: hiding right in front of the
// sensor, where the HC-SR04 can't see it.
export const WALL_Z = 0.42;          // a "ball center" beyond this is really the far wall...
export const BLIND_ZONE = 0.30;      // ...but only when we last saw the ball short of this (a ball resting
                                     // at the far wall can read that far with a noisy sonar)
export const NOVIS_TICKS = 8;        // this many readings in a row with no echo also means "hiding"
export const BLIND_X = 0.035;        // where we assume the ball is while it hides

// ---- brain inputs (observations) -------------------------------------------------------
// o0 error = (x - target)/E_SCALE      o3 action two steps ago
// o1 velocity = v/V_SCALE              o4 integral of error = I/I_LIM
// o2 last action                       o5 where the ball is = (x - X_CENTER)/X_SCALE
export const E_SCALE = 0.15;
export const V_SCALE = 0.40;
export const I_LIM = 0.05;           // integral clamp (meter-seconds)
export const I_BAND = 0.05;          // integrate only when within 5 cm of the target (anti-windup)
export const X_CENTER = 0.21;
export const X_SCALE = 0.15;
export const OBS_CLIP = 3.0;

// ---- brain output ----------------------------------------------------------------------
export const THETA_MAX_DEG = 7.0;    // brain output +-1 means +-7 degrees of beam tilt
export const THETA_MAX = THETA_MAX_DEG * Math.PI / 180;

// ---- network shape ---------------------------------------------------------------------
export const NET_IN = 6;
export const NET_H1 = 16;
export const NET_H2 = 16;
export const NET_OUT = 1;

// ---- servo and calibration -------------------------------------------------------------
export const SERVO_CENTER_US = 1500;
export const SERVO_SWEEP_US = 700;   // calibration sweeps 800..2200 us
export const SERVO_MIN_US = 700;
export const SERVO_MAX_US = 2300;
export const CAL_STEP_US = 50;
export const CAL_TABLE_MIN_DEG = -10; // calibration table: beam angle (whole degrees) -> servo us
export const CAL_TABLE_N = 21;        // -10..+10 degrees
export const DEFAULT_US_PER_DEG = -45; // uncalibrated guess (sign set by how the linkage is built)

// ---- calibration routine -------------------------------------------------------------
export const CAL_SETTLE_TICKS = 25;  // wait at each extreme before reading the gyro
export const CAL_POINT_TICKS = 8;    // per sweep point; the last 3 readings are averaged
export const BALLTEST_DEG = 9;       // ball test tilt (with gyro), degrees
export const BALLTEST_US = 450;      // ball test tilt without gyro, microseconds
export const BALLTEST_TICKS = 40;    // each of the ball test's three tilts (one way, back, one way again)
export const BALLTEST_MIN_DX = 0.05; // the ball must move this far for the test to count
export const LEVEL_KP = 3.0;         // auto-level: gentle PD hold mid-track...
export const LEVEL_KD = 9.0;
export const LEVEL_KT = 50.0;        // ...plus a level correction that creeps toward the ball
export const LEVEL_E_CLAMP = 0.06;
export const LEVEL_MAX_DEG = 8.0;
export const LEVEL_TICKS = 500;
export const LEVEL_AVG_FROM = 250;
export const LEVEL_BAND = 0.06;
export const LEVEL_MIN_N = 40;

// ---- EEPROM layout (1024 bytes on an Uno) ----------------------------------------------
export const EE_SETTINGS = 0;
export const EE_SETTINGS_SIZE = 128;
export const EE_BRAIN = 128;
export const EE_BRAIN_MAX = 896;
export const BRAIN_MAGIC0 = 0x46;    // 'F'
export const BRAIN_MAGIC1 = 0x42;    // 'B'
export const BRAIN_NAME_LEN = 12;

// ---- robot modes -----------------------------------------------------------------------
export const MODE = { IDLE: 0, BRAIN: 1, PID: 2, MANUAL: 3, HOLD: 4, CAL: 5 };
export const MODE_NAMES = ['idle', 'brain', 'pid', 'manual', 'hold', 'calibrate'];

// ---- default PID gains (u = -(KP*e + KI*I + KD*v), e in m, v in m/s) --------------------
export const PID_KP = 6.0;
export const PID_KI = 4.0;
export const PID_KD = 4.5;

// ---- pins (Arduino Uno) ----------------------------------------------------------------
export const PIN = {
  IR: 2, BUZZER: 3, TRIG: 7, ECHO: 8, SERVO: 9,
  MAX_CS: 10, MAX_DIN: 11, MAX_CLK: 13, KNOB: 'A0', SDA: 'A4', SCL: 'A5',
};

// ---- ELEGOO IR remote (NEC protocol command bytes) -------------------------------------
export const IR = {
  POWER: 0x45, VOL_UP: 0x46, FUNC: 0x47, PREV: 0x44, PLAY: 0x40, NEXT: 0x43,
  DOWN: 0x07, VOL_DOWN: 0x15, UP: 0x09, EQ: 0x19, REPT: 0x0D,
  D0: 0x16, D1: 0x0C, D2: 0x18, D3: 0x5E, D4: 0x08, D5: 0x1C, D6: 0x5A, D7: 0x42, D8: 0x52, D9: 0x4A,
};
export const IR_NAMES = Object.fromEntries(Object.entries(IR).map(([k, v]) => [v, k]));

export const SERIAL_BAUD = 115200;
