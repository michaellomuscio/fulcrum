// Calibration, a line-by-line port of Calibrator in core/calibrate.js (where it was proven on
// simulated builds). Phases:
//   0-2  read "up" at the servo's middle and both extremes; the extremes give the pivot axis, so the
//        gyro board can be stuck on in any orientation
//   3-4  sweep down and back up, recording beam angle against servo microseconds
//   5    ball test: tilt one way, back, and again, to learn which way rolls the ball away from the sensor
//   6    auto-level: hold the ball mid-track; the average tilt that keeps it there is true level
#pragma once
#include <Arduino.h>
#include "spec.h"
#include "imu.h"

#define CAL_POINTS (2 * SERVO_SWEEP_US / CAL_STEP_US + 1)
#define CAL_WHY_OK 0
#define CAL_WHY_NO_ROLL 1

void calLog(const char *tag, long a, long b, uint8_t nArgs);   // defined by the sketch (Serial) or the tests

static inline long jsRound(float x) { return (long)floor(x + 0.5f); }   // JavaScript's Math.round
static inline int clampi(long v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : (int)v); }
static inline int sweepUs(uint8_t i) { return SERVO_CENTER_US - SERVO_SWEEP_US + i * CAL_STEP_US; }

struct Calibrator {
  bool hasImu, done, ok, levelSure, hasTable;
  uint8_t phase, idx, n, why;
  uint16_t t, lvN;
  int16_t usLevel;
  float usPerDeg, aAcc, x0, x1, trimDeg, lvTrim, lvSum, lastU;
  float acc[3], ref[3], axis[3], gA[3];
  int16_t up[CAL_POINTS], dn[CAL_POINTS];     // hundredths of a degree
  int16_t table[CAL_TABLE_N];
  int8_t sign;
  int usN, usP;
  float rangeLo, rangeHi;

  void begin(bool imu, int16_t lvl, float perDeg) {
    memset(this, 0, sizeof(*this));
    hasImu = imu; usLevel = lvl; usPerDeg = perDeg;
    phase = imu ? 0 : 5;
    sign = 1;
  }

  float sweepAng(uint8_t i, int8_t s) { return s * (up[i] + dn[i]) * 0.005f; }

  // servo microseconds for a beam angle on the swept curve; past the measured range it stops at the end
  float usForAngle(float deg, int8_t s) {
    int best = -1;
    uint8_t loI = 0, hiI = 0;
    const float mid = (CAL_POINTS - 1) / 2.0f;
    for (uint8_t i = 0; i < CAL_POINTS; i++) {
      if (sweepAng(i, s) < sweepAng(loI, s)) loI = i;
      if (sweepAng(i, s) > sweepAng(hiI, s)) hiI = i;
      if (i + 1 >= CAL_POINTS) break;
      float a = sweepAng(i, s), b = sweepAng(i + 1, s);
      if (a == b) continue;
      if ((a - deg) * (b - deg) <= 0 && (best < 0 || fabs(i - mid) < fabs(best - mid))) best = i;
    }
    if (best < 0) return deg < sweepAng(loI, s) ? sweepUs(loI) : sweepUs(hiI);
    float a = sweepAng(best, s), b = sweepAng(best + 1, s);
    return sweepUs(best) + (deg - a) / (b - a) * CAL_STEP_US;
  }

  void reach(float &lo, float &hi) {
    lo = 0; hi = 0;
    for (uint8_t i = 0; i < CAL_POINTS; i++) { float a = sweepAng(i, 1); if (a < lo) lo = a; if (a > hi) hi = a; }
  }

  int beamToUs(float deg) {
    if (hasTable) {
      float pos = deg - CAL_TABLE_MIN_DEG;
      int i = clampi((long)floor(pos), 0, CAL_TABLE_N - 2);
      float f = pos - i;
      return clampi(jsRound(table[i] + f * (table[i + 1] - table[i])), SERVO_MIN_US, SERVO_MAX_US);
    }
    return clampi(jsRound(usLevel + deg * usPerDeg), SERVO_MIN_US, SERVO_MAX_US);
  }

  void finish(bool good, uint8_t reason) {
    done = true; ok = good; why = reason; phase = 7;
    rangeLo = 0; rangeHi = 0;
    if (hasImu && hasTable) {
      rangeLo = 99; rangeHi = -99;
      for (uint8_t i = 0; i < CAL_POINTS; i++) { float a = sweepAng(i, sign); if (a < rangeLo) rangeLo = a; if (a > rangeHi) rangeHi = a; }
    }
    calLog("CD", good ? 1 : 0, 0, 1);
    calLog("CR", jsRound(rangeLo * 100), jsRound(rangeHi * 100), 2);
  }

  // one 40 ms tick: x, v from the tracker, g = accelerometer (or null). Returns servo microseconds.
  int tick(float x, float v, const float *g) {
    t++;
    const uint16_t T = t;
    if (phase <= 2) {
      int us = phase == 0 ? SERVO_CENTER_US : (phase == 1 ? sweepUs(0) : sweepUs(CAL_POINTS - 1));
      uint16_t settle = phase == 2 ? CAL_SETTLE_TICKS + 10 : CAL_SETTLE_TICKS;
      if (T > settle && g) { for (uint8_t k = 0; k < 3; k++) acc[k] += g[k]; n++; }
      if (T >= settle + 8) {
        float u[3] = { acc[0], acc[1], acc[2] };
        unit3(u);
        if (phase == 0) memcpy(ref, u, sizeof ref);
        else if (phase == 1) memcpy(gA, u, sizeof gA);
        else {
          float c[3];
          cross3(gA, u, c);
          float s = sqrt(dot3(c, c));
          if (s < 0.035f) {                   // under 2 degrees of motion: the gyro isn't on the beam
            calLog("CE", 0, 0, 0);
            hasImu = false; phase = 5; t = 0;
            return usLevel;
          }
          memcpy(axis, c, sizeof axis);
          unit3(axis);
          calLog("CA", jsRound(atan2(s, sqrt(1 - (s < 1 ? s * s : 1))) * 57.29578f * 10), 0, 1);
        }
        acc[0] = acc[1] = acc[2] = 0; n = 0; t = 0; idx = 0; aAcc = 0;
        phase++;
      }
      return us;
    }
    if (phase == 3 || phase == 4) {           // 3 sweeps down, 4 sweeps back up
      uint8_t i = phase == 3 ? CAL_POINTS - 1 - idx : idx;
      int us = sweepUs(i);
      if (T > CAL_POINT_TICKS - 3 && g) { aAcc += imuAngle(g, ref, axis); n++; }
      if (T >= CAL_POINT_TICKS) {
        int16_t a = (int16_t)jsRound(aAcc / (n > 0 ? n : 1) * 100);
        if (phase == 3) dn[i] = a; else up[i] = a;
        calLog(phase == 3 ? "CPD" : "CPU", us, a, 2);
        t = 0; aAcc = 0; n = 0;
        if (++idx >= CAL_POINTS) { idx = 0; phase++; }
      }
      return us;
    }
    if (phase == 5) {                         // ball test: tilt P, then N, then P again
      if (T == 1) {
        if (hasImu) {
          float lo, hi;
          reach(lo, hi);
          float lim = 0.9f * (-lo < hi ? -lo : hi);
          float tilt = BALLTEST_DEG < lim ? BALLTEST_DEG : lim;
          usN = (int)jsRound(usForAngle(-tilt, 1));
          usP = (int)jsRound(usForAngle(tilt, 1));
        } else {
          usN = usLevel - BALLTEST_US;
          usP = usLevel + BALLTEST_US;
        }
      }
      lastU = 0;
      const uint16_t B = BALLTEST_TICKS;
      if (T == B) x0 = x;
      if (T == 2 * B) x1 = x;
      int us = (T <= B || T > 2 * B) ? usP : usN;
      if (T >= 3 * B) {
        float d = (x - x1) - (x1 - x0);
        int8_t s = d > BALLTEST_MIN_DX ? 1 : (d < -BALLTEST_MIN_DX ? -1 : 0);
        calLog("CB", jsRound(d * 1000), s, 2);
        if (!s) { finish(false, CAL_WHY_NO_ROLL); return us; }
        if (hasImu) {
          sign = s;
          for (uint8_t k = 0; k < CAL_TABLE_N; k++) table[k] = (int16_t)clampi(jsRound(usForAngle(CAL_TABLE_MIN_DEG + k, s)), SERVO_MIN_US, SERVO_MAX_US);
          hasTable = true;
        } else {
          usPerDeg = s * fabs(usPerDeg);
        }
        phase = 6; t = 0;
        lvTrim = 0; lvSum = 0; lvN = 0;
      }
      return us;
    }
    if (phase == 6) {                         // auto-level
      float e = x - X_CENTER;
      float uFb = -(LEVEL_KP * e + LEVEL_KD * v);
      uFb = uFb < -1 ? -1 : (uFb > 1 ? 1 : uFb);
      float eC = e < -LEVEL_E_CLAMP ? -LEVEL_E_CLAMP : (e > LEVEL_E_CLAMP ? LEVEL_E_CLAMP : e);
      lvTrim = lvTrim - LEVEL_KT * eC * DT;
      lvTrim = lvTrim < -LEVEL_MAX_DEG ? -LEVEL_MAX_DEG : (lvTrim > LEVEL_MAX_DEG ? LEVEL_MAX_DEG : lvTrim);
      float deg = uFb * THETA_MAX_DEG + lvTrim;
      lastU = deg / THETA_MAX_DEG;
      if (T > LEVEL_AVG_FROM && fabs(e) < LEVEL_BAND) { lvSum += deg; lvN++; }
      if (T >= LEVEL_TICKS) {
        levelSure = lvN > LEVEL_MIN_N;
        trimDeg = levelSure ? lvSum / lvN : 0;
        calLog("CL", jsRound(trimDeg * 100), lvN, 2);
        finish(true, CAL_WHY_OK);
      }
      return beamToUs(deg);
    }
    return beamToUs(trimDeg);
  }
};
