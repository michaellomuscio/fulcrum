// Minimal NEC infrared decoder for the kit's remote. Runs on pin 2's interrupt and uses only
// micros(), so it never fights the Servo library for a timer.
#pragma once
#include <Arduino.h>
#include "spec.h"

static volatile uint32_t irEdge = 0, irBits = 0;
static volatile uint8_t irState = 0, irCount = 0, irCmd = 0;
static volatile bool irReady = false, irRepeat = false;

static void irISR() {
  uint32_t now = micros();
  uint32_t dt = now - irEdge;
  irEdge = now;
  bool high = digitalRead(PIN_IR);
  if (high) {                       // a mark (carrier burst, output LOW) just ended
    if (dt > 8000 && dt < 10000) irState = 1;          // 9 ms leader
    else if (irState == 2 && (dt < 300 || dt > 900)) irState = 0;
  } else {                          // a space (output HIGH) just ended
    if (irState == 1) {
      if (dt > 4000 && dt < 5000) { irState = 2; irBits = 0; irCount = 0; }
      else if (dt > 2000 && dt < 2700) { irRepeat = true; irState = 0; }
      else irState = 0;
    } else if (irState == 2) {
      if (dt > 1300 && dt < 2000) { irBits |= (1UL << irCount); irCount++; }
      else if (dt > 300 && dt < 900) irCount++;
      else irState = 0;
      if (irCount == 32) {
        uint8_t cmd = (irBits >> 16) & 0xFF, ncmd = (irBits >> 24) & 0xFF;
        if ((uint8_t)(cmd ^ ncmd) == 0xFF) { irCmd = cmd; irReady = true; }
        irState = 0;
      }
    }
  }
}

static void irBegin() {
  pinMode(PIN_IR, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_IR), irISR, CHANGE);
}

// returns a command byte, or -1 when nothing new arrived
static int irPoll() {
  if (!irReady) return -1;
  noInterrupts();
  uint8_t c = irCmd;
  irReady = false;
  interrupts();
  return c;
}
