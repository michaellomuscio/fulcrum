# Fulcrum build spec

The single source of truth for the physical build. The guide's text, the 3D illustrations, the
wiring diagrams and the firmware all follow this file. Units are centimeters unless noted.
Coordinates: **x** runs along the track from the sonar end (x = 0 at the sonar plate) to the far
wall (x = 44); **y** is across the robot (toward the viewer is −y); **z** is up from the tabletop.

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

## Cut list (corrugated cardboard, about 4 mm thick)

| Part | Size | Qty | Notes |
|---|---|---|---|
| Base | 52 × 16 | 1 | |
| Track | 44 × 7 | 1 | corrugation (flutes) running along the 44 cm length |
| Saddle | 7 wide × 4.5 tall | 4 | 90° V-notch cut from both top corners down to the center, 3.5 deep |
| Tower | 7 wide × 14 tall | 2 | flutes vertical; skewer hole 1.5 below the top edge, centered |
| Tower brace | right triangle, legs 5 × 9 | 2 | |
| Sonar plate | 7 wide × 9 tall | 1 | two 1.6 cm holes, see assembly |
| Far wall | 7 wide × 6 tall | 1 | |
| Servo post | 6 wide × 8 tall | 1 | |
| Post brace | right triangle, legs 4 × 6 | 1 | |

## Assembly (finished geometry)

- **Base** lies flat: x from −4 to 48, y from −8 to 8, z from 0 to 0.4.
- **Track**: the 44 × 7 strip scored down the middle and folded to a 90° V (each wall 3.5 wide). The V's
  outer apex (the fold) runs along y = 0. Optional: line the inside with clear packing tape.
- **Saddles** under the track, perpendicular to it, at x = 5, 22 (pivot), 29 (push-rod), 39. Each
  saddle's notch hugs the outside of the V.
- **Straw**: 10.5 long, glued along the bottom edge of the pivot saddle (x = 22), running across (along y).
- **Push-rod hole**: in the x = 29 saddle, 0.7 above its bottom edge, centered (poke with a skewer tip).
- **Sonar plate**: glued across the x = 0 end of the track, centered on the V, its bottom edge about
  1 cm below the fold. The HC-SR04's two silver cans poke through two 1.6 cm holes, 2.6 cm apart
  center to center, centered at the height of the ball's center (find it by holding the ball in the
  V against the plate and marking). Sonar board on the outside, its 4 pins pointing down.
- **Far wall**: glued across the x = 44 end.
- **Towers**: stand on the base at x = 18.5..25.5 (centered on x = 22), one on each side of the track:
  inner faces at y = ±5.35 (10.7 apart). Each has a brace glued to its **inner** face along its sonar-side
  edge (x = 18.5..18.9). A brace on the outer face would hang 2.75 cm off the 16 cm base and the front one
  would hit the LED matrix. The inner braces stay under 9.4 cm and clear the beam even at full tilt.
- **Pivot**: a bamboo skewer runs along y through tower, straw, tower, at height z = 12.9 (hole 1.5 below
  each tower's 14 cm top; the towers stand on the 0.4 cm base). The track's fold sits about 1.3 above the skewer; the ball's center about
  4.5 above it. Trim the skewer to about 13 long.
- **Servo post**: 6 × 8 upright standing on the base just behind the track's centerline: its front face at
  y = +3.4, spanning x = 25.8..31.8 (clear of the back tower, which ends at x = 25.5). Its brace stands
  behind it at x ≈ 31.4.
- **Servo (SG90)**: glued by its bottom face to the post's front face, output shaft pointing toward −y
  (toward the viewer). That puts the horn in the track's own vertical plane (y ≈ 0). Shaft at x ≈ 27.6,
  z ≈ 5.
- **Horn**: the long single-arm horn, pushed on while the servo holds its middle position (the Gym's
  Level button), pointing horizontally toward the far wall (+x). Its outermost hole is then at x ≈ 29.
- **Push-rod**: a straightened large paperclip from that horn hole straight up to the hole in the x = 29
  saddle, about 9 between its hooked ends (about 10.5 cm of wire). Vertical when the beam is level. Bend each hook closed after
  threading it so it can't slip out; the joints must still turn freely (no glue on them).
- **Gyro (GY-521)**: stuck to the outside of the track's front wall near x = 15, any orientation
  (calibration figures out how it's mounted). Double-sided tape or a dab of hot glue on the board's edge.
- **LED matrix (MAX7219 module)**: stuck to the front face of the front tower, below the skewer, facing
  the viewer. Pins at the side.
- **Ball**: ping-pong ball, radius 2. Golf ball or small rubber ball also work (pick it in the Gym).
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
