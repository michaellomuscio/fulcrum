// Settings that survive power-off: calibration, level trim, PID gains, display.
#pragma once
#include <Arduino.h>
#include <EEPROM.h>
#include "spec.h"

#define SET_MAGIC0 'F'
#define SET_MAGIC1 'S'
#define SET_VERSION 2
#define FLAG_CAL 0x01        // gyro calibration table (and reference pose) are valid
#define FLAG_AUTOSTART 0x02  // start balancing with the brain at power-up
#define FLAG_MUTE 0x04       // buzzer off
#define FLAG_CALDONE 0x08    // a calibration finished (with or without the gyro)

struct Settings {
  uint8_t magic0, magic1, version, flags;
  int16_t cal[CAL_TABLE_N];  // servo microseconds for beam angles -10..+10 degrees
  int16_t trimCdeg;          // level trim, hundredths of a degree
  int16_t usLevel;           // without the gyro: microseconds at level
  float usPerDeg;            // without the gyro: microseconds per degree (sign = direction)
  float kp, ki, kd;          // PID gains
  int8_t imuSign;            // +1 or -1: which way of the gyro's rotation rolls the ball away
  uint8_t display;           // LED matrix view
  uint8_t rotate;            // LED matrix rotation (bits 0-1) and mirror (bit 2)
  int16_t imuRef[3];         // "up" at the reference pose, x10000
  int16_t imuAxis[3];        // the pivot axis as the gyro sees it, x10000
  int16_t reachLo, reachHi;  // how far the beam can tilt, hundredths of a degree
  uint8_t sum;               // checksum
};
static_assert(sizeof(Settings) <= EE_SETTINGS_SIZE, "settings block too large");

static Settings cfg;

static uint8_t settingsSum(const Settings &s) {
  const uint8_t *p = (const uint8_t *)&s;
  uint8_t c = 0x5A;
  for (uint16_t i = 0; i < sizeof(Settings) - 1; i++) c = (uint8_t)((c << 1) | (c >> 7)) ^ p[i];
  return c;
}

static void settingsDefaults() {
  memset(&cfg, 0, sizeof(cfg));
  cfg.magic0 = SET_MAGIC0; cfg.magic1 = SET_MAGIC1; cfg.version = SET_VERSION;
  cfg.usLevel = SERVO_CENTER_US;
  cfg.usPerDeg = DEFAULT_US_PER_DEG;
  cfg.kp = PID_KP; cfg.ki = PID_KI; cfg.kd = PID_KD;
  cfg.imuSign = 1;
  for (int i = 0; i < CAL_TABLE_N; i++) cfg.cal[i] = SERVO_CENTER_US + (int)((CAL_TABLE_MIN_DEG + i) * DEFAULT_US_PER_DEG);
}

static void settingsSave() { cfg.sum = settingsSum(cfg); EEPROM.put(EE_SETTINGS, cfg); }

static bool settingsLoad() {
  EEPROM.get(EE_SETTINGS, cfg);
  if (cfg.magic0 != SET_MAGIC0 || cfg.magic1 != SET_MAGIC1 || cfg.version != SET_VERSION || cfg.sum != settingsSum(cfg)) {
    settingsDefaults();
    return false;
  }
  return true;
}
