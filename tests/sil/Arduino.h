// Fake Arduino for software-in-the-loop tests: the real firmware runs on this Mac against a
// simulated robot. tools/sil_test.mjs plays the hardware over stdin/stdout.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <algorithm>
using std::min; using std::max;
typedef bool boolean;
typedef uint8_t byte;
#define PROGMEM
#define F(x) (x)
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define CHANGE 1
#define MSBFIRST 1
#define HEX 16
#define A0 14
#define A4 18
#define A5 19
inline uint8_t pgm_read_byte(const uint8_t *p) { return *p; }
template <class T, class U, class V> T constrain(T v, U lo, V hi) { return v < (T)lo ? (T)lo : (v > (T)hi ? (T)hi : v); }

namespace sim {
  extern uint64_t us;            // simulated clock
  extern uint32_t echoUs;        // what the sonar's echo pin will report this tick (0 = none)
  extern int knob;
  extern int16_t accel[3];
  extern bool imuPresent;
  extern std::string serialIn, serialOut;
  extern uint8_t matrixRows[8];
}
inline unsigned long micros() { return (unsigned long)sim::us; }
inline unsigned long millis() { return (unsigned long)(sim::us / 1000); }
inline void delay(unsigned long ms) { sim::us += ms * 1000; }
inline void delayMicroseconds(unsigned int u) { sim::us += u; }
inline void pinMode(int, int) {}
inline void digitalWrite(int, int) {}
inline int digitalRead(int) { return LOW; }
inline int analogRead(int) { return sim::knob; }
inline unsigned long pulseInLong(int, int, unsigned long timeout) { return sim::echoUs && sim::echoUs < timeout ? sim::echoUs : 0; }
inline int digitalPinToInterrupt(int p) { return p; }
inline void attachInterrupt(int, void (*)(), int) {}
inline void noInterrupts() {}
inline void interrupts() {}
void shiftOut(int dataPin, int clockPin, int order, uint8_t val);

struct SerialClass {
  void begin(long) {}
  int available() { return (int)sim::serialIn.size(); }
  int read() { if (sim::serialIn.empty()) return -1; int c = (uint8_t)sim::serialIn[0]; sim::serialIn.erase(0, 1); return c; }
  void print(const char *s) { sim::serialOut += s; }
  void print(char c) { sim::serialOut += c; }
  void print(int v, int base = 10) { print((long)v, base); }
  void print(unsigned int v, int base = 10) { print((unsigned long)v, base); }
  void print(long v, int base = 10) { char b[24]; snprintf(b, sizeof b, base == 16 ? "%lX" : "%ld", v); sim::serialOut += b; }
  void print(unsigned long v, int base = 10) { char b[24]; snprintf(b, sizeof b, base == 16 ? "%lX" : "%lu", v); sim::serialOut += b; }
  void print(double v, int d = 2) { char b[32]; snprintf(b, sizeof b, "%.*f", d, v); sim::serialOut += b; }
  template <class T> void println(T v) { print(v); sim::serialOut += '\n'; }
  template <class T> void println(T v, int base) { print(v, base); sim::serialOut += '\n'; }
  void println() { sim::serialOut += '\n'; }
};
extern SerialClass Serial;
