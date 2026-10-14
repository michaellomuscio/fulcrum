// Fulcrum: a cardboard ball-and-beam robot whose brain was trained in a simulator.
// Arduino Uno firmware. Every 40 ms it pings the ball, updates its tracker, asks the brain
// (or PID, or your knob) for a tilt, and moves the servo. The Gym talks to it over USB.
//
// Pins: IR 2, buzzer 3, sonar trig 7 / echo 8, servo 9, LED matrix CS 10 / DIN 11 / CLK 13,
// knob A0, gyro SDA A4 / SCL A5. Serial: 115200 baud, one command per line (see PROTOCOL.md).

#include <Servo.h>
#include <Wire.h>
#include <EEPROM.h>
#include "spec.h"
#include "tracker.h"
#include "settings.h"
#include "brain.h"
#include "factory_brain.h"
#include "ir_nec.h"
#include "matrix.h"
#include "imu.h"
#include "calibrate.h"

#define VIEW_FACE 0
#define VIEW_NEURONS 1
#define VIEW_TRACK 2
#define N_VIEWS 3

Servo servo;
Tracker trk;
Calibrator cal;

uint8_t mode = MODE_IDLE;
float target = X_CENTER;            // meters from the sensor
bool knobMode = true;               // target follows the knob until the remote or Gym sets one
float knobF = 512;
int knobAnchor = 0;
float integ = 0, a1 = 0, a2 = 0, lastU = 0;
float holdU = 0;
bool holdRaw = false;
int holdUs = SERVO_CENTER_US;
float g[3] = { 0, 0, 1 };
bool imuOk = false, gOk = false;
float beamDeg = 0;
int servoUs = SERVO_CENTER_US;
int16_t rawMm = -1;
uint8_t kind = 0;
bool telemetry = true;
uint32_t nextTick = 0, tick = 0, lastHitTick = 0, testUntil = 0;
uint16_t tickUs = 0, thinkUs = 0;
uint8_t calmTicks = 0;
bool settled = false;
bool trimDirty = false;
uint32_t trimTouched = 0;

uint8_t beepsLeft = 0;
bool buzzOn = false;
uint32_t buzzAt = 0;
uint16_t beepLen = 60;

bool uploading = false;
uint32_t upLast = 0;
uint16_t upLen = 0;

char line[100];
uint8_t lineLen = 0;

// ---------------------------------------------------------------- buzzer
void beep(uint8_t n, uint16_t len = 60, bool force = false) {
  if ((cfg.flags & FLAG_MUTE) && !force) return;
  beepsLeft = n; beepLen = len; buzzOn = false; buzzAt = millis();
}

void serviceBuzzer() {
  if (!beepsLeft && !buzzOn) return;
  uint32_t now = millis();
  if ((int32_t)(now - buzzAt) < 0) return;
  if (buzzOn) { digitalWrite(PIN_BUZZER, LOW); buzzOn = false; beepsLeft--; buzzAt = now + 70; }
  else if (beepsLeft) { digitalWrite(PIN_BUZZER, HIGH); buzzOn = true; buzzAt = now + beepLen; }
}

// ---------------------------------------------------------------- servo
// commanded beam angle (degrees, + rolls the ball away from the sensor) -> servo microseconds
int beamToUs(float deg) {
  deg += cfg.trimCdeg * 0.01f;
  if (cfg.flags & FLAG_CAL) {
    float pos = deg - CAL_TABLE_MIN_DEG;
    int i = clampi((long)floor(pos), 0, CAL_TABLE_N - 2);
    float f = pos - i;   // past the table it follows the end segment, then the servo limits
    return clampi(jsRound(cfg.cal[i] + f * (cfg.cal[i + 1] - cfg.cal[i])), SERVO_MIN_US, SERVO_MAX_US);
  }
  return clampi(jsRound(cfg.usLevel + deg * cfg.usPerDeg), SERVO_MIN_US, SERVO_MAX_US);
}

void setServoUs(int us) {
  servoUs = constrain(us, SERVO_MIN_US, SERVO_MAX_US);
  servo.writeMicroseconds(servoUs);
}

void setBeamDeg(float deg) { setServoUs(beamToUs(deg)); }

// ---------------------------------------------------------------- sensing
float pingSensor() {
  if (digitalRead(PIN_ECHO) == HIGH) return -1;   // last echo still ringing
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  uint32_t us = pulseInLong(PIN_ECHO, HIGH, ECHO_TIMEOUT_US + 1000UL);
  if (us == 0) return -1;
  return us * US_TO_M;
}

void setTargetOverride(float t) {
  target = clampf(t, TARGET_MIN, TARGET_MAX);
  knobMode = false;
  knobAnchor = (int)knobF;
}

void updateKnob() {
  int raw = analogRead(PIN_KNOB);
  knobF += 0.25f * (raw - knobF);
  if (!knobMode && abs((int)knobF - knobAnchor) > 40) { knobMode = true; Serial.println(F("EV knob")); }
  if (knobMode && mode != MODE_CAL) target = TARGET_MIN + (TARGET_MAX - TARGET_MIN) * (knobF / 1023.0f);
}

// beam angle for telemetry: degrees from level, from the gyro (needs a gyro calibration)
float measuredBeamDeg() {
  if (!gOk || !(cfg.flags & FLAG_CAL)) return lastU * THETA_MAX_DEG;
  float ref[3], axis[3];
  for (uint8_t k = 0; k < 3; k++) { ref[k] = cfg.imuRef[k] * 1e-4f; axis[k] = cfg.imuAxis[k] * 1e-4f; }
  return cfg.imuSign * imuAngle(g, ref, axis) - cfg.trimCdeg * 0.01f;
}

// ---------------------------------------------------------------- modes
void setMode(uint8_t m) {
  if (m > MODE_CAL) return;
  mode = m;
  integ = 0; a1 = 0; a2 = 0; calmTicks = 0; settled = false; holdRaw = false; holdU = 0;
  if (m == MODE_CAL) {
    cal.begin(imuOk, cfg.usLevel, cfg.usPerDeg);
    Serial.println(imuOk ? F("CS gyro") : F("CS nogyro"));
  }
  if (m == MODE_IDLE) setBeamDeg(0);
  Serial.print(F("EV mode "));
  Serial.println(m);
}

void calLog(const char *tag, long a, long b, uint8_t nArgs) {
  Serial.print(tag);
  if (nArgs > 0) { Serial.print(' '); Serial.print(a); }
  if (nArgs > 1) { Serial.print(' '); Serial.print(b); }
  Serial.println();
}

// the calibration finished: keep what it learned (a failed run changes nothing)
void applyCalibration() {
  if (cal.ok) {
    if (cal.hasImu && cal.hasTable) {
      memcpy(cfg.cal, cal.table, sizeof cfg.cal);
      cfg.imuSign = cal.sign;
      for (uint8_t k = 0; k < 3; k++) { cfg.imuRef[k] = (int16_t)jsRound(cal.ref[k] * 1e4f); cfg.imuAxis[k] = (int16_t)jsRound(cal.axis[k] * 1e4f); }
      cfg.reachLo = (int16_t)jsRound(cal.rangeLo * 100);
      cfg.reachHi = (int16_t)jsRound(cal.rangeHi * 100);
      cfg.flags |= FLAG_CAL;
    } else {
      cfg.usPerDeg = cal.usPerDeg;
      cfg.flags &= ~FLAG_CAL;
    }
    cfg.trimCdeg = cal.levelSure ? (int16_t)jsRound(cal.trimDeg * 100) : 0;
    cfg.flags |= FLAG_CALDONE;
    settingsSave();
    beep(3, 50);
  } else {
    beep(1, 600);
  }
  setMode(MODE_IDLE);
}

// ---------------------------------------------------------------- display
void updateDisplay() {
  if (testUntil) {
    if ((int32_t)(millis() - testUntil) < 0) return;
    testUntil = 0;
    matrixTest(false);
  }
  bool blink = (tick / 6) % 2;
  if (mode == MODE_CAL) drawLevel(cal.lastU * THETA_MAX_DEG);
  else if (mode == MODE_IDLE) drawFace(0, MOUTH_SLEEP);
  else if (mode == MODE_BRAIN && !brainOK) drawQuestion();
  else if (cfg.display == VIEW_NEURONS && mode == MODE_BRAIN) drawNeurons(hid1, hid2, lastU, trk.x, target, blink);
  else if (cfg.display == VIEW_TRACK) drawTrack(beamDeg, trk.x, target, blink);
  else {
    int8_t look = trk.x < X_CENTER - 0.06f ? -1 : (trk.x > X_CENTER + 0.06f ? 1 : 0);
    float e = fabs(trk.x - target);
    uint8_t mouth = settled ? MOUTH_SMILE : ((e > 0.08f || tick - lastHitTick < 25) ? MOUTH_O : MOUTH_FLAT);
    drawFace(look, mouth);
  }
  matrixShow(cfg.rotate);
}

// ---------------------------------------------------------------- telemetry
void sp(long v) { Serial.print(' '); Serial.print(v); }

void sendTelemetry() {
  uint8_t flags = (kind == 1) | ((kind == 2) << 1) | (imuOk << 2) | (brainOK << 3) | (knobMode << 4)
                  | (settled << 5) | (((cfg.flags & FLAG_CALDONE) != 0) << 6) | ((kind == 3) << 7);
  Serial.print('T');
  Serial.print(' '); Serial.print(millis());
  sp(mode); sp(rawMm);
  sp(lroundf(trk.x * 1000)); sp(lroundf(trk.v * 1000)); sp(lroundf(target * 1000));
  sp(lroundf(lastU * 1000)); sp(lroundf(integ * 1e5f)); sp(lroundf(beamDeg * 100));
  sp(servoUs); sp((long)knobF); sp(tickUs); sp(flags);
  Serial.println();
}

// ---------------------------------------------------------------- the 25 Hz tick
void controlTick() {
  uint32_t t0 = micros();
  tick++;
  float reading = pingSensor();
  rawMm = reading < 0 ? -1 : (int16_t)lroundf(reading * 1000);
  kind = trk.update(reading);
  gOk = imuOk && imuAccel(g);
  updateKnob();
  integ = stepIntegral(integ, trk.x - target);
  float e = trk.x - target;

  if (fabs(e) < 0.015f && fabs(trk.v) < 0.03f) { if (calmTicks < 255) calmTicks++; } else calmTicks = 0;
  bool nowSettled = calmTicks >= 12;
  if (nowSettled && !settled && (mode == MODE_BRAIN || mode == MODE_PID)) { beep(1, 25); Serial.println(F("EV settled")); }
  settled = nowSettled;
  if ((trk.x < 0.035f || trk.x > 0.385f) && fabs(trk.v) > 0.1f) lastHitTick = tick;

  float u = 0;
  switch (mode) {
    case MODE_BRAIN:
      if (brainOK) {
        float obs[NET_IN];
        makeObs(obs, trk.x, trk.v, target, a1, a2, integ);
        uint32_t b0 = micros();
        u = brainRun(obs);
        thinkUs = micros() - b0;
      }
      break;
    case MODE_PID: u = clampf(-(cfg.kp * e + cfg.ki * integ + cfg.kd * trk.v), -1, 1); break;
    case MODE_MANUAL: u = clampf(knobF / 511.5f - 1.0f, -1, 1); break;
    case MODE_HOLD: u = holdU; break;
    default: break;
  }
  if (mode == MODE_CAL) {
    setServoUs(cal.tick(trk.x, trk.v, gOk ? g : nullptr));
    u = cal.lastU;
  } else if (mode == MODE_HOLD && holdRaw) {
    setServoUs(holdUs);
  } else {
    setBeamDeg(u * THETA_MAX_DEG);
  }
  a2 = a1; a1 = u; lastU = u;
  beamDeg = measuredBeamDeg();

  if (tick % 2 == 0) updateDisplay();
  if (telemetry) sendTelemetry();
  if (mode == MODE_CAL && cal.done) applyCalibration();
  tickUs = micros() - t0;
}

// ---------------------------------------------------------------- brain upload
uint8_t hexNibble(char c) { return c <= '9' ? c - '0' : (c | 0x20) - 'a' + 10; }

void installFactoryBrain() {
  for (uint16_t i = 0; i < FACTORY_BRAIN_LEN; i++) EEPROM.update(EE_BRAIN + i, pgm_read_byte(FACTORY_BRAIN + i));
}

void uploadBegin(uint16_t len) {
  if (len < 32 || len > EE_BRAIN_MAX) { Serial.println(F("BERR size")); return; }
  if (mode == MODE_BRAIN || mode == MODE_CAL) setMode(MODE_IDLE);
  uploading = true; upLen = len; upLast = millis();
  brainOK = false;
  EEPROM.update(EE_BRAIN, 0);   // the old brain is invalid until the new one checks out
  Serial.println(F("BR"));
}

void uploadData(uint16_t off, const char *hex) {
  if (!uploading) { Serial.println(F("BERR state")); return; }
  uint8_t n = strlen(hex) / 2;
  if ((uint32_t)off + n > upLen) { Serial.println(F("BERR range")); return; }
  for (uint8_t i = 0; i < n; i++) EEPROM.update(EE_BRAIN + off + i, (hexNibble(hex[2 * i]) << 4) | hexNibble(hex[2 * i + 1]));
  upLast = millis();
  Serial.print(F("BA ")); Serial.println(off);
}

void uploadEnd() {
  uploading = false;
  if (brainValidate() && brainLen == upLen) {
    Serial.print(F("BOK ")); Serial.println(brainName);
    beep(3, 40);
  } else {
    Serial.println(F("BERR crc"));
  }
}

// ---------------------------------------------------------------- serial commands
void hello() {
  Serial.print(F("HI Fulcrum " FW_VERSION " spec=")); Serial.print(SPEC_VERSION);
  Serial.print(F(" brain=")); Serial.print(brainOK ? brainName : "-");
  Serial.print(F(" cal=")); Serial.print((cfg.flags & FLAG_CALDONE) ? 1 : 0);
  Serial.print(F(" gyro=")); Serial.print(imuType);
  Serial.print(F(" mode=")); Serial.print(mode);
  Serial.print(F(" think=")); Serial.println(thinkUs);
}

void printSettings() {
  Serial.print(F("CFG cal=")); Serial.print((cfg.flags & FLAG_CALDONE) ? 1 : 0);
  Serial.print(F(" table=")); Serial.print((cfg.flags & FLAG_CAL) ? 1 : 0);
  Serial.print(F(" trim=")); Serial.print(cfg.trimCdeg);
  Serial.print(F(" kp=")); Serial.print(lroundf(cfg.kp * 1000));
  Serial.print(F(" ki=")); Serial.print(lroundf(cfg.ki * 1000));
  Serial.print(F(" kd=")); Serial.print(lroundf(cfg.kd * 1000));
  Serial.print(F(" usPerDeg=")); Serial.print(lroundf(cfg.usPerDeg * 100));
  Serial.print(F(" usLevel=")); Serial.print(cfg.usLevel);
  Serial.print(F(" sign=")); Serial.print(cfg.imuSign);
  Serial.print(F(" reach=")); Serial.print(cfg.reachLo); Serial.print(','); Serial.print(cfg.reachHi);
  Serial.print(F(" view=")); Serial.print(cfg.display);
  Serial.print(F(" rot=")); Serial.print(cfg.rotate);
  Serial.print(F(" auto=")); Serial.print((cfg.flags & FLAG_AUTOSTART) ? 1 : 0);
  Serial.print(F(" mute=")); Serial.println((cfg.flags & FLAG_MUTE) ? 1 : 0);
  Serial.print(F("CFGT"));
  for (uint8_t i = 0; i < CAL_TABLE_N; i++) sp(cfg.cal[i]);
  Serial.println();
}

void ok(const char *c) { Serial.print(F("OK ")); Serial.println(c); }

void handleLine(char *s) {
  char *cmd = strtok(s, " ");
  if (!cmd) return;
  char *a = strtok(NULL, " "), *b = strtok(NULL, " "), *c = strtok(NULL, " ");
  if (!strcmp(cmd, "?")) hello();
  else if (!strcmp(cmd, "M") && a) setMode(atoi(a));
  else if (!strcmp(cmd, "C")) setMode(MODE_CAL);
  else if (!strcmp(cmd, "G") && a) { int mm = atoi(a); if (mm < 0) knobMode = true; else setTargetOverride(mm / 1000.0f); ok(cmd); }
  else if (!strcmp(cmd, "U") && a) { holdU = clampf(atoi(a) / 1000.0f, -1, 1); holdRaw = false; ok(cmd); }
  else if (!strcmp(cmd, "W") && a) { holdUs = atoi(a); holdRaw = true; ok(cmd); }
  else if (!strcmp(cmd, "T") && a) { telemetry = atoi(a) != 0; ok(cmd); }
  else if (!strcmp(cmd, "BB") && a) uploadBegin(atoi(a));
  else if (!strcmp(cmd, "BD") && a && b) uploadData(atoi(a), b);
  else if (!strcmp(cmd, "BE")) uploadEnd();
  else if (!strcmp(cmd, "BF")) {
    if (mode == MODE_BRAIN) setMode(MODE_IDLE);
    installFactoryBrain();
    if (brainValidate()) { Serial.print(F("BOK ")); Serial.println(brainName); } else Serial.println(F("BERR factory"));
  }
  else if (!strcmp(cmd, "P") && a && b && c) { cfg.kp = atol(a) * 0.001f; cfg.ki = atol(b) * 0.001f; cfg.kd = atol(c) * 0.001f; settingsSave(); ok(cmd); }
  else if (!strcmp(cmd, "L") && a) { cfg.trimCdeg = atoi(a); settingsSave(); ok(cmd); }
  else if (!strcmp(cmd, "K") && a) { cfg.usPerDeg = atol(a) * 0.01f; if (b) cfg.usLevel = atoi(b); cfg.flags &= ~FLAG_CAL; settingsSave(); ok(cmd); }
  else if (!strcmp(cmd, "S")) printSettings();
  else if (!strcmp(cmd, "R")) { settingsDefaults(); settingsSave(); ok(cmd); }
  else if (!strcmp(cmd, "A") && a) { if (atoi(a)) cfg.flags |= FLAG_AUTOSTART; else cfg.flags &= ~FLAG_AUTOSTART; settingsSave(); ok(cmd); }
  else if (!strcmp(cmd, "Q") && a) { if (atoi(a)) cfg.flags |= FLAG_MUTE; else cfg.flags &= ~FLAG_MUTE; settingsSave(); ok(cmd); }
  else if (!strcmp(cmd, "D") && a) { cfg.display = atoi(a) % N_VIEWS; if (b) cfg.rotate = atoi(b) & 7; settingsSave(); ok(cmd); }
  else if (!strcmp(cmd, "Y")) { beep(1, a ? atoi(a) : 120, true); ok(cmd); }
  else if (!strcmp(cmd, "X")) { matrixTest(true); testUntil = millis() + 1200; ok(cmd); }
  else { Serial.print(F("ERR ")); Serial.println(cmd); }
}

void pollSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (lineLen) { line[lineLen] = 0; handleLine(line); lineLen = 0; }
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = ch;
    }
  }
}

// ---------------------------------------------------------------- remote control
int8_t digitOf(uint8_t c) {
  switch (c) {
    case IR_D0: return 0; case IR_D1: return 1; case IR_D2: return 2; case IR_D3: return 3; case IR_D4: return 4;
    case IR_D5: return 5; case IR_D6: return 6; case IR_D7: return 7; case IR_D8: return 8; case IR_D9: return 9;
    default: return -1;
  }
}

void handleIR(uint8_t c) {
  Serial.print(F("IR ")); Serial.println(c, HEX);
  beep(1, 15);
  int8_t d = digitOf(c);
  if (d == 0) { knobMode = true; return; }
  if (d > 0) { setTargetOverride(TARGET_MIN + (TARGET_MAX - TARGET_MIN) * (d - 1) / 8.0f); return; }
  switch (c) {
    case IR_POWER:
    case IR_PLAY: setMode(mode == MODE_IDLE ? (brainOK ? MODE_BRAIN : MODE_PID) : MODE_IDLE); break;
    case IR_FUNC: setMode(mode == MODE_BRAIN ? MODE_PID : (mode == MODE_PID ? MODE_MANUAL : MODE_BRAIN)); break;
    case IR_UP: setTargetOverride(target + 0.01f); break;
    case IR_DOWN: setTargetOverride(target - 0.01f); break;
    case IR_VOL_UP: cfg.trimCdeg += 5; trimDirty = true; trimTouched = millis(); break;
    case IR_VOL_DOWN: cfg.trimCdeg -= 5; trimDirty = true; trimTouched = millis(); break;
    case IR_PREV: cfg.display = (cfg.display + N_VIEWS - 1) % N_VIEWS; settingsSave(); break;
    case IR_NEXT: cfg.display = (cfg.display + 1) % N_VIEWS; settingsSave(); break;
    case IR_EQ: cfg.flags ^= FLAG_MUTE; settingsSave(); break;
    case IR_REPT: setMode(MODE_CAL); break;
    default: break;
  }
}

// ---------------------------------------------------------------- setup and loop
void setup() {
  Serial.begin(SERIAL_BAUD);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  settingsLoad();
  if (!brainValidate() && FACTORY_BRAIN_LEN > 0) { installFactoryBrain(); brainValidate(); }
  matrixBegin();
  imuOk = imuBegin();
  irBegin();
  knobF = analogRead(PIN_KNOB);
  setBeamDeg(0);                     // set the pulse before attaching, so the servo doesn't twitch
  servo.attach(PIN_SERVO, SERVO_MIN_US, SERVO_MAX_US);
  hello();
  beep(2, 40);
  nextTick = micros() + DT_US;
  if ((cfg.flags & FLAG_AUTOSTART) && brainOK) setMode(MODE_BRAIN);
}

void loop() {
  pollSerial();
  int ir = irPoll();
  if (ir >= 0) handleIR(ir);
  serviceBuzzer();
  if (uploading) {
    if (millis() - upLast > 5000) { uploading = false; brainValidate(); Serial.println(F("BERR timeout")); }
    return;
  }
  if (trimDirty && millis() - trimTouched > 3000) { trimDirty = false; settingsSave(); }
  uint32_t now = micros();
  if ((int32_t)(now - nextTick) < 0) return;
  nextTick += DT_US;
  if ((int32_t)(now - nextTick) > (int32_t)DT_US) nextTick = now + DT_US;   // fell behind: resync
  controlTick();
}
