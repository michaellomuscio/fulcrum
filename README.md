# Fulcrum

A cardboard ball-and-beam robot, built from an ELEGOO Most Complete Starter Kit, whose brain is
trained by reinforcement learning in a browser simulator and then sent over USB into the Arduino.

**Start with the guide**: 30 illustrated, narrated steps, with a 3D model, wiring diagrams for every step,
printable cut templates (`guide/fulcrum-cut-templates.pdf`) and 16 minutes of narration.
Serve the folder (below) and open http://localhost:8642/guide/.

## Quick start

1. Build the cardboard beam and wire the electronics (guide parts 1–2).
2. Double-click **`Fulcrum Gym.command`** (macOS). Chrome opens the Gym at http://localhost:8642/gym/.
   Elsewhere: run `python3 -m http.server 8642` in this folder and open that address in Chrome
   (USB access needs Chrome and a localhost or https page).
3. Robot tab: Connect, Install firmware, check the parts, mount the servo, Calibrate.
4. Dream tab: Start training. Exam tab: run the exam. Robot tab: Send best brain, Brain mode.

No hardware yet? The Robot tab's **Try a virtual one** runs the whole flow against a simulated robot.

## Layout

| Path | What |
|---|---|
| `core/` | shared JavaScript: `spec.js` (every constant), `world.js` (physics, sonar, tracker), `ppo.js` + `mlp.js` (the learner), `brain.js` (8-bit packing, CRC), `calibrate.js` (calibration, also ported to the firmware), `evaluate.js` (the exam) |
| `firmware/Fulcrum/` | Arduino Uno firmware. `spec.h` is generated from `core/spec.js`. Protocol: `firmware/PROTOCOL.md` |
| `gym/` | the Gym web app (training in a Web Worker, exam, Web Serial robot link, STK500 firmware installer, virtual robot) |
| `guide/` | the build guide, narration (Kokoro af_heart), illustrations, cut templates |
| `tools/` | headless training, exam, and the test suite |
| `tests/` | desktop builds of the firmware for testing |
| `BUILD_SPEC.md` | dimensions, positions and wiring |

## Commands

```sh
node tools/build.mjs                 # regenerate spec.h, compile the firmware, embed it in the Gym
node tools/train_node.mjs 240 7      # train a brain headlessly (iterations, seed)
node tools/exam_node.mjs tools/out/actor_seed7.json
node tools/make_factory_brain.mjs tools/out/actor_xxx.json starter   # new starter brain
node tools/host_test.mjs             # firmware math == simulator math (needs tests/host/host_test built)
node tools/test_calibration.mjs 100  # calibration + balancing on 100 random simulated builds
node tools/sil_test.mjs              # the real firmware (tests/sil/sil) driving the simulated robot
node guide/tools/build_guide.mjs     # assemble the guide
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn arduino:avr:uno firmware/Fulcrum   # flash without the Gym
```

Build the desktop test binaries:

```sh
cd tests/host && clang++ -std=c++17 -O2 -ffp-contract=off -w -I. host_test.cpp -o host_test
cd tests/sil  && clang++ -std=c++17 -O2 -ffp-contract=off -w -I. -x c++ sil_main.cpp -o sil
```
