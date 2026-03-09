import { isDemoMode } from '../../config/featureFlags'

export function getTutorialPolicy() {
  if (isDemoMode()) {
    return {
      key: 'demo',
      academyLabel: 'Demo Academy',
      introTitle: 'Start A Guided Tour',
      introCopy: 'This public workspace is designed to teach one complete workflow quickly. Pick a role, follow the mission panel, and move through the live demo without guessing.',
      introNoteTitle: 'Recommended now',
      introStartLabel: 'Start 5-minute tour',
      introDismissLabel: 'Explore on my own',
      introSecondaryDismissLabel: null,
      helpLabel: 'Open Demo Help',
      helpTitle: 'Demo Help Center',
      helpSubtitle: 'Quick start guidance, workflow explanations, and core terms for the public Maulya demo.',
      helpKicker: 'Demo Help',
      helpWorkflowBody: 'The public demo teaches the full control loop with safe sample data and can be reset without notice.',
      launcherLabel: 'Demo Academy',
      launcherTitle: 'Need a guided path?',
      launcherSummary: 'Start a role-based walkthrough or open the glossary without leaving the demo workspace.',
      startLabel: 'Start guided tour',
      resumeLabel: 'Resume guided tour',
      resetLabel: 'Reset tutorial',
      shouldAutoStart: true,
      shouldShowFirstLoginPrompt: false,
      shouldShowMissionPanelByDefault: true,
      helpPaths: {
        desktop: '/help/demo',
        mobile: '/m/help/demo',
      },
      disclaimer: 'This environment uses sample data only and can be refreshed at any time.',
    }
  }

  return {
    key: 'main',
    academyLabel: 'Workspace Tour',
    introTitle: 'Want A 3-minute Tour?',
    introCopy: 'Learn the workflow for your role inside the live Maulya workspace. You can start now, come back later from Help, or reset the tour from profile settings.',
    introNoteTitle: 'Recommended now',
    introStartLabel: 'Start guided tour',
    introDismissLabel: 'Not now',
    introSecondaryDismissLabel: "Don't show again",
    helpLabel: 'Open Tour Help',
    helpTitle: 'Workspace Tour Help',
    helpSubtitle: 'Quick start guidance, workflow explanations, and role-based navigation help for the main Maulya workspace.',
    helpKicker: 'Workspace Tour',
    helpWorkflowBody: 'The live workspace tour is view-first. It explains the control loop without forcing risky actions in a real environment.',
    launcherLabel: 'Help & Tour',
    launcherTitle: 'Need orientation?',
    launcherSummary: 'Start a role-based walkthrough, replay onboarding, or open the workflow glossary.',
    startLabel: 'Start guided tour',
    resumeLabel: 'Resume guided tour',
    resetLabel: 'Reset tutorial',
    shouldAutoStart: false,
    shouldShowFirstLoginPrompt: true,
    shouldShowMissionPanelByDefault: false,
    helpPaths: {
      desktop: '/help/tutorial',
      mobile: '/m/help/tutorial',
    },
    disclaimer: 'This is the main workspace. Guided steps explain the workflow and keep risky actions view-first.',
  }
}
