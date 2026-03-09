import React from 'react'

import MobileLayout from '../MobileLayout'
import DemoHelpCenter from '../../demo/tutorial/DemoHelpCenter'
import { useDemoTutorial } from '../../demo/tutorial/useDemoTutorial'

export default function DemoHelpScreen() {
  const { policy } = useDemoTutorial()

  return (
    <MobileLayout
      title={policy.helpTitle}
      subtitle="Quick start and glossary"
      secondaryAction={{ label: 'Home', to: '/m/home' }}
    >
      <DemoHelpCenter mobile />
    </MobileLayout>
  )
}
