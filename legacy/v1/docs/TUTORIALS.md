# Tutorials

## Purpose

Maulya uses one shared tutorial engine across demo and main app. The engine is policy-driven so the same components, step definitions, help center, and coachmark layer can serve different onboarding behavior without forking the code.

Implementation root:
- `frontend/src/demo/tutorial/`

## Policy Modes

### Demo

Environment trigger:
- `VITE_DEMO_MODE=1`

Behavior:
- tutorial engine enabled
- onboarding modal opens automatically for authenticated first-time visitors
- mission panel is visible by default
- help routes use demo-oriented copy
- launcher is usually hidden because the mission panel already exposes start, help, and reset actions

Intent:
- remove guesswork from public exploration
- teach one complete workflow quickly
- keep the demo self-explanatory

### Main App

Environment trigger:
- `VITE_DEMO_MODE=0`

Behavior:
- tutorial engine enabled
- no demo auto-launch behavior
- one-time optional first-login prompt appears
- mission panel stays hidden by default
- compact launcher remains available from shell surfaces
- users can restart or reset the tour from account/profile views
- help routes use live-workspace copy instead of demo copy

Intent:
- avoid annoying regular operators
- make onboarding available for new hires and associates
- keep the live workspace tour view-first and low-risk

## Policy Source

Policy is defined in:
- `frontend/src/demo/tutorial/tutorialPolicy.js`

Current policy fields:
- `academyLabel`
- `introTitle`
- `introCopy`
- `introStartLabel`
- `introDismissLabel`
- `introSecondaryDismissLabel`
- `helpLabel`
- `helpTitle`
- `helpSubtitle`
- `helpKicker`
- `helpWorkflowBody`
- `launcherLabel`
- `launcherTitle`
- `launcherSummary`
- `startLabel`
- `resumeLabel`
- `resetLabel`
- `shouldAutoStart`
- `shouldShowFirstLoginPrompt`
- `shouldShowMissionPanelByDefault`
- `helpPaths`
- `disclaimer`

## Shared Components

Core shared components:
- `DemoTutorialContext.jsx`
- `DemoOnboardingModal.jsx`
- `DemoMissionPanel.jsx`
- `DemoCoachmarkLayer.jsx`
- `DemoTutorialLauncher.jsx`
- `DemoHelpCenter.jsx`
- `DemoInlineHelp.jsx`

Supporting files:
- `demoTutorialSteps.js`
- `demoGlossary.js`
- `tutorialStorage.js`
- `useDemoTutorial.js`

## Mount Points

Global shell mounts:
- desktop: `frontend/src/components/layout/AppShell.jsx`
- mobile: `frontend/src/mobile/MobileLayout.jsx`

Mission panel mounts:
- `frontend/src/mobile/screens/HomeScreen.jsx`
- `frontend/src/pages/partner/PartnerHome.jsx`
- `frontend/src/pages/Account.jsx`
- `frontend/src/pages/admin/AdminDashboard.jsx`

Help routes:
- desktop: `/help/demo`, `/help/tutorial`
- mobile: `/m/help/demo`, `/m/help/tutorial`

Profile/reset entry points:
- desktop: `frontend/src/pages/Account.jsx`
- mobile: `frontend/src/mobile/screens/ProfileScreen.jsx`

## Storage Model

Tutorial state is stored in localStorage through app-instance namespaced keys.

Current keys:
- `maulya.tutorial.state.v2`
- `maulya.tutorial.dismissed.v2`
- `maulya.tutorial.role.v2`

Legacy demo-only keys are still read for migration:
- `maulya.demo.tutorial.state.v1`
- `maulya.demo.tutorial.dismissed.v1`
- `maulya.demo.tutorial.role.v1`

Because storage is namespaced through `VITE_APP_INSTANCE`, demo and main do not collide.

## Route Resolution Rules

Static step routes use direct navigation.

Dynamic routes with `:id` resolve in this order:
- current pathname if it already contains `/assignments/:id`
- `routeSourceTarget` selector with `data-tour-route`
- otherwise the step stays manual and the user continues through the highlighted surface

This is why list rows used by the tour expose `data-tour-route`.

## Mission Panel Visibility Rules

Mission panel shows when:
- the active policy says it should be visible by default, or
- a tutorial has been started and not dismissed

This keeps demo highly guided while keeping the main app quiet by default.

## Launcher Visibility Rules

Launcher shows when:
- tutorial is enabled, and
- the mission panel is not visible

This gives the main app a compact entry point without duplicating demo controls.

## QA Expectations

Minimum QA for tutorial behavior:
- demo prompt appears automatically for first authenticated visit
- main prompt appears once and can be dismissed
- manual launcher can open the tour on main
- reset clears tutorial state
- help routes open from both launcher and mission panel
- coachmark can advance across at least three associate steps
