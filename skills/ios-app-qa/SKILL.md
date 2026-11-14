---
name: ios-app-qa
description: QA and fix a SwiftUI/UIKit iOS app on simulator or device - build with xcodebuild, drive and screenshot with simctl, reproduce bugs, fix test-first, review visuals on real screen sizes. Use for "test my iOS app", "fix this iOS bug", "QA the app", "review the app's design".
---

# iOS app QA

## When to use
Use this to test an iOS app before release, reproduce and fix a reported bug, or review how screens actually look across devices, appearance modes and text sizes. It needs macOS with Xcode installed. If Xcode is missing, say so and stop rather than guessing. Store submission and signing are out of scope, except where they cause a build failure.

## Gather first
- **Project layout.** The `.xcodeproj` or `.xcworkspace`, schemes (`xcodebuild -list`), test targets, and the minimum iOS version.
- **Available runtimes and devices.** `xcrun simctl list devices available`. Pick a small phone, a large phone, and an iPad if the app supports it.
- **What to test.** A bug report with steps, a feature to check, or a general pass. Ask for test accounts or seed data if screens sit behind a login. Never use real customer credentials.
- **Whether a physical device is attached** (`xcrun devicectl list devices` on recent Xcode). Some behaviour, such as camera, push, real keyboards and performance, only shows there.

## Build and run
1. Build for the simulator: `xcodebuild -scheme <S> -destination 'platform=iOS Simulator,name=<device>' build`. Read the first error, not the last. Resolve signing issues by building for the simulator, which needs no signing.
2. Boot and install: `xcrun simctl boot <udid>`, then `xcrun simctl install booted <path/to/App.app>`, then `xcrun simctl launch booted <bundle-id>`.
3. Run the tests: `xcodebuild test -scheme <S> -destination ...`. Record the baseline failures before changing anything.
4. Capture evidence: `xcrun simctl io booted screenshot <file>.png` and `xcrun simctl io booted recordVideo <file>.mp4`. Stream logs with `xcrun simctl spawn booted log stream --predicate 'subsystem == "<bundle-id>"'`.

## QA pass
- **Core flows** end to end: first launch, onboarding, sign in and out, the main task, settings.
- **States:** empty, loading, error (turn off the network, or point at a failing endpoint), long content, and large data sets.
- **Environment variation:**
  - Dark mode (`xcrun simctl ui booted appearance dark`).
  - Dynamic Type at the largest accessibility sizes (`xcrun simctl ui booted content_size accessibility-extra-extra-extra-large`, flag names may vary by Xcode version).
  - Rotation, and other locales, including a long-text language and a right-to-left one.
  - Small screens with the keyboard up.
- **Lifecycle:** background and foreground, kill and relaunch, deep links (`xcrun simctl openurl booted <url>`), push notification payloads (`xcrun simctl push`), permission prompts denied and then granted (`xcrun simctl privacy`).
- **Accessibility:** VoiceOver labels on interactive elements, tap targets of reasonable size, contrast, and nothing conveyed by colour alone. The Accessibility Inspector helps if available.

Driving taps on the simulator from the command line is limited. Prefer XCUITest UI tests for repeatable flows, and ask the user to tap through when a manual step is unavoidable.

## Fixing a bug
1. **Reproduce** it, and capture a screenshot or log of the failure. If you can't reproduce it, report what you tried. Don't fix blind.
2. **Write a failing test** at the lowest level that shows the bug: a unit test for logic, a UI test for flow or layout regressions.
3. **Find the cause.** Common SwiftUI suspects:
   - State owned at the wrong level (`@State` vs `@StateObject`/`@Observable` ownership).
   - Work on the main actor that should not be, or UI updates off the main actor.
   - Identity changes resetting views (unstable `id`).
   - Fixed frames breaking under Dynamic Type.
   - Safe-area and keyboard handling.
4. **Fix minimally**, and re-run the test, the full suite and the screens around the change.
5. **Re-check the original repro on the simulator**, and on a device if the bug was device-specific.

## Visual review
Screenshot every key screen at each device size, in light and dark modes and at the largest text size. Look for:
- Clipped or truncated text, and overlapping elements.
- Inconsistent spacing and alignment.
- Off-system fonts or colours that ignore dark mode.
- Controls that don't follow platform conventions (navigation, sheets, destructive-action styling).
- Content under the notch, the Dynamic Island or the home indicator.
Report each issue with a screenshot path and a concrete suggested change.

## Report
Lead with the outcome: bugs found and fixed, or issues found, ranked by severity. For each, give the steps, the evidence file, and the fix or recommendation. State which devices, OS versions and modes were covered, the test results before and after, and what was not verified, especially anything that only a physical device can confirm.
