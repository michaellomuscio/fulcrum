// The GY-521 gyro board. ELEGOO ships it with either an MPU-6050 or a QMI8658 chip (their own
// Lesson 16 shows both), so this finds whichever is there. Only the accelerometer is used: during
// calibration it tells which way is down, and the beam's tilt comes from how that changes.
#pragma once
#include <Arduino.h>
#include <Wire.h>

#define IMU_NONE 0
#define IMU_MPU6050 1
#define IMU_QMI8658 2

static uint8_t imuAddr = 0, imuType = IMU_NONE;

static bool i2cPing(uint8_t a) {
  Wire.beginTransmission(a);
  return Wire.endTransmission() == 0;
}

static bool i2cWrite(uint8_t a, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(a);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static int i2cRead8(uint8_t a, uint8_t reg) {
  Wire.beginTransmission(a);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(a, (uint8_t)1) != 1) return -1;
  return Wire.read();
}

static bool imuBegin() {
  Wire.begin();
  Wire.setClock(400000);
  Wire.setWireTimeout(3000, true);           // a loose wire must never freeze the robot
  const uint8_t qmi[2] = { 0x6B, 0x6A };
  for (uint8_t i = 0; i < 2; i++) {
    uint8_t a = qmi[i];
    if (i2cPing(a) && i2cRead8(a, 0x00) == 0x05) {   // QMI8658 WHO_AM_I
      imuAddr = a; imuType = IMU_QMI8658;
      i2cWrite(a, 0x60, 0xB0);                // soft reset
      delay(20);
      bool ok = i2cWrite(a, 0x02, 0x40);      // CTRL1: auto-increment, little-endian
      ok &= i2cWrite(a, 0x03, 0x06);          // CTRL2: accelerometer +-2 g, ~125 Hz
      ok &= i2cWrite(a, 0x08, 0x01);          // CTRL7: accelerometer on
      delay(30);
      return ok;
    }
  }
  const uint8_t mpu[2] = { 0x68, 0x69 };
  for (uint8_t i = 0; i < 2; i++) {
    uint8_t a = mpu[i];
    if (i2cPing(a)) {
      imuAddr = a; imuType = IMU_MPU6050;
      bool ok = i2cWrite(a, 0x6B, 0x00);      // wake up
      ok &= i2cWrite(a, 0x1A, 0x04);          // 21 Hz low-pass filter
      ok &= i2cWrite(a, 0x1C, 0x00);          // +-2 g
      return ok;
    }
  }
  return false;
}

// The direction of "up" as the board sees it (any scale; only the direction matters)
static bool imuAccel(float *g) {
  if (!imuType) return false;
  Wire.beginTransmission(imuAddr);
  Wire.write(imuType == IMU_QMI8658 ? 0x35 : 0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(imuAddr, (uint8_t)6) != 6) return false;
  for (uint8_t i = 0; i < 3; i++) {
    uint8_t a = Wire.read(), b = Wire.read();
    g[i] = imuType == IMU_QMI8658 ? (int16_t)((b << 8) | a) : (int16_t)((a << 8) | b);
  }
  return true;
}

// ---- vector helpers shared with calibration --------------------------------------------
static inline float dot3(const float *a, const float *b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

static inline void cross3(const float *a, const float *b, float *c) {
  c[0] = a[1] * b[2] - a[2] * b[1];
  c[1] = a[2] * b[0] - a[0] * b[2];
  c[2] = a[0] * b[1] - a[1] * b[0];
}

static inline void unit3(float *v) {
  float n = sqrt(dot3(v, v));
  if (n < 1e-6f) n = 1;
  v[0] /= n; v[1] /= n; v[2] /= n;
}

// beam rotation in degrees about the pivot axis, relative to the reference pose (as core/calibrate.js)
static float imuAngle(const float *g, const float *ref, const float *axis) {
  float u[3] = { g[0], g[1], g[2] }, c[3];
  unit3(u);
  cross3(ref, u, c);
  return atan2(dot3(axis, c), dot3(ref, u)) * 57.29578f;
}
