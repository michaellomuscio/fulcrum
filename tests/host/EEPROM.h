// Array-backed EEPROM for desktop tests.
#pragma once
#include <cstdint>
#include <cstring>
struct EEPROMClass {
  uint8_t mem[1024];
  uint8_t read(int a) { return mem[a]; }
  void write(int a, uint8_t v) { mem[a] = v; }
  void update(int a, uint8_t v) { mem[a] = v; }
  template <class T> T &get(int a, T &t) { memcpy(&t, mem + a, sizeof(T)); return t; }
  template <class T> const T &put(int a, const T &t) { memcpy(mem + a, &t, sizeof(T)); return t; }
};
static EEPROMClass EEPROM;
