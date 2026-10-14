// Ball tracker, integral and observation builder. Line for line the same math as
// core/world.js (Tracker, stepIntegral, makeObs), so the brain sees what it saw in training.
#pragma once
#include <Arduino.h>
#include "spec.h"

static inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

struct Tracker {
  float x = X_CENTER, v = 0;
  uint8_t rej = 0, nv = 0;
  bool locked = false, blind = false;

  void reset() { x = X_CENTER; v = 0; rej = 0; nv = 0; locked = false; blind = false; }

  void coast() {
    x = clampf(x + v * DT, F_X_LO, F_X_HI);
    v = clampf(v * F_V_DECAY, -F_V_MAX, F_V_MAX);
  }

  // reading: meters to the ball's near surface, or negative for "no reading".
  // Returns 0 = coasting, 1 = reading used, 2 = (re)locked, 3 = ball hiding in the sonar's blind spot.
  uint8_t update(float reading) {
    bool valid = reading >= READ_MIN && reading <= READ_MAX;
    float z = reading + BALL_R;
    bool wall = valid && z > WALL_Z;   // the sonar sees past the ball, all the way to the far wall
    if (!valid || (wall && x < BLIND_ZONE)) {
      if (nv < 255) nv++;
      if (blind || (x < BLIND_ZONE && ((wall && nv >= 2) || nv >= NOVIS_TICKS))) {
        blind = true; x = BLIND_X; v = 0; rej = 0;
        return 3;
      }
      coast();
      return 0;
    }
    nv = 0;
    if (!locked || blind) {
      x = z < F_X_HI ? z : F_X_HI; v = 0; locked = true; blind = false; rej = 0;
      return 2;
    }
    float r = z - (x + v * DT);
    if (fabs(r) > F_GATE) {
      if (rej < F_MAX_REJECT) { rej++; coast(); return 0; }
      x = z < F_X_HI ? z : F_X_HI; v = 0; rej = 0;
      return 2;
    }
    rej = 0;
    x = clampf(x + v * DT + F_ALPHA * r, F_X_LO, F_X_HI);
    v = clampf(v + (F_BETA / DT) * r, -F_V_MAX, F_V_MAX);
    return 1;
  }
};

static inline float stepIntegral(float I, float err) {
  if (fabs(err) < I_BAND) I = clampf(I + err * DT, -I_LIM, I_LIM);
  return I;
}

static inline void makeObs(float *o, float xh, float vh, float tgt, float a1, float a2, float I) {
  o[0] = clampf((xh - tgt) / E_SCALE, -OBS_CLIP, OBS_CLIP);
  o[1] = clampf(vh / V_SCALE, -OBS_CLIP, OBS_CLIP);
  o[2] = a1;
  o[3] = a2;
  o[4] = I / I_LIM;
  o[5] = clampf((xh - X_CENTER) / X_SCALE, -OBS_CLIP, OBS_CLIP);
}
