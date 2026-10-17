# Fulcrum build spec

The single source of truth for the physical build. The guide's text, the 3D illustrations, the
wiring diagrams and the firmware all follow this file. Units are inches unless noted, rounded to the
nearest 1/8 in so they can be measured with an ordinary ruler. (The simulator, the 3D model and the
firmware work in metric; each inch size here is within 1/8 in of the metric size they use, and
calibration absorbs the difference.)
Coordinates: **x** runs along the track from the sonar end (x = 0 at the sonar plate) to the far
wall (x = 17 1/4); **y** is across the robot (toward the viewer is −y); **z** is up from the tabletop.

## Materials

From the ELEGOO kit (names as printed on the lid card):
UNO R3 Controller Board, USB Cable, 830 Tie-Points Breadboard, Power Supply Module, 9V1A Adapter,
Servo Motor SG90 (with its horns), Ultrasonic Sensor (HC-SR04), GY-521 Module, MAX7219 Module (8×8
LED matrix), IR Receiver Module, Remote Control, Active Buzzer, Potentiometer 10K, 100uF Electrolytic
Capacitor, Breadboard Jumper Wire (male-male, about 14), Female-to-Male Dupont Wire (13).

From home: corrugated cardboard (one medium shipping box), a ping-pong ball, 2 bamboo skewers, 1 plastic
drinking straw, 1 large paperclip, hot glue gun, box cutter or sturdy scissors, ruler, pencil, double-sided
tape (or poster putty), optional clear packing tape. A MacBook also needs a USB-C to USB-A adapter
(the kit's cable is USB-A to USB-B).

## Cut list (corrugated cardboard, about 3/16 in thick)

| Part | Size | Qty | Notes |
|---|---|---|---|
| Base | 20 1/2 × 6 1/4 | 1 | |
| Track | 17 1/4 × 2 3/4 | 1 | corrugation (flutes) running along the 17 1/4 in length |
| Saddle | 2 3/4 wide × 1 3/4 tall | 4 | 90° V-notch cut from both top corners down to the center, 1 3/8 deep |
| Tower | 2 3/4 wide × 5 1/2 tall | 2 | flutes vertical; skewer hole 5/8 below the top edge, centered |
| Tower brace | right triangle, legs 2 × 3 1/2 | 2 | |
| Sonar plate | 2 3/4 wide × 3 1/2 tall | 1 | two 5/8 in holes, see assembly |
| Far wall | 2 3/4 wide × 2 3/8 tall | 1 | |
| Servo post | 2 3/8 wide × 3 1/8 tall | 1 | |
| Post brace | right triangle, legs 1 5/8 × 2 3/8 | 1 | |

## Assembly (finished geometry)

- **Base** lies flat: x from −1 5/8 to 18 7/8, y from −3 1/8 to 3 1/8, z from 0 to 3/16.
- **Track**: the 17 1/4 × 2 3/4 strip scored down the middle and folded to a 90° V (each wall 1 3/8 wide).
  The V's outer apex (the fold) runs along y = 0. Optional: line the inside with clear packing tape.
- **Saddles** under the track, perpendicular to it, at x = 2, 8 5/8 (pivot), 11 3/8 (push-rod), 15 3/8.
  Each saddle's notch hugs the outside of the V.
- **Straw**: 4 1/8 long, glued along the bottom edge of the pivot saddle (x = 8 5/8), running across (along y).
- **Push-rod hole**: in the x = 11 3/8 saddle, 1/4 above its bottom edge, centered (poke with a skewer tip).
- **Sonar plate**: glued across the x = 0 end of the track, centered on the V, its bottom edge about
  3/8 below the fold. The HC-SR04's two silver cans poke through two 5/8 in holes, 1 in apart
  center to center, centered at the height of the ball's center (find it by holding the ball in the
  V against the plate and marking). Sonar board on the outside, its 4 pins pointing down.
- **Far wall**: glued across the x = 17 1/4 end.
- **Towers**: stand on the base at x = 7 1/4..10 (centered on x = 8 5/8), one on each side of the track:
  inner faces at y = ±2 1/8 (4 1/4 apart). Each has a brace glued to its **inner** face along its
  sonar-side edge. A brace on the outer face would hang about 1 in off the 6 1/4 in base and the front
  one would hit the LED matrix. The inner braces stay under 3 3/4 tall and clear the beam even at full tilt.
- **Pivot**: a bamboo skewer runs along y through tower, straw, tower, at height z ≈ 5 1/16 (hole 5/8
  below each tower's 5 1/2 in top; the towers stand on the 3/16 in base). The track's fold sits about
  1/2 above the skewer; the ball's center about 1 3/4 above it. Trim the skewer to about 5 1/2 long.
- **Servo post**: 2 3/8 × 3 1/8 upright standing on the base just behind the track's centerline: its
  front face at y = +1 3/8, spanning x ≈ 10 1/8..12 1/2 (clear of the back tower, which ends at x = 10).
  Its brace stands behind it.
- **Servo (SG90)**: glued by its bottom face to the post's front face, output shaft pointing toward −y
  (toward the viewer). That puts the horn in the track's own vertical plane (y ≈ 0). Shaft at
  x ≈ 10 7/8, z ≈ 2.
- **Horn**: the long single-arm horn, pushed on while the servo holds its middle position (the Gym's
  Level button), pointing horizontally toward the far wall (+x). Its outermost hole is then at x ≈ 11 3/8.
- **Push-rod**: a straightened large paperclip from that horn hole straight up to the hole in the
  x = 11 3/8 saddle, about 3 1/2 between its hooked ends (about 4 1/8 in of wire). Vertical when the
  beam is level. Bend each hook closed after threading it so it can't slip out; the joints must still
  turn freely (no glue on them).
- **Gyro (GY-521)**: stuck to the outside of the track's front wall near x = 6, any orientation
  (calibration figures out how it's mounted). Double-sided tape or a dab of hot glue on the board's edge.
- **LED matrix (MAX7219 module)**: stuck to the front face of the front tower, below the skewer, facing
  the viewer. Pins at the side.
- **Ball**: ping-pong ball (1 1/2 in across). Golf ball or small rubber ball also work (pick it in the Gym).
- **Electronics**: breadboard and Arduino sit on the table in front of the robot, toward the sonar end.

Ranges: the beam tilts about ±10° at the servo's ±700 µs; Fulcrum uses ±7° plus level trim.

## Breadboard wiring

830-point breadboard, horizontal. Columns 1 to 63 left to right. Terminal rows j..f (upper half) and
e..a (lower half). Rails on both long edges; on each edge the **inner rail is + (red stripe)** and the
**outer rail is − (blue stripe)**. Names: TP = top +, TN = top −, BP = bottom +, BN = bottom −.
Everything sits in columns 1 to 30, so it works even on breadboards whose rails are split in the middle.

**Power Supply Module** plugs into the left end of the breadboard across both rail pairs, its − pins on
the blue rails and + pins on the red rails, DC jack facing left. **Top-side jumper on 5V** (servo power).
**Bottom-side jumper on OFF.** The 9V1A adapter plugs into its DC jack. Press its button to switch on.

| Step | From | To | Wire |
|---|---|---|---|
| W1 power | UNO 5V | BP col 7 | red jumper |
| W1 power | UNO GND | BN col 7 | black jumper |
| W1 power | TN col 8 | BN col 8 | black jumper (one shared ground for both supplies) |
| W2 servo | 100 µF capacitor | long (+) leg TP col 14, striped (−) leg TN col 14 | (steadies servo power; polarity matters; col 9 would cover the col 8 bridge hole) |
| W2 servo | servo brown | TN col 11 | black jumper |
| W2 servo | servo red | TP col 11 | red jumper (the power module's 5 V) |
| W2 servo | servo orange | UNO D9 | orange jumper |
| W3 sonar | sonar VCC | BP col 13 | F-M red |
| W3 sonar | sonar Gnd | BN col 13 | F-M black |
| W3 sonar | sonar Trig | UNO D7 | F-M green |
| W3 sonar | sonar Echo | UNO D8 | F-M blue |
| W4 gyro | gyro VCC | BP col 15 | F-M red |
| W4 gyro | gyro GND | BN col 15 | F-M black |
| W4 gyro | gyro SCL | UNO A5 | F-M yellow |
| W4 gyro | gyro SDA | UNO A4 | F-M white |
| W5 knob | potentiometer legs | row c, cols 19, 20, 21 | (each leg its own column; some pots need cols 19, 21, 23) |
| W5 knob | col 19 (row a) | BN col 19 | black jumper |
| W5 knob | col 21 (row a) | BP col 21 | red jumper |
| W5 knob | col 20 (row e) | UNO A0 | yellow jumper |
| W6 face | LED matrix VCC | BP col 17 | F-M red |
| W6 face | LED matrix GND | BN col 17 | F-M black |
| W6 face | LED matrix DIN | UNO D11 | F-M purple |
| W6 face | LED matrix CS | UNO D10 | F-M gray |
| W6 face | LED matrix CLK | UNO D13 | F-M brown |
| W7 remote | IR receiver pins G, R, Y | row c, cols 23, 24, 25 | (receiver dome faces the front edge) |
| W7 remote | col 23 (row a) | BN col 23 | black jumper |
| W7 remote | col 24 (row a) | BP col 24 | red jumper |
| W7 remote | col 25 (row e) | UNO D2 | yellow jumper |
| W8 buzzer | active buzzer, + leg (longer, + on top) | row e col 27 | (a 12 mm buzzer covers rows b–d around it) |
| W8 buzzer | active buzzer, − leg | row e col 30 | |
| W8 buzzer | col 27 (row a) | UNO D3 | white jumper |
| W8 buzzer | col 30 (row a) | BN col 30 | black jumper |

Ground and 5 V wires can go into any hole of the correct rail in columns 7–30; the columns above are
the tidy layout the diagrams show.

## Arduino pins (firmware/Fulcrum/spec.h)

| Pin | Connects to |
|---|---|
| D2 | IR receiver Y (signal) |
| D3 | active buzzer + |
| D7 | sonar Trig |
| D8 | sonar Echo |
| D9 | servo signal (orange) |
| D10 | LED matrix CS |
| D11 | LED matrix DIN |
| D13 | LED matrix CLK |
| A0 | knob middle leg |
| A4 | gyro SDA |
| A5 | gyro SCL |
| 5V, GND | bottom rails (sensors) |
