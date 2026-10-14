// Feeds the firmware's tracker, brain and calibrator the vectors written by tools/host_test.mjs.
#include "Arduino.h"
#include "EEPROM.h"
#include "../../firmware/Fulcrum/spec.h"
#include "../../firmware/Fulcrum/tracker.h"
#include "../../firmware/Fulcrum/brain.h"
#include "../../firmware/Fulcrum/calibrate.h"

void calLog(const char *tag, long a, long b, uint8_t n) {
  if (n == 0) printf("L %s\n", tag); else if (n == 1) printf("L %s %ld\n", tag, a); else printf("L %s %ld %ld\n", tag, a, b);
}

int main() {
  int n; if (scanf("%d", &n) != 1) return 1;            // brain bytes
  for (int i = 0; i < n; i++) { unsigned v; scanf("%2x", &v); EEPROM.mem[EE_BRAIN + i] = (uint8_t)v; }
  printf("valid %d name %s len %u\n", brainValidate() ? 1 : 0, brainName, brainLen);
  int m; scanf("%d", &m);                               // observation vectors
  for (int i = 0; i < m; i++) {
    float o[NET_IN]; for (int k = 0; k < NET_IN; k++) scanf("%f", &o[k]);
    printf("u %.9g\n", brainRun(o));
  }
  int r; scanf("%d", &r);                               // tracker readings + targets
  Tracker t; float I = 0;
  for (int i = 0; i < r; i++) {
    float reading, target; scanf("%f %f", &reading, &target);
    uint8_t k = t.update(reading);
    I = stepIntegral(I, t.x - target);
    printf("t %d %.9g %.9g %.9g\n", k, t.x, t.v, I);
  }
  int runs; scanf("%d", &runs);                         // calibration replays
  static Calibrator cal;
  for (int q = 0; q < runs; q++) {
    int hasImu, usLevel, ticks; float usPerDeg;
    scanf("%d %d %f %d", &hasImu, &usLevel, &usPerDeg, &ticks);
    cal.begin(hasImu, usLevel, usPerDeg);
    printf("R %d\n", q);
    for (int i = 0; i < ticks; i++) {
      float x, v, g[3]; int hasG; scanf("%f %f %d %f %f %f", &x, &v, &hasG, &g[0], &g[1], &g[2]);
      int us = cal.tick(x, v, hasG ? g : nullptr);
      printf("c %d %.6g\n", us, cal.lastU);
    }
    printf("E %d %d %d %ld", cal.ok, cal.sign, cal.levelSure, jsRound(cal.trimDeg * 100));
    for (int k = 0; k < CAL_TABLE_N; k++) printf(" %d", cal.hasTable ? cal.table[k] : 0);
    printf("\n");
  }
  return 0;
}
