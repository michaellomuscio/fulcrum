#pragma once
#include "Arduino.h"
// Emulates one MPU-6050 at 0x68 (accelerometer registers only), or nothing at all.
struct TwoWire {
  uint8_t addr = 0, reg = 0, idx = 0; bool regSet = false; uint8_t txBuf[8]; uint8_t txN = 0;
  void begin() {} void setClock(long) {} void setWireTimeout(int, bool) {}
  void beginTransmission(uint8_t a) { addr = a; txN = 0; }
  void write(uint8_t v) { if (txN < 8) txBuf[txN++] = v; }
  int endTransmission(bool = true) {
    if (!sim::imuPresent || addr != 0x68) return 2;     // NACK
    if (txN >= 1) { reg = txBuf[0]; idx = 0; }
    return 0;
  }
  uint8_t requestFrom(uint8_t a, uint8_t n) { return (sim::imuPresent && a == 0x68) ? n : 0; }
  int read() {
    uint8_t r = reg + idx++;
    if (r >= 0x3B && r <= 0x40) { int axis = (r - 0x3B) / 2; uint16_t v = (uint16_t)sim::accel[axis]; return ((r - 0x3B) % 2 == 0) ? (v >> 8) : (v & 0xFF); }
    if (r == 0x75) return 0x68;
    return 0;
  }
};
extern TwoWire Wire;
