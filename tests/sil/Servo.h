#pragma once
#include "Arduino.h"
namespace sim { extern int servoUs; extern bool servoAttached; }
struct Servo {
  void attach(int, int, int) { sim::servoAttached = true; }
  void writeMicroseconds(int us) { sim::servoUs = us; }
};
