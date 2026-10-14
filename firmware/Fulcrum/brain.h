// The brain lives in EEPROM: header, 8-bit weights with one float scale per layer, float
// biases, CRC-32. Inference reads the weights straight from EEPROM (no RAM copy), with the
// same order of float operations as runPacked() in core/brain.js.
#pragma once
#include <Arduino.h>
#include <EEPROM.h>
#include "spec.h"

#define BRAIN_HEADER 28

static bool brainOK = false;
static char brainName[BRAIN_NAME_LEN + 1];
static uint16_t brainLen = 0;
static float hid1[NET_H1], hid2[NET_H2];   // last activations, drawn on the LED matrix

static uint32_t crc32Update(uint32_t c, uint8_t b) {
  c ^= b;
  for (uint8_t k = 0; k < 8; k++) c = (c & 1) ? (c >> 1) ^ 0xEDB88320UL : (c >> 1);
  return c;
}

static float eeFloat(uint16_t a) { float f; EEPROM.get(a, f); return f; }

static uint16_t brainBytesFor(uint8_t nIn, uint8_t h1, uint8_t h2, uint8_t nOut) {
  return BRAIN_HEADER + (4 + h1 * nIn + 4 * h1) + (4 + h2 * h1 + 4 * h2) + (4 + nOut * h2 + 4 * nOut) + 4;
}

static uint32_t eepromCrc(uint16_t addr, uint16_t len) {
  uint32_t c = 0xFFFFFFFFUL;
  for (uint16_t i = 0; i < len; i++) c = crc32Update(c, EEPROM.read(addr + i));
  return c ^ 0xFFFFFFFFUL;
}

static bool brainValidate() {
  const uint16_t a = EE_BRAIN;
  brainOK = false;
  brainName[0] = 0;
  if (EEPROM.read(a) != BRAIN_MAGIC0 || EEPROM.read(a + 1) != BRAIN_MAGIC1) return false;
  if (EEPROM.read(a + 2) != 1 || EEPROM.read(a + 3) != SPEC_VERSION) return false;
  uint8_t nIn = EEPROM.read(a + 4), h1 = EEPROM.read(a + 5), h2 = EEPROM.read(a + 6), nOut = EEPROM.read(a + 7);
  if (nIn != NET_IN || h1 != NET_H1 || h2 != NET_H2 || nOut != NET_OUT) return false;
  uint16_t n = brainBytesFor(nIn, h1, h2, nOut);
  if (n > EE_BRAIN_MAX) return false;
  uint32_t stored;
  EEPROM.get(a + n - 4, stored);
  if (eepromCrc(a, n - 4) != stored) return false;
  for (uint8_t i = 0; i < BRAIN_NAME_LEN; i++) brainName[i] = (char)EEPROM.read(a + 8 + i);
  brainName[BRAIN_NAME_LEN] = 0;
  brainLen = n;
  brainOK = true;
  return true;
}

// out[j] = act(b[j] + scale * sum_k q[j][k] * in[k]); returns the address after this layer
static uint16_t brainLayer(uint16_t a, const float *in, uint8_t nIn, float *out, uint8_t nOut, bool squash) {
  float scale = eeFloat(a);
  a += 4;
  uint16_t w = a, b = a + (uint16_t)nIn * nOut;
  for (uint8_t j = 0; j < nOut; j++) {
    float acc = 0;
    for (uint8_t k = 0; k < nIn; k++) acc += (float)(int8_t)EEPROM.read(w++) * in[k];
    float s = eeFloat(b + 4 * j) + scale * acc;
    out[j] = squash ? tanh(s) : s;
  }
  return b + 4 * nOut;
}

static float brainRun(const float *obs) {
  if (!brainOK) return 0;
  float y;
  uint16_t a = EE_BRAIN + BRAIN_HEADER;
  a = brainLayer(a, obs, NET_IN, hid1, NET_H1, true);
  a = brainLayer(a, hid1, NET_H1, hid2, NET_H2, true);
  brainLayer(a, hid2, NET_H2, &y, NET_OUT, false);
  return y < -1 ? -1 : (y > 1 ? 1 : y);
}
