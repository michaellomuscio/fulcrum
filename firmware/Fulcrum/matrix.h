// MAX7219 8x8 LED matrix: Fulcrum's face, its neurons, or a tiny copy of the beam.
#pragma once
#include <Arduino.h>
#include "spec.h"

static uint8_t mx[8];   // the picture, row 0 = top, bit 7 = leftmost column

static void maxWrite(uint8_t reg, uint8_t val) {
  digitalWrite(PIN_MAX_CS, LOW);
  shiftOut(PIN_MAX_DIN, PIN_MAX_CLK, MSBFIRST, reg);
  shiftOut(PIN_MAX_DIN, PIN_MAX_CLK, MSBFIRST, val);
  digitalWrite(PIN_MAX_CS, HIGH);
}

static void matrixBegin() {
  pinMode(PIN_MAX_CS, OUTPUT);
  pinMode(PIN_MAX_DIN, OUTPUT);
  pinMode(PIN_MAX_CLK, OUTPUT);
  digitalWrite(PIN_MAX_CS, HIGH);
  maxWrite(0x0F, 0);   // display test off
  maxWrite(0x09, 0);   // raw pixels, no digit decoding
  maxWrite(0x0B, 7);   // scan all 8 rows
  maxWrite(0x0A, 2);   // brightness 0..15
  maxWrite(0x0C, 1);   // wake up
  for (uint8_t r = 0; r < 8; r++) maxWrite(r + 1, 0);
}

static void matrixTest(bool on) { maxWrite(0x0F, on ? 1 : 0); }

static inline void px(uint8_t r, int8_t c) { if (r < 8 && c >= 0 && c < 8) mx[r] |= 0x80 >> c; }

// rot: bits 0-1 = quarter turns, bit 2 = mirror left-right
static void matrixShow(uint8_t rot) {
  for (uint8_t r = 0; r < 8; r++) {
    uint8_t row = 0;
    for (uint8_t c = 0; c < 8; c++) {
      uint8_t cc = (rot & 4) ? 7 - c : c, sr, sc;
      switch (rot & 3) {
        case 0: sr = r; sc = cc; break;
        case 1: sr = 7 - cc; sc = r; break;
        case 2: sr = 7 - r; sc = 7 - cc; break;
        default: sr = cc; sc = 7 - r; break;
      }
      if (mx[sr] & (0x80 >> sc)) row |= 0x80 >> c;
    }
    maxWrite(r + 1, row);
  }
}

// ---- faces -----------------------------------------------------------------------------
#define MOUTH_SMILE 0
#define MOUTH_FLAT 1
#define MOUTH_O 2
#define MOUTH_SLEEP 3

// look: -1 = toward the sensor end, 0 = ahead, +1 = toward the far end
static void drawFace(int8_t look, uint8_t mouth) {
  memset(mx, 0, 8);
  if (mouth == MOUTH_SLEEP) {
    mx[2] = 0x66;
    mx[5] = 0x18;
    return;
  }
  for (uint8_t r = 1; r <= 2; r++) {
    px(r, 1 + look); px(r, 2 + look);
    px(r, 5 + look); px(r, 6 + look);
  }
  if (mouth == MOUTH_SMILE) { mx[4] = 0x81; mx[5] = 0x42; mx[6] = 0x3C; }
  else if (mouth == MOUTH_FLAT) { mx[5] = 0x3C; }
  else { mx[4] = 0x18; mx[5] = 0x24; mx[6] = 0x18; }
}

static void drawQuestion() {
  static const uint8_t Q[8] = { 0x3C, 0x42, 0x02, 0x0C, 0x10, 0x00, 0x10, 0x00 };
  memcpy(mx, Q, 8);
}

// a line tilted like the beam, used while calibrating
static void drawLevel(float deg) {
  memset(mx, 0, 8);
  float slope = tan(deg * 0.0174533f) * 3.0f;
  for (int8_t c = 0; c < 8; c++) {
    int8_t r = 4 + (int8_t)lroundf((c - 3.5f) * slope);
    px(constrain(r, 0, 7), c);
  }
}

// neurons: rows 0-1 first hidden layer, rows 3-4 second, row 6 tilt, row 7 ball and target
static void drawNeurons(const float *h1, const float *h2, float u, float x, float tgt, bool blink) {
  memset(mx, 0, 8);
  for (uint8_t i = 0; i < 16; i++) { if (h1[i] > 0) px(i / 8, i % 8); if (h2[i] > 0) px(3 + i / 8, i % 8); }
  int8_t t = (int8_t)lroundf(u * 4);
  if (t > 0) for (int8_t c = 4; c < 4 + t; c++) px(6, c);
  else if (t < 0) for (int8_t c = 4 + t; c < 4; c++) px(6, c);
  else { px(6, 3); px(6, 4); }
  px(7, (int8_t)constrain(lroundf((x - X_MIN) / (X_MAX - X_MIN) * 7), 0, 7));
  if (blink) px(7, (int8_t)constrain(lroundf((tgt - X_MIN) / (X_MAX - X_MIN) * 7), 0, 7));
}

// a tiny copy of the robot: the beam as a tilted line, the ball riding on it, target below
static void drawTrack(float deg, float x, float tgt, bool blink) {
  memset(mx, 0, 8);
  float slope = tan(deg * 0.0174533f) * 4.0f;
  int8_t bc = (int8_t)constrain(lroundf((x - X_MIN) / (X_MAX - X_MIN) * 7), 0, 7);
  for (int8_t c = 0; c < 8; c++) {
    int8_t r = 5 + (int8_t)lroundf((c - 3.5f) * slope);
    r = constrain(r, 1, 6);
    px(r, c);
    if (c == bc) px(r - 1, c);
  }
  if (blink) px(7, (int8_t)constrain(lroundf((tgt - X_MIN) / (X_MAX - X_MIN) * 7), 0, 7));
}
