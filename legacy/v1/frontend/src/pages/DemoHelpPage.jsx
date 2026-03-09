import React from 'react'
import { Link } from 'react-router-dom'

import PageHeader from '../components/ui/PageHeader'
import DemoHelpCenter from '../demo/tutorial/DemoHelpCenter'
import { useDemoTutorial } from '../demo/tutorial/useDemoTutorial'

export default function DemoHelpPage() {
  const { policy } = useDemoTutorial()

  return (
    <div className="demo-help-page">
      <PageHeader
        eyebrow={policy.academyLabel}
        title={policy.helpTitle}
        subtitle={policy.helpSubtitle}
        actions={<Link className="nav-link" to="/">Back to workspace</Link>}
      />
      <DemoHelpCenter />
    </div>
  )
}
