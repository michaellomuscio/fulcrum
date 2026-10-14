// Runs the real firmware (Fulcrum.ino) against a robot simulated by tools/sil_test.mjs.
// stdin, one command per line:
//   S <echoUs> <ax> <ay> <az> <knob>   set what the sensors will read
//   W <text>                          bytes arriving on the serial port (a newline is added)
//   I <hex>                           an IR remote button
//   A <ms>                            run the firmware for this long (1 ms steps)
// stdout: "O <line>" for each line the firmware prints, "V <servoUs> <t_ms>" after each A.
#include "Arduino.h"
#include "Servo.h"
#include "Wire.h"
#include "EEPROM.h"
namespace sim {
  uint64_t us = 0; uint32_t echoUs = 0; int knob = 512; int16_t accel[3] = {0, 0, 16384};
  bool imuPresent = true; std::string serialIn, serialOut; uint8_t matrixRows[8];
  int servoUs = 0; bool servoAttached = false;
}
SerialClass Serial; TwoWire Wire; EEPROMClass EEPROM;
static int mxBit = 0; static uint16_t mxWord = 0;
void shiftOut(int, int, int, uint8_t v) { mxWord = (mxWord << 8) | v; if (++mxBit == 2) { mxBit = 0; uint8_t reg = mxWord >> 8; if (reg >= 1 && reg <= 8) sim::matrixRows[reg - 1] = mxWord & 0xFF; } }

#include "../../firmware/Fulcrum/Fulcrum.ino"

static void flush() {
  size_t i;
  while ((i = sim::serialOut.find('\n')) != std::string::npos) { printf("O %s\n", sim::serialOut.substr(0, i).c_str()); sim::serialOut.erase(0, i + 1); }
}
int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "noimu")) sim::imuPresent = false;
  setvbuf(stdout, nullptr, _IOFBF, 1 << 16);
  setup(); flush(); fflush(stdout);
  char buf[512];
  while (fgets(buf, sizeof buf, stdin)) {
    buf[strcspn(buf, "\r\n")] = 0;
    if (buf[0] == 'S') { long e, ax, ay, az, k; sscanf(buf + 2, "%ld %ld %ld %ld %ld", &e, &ax, &ay, &az, &k); sim::echoUs = e; sim::accel[0] = ax; sim::accel[1] = ay; sim::accel[2] = az; sim::knob = k; }
    else if (buf[0] == 'W') { sim::serialIn += std::string(buf + 2) + "\n"; }
    else if (buf[0] == 'I') { handleIR((uint8_t)strtol(buf + 2, nullptr, 16)); }
    else if (buf[0] == 'A') { long ms = atol(buf + 2); for (long k = 0; k < ms; k++) { loop(); sim::us += 1000; } flush(); printf("V %d %lu\n", sim::servoUs, millis()); }
    else if (buf[0] == 'M') { printf("M"); for (int r = 0; r < 8; r++) printf(" %02X", sim::matrixRows[r]); printf("\n"); }
    fflush(stdout);
  }
  return 0;
}
