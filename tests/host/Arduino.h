// Minimal stand-in for Arduino.h so firmware headers compile on a desktop for testing.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <algorithm>
using std::min; using std::max;
#define PROGMEM
#define F(x) x
inline uint8_t pgm_read_byte(const uint8_t *p) { return *p; }
template <class T> T constrain(T v, T lo, T hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline unsigned long micros() { return 0; }
inline unsigned long millis() { return 0; }
inline void delay(unsigned long) {}
// Wire stub: the calibrator only borrows imu.h's vector helpers
struct TwoWire {
  void begin() {} void setClock(long) {} void setWireTimeout(int, bool) {}
  void beginTransmission(uint8_t) {} int endTransmission(bool = true) { return 1; }
  void write(uint8_t) {} uint8_t requestFrom(uint8_t, uint8_t) { return 0; } int read() { return 0; }
};
static TwoWire Wire;
